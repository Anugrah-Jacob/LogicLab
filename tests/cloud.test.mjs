// API and browser integration tests: account sync, offline editing and the mocked AI tool loop.
import { chromium } from 'playwright';
import { test, eq, ok, summary } from './harness.mjs';
import { startApp } from './app-server.mjs';

const app = await startApp();
const BASE = app.url;
const post = (p, body, headers = {}, cookie = '') =>
  fetch(BASE + 'api' + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: JSON.stringify(body)
  });
const aiPayload = (mode = 'read', message = 'hi') => ({
  project_name: 'Cloud test project',
  mode,
  message,
  chat_history: [],
  components: ['IN', 'XOR', 'LED'],
  expression: '',
  project_explanation: ''
});
const email = 'test' + Date.now() + '@example.com';
let cookie = '';

await test('sign-up validates input and rejects duplicates', async () => {
  eq((await post('/auth/signup', { email: 'bad', password: 'longenough1' })).status, 400);
  eq((await post('/auth/signup', { email, password: 'short' })).status, 400);
  const r = await post('/auth/signup', {
    name: 'Test User',
    email: email.toUpperCase(),
    password: 'correct horse 9'
  });
  eq(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  ok(
    /HttpOnly/i.test(r.headers.get('set-cookie')) && /SameSite=Lax/i.test(r.headers.get('set-cookie')),
    'cookie flags'
  );
  eq((await post('/auth/signup', { email, password: 'correct horse 9' })).status, 409);
});
await test('login works, wrong passwords are refused and throttled', async () => {
  const missing = await post('/auth/login', {
    email: 'missing' + Date.now() + '@example.com',
    password: 'anything'
  });
  eq(missing.status, 404);
  ok((await missing.json()).error.includes('Account not found'), 'unknown email directs the user to sign up');
  eq((await post('/auth/login', { email, password: 'correct horse 9' })).status, 200);
  for (let i = 0; i < 8; i++)
    eq((await post('/auth/login', { email, password: 'wrong password ' + i })).status, 401);
  eq((await post('/auth/login', { email, password: 'wrong again' })).status, 429);
  eq(
    (await post('/auth/login', { email, password: 'correct horse 9' })).status,
    429,
    'locked out even with the right password'
  );
});
await test('/api/me, session tampering and cross-site requests', async () => {
  eq((await (await fetch(BASE + 'api/me')).json()).user, null);
  eq((await (await fetch(BASE + 'api/me', { headers: { cookie } })).json()).user.email, email.toLowerCase());
  eq((await (await fetch(BASE + 'api/me', { headers: { cookie: cookie + 'x' } })).json()).user, null);
  eq((await post('/auth/login', {}, { origin: 'https://evil.example' })).status, 403);
  eq((await fetch(BASE + 'api/projects')).status, 401);
});
await test('project CRUD, last-write-wins conflicts and validation', async () => {
  const put = (id, body) =>
    fetch(BASE + 'api/projects/' + id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body)
    });
  eq(
    (
      await (
        await put('p123abc', {
          name: 'A',
          created: 1000,
          updated: 2000,
          type: 'Combinational',
          count: 3,
          doc: { nodes: [1], wires: [] }
        })
      ).json()
    ).ok,
    true
  );
  eq(
    (await (await put('p123abc', { name: 'old', updated: 1500, doc: { nodes: [] } })).json()).conflict,
    true
  );
  eq((await put('p123abc', { name: 'x', doc: { nope: 1 } })).status, 400);
  eq((await fetch(BASE + 'api/projects/..%2Fx', { headers: { cookie } })).status, 400);
  const list = (await (await fetch(BASE + 'api/projects', { headers: { cookie } })).json()).projects;
  eq([list.length, list[0].name, list[0].count], [1, 'A', 3]);
  eq((await (await fetch(BASE + 'api/projects/p123abc', { headers: { cookie } })).json()).doc.nodes, [1]);
  eq((await fetch(BASE + 'api/projects/p123abc', { method: 'DELETE', headers: { cookie } })).status, 200);
  eq((await fetch(BASE + 'api/projects/p123abc', { headers: { cookie } })).status, 404);
});
await test('AI endpoint needs a session and reports a missing key', async () => {
  eq((await post('/ai', aiPayload())).status, 401);
  const r = await post('/ai', aiPayload(), {}, cookie.replace('', ''));
  ok([503, 429, 502].includes(r.status), 'status ' + r.status);
});

