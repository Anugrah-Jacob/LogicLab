// Push button: a separate palette part that outputs 1 only while it is held; the switch and power button are unchanged.
import { chromium } from 'playwright';
import { test, eq, ok, summary } from './harness.mjs';
import { startApp } from './app-server.mjs';

const app = await startApp();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(app.url);
await page.waitForFunction(() => window.LogicLab);
await page.click('#wn');
const geo = () => page.evaluate(() => { const v = LogicLabHost.view(), r = v.el.getBoundingClientRect(); return { x: r.left + v.v.x, y: r.top + v.v.y, s: v.v.s }; });
const node = (pred) => page.evaluate((p) => LogicLabHost.doc().nodes.find(new Function('n', 'return ' + p)), pred);
const at = async (n, dx = 34, dy = 22) => { const g = await geo(); return [g.x + (n.x + dx) * g.s, g.y + (n.y + dy) * g.s]; };

await test('palette has Switch and Push button as two separate parts', async () => {
  eq(await page.locator('#pcat button[data-k=IN]').count(), 1);
  eq(await page.locator('#pcat button[data-k=PB]').count(), 1);
});
await page.click('#pcat button[data-k=PB]');
await page.click('#pcat button[data-k=LED]');
await page.click('#pcat button[data-k=IN]');
// New parts land at random nearby spots and may overlap, so put them in clear places first.
await page.evaluate(() => {
  const d = LogicLabHost.doc().nodes, at = { LED: [300, 40], IN: [60, 140] };
  LogicLabHost.applyChanges(d.map((n) => { const p = n.mom ? [60, 40] : at[n.type]; return { k: 'n:' + n.id, v: { ...n, x: p[0], y: p[1] } }; }));
});
await page.waitForTimeout(300);
const pb = await node('n.mom');
const sw = await node("n.type=='IN' && !n.mom");
await test('push button and switch are different parts; the switch has no push-button option', async () => {
  ok(pb && sw && pb.id !== sw.id);
  eq(sw.name, 'A', 'the switch keeps its own letter');
  ok(/^PB\d/.test(pb.name));
});
await test('held down = 1, released = 0', async () => {
  const [x, y] = await at(pb);
  await page.mouse.move(x, y);
  await page.mouse.down();
  eq(await page.evaluate((n) => LogicLab.inputs()[n], pb.name), 1);
  await page.mouse.up();
  await page.waitForTimeout(150);
  eq(await page.evaluate((n) => LogicLab.inputs()[n], pb.name), 0);
});
await test('a tap shorter than one simulation tick is held until a tick has seen it', async () => {
  const [x, y] = await at(pb);
  const r = await page.evaluate(([x, y, n]) => {
    const cv = LogicLabHost.view().el, o = { pointerId: 7, clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 };
    cv.setPointerCapture = () => {}; // synthetic pointers cannot be captured
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    cv.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    return LogicLab.inputs()[n];
  }, [x, y, pb.name]);
  eq(r, 1, 'still 1 right after a zero-length tap');
  await page.waitForTimeout(250);
  eq(await page.evaluate((n) => LogicLab.inputs()[n], pb.name), 0, 'and released once a tick passed');
});
await test('the normal switch still latches on click and toggles back', async () => {
  const [x, y] = await at(sw, 38);
  await page.mouse.click(x, y);
  eq(await page.evaluate(() => LogicLab.inputs().A), 1);
  await page.mouse.click(x, y);
  eq(await page.evaluate(() => LogicLab.inputs().A), 0);
});
await test('the power button still works', async () => {
  eq(await page.locator('#pwr').innerText(), 'ON');
  await page.click('#pwr');
  eq(await page.locator('#pwr').innerText(), 'OFF');
  await page.click('#pwr');
  eq(await page.locator('#pwr').innerText(), 'ON');
});
await test('push button survives save and reload as a push button', async () => {
  const doc = await page.evaluate(() => JSON.parse(JSON.stringify(LogicLabHost.project())));
  await page.evaluate((d) => LogicLabHost.load(d, 'x'), doc);
  ok(await page.evaluate(() => LogicLabHost.doc().nodes.some((n) => n.mom)));
  ok(await page.evaluate(() => LogicLabHost.doc().nodes.some((n) => n.type === 'IN' && !n.mom)));
});
await test('no script errors', () => eq(errs, []));
await browser.close();
app.close();
summary();
