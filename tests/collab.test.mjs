// Collaboration tests: merge engine, share/session API, history, MongoDB storage bridge, and two or three
// real browsers editing one circuit over WebRTC. Run with: npm run test:collab   (no dev server needed).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { test, eq, ok, summary } from './harness.mjs';
import { startApp } from './app-server.mjs';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ctxm = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(pub, 'js/merge.js'), 'utf8'), ctxm);
const { Replica, items, valid } = ctxm.LLMerge;
const clone = (x) => JSON.parse(JSON.stringify(x));
const sortedKeys = (r) => [...r.desired()].map(([k, v]) => k + '=' + JSON.stringify(v)).sort();

/* ---------------------------------------------------------------- merge engine */
const base = {
  name: 'T',
  nodes: [
    { id: 1, type: 'IN', x: 0, y: 0, name: 'A' },
    { id: 2, type: 'LED', x: 200, y: 0, name: 'Y' }
  ],
  wires: [{ a: 1, ap: 0, b: 2, bp: 0 }],
  notes: [],
  groups: [],
  layers: [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }]
};
const pair = () => {
  const a = new Replica(1),
    b = new Replica(2);
  a.seed(base);
  b.seed(base);
  return [a, b, clone(base), clone(base)];
};
await test('merge: edits to different parts both survive and both sides converge', () => {
  const [a, b, da, db] = pair();
  da.nodes.push({ id: 1000001, type: 'AND', x: 50, y: 50, name: 'U1', nin: 2 });
  db.nodes[1].x = 333;
  db.nodes.push({ id: 2000001, type: 'NOT', x: 90, y: 90, name: 'U2' });
  const oa = a.local(da),
    ob = b.local(db);
  a.remote(ob);
  b.remote(oa);
  a.reconcile(da).length && 0;
  eq(sortedKeys(a), sortedKeys(b));
  ok(a.desired().has('n:1000001') && a.desired().has('n:2000001'), 'both new parts exist');
  eq(a.desired().get('n:2').x, 333);
});
await test('merge: the newer edit of the same part wins, in any delivery order', () => {
  const [a, b, da, db] = pair();
  da.nodes[0].x = 10;
  const oa = a.local(da);
  db.nodes[0].x = 20;
  const ob = b.local(db);
  const c = new Replica(3);
  c.seed(base);
  c.remote(ob);
  c.remote(oa);
  a.remote(ob);
  b.remote(oa);
  eq(sortedKeys(a), sortedKeys(b));
  eq(sortedKeys(a), sortedKeys(c));
  eq(a.desired().get('n:1').x, 20, 'the later edit (B) wins');
});
await test('merge: a deleted part stays deleted and takes its wires with it', () => {
  const [a, b, da] = pair();
  da.nodes = da.nodes.filter((n) => n.id !== 2);
  da.wires = [];
  const oa = a.local(da);
  b.remote(oa);
  ok(!b.desired().has('n:2') && ![...b.desired().keys()].some((k) => k[0] === 'w'));
  b.remote([{ k: 'n:2', v: { id: 2, type: 'LED', x: 1, y: 1 }, t: 1, p: 9 }]);
  ok(!b.desired().has('n:2'), 'a stale edit cannot bring it back');
});
await test('merge: two wires into one input leave exactly one, the same on both sides', () => {
  const [a, b, da, db] = pair();
  da.nodes.push({ id: 1000001, type: 'IN', x: 0, y: 90, name: 'B' });
  da.wires = [{ a: 1000001, ap: 0, b: 2, bp: 0 }];
  const oa = a.local(da);
  db.wires = [{ a: 1, ap: 0, b: 2, bp: 0 }];
  b.remote(oa);
  const ob = b.local(db);
  a.remote(ob);
  eq(sortedKeys(a), sortedKeys(b));
  eq([...a.desired().keys()].filter((k) => k[0] === 'w').length, 1);
});
await test('merge: reconcile() turns the live document into the merged one (and nothing else)', () => {
  const [a, b, da] = pair();
  da.nodes.push({ id: 1000001, type: 'OR', x: 5, y: 5, name: 'U1', nin: 2 });
  b.remote(a.local(da));
  const ch = b.reconcile(clone(base));
  eq(
    ch.map((c) => c.k),
    ['n:1000001']
  );
  eq(b.reconcile(da), []);
});
await test('merge: malformed, oversized-clock and foreign items are ignored', () => {
  const [a] = pair();
  const bad = [
    { k: 'n:5', v: { id: 5, type: 'EVIL', x: 0, y: 0 }, t: 5, p: 1 },
    { k: 'n:6', v: { id: 7, type: 'AND', x: 0, y: 0 }, t: 5, p: 1 },
    { k: 'n:8', v: { id: 8, type: 'AND', x: 'a', y: 0 }, t: 5, p: 1 },
    { k: 'x:1', v: {}, t: 5, p: 1 },
    { k: 'w:1:0:2', v: 1, t: 5, p: 1 },
    { k: 'n:9', v: { id: 9, type: 'AND', x: 0, y: 0 }, t: Date.now() + 3600e3, p: 1 },
    null,
    'nope'
  ];
  eq(a.remote(bad), 0);
  ok(valid('n:5', { id: 5, type: 'AND', x: 1, y: 2 }));
});
await test('merge: a stream of random edits from three people converges', () => {
  const R = [new Replica(1), new Replica(2), new Replica(3)];
  R.forEach((r) => r.seed(base));
  const docs = R.map(() => clone(base));
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  const inbox = [[], [], []];
  for (let step = 0; step < 300; step++) {
    const i = rnd(3),
      d = docs[i],
      act = rnd(4);
    if (act === 0)
      d.nodes.push({ id: (i + 1) * 1e6 + step, type: 'AND', x: rnd(500), y: rnd(500), name: 'U', nin: 2 });
    else if (act === 1 && d.nodes.length > 1) d.nodes.splice(rnd(d.nodes.length), 1);
    else if (act === 2 && d.nodes.length) d.nodes[rnd(d.nodes.length)].x = rnd(900);
    else if (d.nodes.length > 1)
      d.wires = [{ a: d.nodes[0].id, ap: 0, b: d.nodes[d.nodes.length - 1].id, bp: rnd(2) }];
    const ops = R[i].local(d);
    [0, 1, 2].filter((j) => j !== i).forEach((j) => inbox[j].push(ops));
    if (rnd(3) === 0)
      [0, 1, 2].forEach((j) => {
        inbox[j].sort(() => rnd(3) - 1).forEach((o) => R[j].remote(o));
        inbox[j] = [];
        docs[j] = applyTo(docs[j], R[j].reconcile(docs[j]));
      });
  }
  [0, 1, 2].forEach((j) => {
    inbox[j].forEach((o) => R[j].remote(o));
    docs[j] = applyTo(docs[j], R[j].reconcile(docs[j]));
  });
  eq(sortedKeys(R[0]), sortedKeys(R[1]));
  eq(sortedKeys(R[0]), sortedKeys(R[2]));
});
function applyTo(doc, ch) {
  const d = clone(doc);
  for (const { k, v } of ch) {
    if (k[0] === 'n') {
      const id = +k.slice(2);
      d.nodes = d.nodes.filter((n) => n.id !== id);
      if (v) d.nodes.push(v);
    } else if (k[0] === 'w') {
      const [a, ap, b, bp] = k.slice(2).split(':').map(Number);
      d.wires = d.wires.filter(
        (w) => !(w.a === a && w.ap === ap && w.b === b && w.bp === bp) && !(v && w.b === b && w.bp === bp)
      );
      if (v) d.wires.push({ a, ap, b, bp });
    }
  }
  const ids = new Set(d.nodes.map((n) => n.id));
  d.wires = d.wires.filter((w) => ids.has(w.a) && ids.has(w.b));
  return d;
}

