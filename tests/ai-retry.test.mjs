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
    if (body.message.toLowerCase().includes('master-slave'))
      return route.fulfill({
        json: {
          tool: { expression: 'MSDFF(D,CLK)', mode: body.mode },
          chat: 'The master-slave D flip-flop captures D on the rising clock edge and holds Q between edges.'
        }
      });
    if (body.expression)
      return route.fulfill({ json: { tool: { expression: body.expression, mode: body.mode }, chat: body.expression } });
    aiCalls++;
    if (aiCalls <= 7)
      return route.fulfill({ status: 502, json: { error: 'Temporary provider failure.' } });
    if (aiCalls === 8)
      return route.fulfill({ json: { tool: { expression: 'A+B', mode: body.mode }, chat: 'Circuit built and the request continued.' } });
    if (aiCalls === 9)
      return route.fulfill({ json: { tool: { expression: 'A+B+C+D+E', mode: body.mode }, chat: 'The expression circuit is ready.' } });
    if (aiCalls === 10)
      return route.fulfill({ json: { tool: { expression: 'A+B', mode: body.mode }, chat: 'The existing circuit was kept.' } });
    return route.fulfill({
      json: {
        tool: null,
        chat:
          '| Inputs | Sum | Cout |\n|-------|-----|------|\n| 000 | 0 | 0 |\n| 001 | 1 | 0 |\n\n### How it works\n1. **XOR A,B** → intermediate value.\n2. XOR with Cin → Sum output.\n\n### Next steps (optional)\n- Multi-bit adder\n- Ripple-carry adder'
      }
    });
  }
  return route.fulfill({ json: {} });
});
await page.goto(url);
await page.waitForFunction(() => window.LogicLab && window.LogicLabHost.user());

await test('AI retries a structured request and applies the returned expression', async () => {
  await page.click('.tc[data-k="full-adder"]');
  await page.click('#aib');
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
  await page.fill('#ai #aq', 'Build a simple circuit.');
  await page.click('#ai #aisend');
  await page.waitForFunction(() => document.querySelector('#am #aretry'), null, { timeout: 10000 });
  eq(aiCalls, 7, 'failed request is retried automatically');
  eq(await page.locator('#am #aretry').innerText(), 'Retry', 'manual retry has no countdown');
  for (let i = 1; i < 7; i++) eq(requests[i], requests[0], 'retry reuses the exact structured request');
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
  await page.waitForSelector('.ai-approval [data-ai-apply]', { timeout: 3000 });
  await page.click('.ai-approval [data-ai-apply]');
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('Circuit built and the request continued.')
  );
  eq(requests[0].mode, 'overwrite');
  eq(Object.keys(requests[0]).sort(), [
    'chat_history', 'components', 'expression', 'message', 'mode', 'project_explanation', 'project_name'
  ]);
  eq(await page.locator('#am .bb.u').count(), 1, 'user message is not duplicated');
  eq(await page.locator('#am .bb.workflow').count(), 0, 'intermediate workflow details are hidden');
  const panel = await page.locator('#ai').boundingBox();
  ok(
    panel.width >= 320 && panel.width <= 460 && panel.height <= 720,
    'chat panel is compact and usable: ' + JSON.stringify(panel)
  );
  eq(await page.locator('#aimode option').allInnerTexts(), ['Overwrite circuit', 'Append / add', 'Read only']);
  const firstChat = await page.locator('#am').innerText();
  ok(firstChat.includes('Circuit built and the request continued.'), firstChat);
  eq(await page.locator('#ai-provider-status').count(), 0, 'provider identity is hidden in the frontend');
});

await test('AI appends an expression using project explanation and components', async () => {
  await page.selectOption('#aimode', 'append');
  await page.fill('#ai #aq', 'Build a large circuit.');
  await page.click('#ai #aisend');
  await page.waitForFunction(() => LogicLab.parts().length === 14);
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('The expression circuit is ready.')
  );
  eq(requests.at(-1).mode, 'append');
  ok(requests.at(-1).project_explanation.includes(':IN:"A"'), 'project explanation includes current inputs');
  ok(requests.at(-1).components.some((component) => component.startsWith('AND:')), 'component inventory includes logic gates');
  ok(
    requests.at(-1).project_explanation.includes('Truth table, input order'),
    'the AI receives the computed truth table when the input count permits it'
  );
  const collisions = await page.evaluate(() => {
    const nodes = LogicLab.exportProject().nodes,
      height = (node) => (node.type === 'IN' || node.type === 'CLK' || node.type === 'LED' ? 44 : 48),
      overlaps = [];
    nodes.forEach((a, i) =>
      nodes.slice(i + 1).forEach((b) => {
        if (a.x < b.x + 76 && a.x + 76 > b.x && a.y < b.y + height(b) && a.y + height(a) > b.y)
          overlaps.push([a.name, b.name]);
      })
    );
    return overlaps;
  });
  eq(collisions, [], 'appended components should not occupy overlapping canvas positions');
  ok((await page.locator('#am').innerText()).includes('The expression circuit is ready.'));
  await page.waitForFunction(() => !document.querySelector('#aisend').disabled);
});

