// Admin API (all routes need a signed-in administrator): stats, users, circuits, platform and AI settings.
import {
  json,
  fail,
  readJson,
  same,
  enc,
  validEmail,
  validPassword,
  makePasswordRecord,
  seal
} from './util.js';
import { publicUser } from './auth.js';
import { dropDoc, mongoPing } from './store.js';
import { dropHistory } from './history.js';
import {
  PROVIDERS,
  loadSettings,
  saveSetting,
  storeKey,
  storeProviderKey,
  resolveKey,
  validBaseUrl,
  keyHint,
  aiReady
} from './settings.js';
import { testProvider } from './ai.js';

const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const num = async (env, sql, ...args) =>
  (
    await env.DB.prepare(sql)
      .bind(...args)
      .first()
  ).n;

/** Last `n` days as YYYY-MM-DD, oldest first. */
const lastDays = (n) => Array.from({ length: n }, (_, i) => isoDay(Date.now() - (n - 1 - i) * DAY));
const series = (days, rows) => {
  const m = new Map(rows.map((r) => [r.d, r.n]));
  return days.map((d) => m.get(d) || 0);
};

/* ---- first administrator: signed-in user + the ADMIN_SETUP_CODE secret ---- */
export async function claimStatus(env) {
  return json({
    open: (await num(env, "SELECT COUNT(*) AS n FROM users WHERE role='admin'")) === 0,
    codeSet: !!env.ADMIN_SETUP_CODE
  });
}
export async function claimAdmin(request, env, user) {
  if (!env.ADMIN_SETUP_CODE) return fail(503, 'The ADMIN_SETUP_CODE secret is not set on the server.');
  if ((await num(env, "SELECT COUNT(*) AS n FROM users WHERE role='admin'")) > 0)
    return fail(403, 'An administrator already exists. Ask them to promote you.');
  const { code } = await readJson(request);
  if (!same(enc.encode(String(code || '')), enc.encode(env.ADMIN_SETUP_CODE)))
    return fail(403, 'That setup code is not correct.');
  await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(user.id).run();
  return json({ ok: true });
}

/* ---- dashboard ---- */
export async function stats(env) {
  const days = lastDays(30),
    since = Date.now() - 30 * DAY,
    sinceDay = days[0];
  const day = (col) => `strftime('%Y-%m-%d', ${col}/1000, 'unixepoch')`;
  const [users, active, fresh, projects, aiTotal, ai30] = await Promise.all([
    num(env, 'SELECT COUNT(*) AS n FROM users'),
    num(env, 'SELECT COUNT(*) AS n FROM users WHERE last_login > ?', since),
    num(env, 'SELECT COUNT(*) AS n FROM users WHERE created > ?', since),
    num(env, 'SELECT COUNT(*) AS n FROM projects'),
    num(env, 'SELECT COALESCE(SUM(n),0) AS n FROM usage'),
    num(env, 'SELECT COALESCE(SUM(n),0) AS n FROM usage WHERE day >= ?', sinceDay)
  ]);
  const [signups, aiDaily, projDaily, templates, topAi, roles] = await Promise.all([
    env.DB.prepare(`SELECT ${day('created')} AS d, COUNT(*) AS n FROM users WHERE created > ? GROUP BY d`)
      .bind(since)
      .all(),
    env.DB.prepare('SELECT day AS d, SUM(n) AS n FROM usage WHERE day >= ? GROUP BY day')
      .bind(sinceDay)
      .all(),
    env.DB.prepare(`SELECT ${day('created')} AS d, COUNT(*) AS n FROM projects WHERE created > ? GROUP BY d`)
      .bind(since)
      .all(),
    env.DB.prepare(
      "SELECT tpl, COUNT(*) AS n FROM projects WHERE tpl IS NOT NULL AND tpl <> '' GROUP BY tpl ORDER BY n DESC LIMIT 6"
    ).all(),
    env.DB.prepare(
      'SELECT u.id, u.name, u.email, SUM(x.n) AS n FROM usage x JOIN users u ON u.id = x.uid WHERE x.day >= ? GROUP BY u.id ORDER BY n DESC LIMIT 5'
    )
      .bind(sinceDay)
      .all(),
    env.DB.prepare('SELECT role, disabled, COUNT(*) AS n FROM users GROUP BY role, disabled').all()
  ]);
  const dist = { admins: 0, users: 0, disabled: 0 };
  roles.results.forEach((r) => {
    if (r.disabled) dist.disabled += r.n;
    else if (r.role === 'admin') dist.admins += r.n;
    else dist.users += r.n;
  });
  const fromTemplates = templates.results.reduce((s, r) => s + r.n, 0);
  return json({
    totals: { users, activeUsers30: active, newUsers30: fresh, projects, aiTotal, ai30 },
    days,
    series: {
      signups: series(days, signups.results),
      ai: series(days, aiDaily.results),
      projects: series(days, projDaily.results)
    },
    templates: templates.results.map((r) => ({
      id: r.tpl,
      n: r.n,
      pct: fromTemplates ? Math.round((r.n / fromTemplates) * 100) : 0
    })),
    topAi: topAi.results,
    distribution: dist
  });
}