/* ---------------------------------------------------------------- API: shares, sessions, history, MongoDB */
const mongoData = new Map();
let mongoDown = false;
const fakeMongo = {
  async fetch(url, init) {
    if (mongoDown) return new Response('down', { status: 503 });
    if (init.headers['x-api-key'] !== 'mk') return new Response('no', { status: 401 });
    const op = new URL(url).pathname.slice(1),
      b = JSON.parse(init.body);
    if (op === 'put') mongoData.set(b.col + '/' + b.key, b.doc);
    if (op === 'del') mongoData.delete(b.col + '/' + b.key);
    if (op === 'get') return Response.json({ doc: mongoData.get(b.col + '/' + b.key) || null });
    return Response.json({ ok: true });
  }
};
const app = await startApp({ MONGO: fakeMongo, MONGO_API_KEY: 'mk' });
const call = async (method, p, body, cookie = '') => {
  const r = await fetch(app.url + 'api' + p, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: r.status,
    body: await r.json().catch(() => null),
    cookie: (r.headers.getSetCookie?.()[0] || '').split(';')[0]
  };
};
const owner = await call('POST', '/auth/signup', {
  name: 'Olive Owner',
  email: 'olive@example.com',
  password: 'correct horse 9'
});
const cookie = owner.cookie;
const docOf = (n = 1) => ({
  app: 'LogicLab',
  nodes: Array.from({ length: n }, (_, i) => ({ id: i + 1, type: 'IN', x: i * 100, y: 0, name: 'A' + i })),
  wires: [],
  groups: [],
  notes: [],
  layers: [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }]
});
const put = (id, n, upd) =>
  call('PUT', '/projects/' + id, { name: 'Circuit ' + id, doc: docOf(n), updated: upd }, cookie);
await put('pshare1', 2);
let sh, vlink, elink;

