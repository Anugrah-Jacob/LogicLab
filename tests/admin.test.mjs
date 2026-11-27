// Admin panel, user management, AI provider settings and the AI provider translation layer.
// Needs a running dev server on a FRESH database with ADMIN_SETUP_CODE set (the claim step only works while no admin exists):
//   rm -rf .wrangler/state && npm run dev        then, in another terminal:   npm run test:admin
import http from 'node:http';
import { chromium } from 'playwright';
import { test, eq, ok, summary } from './harness.mjs';
import { startApp } from './app-server.mjs';

const SETUP = process.env.ADMIN_SETUP_CODE || 'choose-a-one-time-setup-code';
const app = process.env.BASE_URL ? null : await startApp({ ADMIN_SETUP_CODE: SETUP });
const BASE = (process.env.BASE_URL || app.url).replace(/\/$/, '') + '/';
const stamp = Date.now();
const aiPayload = ({ mode = 'read', message = 'hi', project_explanation = '' } = {}) => ({
  project_name: 'Test project',
  mode,
  message,
  chat_history: [],
  components: ['IN', 'AND', 'OR', 'XOR', 'NOT', 'LED'],
  expression: '',
  project_explanation
});

/* ---- fake OpenAI-compatible provider ---- */
const seen = [];
let expectedKey = 'sk-test-AAAA1111';
let mockDelayMs = 0;
let activeMockRequests = 0;
let maxActiveMockRequests = 0;
let mockResponseHeaders = {};
const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  seen.push({ url: req.url, headers: req.headers, body });
  const send = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json', ...mockResponseHeaders });
    res.end(JSON.stringify(data));
  };
  if (req.url === '/v1/chat/completions') {
    if (req.headers.authorization !== 'Bearer ' + expectedKey)
      return send(401, { error: { message: 'bad key' } });
    const call = async (name, args) => {
      activeMockRequests++;
      maxActiveMockRequests = Math.max(maxActiveMockRequests, activeMockRequests);
      try {
        if (mockDelayMs) await new Promise((resolve) => setTimeout(resolve, mockDelayMs));
        return send(200, {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: 'All done.',
                tool_calls: [
                  {
                    id: 'call_' + name,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) }
                  }
                ]
              }
            }
          ]
        });
      } finally {
        activeMockRequests--;
      }
    };
    if (!body.tools || !body.tools.length) {
      activeMockRequests++;
      maxActiveMockRequests = Math.max(maxActiveMockRequests, activeMockRequests);
      try {
        if (mockDelayMs) await new Promise((resolve) => setTimeout(resolve, mockDelayMs));
        return send(200, {
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }]
        });
      } finally {
        activeMockRequests--;
      }
    }
    return call('apply_expression', { expression: 'A^B', mode: 'overwrite' });
  }
  send(404, { error: { message: 'unknown path ' + req.url } });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK = 'http://127.0.0.1:' + mock.address().port;

/* ---- tiny API client with cookies ---- */
function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + 'api' + path, {
      method,
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty */
    }
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    cookie: () => cookie
  };
}
const admin = client(),
  bob = client();
const adminEmail = `admin${stamp}@example.com`,
  bobEmail = `bob${stamp}@example.com`;

await test('the first administrator is created with the setup code, only once', async () => {
  eq(
    (await admin.post('/auth/signup', { name: 'Ada Admin', email: adminEmail, password: 'correct horse 9' }))
      .status,
    200
  );
  eq(
    (await bob.post('/auth/signup', { name: 'Bob User', email: bobEmail, password: 'correct horse 9' }))
      .status,
    200
  );
  eq((await bob.get('/admin/stats')).status, 403, 'a normal user cannot read admin data');
  eq((await admin.get('/admin/claim')).data.open, true);
  eq((await admin.post('/admin/claim', { code: 'wrong' })).status, 403);
  eq((await admin.post('/admin/claim', { code: SETUP })).status, 200);
  eq((await admin.get('/me')).data.user.role, 'admin');
  eq(
    (await bob.post('/admin/claim', { code: SETUP })).status,
    403,
    'the claim is closed once an admin exists'
  );
});

await test('dashboard statistics are real', async () => {
  const s = (await admin.get('/admin/stats')).data;
  ok(s.totals.users >= 2 && s.days.length === 30 && s.series.signups.length === 30, JSON.stringify(s.totals));
  ok(s.series.signups.reduce((a, b) => a + b, 0) >= 2, 'signups appear in the chart data');
  eq((await admin.get('/admin/health')).data.migrated, true);
  ok((await admin.get('/admin/activity')).data.events.length >= 2);
});