export async function activity(env, url) {
  const limit = Math.min(30, Number(url.searchParams.get('limit')) || 8);
  const users = await env.DB.prepare(
    'SELECT name, email, created AS t FROM users ORDER BY created DESC LIMIT ?'
  )
    .bind(limit)
    .all();
  const projects = await env.DB.prepare(
    'SELECT p.name, p.type, p.created AS t, u.email FROM projects p JOIN users u ON u.id = p.uid ORDER BY p.created DESC LIMIT ?'
  )
    .bind(limit)
    .all();
  const events = [
    ...users.results.map((u) => ({ kind: 'user', title: 'New user registered', detail: u.email, t: u.t })),
    ...projects.results.map((p) => ({
      kind: 'circuit',
      title: 'New circuit created',
      detail: p.name + ' · ' + p.email,
      t: p.t
    }))
  ]
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
  return json({ events });
}

export async function health(env) {
  const started = Date.now();
  let db = false,
    migrated = false,
    collab = false;
  try {
    await env.DB.prepare('SELECT 1').first();
    db = true;
    await env.DB.prepare('SELECT role FROM users LIMIT 1').first();
    migrated = true;
    await env.DB.prepare('SELECT id FROM shares LIMIT 1').first();
    collab = true;
  } catch {
    /* reported below */
  }
  const settings = db && migrated ? await loadSettings(env) : null;
  return json({
    db,
    migrated,
    collab,
    mongo: await mongoPing(env),
    dbMs: Date.now() - started,
    ai: settings
      ? {
          enabled: settings.aiEnabled,
          configured: await aiReady(env, settings),
          provider: settings.provider,
          model: settings.model
        }
      : null,
    env: {
      jwtSecret: !!env.JWT_SECRET && env.JWT_SECRET.length >= 16,
      adminSetupCode: !!env.ADMIN_SETUP_CODE,
      groqKey: !!env.GROQ_API_KEY,
      geminiKey: !!env.GEMINI_API_KEY
    },
    time: new Date().toISOString()
  });
}

/* ---- users ---- */
const USER_COLUMNS = 'u.id, u.email, u.name, u.role, u.disabled, u.created, u.last_login, u.ai_limit';
export async function listUsers(env, url) {
  const q = '%' + (url.searchParams.get('q') || '').trim().toLowerCase() + '%';
  const limit = Math.min(100, Number(url.searchParams.get('limit')) || 50),
    offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const today = isoDay(Date.now());
  const rows = await env.DB.prepare(
    `SELECT ${USER_COLUMNS},
       (SELECT COUNT(*) FROM projects p WHERE p.uid = u.id) AS projects,
       (SELECT COALESCE(SUM(n),0) FROM usage x WHERE x.uid = u.id) AS ai_total,
       (SELECT COALESCE(SUM(n),0) FROM usage x WHERE x.uid = u.id AND x.day = ?) AS ai_today
     FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ? ORDER BY u.created DESC LIMIT ? OFFSET ?`
  )
    .bind(today, q, q, limit, offset)
    .all();
  const total = await num(
    env,
    'SELECT COUNT(*) AS n FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ?',
    q,
    q
  );
  return json({ users: rows.results, total });
}