await test('MongoDB: project bodies go to MongoDB, D1 keeps only the marker, reads come back whole', async () => {
  ok(mongoData.has('projects/' + owner.body.user.id + ':pshare1'), 'body stored in Mongo');
  const row = await app.env.DB.prepare('SELECT doc FROM projects WHERE id=?').bind('pshare1').first();
  eq(row.doc, '{"m":1}');
  const got = await call('GET', '/projects/pshare1', null, cookie);
  eq(got.body.doc.nodes.length, 2);
  const list = await call('GET', '/projects', null, cookie);
  eq(list.body.projects.length, 1);
});
await test('MongoDB down: saving still works (kept in D1) and old Mongo copies stay readable', async () => {
  mongoDown = true;
  eq((await put('pshare2', 3)).status, 200);
  eq((await call('GET', '/projects/pshare2', null, cookie)).body.doc.nodes.length, 3);
  eq(
    (await call('GET', '/projects/pshare1', null, cookie)).status,
    502,
    'reading a Mongo-held body while it is down reports 502, not a crash'
  );
  mongoDown = false;
  eq((await call('GET', '/projects/pshare1', null, cookie)).status, 200);
});
await test('without MongoDB configured nothing changes: bodies stay in D1', async () => {
  const plain = await startApp();
  const r = await fetch(plain.url + 'api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'P', email: 'p@example.com', password: 'correct horse 9' })
  });
  const ck = r.headers.getSetCookie()[0].split(';')[0];
  await fetch(plain.url + 'api/projects/pplain1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: ck },
    body: JSON.stringify({ name: 'x', doc: docOf(1) })
  });
  const row = await plain.env.DB.prepare('SELECT doc FROM projects WHERE id=?').bind('pplain1').first();
  ok(JSON.parse(row.doc).nodes.length === 1);
  plain.close();
});
await test('share: only the owner can create it, the project must exist, access levels toggle', async () => {
  eq((await call('POST', '/collab/share', { action: 'create', pid: 'pshare1' })).status, 401);
  eq((await call('POST', '/collab/share', { action: 'create', pid: 'pnothere' }, cookie)).status, 404);
  sh = (await call('POST', '/collab/share', { action: 'create', pid: 'pshare1' }, cookie)).body.share;
  ok(sh.id && sh.viewKey && sh.editKey && sh.viewKey !== sh.editKey);
  eq(
    (await call('GET', '/collab/share?pid=pshare1', null, cookie)).body.share.editKey,
    sh.editKey,
    'owner can read the link again'
  );
  const t = (
    await call(
      'POST',
      '/collab/share',
      { action: 'toggle', pid: 'pshare1', viewOn: true, editOn: false },
      cookie
    )
  ).body.share;
  eq([t.viewOn, t.editOn], [true, false]);
  const protectedLink = (
    await call(
      'POST',
      '/collab/share',
      { action: 'password', pid: 'pshare1', password: 'secure pass 42' },
      cookie
    )
  ).body.share;
  ok(protectedLink.hasPassword, 'password protection is shown without exposing the password');
  eq(
    (await call('POST', '/collab/join', { share: sh.id, key: sh.viewKey, password: 'secure pass 42' }))
      .status,
    401,
    'password-protected links require sign-in'
  );
  eq(
    (
      await call(
        'POST',
        '/collab/join',
        { share: sh.id, key: sh.viewKey, password: 'wrong password' },
        cookie
      )
    ).status,
    403,
    'wrong password is refused'
  );
  const protectedJoin = await call(
    'POST',
    '/collab/join',
    { share: sh.id, key: sh.viewKey, password: 'secure pass 42', name: 'Password User' },
    cookie
  );
  eq([protectedJoin.status, protectedJoin.body.role], [200, 'view']);
  await call('POST', '/collab/' + sh.id + '/leave', {
    peer: protectedJoin.body.peer,
    token: protectedJoin.body.token
  });
  const unprotectedLink = (
    await call('POST', '/collab/share', { action: 'password', pid: 'pshare1', password: '' }, cookie)
  ).body.share;
  eq(unprotectedLink.hasPassword, false);
  vlink = { share: sh.id, key: sh.viewKey };
  elink = { share: sh.id, key: sh.editKey };
});
let inviteCookie = '';
await test('email invites are listed, account-bound, permissioned and revocable', async () => {
  const inviteEmail = 'invite' + Date.now() + '@example.com';
  const registered = await call('POST', '/auth/signup', {
    name: 'Invited User',
    email: inviteEmail,
    password: 'correct horse 9'
  });
  eq(registered.status, 200);
  inviteCookie = registered.cookie;
  const invited = await call(
    'POST',
    '/collab/share',
    { action: 'invite', pid: 'pshare1', email: inviteEmail, role: 'edit' },
    cookie
  );
  eq(invited.status, 200);
  eq(
    invited.body.share.invites.map((i) => [i.email, i.role]),
    [[inviteEmail, 'edit']]
  );
  eq(
    (await call('POST', '/collab/invite/join', { share: sh.id })).status,
    401,
    'invited members must sign in'
  );
  const joined = await call('POST', '/collab/invite/join', { share: sh.id }, inviteCookie);
  eq([joined.status, joined.body.role], [200, 'edit']);
  const changed = await call(
    'POST',
    '/collab/share',
    { action: 'invite', pid: 'pshare1', email: inviteEmail, role: 'view' },
    cookie
  );
  eq(changed.body.share.invites[0].role, 'view');
  eq(
    (await call('POST', '/collab/' + sh.id + '/poll', { peer: joined.body.peer, token: joined.body.token }))
      .status,
    410,
    'changing access disconnects existing sessions'
  );
  const invitedViewer = await call('POST', '/collab/invite/join', { share: sh.id }, inviteCookie);
  eq([invitedViewer.status, invitedViewer.body.role], [200, 'view']);
  const removed = await call(
    'POST',
    '/collab/share',
    { action: 'uninvite', pid: 'pshare1', email: inviteEmail },
    cookie
  );
  eq(removed.body.share.invites.length, 0);
  eq(
    (
      await call('POST', '/collab/' + sh.id + '/poll', {
        peer: invitedViewer.body.peer,
        token: invitedViewer.body.token
      })
    ).status,
    410,
    'revoking access disconnects active sessions'
  );
  eq(
    (await call('POST', '/collab/invite/join', { share: sh.id }, inviteCookie)).status,
    403,
    'revoked invite no longer joins'
  );
});
let viewer, editor;
await test('join: view key gives view, edit key is refused while edit is off, wrong key is refused', async () => {
  const v = await call('POST', '/collab/join', { ...vlink, name: 'Vera' });
  eq(v.status, 200);
  eq([v.body.role, v.body.slot, v.body.doc.nodes.length], ['view', 0, 2]);
  viewer = v.body;
  eq((await call('POST', '/collab/join', { ...elink, name: 'X' })).status, 403);
  eq((await call('POST', '/collab/join', { share: sh.id, key: 'wrong-wrong-wrong' })).status, 403);
  eq((await call('POST', '/collab/join', { share: 'nope-nope-nope', key: 'x' })).status, 403);
  await call(
    'POST',
    '/collab/share',
    { action: 'toggle', pid: 'pshare1', viewOn: true, editOn: true },
    cookie
  );
  const e = await call('POST', '/collab/join', { ...elink, name: '<b>Ed</b>' });
  eq([e.status, e.body.role, e.body.slot, e.body.name], [200, 'edit', 1, 'bEd/b']);
  editor = e.body;
  eq(
    e.body.peers.map((p) => p.name),
    ['Vera']
  );
});
const inRoom = (who, op, body, method = 'POST') =>
  call(method, '/collab/' + sh.id + '/' + op, { peer: who.peer, token: who.token, ...body });
