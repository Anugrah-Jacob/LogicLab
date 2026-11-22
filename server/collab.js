// Live collaboration API (served under /api/collab/*).
//
//   Share links     one per project: a "view" key (see and run) and an "edit" key (change the circuit).
//   Rooms           everyone who opens a link joins the room named by the share id.
//   Signalling      only the WebRTC handshake (offer, answer, ICE) passes through here, as a few short messages
//                   per connection. After that, edits, chat and voice go straight between the browsers.
//   Saving          people who may edit save the project through /doc, history versions through /history.
//
// Permissions are checked here (who may save) and again in every browser (who may change the shared circuit):
// each browser ignores edits from people whose role, as reported by this server, is "view".
import { json, fail, b64u, enc, seal, unseal } from './util.js';
import { loadProject, saveProjectDoc, PROJECT_ID, MAX_BYTES } from './projects.js';
import { historyOp } from './history.js';

const MAX_PEERS = 12;
const STALE_MS = 60_000;
const BEAT_MS = 15_000;
const MAX_SIGNAL = 16_000;
const SIGNALS_PER_MIN = 240;
const ROOM = /^[A-Za-z0-9_-]{6,40}$/;
const KINDS = new Set(['offer', 'answer', 'ice']);

const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const cleanName = (s, fallback) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24) || fallback;

function safeEq(a, b) {
  const x = enc.encode(String(a)),
    y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/* ---- peer tokens: HMAC(room | peer | role), so a peer id cannot be spoofed ---- */
async function macKey(env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET is missing or too short');
  return crypto.subtle.importKey('raw', enc.encode(env.JWT_SECRET + ':collab'), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ]);
}
const mint = async (env, room, peer, role) =>
  b64u(await crypto.subtle.sign('HMAC', await macKey(env), enc.encode(room + '|' + peer + '|' + role)));

/** Look up the caller in the room and check the token. Returns the peer row or a Response. */
async function who(env, room, body) {
  if (!ROOM.test(room) || !body || typeof body.peer !== 'string' || typeof body.token !== 'string')
    return fail(400, 'Bad request.');
  const p = await env.DB.prepare('SELECT peer,name,role,slot,seen FROM peers WHERE room=? AND peer=?')
    .bind(room, body.peer)
    .first();
  if (!p) return fail(410, 'Your session ended. Open the link again.');
  if (!safeEq(await mint(env, room, p.peer, p.role), body.token)) return fail(403, 'Bad session token.');
  return p;
}

async function iceServers(env) {
  if (env.ICE_SERVERS) {
    try {
      const v = JSON.parse(env.ICE_SERVERS);
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through to the defaults */
    }
  }
  if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
    try {
      const r = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer ' + env.TURN_API_TOKEN, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 })
        }
      );
      if (r.ok) {
        const v = (await r.json()).iceServers;
        if (Array.isArray(v) && v.length) return v;
      }
    } catch (e) {
      console.log('TURN credentials failed:', e.message);
    }
  }
  return [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
}

const roster = async (env, room) =>
  (
    await env.DB.prepare('SELECT peer,name,role,slot FROM peers WHERE room=? AND seen>? ORDER BY slot')
      .bind(room, Date.now() - STALE_MS)
      .all()
  ).results;

/* ---- share links (owner, signed in) ---- */
const links = async (env, r) => ({
  id: r.id,
  viewKey: await unseal(env, r.view_key),
  editKey: await unseal(env, r.edit_key),
  viewOn: !!r.view_on,
  editOn: !!r.edit_on,
  pid: r.pid
});
const shareOf = (env, uid, pid) => env.DB.prepare('SELECT * FROM shares WHERE uid=? AND pid=?').bind(uid, pid).first();

async function newKeys(env) {
  return [await seal(env, rand(16)), await seal(env, rand(16))];
}