let carolId = '';
await test('administrators can add, edit, disable, re-enable, reset and delete users', async () => {
  const carol = client();
  const created = await admin.post('/admin/users', {
    name: 'Carol',
    email: `carol${stamp}@example.com`,
    password: 'first password 1',
    role: 'user'
  });
  eq(created.status, 200);
  carolId = created.data.id;
  eq(
    (await admin.post('/admin/users', { email: `carol${stamp}@example.com`, password: 'first password 1' }))
      .status,
    409,
    'duplicate email'
  );
  eq(
    (await carol.post('/auth/login', { email: `carol${stamp}@example.com`, password: 'first password 1' }))
      .status,
    200
  );
  const list = (await admin.get('/admin/users?q=carol')).data;
  eq([list.total, list.users[0].name], [1, 'Carol']);
  eq((await admin.patch('/admin/users/' + carolId, { name: 'Carol C', ai_limit: 5 })).status, 200);
  eq((await admin.patch('/admin/users/' + carolId, { disabled: true })).status, 200);
  eq(
    (await carol.get('/me')).data.user,
    null,
    'an existing session stops working when the account is disabled'
  );
  eq(
    (await carol.post('/auth/login', { email: `carol${stamp}@example.com`, password: 'first password 1' }))
      .status,
    403,
    'login refused'
  );
  eq((await admin.patch('/admin/users/' + carolId, { disabled: false })).status, 200);
  eq(
    (await admin.post('/admin/users/' + carolId + '/password', { password: 'second password 2' })).status,
    200
  );
  eq(
    (await carol.post('/auth/login', { email: `carol${stamp}@example.com`, password: 'first password 1' }))
      .status,
    401,
    'old password no longer works'
  );
  eq(
    (await carol.post('/auth/login', { email: `carol${stamp}@example.com`, password: 'second password 2' }))
      .status,
    200
  );
  const row = (await admin.get('/admin/users?q=carol')).data.users[0];
  eq([row.name, row.ai_limit, row.disabled], ['Carol C', 5, 0]);
  eq((await admin.del('/admin/users/' + carolId)).status, 200);
  eq((await admin.get('/admin/users?q=carol')).data.total, 0);
});
await test('an administrator cannot lock everyone out', async () => {
  const me = (await admin.get('/me')).data.user;
  eq((await admin.del('/admin/users/' + me.id)).status, 400, 'cannot delete yourself');
  eq((await admin.patch('/admin/users/' + me.id, { disabled: true })).status, 400, 'cannot disable yourself');
  eq(
    (await admin.patch('/admin/users/' + me.id, { role: 'user' })).status,
    400,
    'cannot demote the last administrator'
  );
});

await test('Groq and Gemini settings: validation, encrypted key, masking and connection test', async () => {
  const before = (await admin.get('/admin/settings')).data;
  eq([before.hasKey, before.provider], [false, 'groq']);
  eq(Object.keys(before.providers).sort(), ['gemini', 'groq']);
  eq((await admin.put('/admin/settings', { provider: 'nope' })).status, 400);
  eq(
    (await admin.put('/admin/settings', { provider: 'openai' })).status,
    400,
    'providers outside Groq and Gemini are refused'
  );
  const saved = await admin.put('/admin/settings', {
    provider: 'groq',
    baseUrl: MOCK + '/v1',
    model: 'mock-model',
    apiKey: expectedKey,
    dailyLimit: 50
  });
  eq(saved.status, 200);
  const raw = JSON.stringify((await admin.get('/admin/settings')).data);
  ok(!raw.includes(expectedKey), 'the key is never returned');
  eq([saved.data.hasKey, saved.data.keyHint, saved.data.model], [true, '••••1111', 'mock-model']);
  await admin.put('/admin/settings', {
    provider: 'groq',
    providerKeys: { groq: expectedKey, gemini: 'gemini-test-MULTI2222' }
  });
  const multi = (await admin.get('/admin/settings')).data;
  eq([multi.providers.groq.hasKey, multi.providers.gemini.hasKey], [true, true]);
  eq([multi.providers.groq.keyHint, multi.providers.gemini.keyHint], ['••••1111', '••••2222']);
  ok(!JSON.stringify(multi).includes('gemini-test-MULTI2222'), 'provider keys are never returned');
  const good = (await admin.post('/admin/settings/test')).data;
  eq([good.ok, good.reply], [true, 'OK']);
  ok(seen.at(-1).headers.authorization === 'Bearer ' + expectedKey, 'the saved key was used');
  ok(
    !Object.hasOwn(seen.at(-1).body, 'signal'),
    'fetch timeout configuration is not sent in the request body'
  );
  expectedKey = 'sk-test-ROTATED2';
  const bad = (await admin.post('/admin/settings/test')).data;
  ok(!bad.ok && /Provider error \(401\)/.test(bad.error), bad.error);
  await admin.put('/admin/settings', { apiKey: expectedKey });
  eq((await admin.post('/admin/settings/test')).data.ok, true, 'a new key replaces the old one');
  eq((await bob.get('/admin/settings')).status, 403);
});

