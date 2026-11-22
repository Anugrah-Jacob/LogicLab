// Optional MongoDB Atlas storage for the large JSON documents (project bodies and history versions).
//
// D1 always keeps the small rows (accounts, project list, shares, version list). When the secrets below are set, the
// document body goes to MongoDB through the separate "logiclab-mongo" Worker (see /mongo-worker) and D1 stores only
// the marker MARK. Without the secrets nothing changes: the body stays in D1 exactly as before.
//
//   MONGO_API_KEY   shared secret (must equal API_KEY of the mongo Worker)
//   MONGO_API_URL   https URL of the mongo Worker, OR bind that Worker as a service binding named MONGO
export const MARK = '{"m":1}';

export const mongoOn = (env) => !!(env.MONGO_API_KEY && (env.MONGO || env.MONGO_API_URL));

async function call(env, op, body) {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.MONGO_API_KEY },
    body: JSON.stringify(body)
  };
  const res = env.MONGO
    ? await env.MONGO.fetch('https://mongo.internal/' + op, init)
    : await fetch(String(env.MONGO_API_URL).replace(/\/+$/, '') + '/' + op, init);
  if (!res.ok) throw new Error('mongo ' + op + ' failed (' + res.status + ')');
  return res.json();
}

/** Store a document. Returns the text for the D1 column: the JSON itself, or MARK when it went to MongoDB. */
export async function writeDoc(env, col, key, doc) {
  const text = JSON.stringify(doc);
  if (!mongoOn(env)) return text;
  try {
    await call(env, 'put', { col, key, doc });
    return MARK;
  } catch (e) {
    // MongoDB is unreachable: keep the document in D1 so nothing is lost. Reads accept both forms.
    console.log('MongoDB write failed, keeping the document in D1:', e.message);
    return text;
  }
}

/** Read a document from the D1 column text (parses it, or fetches it from MongoDB when it is the marker). */
export async function readDoc(env, col, key, stored) {
  if (stored !== MARK) return JSON.parse(stored);
  if (!mongoOn(env)) throw new Error('This document is stored in MongoDB but MongoDB is not configured.');
  const r = await call(env, 'get', { col, key });
  if (!r || !r.doc) throw new Error('Document not found in MongoDB.');
  return r.doc;
}

export async function dropDoc(env, col, key, stored) {
  if (stored !== MARK || !mongoOn(env)) return;
  try {
    await call(env, 'del', { col, key });
  } catch (e) {
    console.log('MongoDB delete failed:', e.message);
  }
}

export async function mongoPing(env) {
  if (!mongoOn(env)) return null;
  const t = Date.now();
  try {
    await call(env, 'ping', {});
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