async function shareAdmin(request, env, me, method, url) {
  if (method === 'GET') {
    const pid = url.searchParams.get('pid') || '';
    if (!PROJECT_ID.test(pid)) return fail(400, 'Bad project id.');
    const r = await shareOf(env, me.id, pid);
    return json({ share: r ? await links(env, r) : null });
  }
  if (method !== 'POST') return fail(405, 'Method not allowed.');
  const body = await request.json().catch(() => ({}));
  const pid = String(body.pid || '');
  if (!PROJECT_ID.test(pid)) return fail(400, 'Bad project id.');
  let r = await shareOf(env, me.id, pid);
  const kick = (roles) =>
    env.DB.prepare(`DELETE FROM peers WHERE room=? AND role IN (${roles.map(() => '?').join(',')})`).bind(
      r.id,
      ...roles
    );
  switch (body.action) {
    case 'create': {
      if (!r) {
        const p = await env.DB.prepare('SELECT 1 FROM projects WHERE uid=? AND id=?').bind(me.id, pid).first();
        if (!p) return fail(404, 'Sync this project to your account first (wait for "Synced"), then share it.');
        const [vk, ek] = await newKeys(env);
        await env.DB.prepare('INSERT INTO shares(id,uid,pid,view_key,edit_key,view_on,edit_on,created) VALUES(?,?,?,?,?,1,1,?)')
          .bind(rand(9), me.id, pid, vk, ek, Date.now())
          .run();
        r = await shareOf(env, me.id, pid);
      }
      return json({ share: await links(env, r) });
    }
    case 'rotate': {
      if (!r) return fail(404, 'This project is not shared.');
      const [vk, ek] = await newKeys(env);
      await env.DB.prepare('UPDATE shares SET view_key=?, edit_key=? WHERE id=?').bind(vk, ek, r.id).run();
      await kick(['view', 'edit']).run();
      return json({ share: await links(env, await shareOf(env, me.id, pid)) });
    }
    case 'toggle': {
      if (!r) return fail(404, 'This project is not shared.');
      const viewOn = body.viewOn === undefined ? !!r.view_on : !!body.viewOn,
        editOn = body.editOn === undefined ? !!r.edit_on : !!body.editOn;
      await env.DB.prepare('UPDATE shares SET view_on=?, edit_on=? WHERE id=?').bind(+viewOn, +editOn, r.id).run();
      const off = [];
      if (!viewOn) off.push('view');
      if (!editOn) off.push('edit');
      if (off.length) await kick(off).run();
      return json({ share: await links(env, await shareOf(env, me.id, pid)) });
    }
    case 'delete': {
      if (r) {
        await env.DB.prepare('DELETE FROM peers WHERE room=?').bind(r.id).run();
        await env.DB.prepare('DELETE FROM signals WHERE room=?').bind(r.id).run();
        await env.DB.prepare('DELETE FROM shares WHERE id=?').bind(r.id).run();
      }
      return json({ share: null });
    }
    default:
      return fail(400, 'Unknown action.');
  }
}

/* ---- joining a room ---- */
async function enter(env, share, role, name) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM peers WHERE room=? AND seen<?').bind(share.id, now - STALE_MS).run();
  await env.DB.prepare('DELETE FROM signals WHERE ts<?').bind(now - 120_000).run();
  const live = (await env.DB.prepare('SELECT slot FROM peers WHERE room=?').bind(share.id).all()).results;
  if (live.length >= MAX_PEERS) return fail(429, `This session is full (${MAX_PEERS} people).`);

  let proj;
  try {
    proj = await loadProject(env, share.uid, share.pid);
  } catch (e) {
    console.log('collab load failed', e.message);
    return fail(502, 'Could not read the project from storage.');
  }
  if (!proj) return fail(404, 'The owner deleted this project.');

  const used = new Set(live.map((r) => r.slot));
  const peer = 'p' + rand(6);
  for (let attempt = 0; attempt < 5; attempt++) {
    let slot = 0;
    while (used.has(slot)) slot++;
    try {
      await env.DB.prepare('INSERT INTO peers(room,peer,name,role,slot,seen) VALUES(?,?,?,?,?,?)')
        .bind(share.id, peer, name, role, slot, now)
        .run();
      return json({
        room: share.id,
        peer,
        token: await mint(env, share.id, peer, role),
        role,
        slot,
        name,
        title: proj.name,
        doc: proj.doc,
        updated: proj.updated,
        peers: (await roster(env, share.id)).filter((p) => p.peer !== peer),
        ice: await iceServers(env)
      });
    } catch (e) {
      used.add(slot); // another person took this slot a moment ago: try the next one
    }
  }
  return fail(503, 'Could not join right now. Try again.');
}

async function joinWithKey(request, env) {
  const body = await request.json().catch(() => ({}));
  const gone = () => fail(403, 'This link is not valid any more. Ask the owner for a new one.');
  if (typeof body.share !== 'string' || typeof body.key !== 'string' || !ROOM.test(body.share)) return gone();
  const r = await env.DB.prepare('SELECT * FROM shares WHERE id=?').bind(body.share).first();
  if (!r) return gone();
  let role = null;
  if (r.edit_on && safeEq(body.key, await unseal(env, r.edit_key))) role = 'edit';
  else if (r.view_on && safeEq(body.key, await unseal(env, r.view_key))) role = 'view';
  if (!role) return gone();
  return enter(env, r, role, cleanName(body.name, 'Guest'));
}