export async function createUser(request, env) {
  const b = await readJson(request);
  const email = String(b.email || '')
    .trim()
    .toLowerCase();
  const name =
    String(b.name || '')
      .trim()
      .slice(0, 60) || email.split('@')[0];
  if (!validEmail(email)) return fail(400, 'Enter a valid email address.');
  if (!validPassword(b.password)) return fail(400, 'Password must be 8 to 128 characters.');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first())
    return fail(409, 'An account with this email already exists.');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users(id,email,name,pass,created,role) VALUES(?,?,?,?,?,?)')
    .bind(
      id,
      email,
      name,
      await makePasswordRecord(b.password),
      Date.now(),
      b.role === 'admin' ? 'admin' : 'user'
    )
    .run();
  return json({ ok: true, id });
}

async function otherActiveAdmins(env, id) {
  return num(env, "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0 AND id<>?", id);
}

export async function updateUser(request, env, me, id) {
  const target = await env.DB.prepare('SELECT id, role, disabled FROM users WHERE id=?').bind(id).first();
  if (!target) return fail(404, 'User not found.');
  const b = await readJson(request);
  const sets = [],
    args = [];
  if (typeof b.name === 'string') {
    sets.push('name=?');
    args.push(b.name.trim().slice(0, 60) || 'User');
  }
  if (b.role === 'admin' || b.role === 'user') {
    if (b.role === 'user' && target.role === 'admin' && !(await otherActiveAdmins(env, id)))
      return fail(400, 'There must be at least one active administrator.');
    sets.push('role=?');
    args.push(b.role);
  }
  if (typeof b.disabled === 'boolean') {
    if (b.disabled && id === me.id) return fail(400, 'You cannot disable your own account.');
    if (b.disabled && target.role === 'admin' && !(await otherActiveAdmins(env, id)))
      return fail(400, 'There must be at least one active administrator.');
    sets.push('disabled=?');
    args.push(b.disabled ? 1 : 0);
  }
  if ('ai_limit' in b) {
    sets.push('ai_limit=?');
    args.push(
      b.ai_limit === null || b.ai_limit === '' ? null : Math.max(0, Math.min(100000, Number(b.ai_limit) | 0))
    );
  }
  if (!sets.length) return fail(400, 'Nothing to change.');
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id=?`)
    .bind(...args, id)
    .run();
  return json({ ok: true });
}

export async function setPassword(request, env, id) {
  const { password } = await readJson(request);
  if (!validPassword(password)) return fail(400, 'Password must be 8 to 128 characters.');
  const r = await env.DB.prepare('UPDATE users SET pass=? WHERE id=?')
    .bind(await makePasswordRecord(password), id)
    .run();
  if (!r.meta.changes) return fail(404, 'User not found.');
  await env.DB.prepare("DELETE FROM attempts WHERE k=(SELECT 'login:' || email FROM users WHERE id=?)")
    .bind(id)
    .run();
  return json({ ok: true });
}

export async function deleteUser(env, me, id) {
  if (id === me.id) return fail(400, 'You cannot delete your own account.');
  const target = await env.DB.prepare('SELECT role FROM users WHERE id=?').bind(id).first();
  if (!target) return fail(404, 'User not found.');
  if (target.role === 'admin' && !(await otherActiveAdmins(env, id)))
    return fail(400, 'There must be at least one active administrator.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM projects WHERE uid=?').bind(id),
    env.DB.prepare('DELETE FROM usage WHERE uid=?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id=?').bind(id)
  ]);
  try {
    // Share links, invitations, live-session rows and history for this user.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM peers WHERE room IN (SELECT id FROM shares WHERE uid=?)').bind(id),
      env.DB.prepare(
        'DELETE FROM collaboration_invites WHERE room IN (SELECT id FROM shares WHERE uid=?)'
      ).bind(id),
      env.DB.prepare('DELETE FROM shares WHERE uid=?').bind(id),
      env.DB.prepare('DELETE FROM peers WHERE user_id=?').bind(id),
      env.DB.prepare('DELETE FROM history WHERE uid=?').bind(id)
    ]);
  } catch {
    /* collaboration tables not migrated yet */
  }
  return json({ ok: true });
}

/* ---- circuits ---- */
export async function listProjectsAdmin(env, url) {
  const q = '%' + (url.searchParams.get('q') || '').trim().toLowerCase() + '%';
  const limit = Math.min(100, Number(url.searchParams.get('limit')) || 50),
    offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const rows = await env.DB.prepare(
    `SELECT p.uid, p.id, p.name, p.type, p.count, p.tpl, p.created, p.updated, u.email, u.name AS owner
     FROM projects p JOIN users u ON u.id = p.uid WHERE lower(p.name) LIKE ? OR lower(u.email) LIKE ? ORDER BY p.updated DESC LIMIT ? OFFSET ?`
  )
    .bind(q, q, limit, offset)
    .all();
  const total = await num(
    env,
    'SELECT COUNT(*) AS n FROM projects p JOIN users u ON u.id = p.uid WHERE lower(p.name) LIKE ? OR lower(u.email) LIKE ?',
    q,
    q
  );
  return json({ projects: rows.results, total });
}
export async function deleteProjectAdmin(env, uid, id) {
  const row = await env.DB.prepare('SELECT doc FROM projects WHERE uid=? AND id=?').bind(uid, id).first();
  await env.DB.prepare('DELETE FROM projects WHERE uid=? AND id=?').bind(uid, id).run();
  if (row) await dropDoc(env, 'projects', uid + ':' + id, row.doc);
  await dropHistory(env, uid, id);
  return json({ ok: true });
}

/* ---- settings ---- */
export async function getSettings(env) {
  const s = await loadSettings(env);
  const key = await resolveKey(env, s);
  const geminiKey = await resolveKey(env, {
    provider: 'gemini',
    keyBlob: '',
    geminiKeyBlob: s.geminiKeyBlob,
    providerKeyBlobs: s.providerKeyBlobs
  });
  const providers = Object.fromEntries(
    await Promise.all(
      Object.entries(PROVIDERS).map(async ([id, p]) => [
        id,
        {
          label: p.label,
          kind: p.kind,
          base: p.base,
          model: p.model,
          models: p.models,
          hasKey: !!(
            s.providerKeyBlobs[id] ||
            (id === s.provider && s.legacyKeyProvider === id && s.keyBlob) ||
            (id === 'gemini' && s.geminiKeyBlob)
          ),
          keyHint: keyHint(
            await resolveKey(env, {
              provider: id,
              keyBlob: id === s.provider ? s.keyBlob : '',
              legacyKeyProvider: s.legacyKeyProvider,
              geminiKeyBlob: id === 'gemini' ? s.geminiKeyBlob : '',
              providerKeyBlobs: s.providerKeyBlobs
            })
          )
        }
      ])
    )
  );
  return json({
    provider: s.provider,
    fallbackProvider: s.fallbackProvider,
    fallbackModel: s.fallbackModel,
    model: s.model,
    hasKey: !!key,
    keyHint: keyHint(key),
    keySource:
      s.providerKeyBlobs[s.provider] ||
      (s.legacyKeyProvider === s.provider && s.keyBlob) ||
      (s.provider === 'gemini' && s.geminiKeyBlob)
        ? 'admin'
        : key
          ? 'environment'
          : '',
    hasGeminiFallback: !!geminiKey,
    geminiKeyHint: keyHint(geminiKey),
    dailyLimit: s.dailyLimit,
    aiEnabled: s.aiEnabled,
    signupsOpen: s.signupsOpen,
    providers
  });
}

export async function putSettings(request, env) {
  const b = await readJson(request);
  const currentSettings = await loadSettings(env);
  const currentProvider = currentSettings.provider;
  const nextProvider = b.provider === undefined ? currentProvider : b.provider;
  if (b.provider !== undefined) {
    if (!PROVIDERS[b.provider]) return fail(400, 'Unknown provider.');
    await saveSetting(env, 'ai_provider', b.provider);
    if (b.provider !== currentProvider) {
      if (typeof b.model !== 'string') await saveSetting(env, 'ai_model', PROVIDERS[b.provider].model);
      if (typeof b.baseUrl !== 'string') await saveSetting(env, 'ai_base_url', '');
    }
  }
  if (b.fallbackProvider !== undefined) {
    if (b.fallbackProvider !== '' && (!PROVIDERS[b.fallbackProvider] || b.fallbackProvider === nextProvider))
      return fail(400, 'Choose a different supported second provider.');
    await saveSetting(env, 'ai_fallback_provider', b.fallbackProvider);
  }
  if (typeof b.model === 'string') await saveSetting(env, 'ai_model', b.model.trim().slice(0, 120));
  if (typeof b.fallbackModel === 'string')
    await saveSetting(env, 'ai_fallback_model', b.fallbackModel.trim().slice(0, 120));
  if (typeof b.baseUrl === 'string') {
    const url = b.baseUrl.trim();
    if (url && !validBaseUrl(url))
      return fail(400, 'The base URL must start with https:// (http:// is only allowed for localhost).');
    if (url) {
      const parsed = new URL(url);
      const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
      if (!local && url.replace(/\/+$/, '') !== PROVIDERS[nextProvider].base)
        return fail(400, 'Only the selected Groq or Gemini endpoint can be configured.');
    }
    await saveSetting(env, 'ai_base_url', url);
  }
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    await storeKey(env, b.apiKey.trim());
    await storeProviderKey(env, nextProvider, b.apiKey.trim());
  }
  if (b.clearKey === true) await saveSetting(env, 'ai_key', '');
  if (b.clearGeminiKey === true) await saveSetting(env, 'ai_gemini_key', '');
  if (b.providerKeys && typeof b.providerKeys === 'object' && !Array.isArray(b.providerKeys)) {
    for (const [provider, value] of Object.entries(b.providerKeys)) {
      if (!PROVIDERS[provider]) return fail(400, 'Unknown provider key.');
      if (typeof value === 'string' && value.trim()) await storeProviderKey(env, provider, value.trim());
    }
  }
  if (typeof b.clearProviderKey === 'string') {
    if (!PROVIDERS[b.clearProviderKey]) return fail(400, 'Unknown provider key.');
    const clearKeys = [saveSetting(env, 'ai_key_' + b.clearProviderKey, '')];
    if (b.clearProviderKey === currentProvider) clearKeys.push(saveSetting(env, 'ai_key', ''));
    if (b.clearProviderKey === 'gemini') clearKeys.push(saveSetting(env, 'ai_gemini_key', ''));
    await Promise.all(clearKeys);
  }
  if (b.dailyLimit !== undefined)
    await saveSetting(env, 'ai_daily_limit', Math.max(1, Math.min(100000, Number(b.dailyLimit) | 0 || 60)));
  if (typeof b.aiEnabled === 'boolean') await saveSetting(env, 'ai_enabled', b.aiEnabled ? 1 : 0);
  if (typeof b.signupsOpen === 'boolean') await saveSetting(env, 'signups_open', b.signupsOpen ? 1 : 0);
  return getSettings(env);
}

export async function testSettings(env) {
  return json(await testProvider(env, await loadSettings(env)));
}

/* ---- router for /api/admin/* ---- */
export async function handleAdmin(request, env, me, path, url) {
  const m = request.method;
  if (path === '/admin/claim') return null; // handled before the admin check
  if (me.role !== 'admin') return fail(403, 'Administrators only.');
  if (path === '/admin/stats' && m === 'GET') return stats(env);
  if (path === '/admin/activity' && m === 'GET') return activity(env, url);
  if (path === '/admin/health' && m === 'GET') return health(env);
  if (path === '/admin/users' && m === 'GET') return listUsers(env, url);
  if (path === '/admin/users' && m === 'POST') return createUser(request, env);
  let r = /^\/admin\/users\/([^/]+)$/.exec(path);
  if (r && m === 'PATCH') return updateUser(request, env, me, decodeURIComponent(r[1]));
  if (r && m === 'DELETE') return deleteUser(env, me, decodeURIComponent(r[1]));
  r = /^\/admin\/users\/([^/]+)\/password$/.exec(path);
  if (r && m === 'POST') return setPassword(request, env, decodeURIComponent(r[1]));
  if (path === '/admin/projects' && m === 'GET') return listProjectsAdmin(env, url);
  r = /^\/admin\/projects\/([^/]+)\/([^/]+)$/.exec(path);
  if (r && m === 'DELETE') return deleteProjectAdmin(env, decodeURIComponent(r[1]), decodeURIComponent(r[2]));
  if (path === '/admin/settings' && m === 'GET') return getSettings(env);
  if (path === '/admin/settings' && m === 'PUT') return putSettings(request, env);
  if (path === '/admin/settings/test' && m === 'POST') return testSettings(env);
  return fail(404, 'Not found');
}
