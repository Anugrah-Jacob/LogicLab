// Project history: saved versions of a project. Used by the signed-in owner and by people in a live session.
// The body of a version lives in D1, or in MongoDB (see store.js) when that is configured.
import { json, fail } from './util.js';
import { writeDoc, readDoc, dropDoc } from './store.js';

export const MAX_VERSIONS = 50;
const MAX_BYTES = 1_600_000;

async function digest(doc) {
  const { saved, ...rest } = doc; // the save time changes every time, so it is not part of the comparison
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rest)));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const vid = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * Save a version. Skipped (returns null) when nothing changed since the last version or, with `minGap`,
 * when the last version is newer than that many milliseconds. Never throws: history must not break saving.
 */
export async function snapshot(env, uid, pid, doc, { by = '', label = '', minGap = 0 } = {}) {
  try {
    const now = Date.now();
    const last = await env.DB.prepare(
      'SELECT ts, hash FROM history WHERE uid=? AND pid=? ORDER BY ts DESC LIMIT 1'
    )
      .bind(uid, pid)
      .first();
    if (minGap && last && now - last.ts < minGap) return null;
    const hash = await digest(doc);
    if (last && last.hash === hash) return null;
    const id = vid();
    const bytes = JSON.stringify(doc).length;
    const stored = await writeDoc(env, 'history', id, doc);
    await env.DB.prepare(
      'INSERT INTO history(id,uid,pid,ts,by_name,label,bytes,hash,doc) VALUES(?,?,?,?,?,?,?,?,?)'
    )
      .bind(id, uid, pid, now, String(by).slice(0, 40), String(label).slice(0, 60), bytes, hash, stored)
      .run();
    const old = await env.DB.prepare(
      'SELECT id, doc FROM history WHERE uid=? AND pid=? ORDER BY ts DESC LIMIT -1 OFFSET ?'
    )
      .bind(uid, pid, MAX_VERSIONS)
      .all();
    for (const r of old.results) {
      await env.DB.prepare('DELETE FROM history WHERE id=?').bind(r.id).run();
      await dropDoc(env, 'history', r.id, r.doc);
    }
    return { id, ts: now };
  } catch (e) {
    console.log('history snapshot skipped:', (e && e.message) || e);
    return null;
  }
}

/** list | get | save, for one project. `by` is the display name stored with a new version. */
export async function historyOp(env, uid, pid, body, by) {
  const action = body && body.action;
  if (action === 'list') {
    const r = await env.DB.prepare(
      'SELECT id, ts, by_name AS by, label, bytes FROM history WHERE uid=? AND pid=? ORDER BY ts DESC LIMIT 100'
    )
      .bind(uid, pid)
      .all();
    return json({ versions: r.results });
  }
  if (action === 'get') {
    const row = await env.DB.prepare(
      'SELECT id, ts, by_name AS by, label, doc FROM history WHERE uid=? AND pid=? AND id=?'
    )
      .bind(uid, pid, String(body.vid || ''))
      .first();
    if (!row) return fail(404, 'Version not found.');
    try {
      return json({
        id: row.id,
        ts: row.ts,
        by: row.by,
        label: row.label,
        doc: await readDoc(env, 'history', row.id, row.doc)
      });
    } catch (e) {
      console.log('history read failed', e.message);
      return fail(502, 'Could not read this version from storage.');
    }
  }
  if (action === 'save') {
    const doc = body.doc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) return fail(400, 'Invalid project.');
    if (JSON.stringify(doc).length > MAX_BYTES) return fail(413, 'Project is too large.');
    const r = await snapshot(env, uid, pid, doc, { by, label: body.label || 'Saved version' });
    return json(r ? { ok: true, id: r.id, ts: r.ts } : { ok: true, unchanged: true });
  }
  return fail(400, 'Unknown history action.');
}

/** Remove every version of a project (used when the project is deleted). Never throws. */
export async function dropHistory(env, uid, pid) {
  try {
    const rows = await env.DB.prepare('SELECT id, doc FROM history WHERE uid=? AND pid=?')
      .bind(uid, pid)
      .all();
    for (const r of rows.results) await dropDoc(env, 'history', r.id, r.doc);
    await env.DB.prepare('DELETE FROM history WHERE uid=? AND pid=?').bind(uid, pid).run();
    const sh = await env.DB.prepare('SELECT id FROM shares WHERE uid=? AND pid=?').bind(uid, pid).first();
    if (sh) {
      await env.DB.prepare('DELETE FROM peers WHERE room=?').bind(sh.id).run();
      await env.DB.prepare('DELETE FROM collaboration_invites WHERE room=?').bind(sh.id).run();
      await env.DB.prepare('DELETE FROM shares WHERE id=?').bind(sh.id).run();
    }
  } catch (e) {
    console.log('history cleanup skipped:', (e && e.message) || e);
  }
}
