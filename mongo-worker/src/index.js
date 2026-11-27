// LogicLab storage Worker: keeps project bodies and history versions in MongoDB Atlas.
// Only the LogicLab site calls it (shared API_KEY). Accounts, the project list and share links stay in Cloudflare D1.
import { MongoClient } from 'mongodb';

const COLLECTIONS = new Set(['projects', 'history']);
let client, ready;

async function db(env) {
  if (!client) client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000 });
  const d = client.db(env.DB_NAME || 'logiclab');
  if (!ready) {
    ready = Promise.all([
      d.collection('projects').createIndex({ updated: -1 }),
      d.collection('history').createIndex({ updated: -1 })
    ]).catch(() => {});
  }
  await ready;
  return d;
}

function same(a, b) {
  const x = new TextEncoder().encode(String(a)),
    y = new TextEncoder().encode(String(b));
  if (!x.length || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('POST only', { status: 405 });
    if (!env.API_KEY || !env.MONGODB_URI || !same(request.headers.get('x-api-key') || '', env.API_KEY))
      return new Response('Unauthorized', { status: 401 });
    const op = new URL(request.url).pathname.replace(/^\/+/, '');
    let b;
    try {
      b = await request.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
    try {
      if (op === 'ping') {
        await (await db(env)).command({ ping: 1 });
        return Response.json({ ok: true });
      }
      if (!COLLECTIONS.has(b.col) || typeof b.key !== 'string' || !b.key || b.key.length > 120)
        return new Response('Bad request', { status: 400 });
      const c = (await db(env)).collection(b.col);
      if (op === 'put') {
        if (!b.doc || typeof b.doc !== 'object') return new Response('Bad doc', { status: 400 });
        await c.replaceOne({ _id: b.key }, { _id: b.key, doc: b.doc, updated: Date.now() }, { upsert: true });
        return Response.json({ ok: true });
      }
      if (op === 'get') {
        const r = await c.findOne({ _id: b.key });
        return Response.json({ doc: r ? r.doc : null });
      }
      if (op === 'del') {
        await c.deleteOne({ _id: b.key });
        return Response.json({ ok: true });
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.log('mongo error', e && e.message);
      return new Response('Storage error', { status: 502 });
    }
  }
};
