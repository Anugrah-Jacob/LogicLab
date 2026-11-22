// Generates the raster assets from the app and the SVG logos:
//   public/thumbs/<example-id>.jpg, public/icon-*.png, public/apple-touch-icon.png, public/og-image.png
// Needs Playwright:  npm i -D playwright && npx playwright install chromium   then   npm run assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../tests/harness.mjs';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const { server, url } = await serve();
const browser = await chromium.launch();

/* ---- template thumbnails ---- */
fs.mkdirSync(path.join(pub, 'thumbs'), { recursive: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 }, colorScheme: 'light' });
const page = await ctx.newPage();
await page.goto(url);
await page.waitForFunction(() => window.LogicLab);
const ids = await page.evaluate(() => LogicLab.exampleIds());
for (const id of ids) {
  const data = await page.evaluate((id) => {
    LogicLab.load(id);
    LogicLab.pause();
    LogicLab.step(60);
    return LogicLab.snapshot(720, 450);
  }, id);
  fs.writeFileSync(path.join(pub, 'thumbs', id + '.jpg'), Buffer.from(data.split(',')[1], 'base64'));
}
console.log('thumbnails:', ids.length);
await ctx.close();

/* ---- icons ---- */
async function shot(html, w, h, file, transparent = true) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent('<body style="margin:0;background:transparent">' + html + '</body>');
  await p.screenshot({ path: path.join(pub, file), omitBackground: transparent });
  await p.close();
}
const inline = (svg, size) =>
  svg.replace('<svg ', '<svg style="display:block;width:' + size + 'px;height:' + size + 'px" ');
await shot(inline(read('icon.svg'), 32), 32, 32, 'icon-32.png');
await shot(inline(read('icon.svg'), 192), 192, 192, 'icon-192.png');
await shot(inline(read('icon.svg'), 512), 512, 512, 'icon-512.png');
await shot(inline(read('icon-maskable.svg'), 512), 512, 512, 'icon-maskable-512.png', false);
await shot(inline(read('icon-maskable.svg'), 180), 180, 180, 'apple-touch-icon.png', false);

/* ---- social preview (1200x630) ---- */
const features = [
  ['Circuit Simulator', 'Gates, flip-flops, counters'],
  ['Logic Analyzer', 'Waveforms and truth tables'],
  ['Schematic & PCB', 'Four views of one circuit'],
  ['Learn & Practice', '37 ready-made examples']
];
const og = `<div style="width:1200px;height:630px;box-sizing:border-box;padding:70px 80px;font-family:Inter,system-ui,sans-serif;color:#fff;position:relative;overflow:hidden;
  background:radial-gradient(900px 500px at 15% 0%,#2563eb 0%,transparent 60%),radial-gradient(700px 500px at 100% 100%,#1e3a8a 0%,transparent 55%),#0b1220">
  <div style="position:absolute;inset:0;background-image:linear-gradient(#ffffff0d 1px,transparent 1px),linear-gradient(90deg,#ffffff0d 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(120deg,transparent 40%,#000)"></div>
  <img src="data:image/svg+xml;base64,${Buffer.from(read('logo-dark.svg')).toString('base64')}" style="position:relative;width:760px;display:block">
  <div style="position:relative;margin-top:36px;font-size:40px;font-weight:700;line-height:1.2;max-width:900px">Build, simulate and learn digital circuits in your browser.</div>
  <div style="position:relative;display:flex;gap:18px;margin-top:48px">${features.map((f) => `<div style="flex:1;background:#ffffff12;border:1px solid #ffffff26;border-radius:18px;padding:18px 20px"><div style="font-size:22px;font-weight:700">${f[0]}</div><div style="font-size:17px;color:#bfdbfe;margin-top:6px">${f[1]}</div></div>`).join('')}</div>
</div>`;
await shot(og, 1200, 630, 'og-image.png', false);
console.log('icons and social image written');
await browser.close();
server.close();
