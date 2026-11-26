import { chromium, serve, test, eq, ok, summary } from './harness.mjs';

const { server, url } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const requests = [];
let aiCalls = 0;
await page.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/me')
    return route.fulfill({
      json: {
        user: { id: 'ai-test-user', name: 'AI Tester', email: 'ai@example.com', role: 'user' },
        signups: true,
        ai: true
      }
    });
  if (path === '/api/projects') return route.fulfill({ json: { projects: [] } });
  if (path === '/api/ai') {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.mode === 'expression')
      return route.fulfill({
        json: {
          content: [
            { type: 'text', text: '(A AND B) OR C' },
            {
              type: 'tool_use',
              id: 'expression-build',
              name: 'build_circuit',
              input: {
                replace: true,
                parts: [
                  { id: 'a', type: 'IN', name: 'A' },
                  { id: 'b', type: 'IN', name: 'B' },
                  { id: 'or1', type: 'OR', name: 'OR1' },
                  { id: 'y', type: 'LED', name: 'Y' }
                ],
                wires: [
                  { from: 'a', to: 'or1.0' },
                  { from: 'b', to: 'or1.1' },
                  { from: 'or1', to: 'y' }
                ]
              }
            }
          ]
        }
      });
    aiCalls++;
    if (aiCalls === 1)
      return route.fulfill({
        json: {
          content: [
            {
              type: 'tool_use',
              id: 'build-once',
              name: 'build_circuit',
              input: {
                replace: true,
                parts: [
                  { id: 'input', type: 'IN', name: 'A', value: 0 },
                  { id: 'output', type: 'LED', name: 'Y' }
                ],
                wires: [{ from: 'input', to: 'output' }]
              }
            }
          ],
          provider: 'groq'
        }
      });
    if (aiCalls >= 2 && aiCalls <= 8)
      return route.fulfill({ status: 502, json: { error: 'Temporary provider failure.' } });
    if (aiCalls === 10)
      return route.fulfill({
        json: {
          content: [
            {
              type: 'tool_use',
              id: 'build-large',
              name: 'build_circuit',
              input: {
                replace: true,
                parts: Array.from({ length: 1000 }, (_, index) => ({
                  id: 'gate-' + index,
                  type: 'AND',
                  name: 'Gate ' + index
                })),
                wires: []
              }
            }
          ],
          provider: 'gemini'
        }
      });
    if (aiCalls === 12)
      return route.fulfill({
        json: {
          content: [{ type: 'tool_use', id: 'clear-current', name: 'clear_circuit', input: {} }],
          provider: 'gemini'
        }
      });
    return route.fulfill({
      json: {
        content: [
          {
            type: 'text',
            text:
              aiCalls === 9
                ? 'Circuit built and the request continued.'
                : aiCalls === 11
                  ? 'The 1,000-part circuit is ready.'
                  : aiCalls === 13
                    ? 'The existing circuit was kept.'
                    : '| Inputs | Sum | Cout |\n|-------|-----|------|\n| 000 | 0 | 0 |\n| 001 | 1 | 0 |\n\n### How it works\n1. **XOR A,B** → intermediate value.\n2. XOR with Cin → Sum output.\n\n### Next steps (optional)\n- Multi-bit adder\n- Ripple-carry adder'
          }
        ],
        provider: 'gemini'
      }
    });
  }
  return route.fulfill({ json: {} });
});
await page.goto(url);
await page.waitForFunction(() => window.LogicLab && window.LogicLabHost.user());