await test('session: tokens are checked, signals reach only the addressee, and are removed once acknowledged', async () => {
  eq((await inRoom({ peer: editor.peer, token: 'forged' }, 'poll', { since: 0 })).status, 403);
  eq((await inRoom({ peer: 'pghost', token: editor.token }, 'poll', {})).status, 410);
  eq((await inRoom(editor, 'signal', { to: viewer.peer, kind: 'offer', data: '{"sdp":"x"}' })).status, 200);
  eq((await inRoom(editor, 'signal', { to: viewer.peer, kind: 'bogus', data: 'x' })).status, 400);
  eq((await inRoom(editor, 'signal', { to: 'pnobody', kind: 'offer', data: 'x' })).status, 410);
  const p = await inRoom(viewer, 'poll', { since: 0 });
  eq(
    p.body.signals.map((s) => [s.from, s.kind]),
    [[editor.peer, 'offer']]
  );
  eq(p.body.peers.length, 2);
  eq((await inRoom(editor, 'poll', { since: 0 })).body.signals.length, 0);
  const again = await inRoom(viewer, 'poll', { since: p.body.signals[0].id });
  eq(again.body.signals.length, 0);
});
await test('saving: editors can save through the link, view-only people cannot', async () => {
  eq((await inRoom(viewer, 'doc', { doc: docOf(9) }, 'PUT')).status, 403);
  eq((await inRoom(editor, 'doc', { doc: docOf(5), name: 'Renamed' }, 'PUT')).status, 200);
  const got = await call('GET', '/projects/pshare1', null, cookie);
  eq([got.body.doc.nodes.length, got.body.name], [5, 'Renamed']);
  eq((await inRoom(editor, 'doc', { doc: { nodes: 'x' } }, 'PUT')).status, 400);
});
await test('history: versions are saved, listed, fetched and kept apart per project; viewers are refused', async () => {
  eq((await inRoom(viewer, 'history', { action: 'list' })).status, 403);
  const s1 = await inRoom(editor, 'history', { action: 'save', label: 'Milestone', doc: docOf(7) });
  eq(s1.status, 200);
  eq(
    (await inRoom(editor, 'history', { action: 'save', label: 'again', doc: docOf(7) })).body.unchanged,
    true,
    'identical content is not saved twice'
  );
  const list = (await inRoom(editor, 'history', { action: 'list' })).body.versions;
  ok(list.length >= 2, 'automatic + manual versions');
  const v = list.find((x) => x.label === 'Milestone');
  eq((await inRoom(editor, 'history', { action: 'get', vid: v.id })).body.doc.nodes.length, 7);
  ok(
    [...mongoData.keys()].some((k) => k.startsWith('history/')),
    'version bodies live in Mongo too'
  );
  const own = await call('POST', '/projects/pshare1/history', { action: 'list' }, cookie);
  eq(own.body.versions.length, list.length, 'the owner sees the same history outside a session');
  eq(
    (await call('POST', '/projects/pshare2/history', { action: 'get', vid: v.id }, cookie)).status,
    404,
    'a version id from another project is not readable'
  );
});
await test('history: automatic versions are rate limited and the list is capped at 50', async () => {
  for (let i = 0; i < 60; i++)
    await inRoom(editor, 'history', { action: 'save', label: 'v' + i, doc: docOf(10 + i) });
  const n = (await inRoom(editor, 'history', { action: 'list' })).body.versions.length;
  eq(n, 50);
  const before = (await call('POST', '/projects/pshare1/history', { action: 'list' }, cookie)).body.versions
    .length;
  await put('pshare1', 3, Date.now());
  eq(
    (await call('POST', '/projects/pshare1/history', { action: 'list' }, cookie)).body.versions.length,
    before,
    'an ordinary sync inside the 10 minute window adds no version'
  );
});
await test('access changes disconnect people: reset link, turn edit off, stop sharing', async () => {
  const rot = (await call('POST', '/collab/share', { action: 'rotate', pid: 'pshare1' }, cookie)).body.share;
  eq((await inRoom(editor, 'poll', { since: 0 })).status, 410, 'old session is closed');
  eq((await call('POST', '/collab/join', { ...elink, name: 'Old' })).status, 403, 'old link is dead');
  const again = await call('POST', '/collab/join', { share: sh.id, key: rot.editKey, name: 'New' });
  eq(again.status, 200);
  await call(
    'POST',
    '/collab/share',
    { action: 'toggle', pid: 'pshare1', viewOn: true, editOn: false },
    cookie
  );
  eq((await inRoom(again.body, 'poll', {})).status, 410);
  const host = await call('POST', '/collab/host', { pid: 'pshare1' }, cookie);
  eq([host.status, host.body.role], [200, 'owner']);
  eq((await call('POST', '/collab/host', { pid: 'pshare1' })).status, 401);
  await call('POST', '/collab/share', { action: 'delete', pid: 'pshare1' }, cookie);
  eq((await call('GET', '/collab/share?pid=pshare1', null, cookie)).body.share, null);
});
await test('deleting a project removes its history, shares and Mongo bodies', async () => {
  await call('POST', '/collab/share', { action: 'create', pid: 'pshare1' }, cookie);
  eq((await call('DELETE', '/projects/pshare1', null, cookie)).status, 200);
  eq(
    (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM history WHERE pid=?').bind('pshare1').first()).n,
    0
  );
  eq((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE pid=?').bind('pshare1').first()).n, 0);
  ok(![...mongoData.keys()].some((k) => k.includes('pshare1')), 'no Mongo leftovers');
});
await test('the room holds at most 12 people', async () => {
  await put('pfull1', 1);
  const s = (await call('POST', '/collab/share', { action: 'create', pid: 'pfull1' }, cookie)).body.share;
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', '/collab/join', { share: s.id, key: s.viewKey, name: 'g' + i });
    eq(r.status, 200);
    slots.push(r.body.slot);
  }
  eq(new Set(slots).size, 12, 'every person gets a different slot');
  eq((await call('POST', '/collab/join', { share: s.id, key: s.viewKey, name: 'late' })).status, 429);
});

/* ---------------------------------------------------------------- browsers (WebRTC) */
const app2 = await startApp({ MONGO: fakeMongo, MONGO_API_KEY: 'mk' });
const browser = await chromium.launch({
  args: [
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream'
  ]
});
const open = async (cookies) => {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone']
  });
  if (cookies) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/404|Failed to load resource|410|403/.test(m.text()) &&
      problems.push('console: ' + m.text())
  );
  return { ctx, page, problems };
};
const su = await fetch(app2.url + 'api/auth/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Olive Owner', email: 'o2@example.com', password: 'correct horse 9' })
});
const ck = su.headers.getSetCookie()[0].split(';')[0].split('=');
const O = await open([{ name: ck[0], value: ck.slice(1).join('='), url: app2.url }]);
await O.page.goto(app2.url);
await O.page.waitForFunction(() => window.LogicLab && window.LogicLabCollab);
await O.page.waitForFunction(() => document.querySelector('#av').textContent.trim() !== 'Sign in');
await test('login offers account creation when the email is not registered', async () => {
  const A = await open();
  await A.page.goto(app2.url);
  await A.page.click('#wsi');
  await A.page.fill('[name=email]', 'missing-account@example.com');
  await A.page.fill('[name=password]', 'some password 123');
  await A.page.click('#asb');
  await A.page.waitForFunction(() =>
    document.querySelector('#at').textContent.includes('Create your account')
  );
  ok((await A.page.locator('#mauth #as').innerText()).includes('No account was found'));
  eq(await A.page.inputValue('[name=email]'), 'missing-account@example.com');
  ok(await A.page.locator('[name=fname]').isVisible(), 'signup form is shown');
  await A.ctx.close();
});
let links;
await test('owner: Share button opens the popover; choosing "can edit" creates the link and starts a live session', async () => {
  await O.page.click('#wn');
  await O.page.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'a', type: 'IN', name: 'A' },
        { id: 'g', type: 'NOT', name: 'N' },
        { id: 'y', type: 'LED', name: 'Y' }
      ],
      wires: [
        ['a', 'g'],
        ['g', 'y']
      ]
    })
  );
  await O.page.waitForTimeout(200);
  await O.page.evaluate(() => LogicLabHost.syncNow());
  await O.page.click('#cb-share');
  ok(await O.page.isVisible('#cb-pop'), 'popover visible');
  ok((await O.page.innerText('#cb-pop')).includes('Only you can access'), 'starts private');
  await O.page.click('#cb-acc');
  const menu = await O.page.innerText('#cb-mn');
  ok(
    /Anyone with the link can view/.test(menu) && /Anyone with the link can edit/.test(menu),
    'three choices'
  );
  await O.page.click('#cb-mn [data-a=edit]');
  await O.page.waitForFunction(() => LogicLabCollab.session() && LogicLabCollab.session().owner, null, {
    timeout: 15000
  });
  ok((await O.page.innerText('#cb-pop')).includes('Anyone with the link can edit'));
  links = await O.page.evaluate(async () => {
    const pid = LogicLabHost.pid();
    const edit = (await (await fetch('/api/collab/share?pid=' + pid)).json()).share;
    await fetch('/api/collab/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', pid, viewOn: true, editOn: true })
    });
    return { id: edit.id, editKey: edit.editKey, viewKey: edit.viewKey };
  });
  await O.page.locator('#cb-em').fill('collaborator@example.com');
  const inviteField = await O.page.locator('#cb-em').elementHandle();
  await O.page.waitForTimeout(6500);
  ok(
    await inviteField.evaluate((el) => el.isConnected && document.activeElement === el),
    'invite email field survives live roster refresh'
  );
  eq(await O.page.inputValue('#cb-em'), 'collaborator@example.com');
  eq(await O.page.getAttribute('#cb-em', 'autocomplete'), 'off');
  await O.page.selectOption('#cb-inv-role', 'view');
  await O.page.click('#cb-add-invite');
  await O.page.waitForSelector('[data-remove="collaborator@example.com"]');
  ok((await O.page.locator('#cb-pop').innerText()).includes('Can view'));
  await O.page.click('[data-remove="collaborator@example.com"]');
  await O.page.waitForSelector('[data-remove="collaborator@example.com"]', { state: 'detached' });
});
await test('the share panel can enable and remove password protection on a collaboration link', async () => {
  await O.page.fill('#cb-link-pw', 'safe link password');
  await O.page.click('#cb-save-pw');
  await O.page.waitForFunction(() =>
    document.querySelector('#cb-pop').innerText.includes('Password protection is on')
  );
  ok(await O.page.locator('#cb-clear-pw').isVisible());
  await O.page.click('#cb-clear-pw');
  await O.page.waitForFunction(() =>
    document.querySelector('#cb-pop').innerText.includes('Password protection removed')
  );
  ok(!(await O.page.locator('#cb-clear-pw').count()));
});
const joinAs = async (key, name) => {
  const c = await open();
  await c.page.goto(app2.url + '#join=' + links.id + '.' + key);
  await c.page.waitForFunction(() => window.LogicLabCollab);
  await c.page.waitForSelector('#cb-nm');
  await c.page.fill('#cb-nm', name);
  await c.page.click('#cb-go');
  await c.page.waitForFunction(() => LogicLabCollab.session(), null, { timeout: 15000 });
  return c;
};
let E, V;
const parts = (c) =>
  c.page.evaluate(() =>
    LogicLab.parts()
      .map((p) => p.type + ':' + p.name)
      .sort()
  );