await test('AI requests from different users share one provider queue', async () => {
  mockDelayMs = 100;
  maxActiveMockRequests = 0;
  const payload = aiPayload({ mode: 'overwrite', message: 'Reply with OK.' });
  const responses = await Promise.all([admin.post('/ai', payload), bob.post('/ai', payload)]);
  mockDelayMs = 0;
  eq(
    responses.map((response) => response.status),
    [200, 200]
  );
  eq(maxActiveMockRequests, 1, 'provider calls never overlap across users');
});

await test('Groq rate headers limit output and prevent requests over the shared token budget', async () => {
  await admin.put('/admin/settings', {
    provider: 'groq',
    fallbackProvider: '',
    baseUrl: MOCK + '/v1',
    model: 'llama-3.3-70b-versatile'
  });
  const callsBefore = seen.length;
  const tooLong = await bob.post('/ai', aiPayload({ project_explanation: 'x'.repeat(600000) }));
  eq(tooLong.status, 413, 'oversized conversation is rejected before contacting Groq');
  eq(seen.length, callsBefore);

  mockResponseHeaders = {
    'x-ratelimit-limit-tokens': '6000',
    'x-ratelimit-remaining-tokens': '100',
    'x-ratelimit-reset-tokens': '30s',
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '99',
    'x-ratelimit-reset-requests': '1d'
  };
  const first = await bob.post('/ai', aiPayload({ message: 'Reply with OK.' }));
  eq(first.status, 200);
  const providerRequest = seen.at(-1);
  ok(providerRequest.body.max_tokens <= 1024, 'Groq output is capped to the configured token budget');
  const callsAfterFirst = seen.length;

  mockResponseHeaders = {};
  const blocked = await admin.post('/ai', aiPayload({ message: 'Reply with OK.' }));
  eq(blocked.status, 429);
  ok(blocked.data.retryAfter > 0, 'response includes a retry delay');
  eq(seen.length, callsAfterFirst, 'the persisted Groq budget blocks the next call');
  if (app) await app.env.DB.prepare("DELETE FROM settings WHERE k LIKE 'ai_groq_rate_state:%'").run();
  await admin.put('/admin/settings', { provider: 'groq', baseUrl: MOCK + '/v1', model: 'mock-model' });
});

const BROWSER = await chromium.launch();
async function browserFor(who) {
  const ctx = await BROWSER.newContext({ viewport: { width: 1400, height: 900 } });
  const host = new URL(BASE).hostname;
  if (who)
    await ctx.addCookies([
      {
        name: 'll_session',
        value: who.cookie().split('=')[1],
        domain: host,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      }
    ]);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/favicon|401|403/.test(m.text()))
      problems.push(m.type() + ': ' + m.text());
  });
  return { ctx, page, problems };
}

await test('the AI agent works through Groq via LangChain', async () => {
  const { ctx, page, problems } = await browserFor(bob);
  seen.length = 0;
  await page.goto(BASE);
  await page.waitForFunction(() => window.LogicLab);
  await page.waitForFunction(() => document.querySelector('#wav').textContent !== 'Sign in');
  await page.click('#wai'); // "Make with AI" on the welcome screen
  await page.click('#ah0 .pc button >> nth=0');
  await page.waitForFunction(() => document.querySelector('#am').innerText.includes('All done.'), null, {
    timeout: 20000
  });
  eq(
    await page.evaluate(() => LogicLab.parts().length),
    4,
    'expression action builds a wired circuit locally'
  );
  const chats = seen.filter((r) => r.url === '/v1/chat/completions');
  eq(chats.length, 1, 'one structured action response builds the circuit');
  eq([chats[0].body.tools[0].function.name, chats[0].body.model], ['apply_expression', 'mock-model']);
  eq(problems, []);
  if (app) await app.env.DB.prepare("DELETE FROM settings WHERE k LIKE 'ai_groq_rate_state:%'").run();
  await ctx.close();
});
await test('provider settings reject non-Groq/Gemini providers and endpoints', async () => {
  eq((await admin.put('/admin/settings', { provider: 'anthropic' })).status, 400);
  eq(
    (await admin.put('/admin/settings', { provider: 'groq', baseUrl: 'https://other.example/v1' })).status,
    400
  );
});
await test('per-user limits, the AI switch and closed sign-ups are enforced', async () => {
  const bobId = (await bob.get('/me')).data.user.id;
  await admin.patch('/admin/users/' + bobId, { ai_limit: 0 });
  eq((await bob.post('/ai', aiPayload())).status, 429, 'per-user limit');
  await admin.patch('/admin/users/' + bobId, { ai_limit: null });
  eq((await bob.post('/ai', aiPayload())).status, 200);
  await admin.put('/admin/settings', { aiEnabled: false });
  eq((await bob.post('/ai', aiPayload())).status, 503, 'AI switched off');
  eq((await bob.get('/me')).data.ai, false);
  await admin.put('/admin/settings', { aiEnabled: true, signupsOpen: false });
  eq(
    (await client().post('/auth/signup', { email: `late${stamp}@example.com`, password: 'correct horse 9' }))
      .status,
    403,
    'sign-ups closed'
  );
  eq((await client().get('/me')).data.signups, false);
  eq(
    (await admin.post('/admin/users', { email: `late${stamp}@example.com`, password: 'correct horse 9' }))
      .status,
    200,
    'admins can still add users'
  );
  await admin.put('/admin/settings', { signupsOpen: true });
  eq(
    (await client().post('/auth/signup', { email: `late2${stamp}@example.com`, password: 'correct horse 9' }))
      .status,
    200,
    'open again'
  );
});

