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
    if (aiCalls === 2) return route.fulfill({ status: 502, json: { error: 'Temporary provider failure.' } });
    if (aiCalls === 4)
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
    if (aiCalls === 6)
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
              aiCalls === 3
                ? 'Circuit built and the request continued.'
                : aiCalls === 5
                  ? 'The 1,000-part circuit is ready.'
                  : 'The existing circuit was kept.'
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
  await page.click('#ai #as');
  await page.waitForSelector('.ai-approval [data-ai-apply]', { timeout: 3000 });
  await page.click('.ai-approval [data-ai-apply]');
  await page.waitForTimeout(6000);
  await page.waitForFunction(() => document.querySelectorAll('#am .bb.a').length === 1);
  eq(aiCalls, 3, 'one original model step, one failed step, and one continuation retry');
  eq(requests[2], requests[1], 'retry reuses the exact failed-step conversation');
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
  await page.click('#ai #as');
  await page.waitForSelector('.ai-approval [data-ai-apply]', { timeout: 3000 });
  await page.click('.ai-approval [data-ai-apply]');
  await page.waitForFunction(() => LogicLab.parts().length === 1000);
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('The 1,000-part circuit is ready.')
  );
  ok(requests[4].context.includes('AND:"Gate 999"'), 'latest gate is present in context');
  ok(
    requests[4].context.length > 15000,
    'context includes the large circuit netlist (' + requests[4].context.length + ' chars)'
  );
  ok((await page.locator('#am').innerText()).includes('The 1,000-part circuit is ready.'));
  await page.waitForFunction(() => !document.querySelector('#as').disabled);
});

await test('AI cancel keeps the existing circuit unchanged', async () => {
  await page.fill('#ai #aq', 'Clear the circuit.');
  await page.click('#ai #as');
  const cancel = page.locator('.ai-approval [data-ai-cancel]');
  await cancel.waitFor({ state: 'visible', timeout: 10000 });
  await cancel.click();
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('The existing circuit was kept.')
  );
  eq(await page.evaluate(() => LogicLab.parts().length), 1000);
  ok((await page.locator('#am').innerText()).includes('The existing circuit was kept.'));
});

await browser.close();
await new Promise((resolve) => server.close(resolve));
summary();
