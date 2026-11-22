// Cloud tests: accounts, project sync, offline editing and the AI agent loop (with the model mocked).
// Needs a running dev server:  npm run dev   (then in another terminal)  npm run test:cloud
import { chromium } from 'playwright';
import { test, eq, ok, summary } from './harness.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '') + '/';
const post = (p, body, headers = {}, cookie = '') =>
  fetch(BASE + 'api' + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: JSON.stringify(body)
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
  eq((await post('/ai', { messages: [{ role: 'user', content: 'hi' }] })).status, 401);
  const r = await post('/ai', { messages: [{ role: 'user', content: 'hi' }] }, {}, cookie.replace('', ''));
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
  const n = body.messages.length;
  calls.push(n);
  const reply =
    n === 1
      ? {
          content: [
            { type: 'text', text: 'Building a **half adder**.' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'build_circuit',
              input: {
                replace: true,
                parts: [
                  { id: 'a', type: 'IN', name: 'A', value: 1 },
                  { id: 'b', type: 'IN', name: 'B', value: 1 },
                  { id: 'x', type: 'XOR', name: 'SUM' },
                  { id: 'c', type: 'AND', name: 'CARRY' },
                  { id: 's', type: 'LED', name: 'S' },
                  { id: 'k', type: 'LED', name: 'C' }
                ],
                wires: [
                  { from: 'a', to: 'x' },
                  { from: 'b', to: 'x' },
                  { from: 'a', to: 'c' },
                  { from: 'b', to: 'c' },
                  { from: 'x', to: 's' },
                  { from: 'c', to: 'k' }
                ]
              }
            }
          ],
          stop_reason: 'tool_use'
        }
      : n === 3
        ? { content: [{ type: 'tool_use', id: 't2', name: 'get_state', input: {} }], stop_reason: 'tool_use' }
        : { content: [{ type: 'text', text: 'Verified.' }], stop_reason: 'end_turn' };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
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
  await page.waitForFunction(() => document.querySelector('#am').innerText.includes('Verified.'), null, {
    timeout: 15000
  });
  eq(await page.evaluate(() => LogicLab.parts().length), 6);
  eq(calls.slice(0, 3), [1, 3, 5]);
  const text = await page.locator('#am').innerText();
  ok(text.includes('Built 6 parts and 6 wires') && text.includes('Verified.'));
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
summary();