await test('AI retries the failed step and continues without replaying completed tools', async () => {
  await page.click('.tc[data-k="full-adder"]');
  await page.click('#aib');
  await page.fill('#ai #aq', 'Build a simple circuit.');
  await page.click('#ai #aisend');
  await page.waitForSelector('.ai-approval [data-ai-apply]', { timeout: 3000 });
  await page.evaluate(() => {
    window.__retryLabels = [];
    new MutationObserver(() => {
      const retry = document.querySelector('#am .ai-retrying .ai-retry-count');
      if (retry) window.__retryLabels.push(retry.textContent);
    }).observe(document.querySelector('#am'), {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    window.__nativeRetryTimers = {
      setTimeout: window.setTimeout,
      setInterval: window.setInterval
    };
    window.setTimeout = (fn, delay, ...args) =>
      window.__nativeRetryTimers.setTimeout.call(window, fn, Math.min(Number(delay) || 0, 1), ...args);
    window.setInterval = (fn, delay, ...args) =>
      window.__nativeRetryTimers.setInterval.call(window, fn, Math.min(Number(delay) || 0, 5), ...args);
  });
  await page.click('.ai-approval [data-ai-apply]');
  await page.waitForFunction(() => document.querySelector('#am #aretry'), null, { timeout: 10000 });
  eq(aiCalls, 8, 'one initial failure followed by three hidden and three visible retries');
  eq(await page.locator('#am #aretry').innerText(), 'Retry', 'manual retry has no countdown');
  for (let i = 2; i < 8; i++) eq(requests[i], requests[1], 'retry reuses the exact failed-step conversation');
  for (const delay of [35, 45, 55])
    ok(
      (await page.evaluate(() => window.__retryLabels)).includes('Retrying automatically in ' + delay + 's'),
      'visible retry countdown starts at ' + delay + ' seconds'
    );
  eq(await page.locator('#ai #aq').isEnabled(), true, 'chat input remains available after retries fail');
  await page.evaluate(() => {
    window.setTimeout = window.__nativeRetryTimers.setTimeout;
    window.setInterval = window.__nativeRetryTimers.setInterval;
    delete window.__nativeRetryTimers;
  });
  await page.click('#am #aretry');
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('Circuit built and the request continued.')
  );
  eq(requests[0].mode, 'conversation');
  eq(requests[1].mode, 'conversation');
  eq(await page.locator('#am .bb.u').count(), 1, 'user message is not duplicated');
  eq(await page.locator('#am .bb.workflow').count(), 0, 'intermediate workflow details are hidden');
  const panel = await page.locator('#ai').boundingBox();
  ok(
    panel.width >= 320 && panel.width <= 460 && panel.height <= 720,
    'chat panel is compact and usable: ' + JSON.stringify(panel)
  );
  eq(await page.locator('#aimode option').count(), 5, 'AI has selectable task modes');
  const firstChat = await page.locator('#am').innerText();
  ok(firstChat.includes('Circuit built and the request continued.'), firstChat);
  eq(await page.locator('#ai-provider-status').count(), 0, 'provider identity is hidden in the frontend');
});

await test('AI builds 1,000 gates and sends the full compact canvas context', async () => {
  await page.fill('#ai #aq', 'Build a large circuit.');
  await page.click('#ai #aisend');
  await page.waitForSelector('.ai-approval [data-ai-apply]', { timeout: 3000 });
  await page.click('.ai-approval [data-ai-apply]');
  await page.waitForFunction(() => LogicLab.parts().length === 1000);
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('The 1,000-part circuit is ready.')
  );
  ok(requests[10].context.includes('AND:"Gate 999"'), 'latest gate is present in context');
  ok(
    requests[10].context.length > 15000,
    'context includes the large circuit netlist (' + requests[10].context.length + ' chars)'
  );
  ok((await page.locator('#am').innerText()).includes('The 1,000-part circuit is ready.'));
  await page.waitForFunction(() => !document.querySelector('#aisend').disabled);
});

await test('AI cancel keeps the existing circuit unchanged', async () => {
  await page.fill('#ai #aq', 'Clear the circuit.');
  await page.click('#ai #aisend');
  const cancel = page.locator('.ai-approval [data-ai-cancel]');
  await cancel.waitFor({ state: 'visible', timeout: 10000 });
  await cancel.click();
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('The existing circuit was kept.')
  );
  eq(await page.evaluate(() => LogicLab.parts().length), 1000);
  ok((await page.locator('#am').innerText()).includes('The existing circuit was kept.'));
});

await test('AI chat renders Markdown tables, headings and ordered lists', async () => {
  await page.fill('#ai #aq', 'Show an example truth table.');
  await page.click('#ai #aisend');
  await page.waitForSelector('#am .ai-table');
  eq(await page.locator('#am .ai-table th').allInnerTexts(), ['Inputs', 'Sum', 'Cout']);
  eq(await page.locator('#am .ai-table tbody tr').count(), 2);
  eq(await page.locator('#am h3').allInnerTexts(), ['How it works', 'Next steps (optional)']);
  eq(await page.locator('#am ol li').count(), 2);
  eq(await page.locator('#am ul li').count(), 2);
  ok(
    !(await page.locator('#am').innerText()).includes('|-------|'),
    'table separator is not shown as raw text'
  );
});

await test('expression builder sends only the raw expression and builds the returned circuit', async () => {
  await page.click('#ai #ax');
  await page.evaluate(() => LogicLab.load(''));
  await page.click('#side .stabs button[data-t="a"]');
  await page.click('#tabs button[data-t="build"]');
  const expression = 'A+B';
  await page.fill('#expression-input', expression);
  await page.click('#expression-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#expression-status').textContent.includes('Built from'));

  const request = requests.at(-1);
  eq(Object.keys(request).sort(), ['messages', 'mode']);
  eq(request.mode, 'expression');
  eq(request.messages, [{ role: 'user', content: expression }]);
  eq(await page.evaluate(() => LogicLab.parts().length), 4);
  const rows = await page.evaluate(() => LogicLab.analysis().rows.map((row) => row.o[0]));
  eq(rows, [0, 1, 1, 1]);
});

await browser.close();
await new Promise((resolve) => server.close(resolve));
summary();