const connected = (c, n) =>
  c.page.waitForFunction(
    (n) => {
      const s = LogicLabCollab.session();
      return s && [...s.pcs.values()].filter((x) => x.state === 'open').length >= n;
    },
    n,
    { timeout: 30000 }
  );
await test('guest with the edit link joins without an account, sees the circuit, and connects over WebRTC', async () => {
  E = await joinAs(links.editKey, 'Eddie');
  await connected(E, 1);
  await connected(O, 1);
  eq(await parts(E), await parts(O));
  eq((await parts(E)).length, 3);
});
await test('guest with the view link joins read-only and connects to both', async () => {
  V = await joinAs(links.viewKey, 'Vera');
  await connected(V, 2);
  await connected(E, 2);
  ok(await V.page.evaluate(() => document.body.classList.contains('ro') && LogicLabHost.isReadOnly()));
  ok((await V.page.innerText('#cb-bar')).includes('View only'));
  eq(await parts(V), await parts(O));
});
await test('an edit by the guest shows up for the owner and the viewer (palette click)', async () => {
  await E.page.click('#pcat button[data-k=AND]');
  await O.page.waitForFunction(() => LogicLab.parts().length === 4, null, { timeout: 10000 });
  await V.page.waitForFunction(() => LogicLab.parts().length === 4, null, { timeout: 10000 });
  eq(await parts(O), await parts(E));
  eq(await parts(V), await parts(E));
});
await test('the owner and the guest can add parts at the same moment without losing either', async () => {
  await Promise.all([O.page.click('#pcat button[data-k=XOR]'), E.page.click('#pcat button[data-k=NAND]')]);
  for (const c of [O, E, V])
    await c.page.waitForFunction(() => LogicLab.parts().length === 6, null, { timeout: 10000 });
  const a = await parts(O);
  eq(a, await parts(E));
  eq(a, await parts(V));
  const ids = await O.page.evaluate(() => LogicLab.parts().map((p) => p.id));
  eq(new Set(ids).size, ids.length, 'no two parts share an id');
});
await test('view-only: structural changes are refused (keyboard, palette, API), switches still work locally', async () => {
  const before = await parts(V);
  await V.page.evaluate(() => document.querySelector('#pcat button[data-k=OR]').click());
  await V.page.keyboard.press('Control+a');
  await V.page.keyboard.press('Delete');
  await V.page.evaluate(() => LogicLab.build({ parts: [{ id: 'zz', type: 'OR', name: 'ZZ' }], wires: [] }));
  await V.page.waitForTimeout(400);
  await O.page.waitForTimeout(300);
  eq(await parts(O), before, 'the owner never received anything from the viewer');
  const node = await V.page.evaluate(() => LogicLabHost.doc().nodes.find((n) => n.type === 'IN'));
  const box = await V.page.evaluate(() => {
    const v = LogicLabHost.view();
    const r = v.el.getBoundingClientRect();
    return { x: r.left + v.v.x, y: r.top + v.v.y, s: v.v.s };
  });
  await V.page.mouse.click(box.x + (node.x + 38) * box.s, box.y + (node.y + 22) * box.s);
  await V.page.waitForTimeout(300);
  eq(
    await V.page.evaluate(() => Object.values(LogicLab.inputs())[0]),
    1,
    'the viewer can toggle a switch on their own screen'
  );
  eq(await O.page.evaluate(() => Object.values(LogicLab.inputs())[0]), 0, 'and it does not change the owner');
});
await test('a switch flipped by an editor is seen by everyone (view-only people included)', async () => {
  const node = await E.page.evaluate(() => LogicLabHost.doc().nodes.find((n) => n.type === 'IN'));
  const box = await E.page.evaluate(() => {
    const v = LogicLabHost.view();
    const r = v.el.getBoundingClientRect();
    return { x: r.left + v.v.x, y: r.top + v.v.y, s: v.v.s };
  });
  await E.page.mouse.click(box.x + (node.x + 38) * box.s, box.y + (node.y + 22) * box.s);
  await O.page.waitForFunction(() => Object.values(LogicLab.inputs())[0] === 1, null, { timeout: 8000 });
  eq(await E.page.evaluate(() => Object.values(LogicLab.inputs())[0]), 1);
});
await test('push button: output is 1 only while held, and everyone sees it', async () => {
  await O.page.click('#pcat button[data-k=PB]');
  await E.page.waitForFunction(() => LogicLab.parts().some((p) => p.name.startsWith('PB')), null, {
    timeout: 8000
  });
  // new parts land at random spots and can overlap another part: move the button somewhere clear and share that
  await O.page.evaluate(() => {
    const n = LogicLabHost.doc().nodes.find((x) => x.mom);
    const v = LogicLabHost.view(),
      r = v.el.getBoundingClientRect(),
      others = LogicLabHost.doc().nodes.filter((x) => !x.mom);
    let spot = null;
    for (let sy = 90; sy < r.height - 90 && !spot; sy += 60)
      for (let sx = 60; sx < r.width - 140 && !spot; sx += 60) {
        const wx = (sx - v.v.x) / v.v.s,
          wy = (sy - v.v.y) / v.v.s;
        if (others.every((o) => Math.abs(o.x - wx) > 130 || Math.abs(o.y - wy) > 80))
          spot = [Math.round(wx), Math.round(wy)];
      }
    window.__spot = spot;
    LogicLabHost.applyChanges([{ k: 'n:' + n.id, v: { ...n, x: spot[0], y: spot[1] } }]);
    LogicLabCollab._flush();
  });
  const spot = await O.page.evaluate(() => window.__spot);
  await E.page.waitForFunction((y) => LogicLabHost.doc().nodes.find((x) => x.mom).y === y, spot[1], {
    timeout: 8000
  });
  const info = async (c) =>
    c.page.evaluate(() => {
      const n = LogicLabHost.doc().nodes.find((x) => x.mom);
      const v = LogicLabHost.view();
      const r = v.el.getBoundingClientRect();
      return { n, x: r.left + v.v.x, y: r.top + v.v.y, s: v.v.s, val: LogicLab.inputs()[n.name] };
    });
  const o = await info(O);
  eq(o.val, 0);
  await O.page.evaluate(() => LogicLabHost.view().v.s);
  await O.page.mouse.move(o.x + (o.n.x + 34) * o.s, o.y + (o.n.y + 22) * o.s);
  await O.page.mouse.down();
  await E.page.waitForFunction(
    () => {
      const n = LogicLabHost.doc().nodes.find((x) => x.mom);
      return LogicLab.inputs()[n.name] === 1;
    },
    null,
    { timeout: 5000 }
  );
  await V.page.waitForFunction(
    () => {
      const n = LogicLabHost.doc().nodes.find((x) => x.mom);
      return LogicLab.inputs()[n.name] === 1;
    },
    null,
    { timeout: 5000 }
  );
  eq((await info(O)).val, 1, 'held down');
  await O.page.mouse.up();
  await E.page.waitForFunction(
    () => {
      const n = LogicLabHost.doc().nodes.find((x) => x.mom);
      return LogicLab.inputs()[n.name] === 0;
    },
    null,
    { timeout: 5000 }
  );
  eq((await info(O)).val, 0, 'released');
});
await test('chat reaches everyone, including the view-only guest', async () => {
  await O.page.click('#cb-cht');
  await O.page.fill('#cb-ci', 'hello team');
  await O.page.press('#cb-ci', 'Enter');
  await V.page.waitForFunction(
    () => LogicLabCollab.session().chat.some((m) => m.text === 'hello team'),
    null,
    { timeout: 8000 }
  );
  await E.page.waitForFunction(
    () => LogicLabCollab.session().chat.some((m) => m.text === 'hello team'),
    null,
    { timeout: 8000 }
  );
  ok((await V.page.innerText('#cb-bar')).length >= 0);
  await V.page.click('#cb-cht');
  ok((await V.page.innerText('#cb-chat')).includes('hello team'));
  await V.page.fill('#cb-ci', '<img src=x onerror=alert(1)>');
  await V.page.press('#cb-ci', 'Enter');
  await O.page.waitForFunction(() => LogicLabCollab.session().chat.length === 2, null, { timeout: 8000 });
  eq(
    await O.page.evaluate(() => document.querySelectorAll('#cb-chat img').length),
    0,
    'chat text is escaped'
  );
});
await test('voice: turning the microphone on sends audio to the others (fake device)', async () => {
  await O.page.click('#cb-mic');
  await O.page.waitForFunction(() => LogicLabCollab.session().mic, null, { timeout: 8000 });
  await V.page
    .waitForFunction(
      () =>
        [...LogicLabCollab.session().pcs.values()].some(
          (c) => c.audio && c.audio.srcObject && c.audio.srcObject.getAudioTracks().length
        ),
      null,
      { timeout: 10000 }
    )
    .catch(async (e) => {
      console.log(
        'DIAG',
        JSON.stringify(
          await V.page.evaluate(() =>
            [...LogicLabCollab.session().pcs.values()].map((c) => ({
              id: c.id,
              st: c.state,
              pc: c.pc.connectionState,
              audio: !!c.audio,
              tr: c.pc
                .getTransceivers()
                .map((t) => [
                  t.direction,
                  t.currentDirection,
                  t.receiver.track && t.receiver.track.readyState
                ])
            }))
          )
        )
      );
      throw e;
    });
  await O.page.click('#cb-mic');
  eq(await O.page.evaluate(() => !!LogicLabCollab.session().mic), false);
});
await test('a late joiner receives the current circuit from a peer (not only the last saved one)', async () => {
  await O.page.evaluate(() =>
    LogicLab.build({ replace: false, parts: [{ id: 'late', type: 'OR', name: 'LATE' }], wires: [] })
  );
  await O.page.evaluate(() => LogicLabCollab._flush());
  const L = await joinAs(links.viewKey, 'Lena');
  await connected(L, 1);
  await L.page.waitForFunction(() => LogicLab.parts().some((p) => p.name === 'LATE'), null, {
    timeout: 10000
  });
  eq(await parts(L), await parts(O));
  await L.page.evaluate(() => LogicLabCollab.leave());
  await L.ctx.close();
});
await test('the guest edit was saved to the owner’s project through the share link', async () => {
  await E.page.waitForTimeout(6500);
  const saved = await O.page.evaluate(
    async () => (await (await fetch('/api/projects/' + LogicLabHost.pid())).json()).doc.nodes.length
  );
  ok(saved >= 5, 'saved nodes: ' + saved);
});
await test('version history dialog lists versions and restoring one brings the circuit back', async () => {
  const n0 = (await parts(O)).length;
  await O.page.evaluate(() => LogicLabCollab.openHistory());
  await O.page.fill('#cb-lb', 'Checkpoint');
  await O.page.click('#cb-sv');
  await O.page.waitForSelector('.cb-ver');
  await O.page.keyboard.press('Escape');
  eq(await O.page.locator('.cb-modal').count(), 0, 'Escape closes the dialog');
  await O.page.click('#pcat button[data-k=BUF]');
  await V.page.waitForFunction((n) => LogicLab.parts().length === n + 1, n0, { timeout: 8000 });
  await O.page.evaluate(() => LogicLabCollab.openHistory());
  await O.page.waitForSelector('.cb-ver');
  const labels = await O.page.locator('.cb-ver b').allInnerTexts();
  ok(labels.includes('Checkpoint'), 'saved version is listed: ' + labels);
  await O.page.locator('.cb-ver', { hasText: 'Checkpoint' }).locator('button').click();
  await O.page.waitForFunction((n) => LogicLab.parts().length === n, n0, { timeout: 8000 });
  await V.page.waitForFunction((n) => LogicLab.parts().length === n, n0, { timeout: 8000 });
});
await test('leaving ends the session; a view-only guest gets normal editing back only after leaving', async () => {
  await V.page.evaluate(() => LogicLabCollab.leave());
  eq(await V.page.evaluate(() => LogicLabHost.isReadOnly()), false);
  await O.page.waitForFunction(() => LogicLabCollab.session().roster.size <= 2, null, { timeout: 15000 });
});
await test('turning sharing off from the owner’s popover ends the owner’s session and the link stops working', async () => {
  await O.page.click('#cb-share');
  await O.page.click('#cb-acc');
  await O.page.click('#cb-mn [data-a=none]');
  await O.page.waitForFunction(() => !LogicLabCollab.session(), null, { timeout: 10000 });
  const r = await fetch(app2.url + 'api/collab/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ share: links.id, key: links.viewKey, name: 'x' })
  });
  eq(r.status, 403);
  await E.page.waitForFunction(() => !LogicLabCollab.session(), null, { timeout: 20000 });
});
await test('no script errors in any browser', async () => {
  eq([O.problems, E.problems, V.problems], [[], [], []]);
});

await browser.close();
app.close();
app2.close();
summary();