async function hostRoom(request, env, me) {
  const body = await request.json().catch(() => ({}));
  const pid = String(body.pid || '');
  if (!PROJECT_ID.test(pid)) return fail(400, 'Bad project id.');
  const r = await shareOf(env, me.id, pid);
  if (!r) return fail(404, 'This project is not shared yet.');
  return enter(env, r, 'owner', cleanName(body.name || me.name, 'Owner'));
}

/* ---- inside a room ---- */
async function inRoom(request, env, room, op) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES + 20_000) return fail(413, 'Too large.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'Bad JSON');
  }
  const p = await who(env, room, body);
  if (p instanceof Response) return p;
  const share = await env.DB.prepare('SELECT uid,pid FROM shares WHERE id=?').bind(room).first();
  if (!share) return fail(410, 'This share was removed.');
  const now = Date.now();

  if (op === 'signal') {
    if (!KINDS.has(body.kind) || typeof body.data !== 'string' || body.data.length > MAX_SIGNAL)
      return fail(400, 'Bad signal.');
    const to = await env.DB.prepare('SELECT 1 FROM peers WHERE room=? AND peer=?').bind(room, String(body.to)).first();
    if (!to) return fail(410, 'That person already left.');
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM signals WHERE room=? AND src=? AND ts>?')
      .bind(room, p.peer, now - 60_000)
      .first();
    if (n.n >= SIGNALS_PER_MIN) return fail(429, 'Too many connection attempts. Wait a moment.');
    await env.DB.prepare('INSERT INTO signals(room,src,dst,kind,data,ts) VALUES(?,?,?,?,?,?)')
      .bind(room, p.peer, String(body.to), body.kind, body.data, now)
      .run();
    return json({ ok: true });
  }

  if (op === 'poll') {
    const since = Math.max(0, Number(body.since) || 0);
    if (now - p.seen > BEAT_MS)
      await env.DB.prepare('UPDATE peers SET seen=? WHERE room=? AND peer=?').bind(now, room, p.peer).run();
    if (since) await env.DB.prepare('DELETE FROM signals WHERE room=? AND dst=? AND id<=?').bind(room, p.peer, since).run();
    const sig = await env.DB.prepare('SELECT id,src,kind,data FROM signals WHERE room=? AND dst=? AND id>? ORDER BY id LIMIT 60')
      .bind(room, p.peer, since)
      .all();
    return json({
      signals: sig.results.map((s) => ({ id: s.id, from: s.src, kind: s.kind, data: s.data })),
      peers: await roster(env, room)
    });
  }

  if (op === 'leave') {
    await env.DB.prepare('DELETE FROM peers WHERE room=? AND peer=?').bind(room, p.peer).run();
    await env.DB.prepare('DELETE FROM signals WHERE room=? AND (src=? OR dst=?)').bind(room, p.peer, p.peer).run();
    return json({ ok: true });
  }

  if (op === 'doc') {
    if (p.role === 'view') return fail(403, 'View-only links cannot change the project.');
    const doc = body.doc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) return fail(400, 'Invalid project.');
    if (JSON.stringify(doc).length > MAX_BYTES) return fail(413, 'Project is too large to save (limit 1.5 MB).');
    const updated = await saveProjectDoc(env, share.uid, share.pid, {
      doc,
      name: body.name ? cleanName(body.name, '') || undefined : undefined,
      by: p.name
    });
    if (!updated) return fail(404, 'The owner deleted this project.');
    return json({ ok: true, updated });
  }

  if (op === 'history') {
    if (p.role === 'view') return fail(403, 'View-only links cannot use history.');
    return historyOp(env, share.uid, share.pid, body, p.name);
  }
  return fail(404, 'Not found');
}

/**
 * Router for /api/collab/*. `getMe()` resolves the signed-in user (only the owner-only endpoints need it).
 */
export async function handleCollab(request, env, path, method, url, getMe) {
  const parts = path.split('/').filter(Boolean); // ['collab', ...]
  if (parts[1] === 'join' && method === 'POST') return joinWithKey(request, env);
  if (parts[1] === 'host' || parts[1] === 'share') {
    const me = await getMe();
    if (!me) return fail(401, 'Not signed in.');
    if (parts[1] === 'host') return method === 'POST' ? hostRoom(request, env, me) : fail(405, 'Method not allowed.');
    return shareAdmin(request, env, me, method, url);
  }
  if (parts.length === 3 && (method === 'POST' || method === 'PUT')) {
    const op = parts[2];
    if (['signal', 'poll', 'leave', 'doc', 'history'].includes(op)) return inRoom(request, env, parts[1], op);
  }
  return fail(404, 'Not found');
}

/** Owner-only: history of one of the user's own projects, outside a live session. */
export async function ownHistory(request, env, me, pid) {
  const body = await request.json().catch(() => ({}));
  return historyOp(env, me.id, pid, body, me.name || 'You');
}
