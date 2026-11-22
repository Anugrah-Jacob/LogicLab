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
    return route.fulfill({
      json: {
        content: [{ type: 'text', text: 'Circuit built and the request continued.' }],
        provider: 'gemini'
      }
    });
  }
  return route.fulfill({ json: {} });
});
await page.goto(url);
await page.waitForFunction(() => window.LogicLab && window.LogicLabHost.user());

await test('AI retries the failed step and continues without replaying completed tools', async () => {
  await page.click('.tc');
  await page.click('#aib');
  await page.fill('#ai #aq', 'Build a simple circuit.');
  await page.click('#ai #as');
  await page.waitForSelector('.ai-retry-now');
  ok((await page.locator('.ai-retry-count').innerText()).includes('10s'), 'shows automatic retry countdown');
  await page.click('.ai-retry-now');
  await page.waitForFunction(() => document.querySelectorAll('#am .bb.a').length >= 1);
  eq(aiCalls, 3, 'one original model step, one failed step, and one continuation retry');
  eq(requests[2], requests[1], 'retry reuses the exact failed-step conversation');
  eq(await page.locator('#am .bb.u').count(), 1, 'user message is not duplicated');
  eq(await page.locator('#am .bb.workflow').count(), 1, 'completed workflow is not replayed');
  ok(await page.locator('#am .bb.workflow').evaluate((node) => node.classList.contains('collapsed')));
  eq(await page.locator('.ai-workflow-toggle').getAttribute('aria-expanded'), 'false');
  eq(await page.locator('.ai-workflow-head b').innerText(), 'Agent workflow completed');
  const panel = await page.locator('#ai').boundingBox();
  ok(
    panel.width <= 620 && panel.height <= 720,
    'desktop chat panel stays at a normal size: ' + JSON.stringify(panel)
  );
  await page.click('.ai-workflow-toggle');
  eq(await page.locator('.ai-workflow-toggle').getAttribute('aria-expanded'), 'true');
  ok(!(await page.locator('#am .bb.workflow').evaluate((node) => node.classList.contains('collapsed'))));
  ok((await page.locator('#am').innerText()).includes('Built 2 parts and 1 wires'));
  ok((await page.locator('#am').innerText()).includes('Circuit built and the request continued.'));
  eq(await page.locator('#ai-provider-status').innerText(), 'Gemini backup');
});

await browser.close();
await new Promise((resolve) => server.close(resolve));
summary();