await test('AI cancel keeps the existing circuit unchanged', async () => {
  await page.selectOption('#aimode', 'overwrite');
  await page.fill('#ai #aq', 'Clear the circuit.');
  await page.click('#ai #aisend');
  const cancel = page.locator('.ai-approval [data-ai-cancel]');
  await cancel.waitFor({ state: 'visible', timeout: 10000 });
  await cancel.click();
  await page.waitForFunction(() =>
    document.querySelector('#am').innerText.includes('The existing circuit was kept.')
  );
  eq(await page.evaluate(() => LogicLab.parts().length), 14);
  ok((await page.locator('#am').innerText()).includes('The existing circuit was kept.'));
});

await test('AI chat renders Markdown tables, headings and ordered lists', async () => {
  await page.selectOption('#aimode', 'read');
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
  await page.selectOption('#aimode', 'overwrite');
  await page.click('#ai #ax');
  await page.evaluate(() => LogicLab.load(''));
  await page.click('#side .stabs button[data-t="a"]');
  await page.click('#tabs button[data-t="build"]');
  const expression = 'A+B';
  await page.fill('#expression-input', expression);
  await page.click('#expression-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#expression-status').textContent.includes('Built'));

  const request = requests.at(-1);
  eq(Object.keys(request).sort(), [
    'chat_history', 'components', 'expression', 'message', 'mode', 'project_explanation', 'project_name'
  ]);
  eq(request.mode, 'overwrite');
  eq(request.message, expression);
  eq(request.expression, expression);
  eq(await page.evaluate(() => LogicLab.parts().length), 4);
  const rows = await page.evaluate(() => LogicLab.analysis().rows.map((row) => row.o[0]));
  eq(rows, [0, 1, 1, 1]);

  await page.evaluate(() => LogicLab.load(''));
  const groupedExpression = "(A+B)*C'";
  await page.fill('#expression-input', groupedExpression);
  await page.click('#expression-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#expression-status').textContent.includes('Built'));
  eq(await page.evaluate(() => LogicLab.parts().length), 7);
  eq(
    await page.evaluate(() => LogicLab.analysis().rows.map((row) => row.o[0])),
    [0, 0, 1, 0, 1, 0, 1, 0]
  );
});

await test('AI builds a working master-slave D flip-flop from a sequential expression', async () => {
  await page.evaluate(() => LogicLab.load(''));
  await page.click('#aib');
  await page.selectOption('#aimode', 'overwrite');
  await page.fill('#ai #aq', 'Explain a master-slave flip-flop and build one so I can see it work.');
  await page.click('#ai #aisend');
  await page.waitForFunction(() => LogicLab.parts().some((part) => part.type === 'D'));
  const project = await page.evaluate(() => LogicLab.exportProject()),
    request = requests.at(-1),
    flipFlop = project.nodes.find((part) => part.type === 'D');
  eq(request.mode, 'overwrite');
  eq(request.expression, '');
  ok(flipFlop, 'a D flip-flop component is present');
  ok(project.nodes.some((part) => part.type === 'CLK'), 'clock source is present');
  eq(project.nodes.filter((part) => part.type === 'LED').map((part) => part.name), ['Q', 'Qbar']);
  eq(project.wires.length, 4, 'data, clock, Q, and Qbar are all connected');

  await page.evaluate(() => {
    LogicLab.pause();
    LogicLab.setInput('D', 1);
    LogicLab.step(10);
  });
  let outputs = await page.evaluate(() => LogicLab.outputs());
  eq([outputs['expression-q'], outputs['expression-qbar']], [1, 0], 'Q captures D on the rising edge');
  await page.evaluate(() => {
    LogicLab.setInput('D', 0);
    LogicLab.step(5);
  });
  outputs = await page.evaluate(() => LogicLab.outputs());
  eq(outputs['expression-q'], 1, 'Q holds its value while the clock remains high');
  ok(
    (await page.locator('#am').innerText()).includes('captures D on the rising clock edge'),
    'assistant explains the behavior in chat'
  );
});

await browser.close();
await new Promise((resolve) => server.close(resolve));
summary();
