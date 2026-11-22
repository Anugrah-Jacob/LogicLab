// LogicLab API (Cloudflare Pages Function, served under /api/*). This file is only the router;
// the logic lives in /server. Bindings and secrets: DB (D1), JWT_SECRET, ADMIN_SETUP_CODE, and optionally
// ANTHROPIC_API_KEY or GEMINI_API_KEY (Gemini is the Groq rate-limit fallback). Optional: MONGO_API_URL +
// MONGO_API_KEY (or a service binding MONGO) to keep project bodies in MongoDB, ICE_SERVERS / TURN_KEY_ID + TURN_API_TOKEN
// for WebRTC relays (see docs/COLLABORATION.md).
import { json, fail } from '../../server/util.js';
import { loadSettings, aiReady } from '../../server/settings.js';
import { getAuth, signup, login, logout, publicUser } from '../../server/auth.js';
import { listProjects, getProject, putProject, deleteProject, PROJECT_ID } from '../../server/projects.js';
import { aiHandler } from '../../server/ai.js';
import { handleAdmin, claimStatus, claimAdmin } from '../../server/admin.js';
import { handleCollab, ownHistory } from '../../server/collab.js';

export async function onRequest({ request, env, params }) {
  try {
    const url = new URL(request.url);
    const method = request.method;
    const path = '/' + (params.path || []).join('/');
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) return fail(403, 'Bad origin');
    }
    if (!env.DB) return fail(500, 'D1 binding "DB" is not configured.');

    // Live collaboration (share links, WebRTC signalling, history). Handled before loadSettings so the
    // frequent signalling polls cost as little as possible.
    if (path.startsWith('/collab/'))
      return await handleCollab(request, env, path, method, url, () => getAuth(env, request));

    const settings = await loadSettings(env);
    if (path === '/auth/signup' && method === 'POST') return await signup(request, env, settings);
    if (path === '/auth/login' && method === 'POST') return await login(request, env);
    if (path === '/auth/logout' && method === 'POST') return logout();

    const me = await getAuth(env, request);
    if (path === '/me' && method === 'GET') {
      return json({
        user: me ? publicUser(me) : null,
        signups: settings.signupsOpen,
        ai: me ? await aiReady(env, settings) : false
      });
    }
    if (!me) return fail(401, 'Not signed in.');

    if (path === '/projects' && method === 'GET') return await listProjects(env, me.id);
    const pm = /^\/projects\/([^/]+)$/.exec(path);
    if (pm) {
      const id = decodeURIComponent(pm[1]);
      if (!PROJECT_ID.test(id)) return fail(400, 'Bad project id.');
      if (method === 'GET') return await getProject(env, me.id, id);
      if (method === 'PUT') return await putProject(request, env, me.id, id);
      if (method === 'DELETE') return await deleteProject(env, me.id, id);
    }
    const hm = /^\/projects\/([^/]+)\/history$/.exec(path);
    if (hm && method === 'POST') {
      const id = decodeURIComponent(hm[1]);
      if (!PROJECT_ID.test(id)) return fail(400, 'Bad project id.');
      return await ownHistory(request, env, me, id);
    }
    if (path === '/ai' && method === 'POST') return await aiHandler(request, env, me);
    if (path === '/admin/claim') {
      if (method === 'GET') return await claimStatus(env);
      if (method === 'POST') return await claimAdmin(request, env, me);
    }
    if (path.startsWith('/admin/')) return await handleAdmin(request, env, me, path, url);
    return fail(404, 'Not found');
  } catch (e) {
    console.log('api error', (e && e.stack) || e);
    return fail(500, 'Server error.');
  }
}
