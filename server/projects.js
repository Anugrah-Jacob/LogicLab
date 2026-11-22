// Project sync: list, read, write (last write wins) and delete a user's projects.
// The body of a project lives in D1 or, when MongoDB is configured (see store.js), in MongoDB.
import { json, fail } from './util.js';
import { writeDoc, readDoc, dropDoc } from './store.js';
import { snapshot, dropHistory } from './history.js';

export const PROJECT_ID = /^[A-Za-z0-9_-]{3,48}$/;
export const MAX_BYTES = 1_600_000;
const MAX_PROJECTS = 200;
const AUTO_VERSION_GAP = 10 * 60e3; // an automatic history version at most every 10 minutes

export async function listProjects(env, uid) {
  const r = await env.DB.prepare(
    'SELECT id,name,type,count,tpl,created,updated FROM projects WHERE uid=? ORDER BY updated DESC LIMIT 500'
  )
    .bind(uid)
    .all();
  return json({ projects: r.results });
}

export async function getProject(env, uid, id) {
  const r = await env.DB.prepare('SELECT id,name,doc,updated FROM projects WHERE uid=? AND id=?')
    .bind(uid, id)
    .first();
  if (!r) return fail(404, 'Not found');
  try {
    return json({ id: r.id, name: r.name, updated: r.updated, doc: await readDoc(env, 'projects', uid + ':' + id, r.doc) });
  } catch (e) {
    console.log('project read failed', e.message);
    return fail(502, 'Could not read this project from storage.');
  }
}

/** The stored project (name, doc) for code that needs the document itself, or null. */
export async function loadProject(env, uid, id) {
  const r = await env.DB.prepare('SELECT id,name,doc,updated FROM projects WHERE uid=? AND id=?')
    .bind(uid, id)
    .first();
  if (!r) return null;
  return { id: r.id, name: r.name, updated: r.updated, doc: await readDoc(env, 'projects', uid + ':' + id, r.doc) };
}

/**
 * Overwrite the document of an existing project (used by people editing through a share link).
 * Returns false when the project no longer exists.
 */
export async function saveProjectDoc(env, uid, id, { doc, name, by }) {
  const row = await env.DB.prepare('SELECT doc, name FROM projects WHERE uid=? AND id=?').bind(uid, id).first();
  if (!row) return false;
  const now = Date.now();
  const stored = await writeDoc(env, 'projects', uid + ':' + id, doc);
  await env.DB.prepare('UPDATE projects SET doc=?, name=?, count=?, updated=? WHERE uid=? AND id=?')
    .bind(stored, String(name || row.name).slice(0, 80), doc.nodes.length | 0, now, uid, id)
    .run();
  await snapshot(env, uid, id, doc, { by, minGap: 5 * 60e3 });
  return now;
}

export async function putProject(request, env, uid, id) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return fail(413, 'Project is too large to sync (limit 1.5 MB).');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'Bad JSON');
  }
  if (!body || typeof body.doc !== 'object' || !Array.isArray(body.doc.nodes))
    return fail(400, 'Invalid project.');
  const now = Date.now();
  const updated = Math.min(Number(body.updated) || now, now + 300000);
  const created = Number(body.created) || updated;
  const name = String(body.name || 'Untitled').slice(0, 80);
  const type = String(body.type || '').slice(0, 20);
  const tpl = String(body.tpl || '').slice(0, 60);
  const count = Math.max(0, body.count | 0);
  const existing = await env.DB.prepare('SELECT updated FROM projects WHERE uid=? AND id=?')
    .bind(uid, id)
    .first();
  if (existing && existing.updated > updated) return json({ conflict: true, updated: existing.updated });
  if (!existing) {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE uid=?').bind(uid).first();
    if (c.n >= MAX_PROJECTS) return fail(403, `Project limit reached (${MAX_PROJECTS}).`);
  }
  const stored = await writeDoc(env, 'projects', uid + ':' + id, body.doc);
  await env.DB.prepare(
    'INSERT INTO projects(uid,id,name,type,count,tpl,doc,created,updated) VALUES(?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(uid,id) DO UPDATE SET name=excluded.name,type=excluded.type,count=excluded.count,tpl=excluded.tpl,doc=excluded.doc,updated=excluded.updated'
  )
    .bind(uid, id, name, type, count, tpl, stored, created, updated)
    .run();
  await snapshot(env, uid, id, body.doc, { by: 'You', minGap: AUTO_VERSION_GAP });
  return json({ ok: true, updated });
}

export async function deleteProject(env, uid, id) {
  const row = await env.DB.prepare('SELECT doc FROM projects WHERE uid=? AND id=?').bind(uid, id).first();
  await env.DB.prepare('DELETE FROM projects WHERE uid=? AND id=?').bind(uid, id).run();
  if (row) await dropDoc(env, 'projects', uid + ':' + id, row.doc);
  await dropHistory(env, uid, id);
  return json({ ok: true });
}
