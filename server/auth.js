// Accounts and sessions: sign-up, login, logout, and "who is calling?".
import {
  b64u,
  unb64u,
  enc,
  dec,
  json,
  fail,
  readJson,
  validEmail,
  validPassword,
  makePasswordRecord,
  checkPassword,
  hashPassword
} from './util.js';

const COOKIE = 'll_session';
const DAY = 864e5;

async function hmacKey(env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET is missing or too short');
  return crypto.subtle.importKey(
    'raw',
    enc.encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
async function makeToken(env, uid) {
  const payload = b64u(enc.encode(JSON.stringify({ uid, exp: Date.now() + 30 * DAY })));
  return payload + '.' + b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload)));
}
const sessionCookie = (value, maxAge) =>
  `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

/** Returns the user id from a valid session cookie, or null. */
async function readUid(env, request) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(request.headers.get('cookie') || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode(payload))))
      return null;
    const data = JSON.parse(dec.decode(unb64u(payload)));
    return data.exp > Date.now() ? data.uid : null;
  } catch {
    return null;
  }
}

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

/** The signed-in user row (null when not signed in or disabled). Refreshes last_login at most every 6 hours. */
export async function getAuth(env, request) {
  const uid = await readUid(env, request);
  if (!uid) return null;
  const user = await env.DB.prepare(
    'SELECT id,email,name,role,disabled,ai_limit,last_login FROM users WHERE id=?'
  )
    .bind(uid)
    .first();
  if (!user || user.disabled) return null;
  if (!user.last_login || Date.now() - user.last_login > 6 * 3600e3) {
    await env.DB.prepare('UPDATE users SET last_login=? WHERE id=?').bind(Date.now(), uid).run();
  }
  return user;
}

/* ---- login throttle: 8 failed attempts per email per 15 minutes ---- */
async function throttled(env, key) {
  const r = await env.DB.prepare('SELECT n, ts FROM attempts WHERE k=?').bind(key).first();
  return !!r && Date.now() - r.ts < 15 * 60e3 && r.n >= 8;
}
async function noteFailure(env, key) {
  const r = await env.DB.prepare('SELECT n, ts FROM attempts WHERE k=?').bind(key).first();
  const n = r && Date.now() - r.ts < 15 * 60e3 ? r.n + 1 : 1;
  await env.DB.prepare('INSERT INTO attempts(k,n,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET n=?, ts=?')
    .bind(key, n, Date.now(), n, Date.now())
    .run();
}

export async function signup(request, env, settings) {
  if (!settings.signupsOpen) return fail(403, 'Sign-ups are closed. Ask the administrator for an account.');
  const body = await readJson(request);
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const name =
    String(body.name || '')
      .trim()
      .slice(0, 60) || email.split('@')[0];
  if (!validEmail(email)) return fail(400, 'Enter a valid email address.');
  if (!validPassword(body.password)) return fail(400, 'Password must be 8 to 128 characters.');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first())
    return fail(409, 'An account with this email already exists.');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users(id,email,name,pass,created,last_login) VALUES(?,?,?,?,?,?)')
    .bind(id, email, name, await makePasswordRecord(body.password), Date.now(), Date.now())
    .run();
  return json({ user: { id, name, email, role: 'user' } }, 200, {
    'set-cookie': sessionCookie(await makeToken(env, id), 2592000)
  });
}

export async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const key = 'login:' + email;
  if (await throttled(env, key)) return fail(429, 'Too many attempts. Try again in a few minutes.');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  let ok = false;
  if (user) ok = await checkPassword(String(body.password || ''), user.pass);
  else await hashPassword('x', new Uint8Array(16)); // equalise timing for unknown emails
  if (!ok) {
    await noteFailure(env, key);
    return fail(401, 'Wrong email or password.');
  }
  if (user.disabled) return fail(403, 'This account has been disabled. Contact the administrator.');
  await env.DB.prepare('DELETE FROM attempts WHERE k=?').bind(key).run();
  await env.DB.prepare('UPDATE users SET last_login=? WHERE id=?').bind(Date.now(), user.id).run();
  return json({ user: publicUser(user) }, 200, {
    'set-cookie': sessionCookie(await makeToken(env, user.id), 2592000)
  });
}

export const logout = () => json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