await test('admin panel: sign-in screen, access control, dashboard, users, settings', async () => {
  // not signed in
  let b = await browserFor(null);
  await b.page.goto(BASE + 'admin/');
  await b.page.waitForSelector('#lf');
  ok((await b.page.locator('body').innerText()).includes('Sign in to the admin panel'));
  await b.ctx.close();
  // a normal user
  b = await browserFor(bob);
  await b.page.goto(BASE + 'admin/');
  await b.page.waitForSelector('#cf');
  ok((await b.page.locator('body').innerText()).includes('Administrators only'));
  await b.ctx.close();
  // the administrator
  b = await browserFor(admin);
  const { page } = b;
  await page.goto(BASE + 'admin/');
  await page.waitForSelector('.stat');
  eq(await page.locator('.stat').count(), 4);
  ok(await page.locator('svg.chart').first().isVisible(), 'usage chart');
  ok((await page.locator('.status').innerText()).includes('Database'), 'system status');
  await page.screenshot({ path: '/tmp/admin-dashboard.png' });
  await page.click('.nav a[data-page=users]');
  await page.waitForSelector('table.t tbody tr');
  ok((await page.locator('table.t').innerText()).includes(bobEmail));
  await page.click('[data-act=adduser]');
  await page.fill('.mc [name=name]', 'Dana');
  await page.fill('.mc [name=email]', `dana${stamp}@example.com`);
  await page.fill('.mc [name=password]', 'danas password 1');
  await page.click('.mc button.pr');
  await page.waitForFunction(
    (e) => document.querySelector('table.t')?.innerText.includes(e),
    `dana${stamp}@example.com`
  );
  await page.fill('#gq', 'dana');
  await page.waitForFunction(() => document.querySelectorAll('table.t tbody tr').length === 1);
  await page.click('.nav a[data-page=settings]');
  await page.waitForSelector('#aiform');
  await page.selectOption('[name=provider]', 'groq');
  eq(await page.inputValue('[name=model]'), 'llama-3.3-70b-versatile');
  await page.fill('[name=model]', 'mock-model');
  expectedKey = 'sk-test-UIKEY333';
  await page.locator('[name=apiKey]').fill(expectedKey);
  await page.selectOption('[name=fallbackProvider]', 'gemini');
  await page.locator('[name=fallbackApiKey]').fill('gsk-test-UIKEY444');
  await page.click('#aiform button.pr');
  await page.waitForFunction(() => document.querySelector('[name=apiKey]')?.placeholder.includes('••••'));
  ok(
    (await page.locator('[name=fallbackApiKey]').getAttribute('placeholder')).includes('••••'),
    'second provider key is saved separately from the primary key'
  );
  await page.click('[data-act=testai]');
  await page.waitForFunction(() => document.querySelector('#aimsg')?.innerText.includes('Connected'));
  await page.click('.nav a[data-page=system]');
  await page.waitForSelector('.pill');
  ok((await page.locator('table.t').innerText()).includes('Database migrations'));
  await page.click('#menu');
  eq(await page.evaluate(() => localStorage.getItem('ll:admin:collapsed')), '1', 'sidebar can be collapsed');
  eq(b.problems, []);
  await b.ctx.close();
});

await BROWSER.close();
mock.close();
if (app) await app.close();
summary();
