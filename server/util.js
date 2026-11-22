// Shared helpers: JSON responses, base64, password hashing and encryption of stored secrets.
export const enc = new TextEncoder();
export const dec = new TextDecoder();

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64u = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/'));

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
  });
export const fail = (status, error) => json({ error }, status);
export const readJson = (request) => request.json().catch(() => ({}));

/** Constant-time comparison of two byte arrays. */
export function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** PBKDF2-SHA256, 100,000 iterations (the maximum Cloudflare Workers allow). */
export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  );
}

/** Returns "<salt>:<hash>" ready to store. */
export async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return b64(salt) + ':' + b64(await hashPassword(password, salt));
}

export async function checkPassword(password, record) {
  const [salt, hash] = record.split(':');
  return same(await hashPassword(password, unb64(salt)), unb64(hash));
}

export const validEmail = (email) => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(email);
export const validPassword = (password) =>
  typeof password === 'string' && password.length >= 8 && password.length <= 128;

/* ---- encryption of secrets stored in the database (AES-GCM, key derived from JWT_SECRET) ---- */
async function secretKey(env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET is missing or too short');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.JWT_SECRET + ':settings'));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretKey(env), enc.encode(text));
  return 'v1.' + b64(iv) + '.' + b64(data);
}
export async function unseal(env, blob) {
  const [version, iv, data] = String(blob).split('.');
  if (version !== 'v1') throw new Error('Unknown secret format');
  return dec.decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await secretKey(env), unb64(data))
  );
}