/* ---- browser: the real UI against the real server, with the strict CSP header ---- */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('page error: ' + e.message));
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !/favicon/.test(m.text()))
    problems.push(m.type() + ': ' + m.text());
});
const calls = [];
await page.route('**/api/ai', (route) => {
  const body = JSON.parse(route.request().postData());
  calls.push(body);
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tool: { expression: 'A^B', mode: body.mode }, chat: 'Verified.' })
  });
});
await page.goto(BASE);
await page.waitForFunction(() => window.LogicLab);
await test('sign up through the interface, then the project syncs to the server', async () => {
  await page.click('#wav');
  await page.click('#asw a');
  const e2 = 'ui' + Date.now() + '@example.com';
  await page.fill('[name=fname]', 'Anugrah Jacob');
  await page.fill('[name=email]', e2);
  await page.fill('[name=password]', 'correct horse 9');
  await page.fill('[name=password2]', 'correct horse 9');
  await page.click('#asb');
  eq(await page.locator('#aerr').innerText(), 'Please accept the Terms of Service and Privacy Policy.');
  await page.check('[name=terms]');
  await page.click('#asb');
  await page.waitForFunction(() => document.querySelector('#wav').textContent === 'AJ');
  await page.click('.tc[data-k="mux-4to1"]');
  await page.evaluate(() => LogicLabHost.syncNow());
  await page.waitForFunction(() => /Synced/.test(document.querySelector('#ss').textContent), null, {
    timeout: 15000
  });
  const list = await page.evaluate(() => fetch('/api/projects').then((r) => r.json()));
  eq(
    [list.projects.length, list.projects[0].name, list.projects[0].type],
    [1, '4:1 multiplexer', 'Combinational']
  );
});
await test('edits made offline are kept on the device and synced after reconnecting', async () => {
  await ctx.setOffline(true);
  await page.click('#pal button[data-k="AND"]');
  await page.waitForFunction(() => /Offline/.test(document.querySelector('#ss').textContent), null, {
    timeout: 8000
  });
  const count = await page.evaluate(() => LogicLab.parts().length);
  await ctx.setOffline(false);
  await page.evaluate(() => LogicLabHost.syncNow());
  await page.waitForFunction(
    (n) =>
      fetch('/api/projects')
        .then((r) => r.json())
        .then((l) => l.projects[0] && l.projects[0].count === n),
    count,
    { timeout: 25000, polling: 1000 }
  );
  eq(true, true);
});
await test('the AI agent builds a circuit, checks it, and answers', async () => {
  await page.click('#aib');
  await page.click('#ah0 .pc button >> nth=0');
  await page.waitForSelector('.ai-approval [data-ai-apply]', { timeout: 5000 });
  await page.click('.ai-approval [data-ai-apply]');
  await page.waitForFunction(() => document.querySelector('#am').innerText.includes('Verified.'), null, {
    timeout: 15000
  });
  eq(await page.evaluate(() => LogicLab.parts().length), 4);
  eq(calls.length, 1);
  eq(Object.keys(calls[0]).sort(), [
    'chat_history', 'components', 'expression', 'message', 'mode', 'project_explanation', 'project_name'
  ]);
  eq(calls[0].mode, 'overwrite');
  eq(calls[0].expression, '');
  const text = await page.locator('#am').innerText();
  ok(text.includes('Verified.'));
  eq(await page.locator('#am .bb.a').count(), 1, 'tool steps collapse into the final assistant message');
  await page.evaluate(() => LogicLabHost.syncNow());
});
await test('the session survives a reload and the project list shows the synced project', async () => {
  await page.reload();
  await page.waitForFunction(() => window.LogicLab);
  await page.waitForFunction(() => document.querySelector('#wav').textContent === 'AJ');
  eq(await page.locator('.rr[data-id]').count(), 1);
});
await test('the app opens offline after the first visit (service worker)', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx2.newPage();
  await p.goto(BASE);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForTimeout(1500);
  await p.reload();
  await p.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx2.setOffline(true);
  await p.reload();
  await p.waitForFunction(() => window.LogicLab, null, { timeout: 10000 });
  eq(await p.isVisible('#wl'), true, 'welcome screen shows offline');
  await p.click('.tc[data-k="half-adder"]');
  eq(await p.evaluate(() => LogicLab.parts().length), 6, 'examples still work offline');
  await ctx2.close();
});
await test('no console errors or CSP violations occurred', async () => {
  eq(problems, []);
});
await browser.close();
await app.close();
summary();
