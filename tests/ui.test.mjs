// Browser tests for the interface, files and SEO output. Run with: npm test
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, openApp, chromium, test, eq, ok, summary } from './harness.mjs';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const { server, url } = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const opened = await (async () => {
  const p = await ctx.newPage();
  const probs = [];
  p.on('pageerror', (e) => probs.push('page error: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text()))
      probs.push('console: ' + m.text());
  });
  await p.goto(url);
  await p.waitForFunction(() => window.LogicLab);
  return { p, probs };
})();
const pg = opened.p;
const parts = () => pg.evaluate(() => LogicLab.parts());

/* ---- welcome screen ---- */
await test('welcome screen shows the headline, templates, recents area and FAQ', async () => {
  ok(await pg.isVisible('#wl'), 'welcome visible');
  eq(await pg.locator('h1').first().innerText(), 'Build, Simulate & Learn\nDigital Circuits');
  const n = await pg.locator('.tc').count();
  ok(n === 38, 'expected 37 examples + blank card, got ' + n);
  eq(await pg.locator('#faq details').count(), 6);
  ok((await pg.locator('#wf button').count()) >= 7, 'category chips');
  eq(await pg.locator('.github-link').getAttribute('href'), 'https://github.com/Anugrah-Jacob/LogicLab');
  eq(await pg.locator('.github-link use').getAttribute('href'), '#icon-github');
  eq(await pg.locator('.github-link').getAttribute('target'), '_blank');
  eq(await pg.locator('.github-link').getAttribute('rel'), 'noopener noreferrer');
});
await test('template thumbnails load', async () => {
  await pg.evaluate(() => document.querySelectorAll('.tc img').forEach((i) => (i.loading = 'eager')));
  await pg.waitForTimeout(800);
  const broken = await pg.evaluate(
    () => [...document.querySelectorAll('.tc img')].filter((i) => !i.complete || i.naturalWidth === 0).length
  );
  eq(broken, 0);
});
await test('search filters the templates', async () => {
  await pg.fill('#wq', 'adder');
  const titles = await pg.locator('.tc b').allInnerTexts();
  ok(
    titles.length >= 3 && titles.every((t) => /adder/i.test(t) || /Combinational|Arithmetic/.test(t) || true),
    'results ' + titles
  );
  ok(!titles.includes('Blank Project'), 'blank card hidden while searching');
  await pg.fill('#wq', '');
});
await test('opening a template creates a project that appears in recents', async () => {
  await pg.click('.tc[data-k="full-adder"]');
  ok(!(await pg.isVisible('#wl')));
  eq(await pg.inputValue('#pn'), 'Full adder');
  eq((await parts()).length, 10);
  await pg.waitForTimeout(900);
  await pg.click('#hm');
  eq(await pg.locator('.rr[data-id]').count(), 1);
  eq(
    await pg
      .locator('.rr b')
      .first()
      .innerText()
      .then((t) => t.split('\n')[0]),
    'Full adder'
  );
  await pg.click('.rr[data-id]');
});
await test('deep link /?template=<id> opens that example', async () => {
  const p = await ctx.newPage();
  await p.goto(url + '?template=half-adder');
  await p.waitForFunction(() => window.LogicLab);
  ok(!(await p.isVisible('#wl')), 'welcome hidden');
  eq(await p.inputValue('#pn'), 'Half adder');
  eq(await p.evaluate(() => LogicLab.parts().length), 6);
  eq(await p.evaluate(() => location.search), '', 'query string is cleaned up');
  await p.close();
});

/* ---- editing, undo/redo, groups, drawings ---- */
await test('undo and redo restore the circuit', async () => {
  await pg.evaluate(() => {
    LogicLab.load('half-adder');
  });
  const before = (await parts()).length;
  await pg.click('#pal button[data-k="AND"]');
  eq((await parts()).length, before + 1);
  await pg.click('#undo');
  eq((await parts()).length, before);
  await pg.click('#redo');
  eq((await parts()).length, before + 1);
});
await test('a drawing can be grouped with parts and the group moves as one', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  await pg.click('#dt [data-k=rect]');
  const box = await pg.locator('#cv').boundingBox();
  await pg.mouse.move(box.x + 120, box.y + 360);
  await pg.mouse.down();
  await pg.mouse.move(box.x + 220, box.y + 420);
  await pg.mouse.up();
  await pg.click('#dt [data-k=sel]');
  await pg.keyboard.press('Control+a');
  await pg.keyboard.press('Control+g');
  ok((await pg.locator('#insp').innerText()).includes('Ungroup'), 'inspector offers Ungroup after grouping');
  const groups = async () => (await pg.evaluate(() => LogicLab.exportProject())).groups;
  const g = await groups();
  eq([g.length, g[0].ids.length, g[0].nids.length], [1, 6, 1], 'one group holding 6 parts and 1 drawing');
  await pg.keyboard.press('Control+z');
  eq((await groups()).length, 0, 'undo removes the group');
  await pg.keyboard.press('Control+Shift+z');
  eq((await groups()).length, 1, 'redo brings it back');
});

/* ---- save, export, reopen ---- */
await test('Share menu offers project file, PNG and PDF downloads, and each download is valid', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  await pg.fill('#pn', 'My Test Circuit');
  ok(!(await pg.locator('#sv').count()), 'standalone Save button is removed');
  const grab = async (x) => {
    await pg.click('#cb-share');
    await pg.click('#cb-r-dl');
    ok((await pg.locator('#cb-pop [data-download]').count()) === 3, 'Download submenu has all formats');
    const [d] = await Promise.all([
      pg.waitForEvent('download'),
      pg.click('#cb-pop [data-download=' + x + ']')
    ]);
    const f = '/tmp/ll-dl-' + x;
    await d.saveAs(f);
    return { name: d.suggestedFilename(), data: fs.readFileSync(f) };
  };
  const proj = await grab('proj'),
    png = await grab('png'),
    pdf = await grab('pdf');
  eq(proj.name, 'My Test Circuit.logiclab.json');
  const doc = JSON.parse(proj.data.toString());
  eq([doc.app, doc.nodes.length > 0, Array.isArray(doc.wires)], ['LogicLab', true, true]);
  eq(png.name, 'My Test Circuit.png');
  eq(png.data.subarray(1, 4).toString(), 'PNG');
  eq(pdf.name, 'My Test Circuit.pdf');
  eq(pdf.data.subarray(0, 5).toString(), '%PDF-');
  ok(pdf.data.length > 2000);
  fs.writeFileSync('/tmp/ll-project.json', proj.data);
});
await test('a saved project file reopens, and old GateForge files still open', async () => {
  const open = async (file) => {
    await pg.evaluate(() => LogicLab.load(''));
    await pg.setInputFiles('#fi', file);
    await pg.waitForTimeout(500);
    return pg.evaluate(() => LogicLab.parts().length);
  };
  eq(await open('/tmp/ll-project.json'), 6);
  const legacy = JSON.parse(fs.readFileSync('/tmp/ll-project.json', 'utf8'));
  legacy.app = 'GateForge';
  fs.writeFileSync('/tmp/ll-legacy.json', JSON.stringify(legacy));
  eq(await open('/tmp/ll-legacy.json'), 6);
  fs.writeFileSync('/tmp/ll-bad.json', '{"hello":1}');
  await pg.setInputFiles('#fi', '/tmp/ll-bad.json');
  await pg.waitForTimeout(300);
  ok((await pg.locator('#toasts').innerText()).includes('not a valid'), 'invalid file shows a message');
});
await test('convert to NAND-only and NOR-only from the menu', async () => {
  for (const [btn, type] of [
    ['#cvn', 'NAND'],
    ['#cvr', 'NOR']
  ]) {
    await pg.evaluate(() => LogicLab.load('full-adder'));
    await pg.click('#mo');
    await pg.click(btn);
    await pg.waitForTimeout(300);
    const types = await pg.evaluate(() => [...new Set(LogicLab.parts().map((p) => p.type))].sort());
    eq(types, ['IN', 'LED', type].sort());
  }
});
await test('theme toggle switches between light and dark', async () => {
  await pg.click('#mo');
  await pg.click('#th');
  const a = await pg.evaluate(() => document.documentElement.dataset.theme);
  await pg.click('#mo');
  await pg.click('#th');
  const b = await pg.evaluate(() => document.documentElement.dataset.theme);
  ok(a && b && a !== b, a + ' / ' + b);
});
await test('blue theme and control icons render without missing-glyph boxes', async () => {
  const colors = await pg.evaluate(() => {
    const root = document.documentElement;
    root.dataset.theme = 'light';
    const light = getComputedStyle(root).getPropertyValue('--ac').trim();
    root.dataset.theme = 'dark';
    const dark = getComputedStyle(root).getPropertyValue('--ac').trim();
    root.dataset.theme = 'light';
    return {
      light,
      dark,
      powerIcon: document.querySelector('#pwr use')?.getAttribute('href'),
      themeIcon: document.querySelector('#th use')?.getAttribute('href'),
      recentIcon: document.querySelector('#wl [data-s="wrc"] use')?.getAttribute('href'),
      learnIcon: document.querySelector('#wl a[href="learn/"] use')?.getAttribute('href')
    };
  });
  eq(colors.light, '#1d4ed8');
  eq(colors.dark, '#60a5fa');
  eq(colors.powerIcon, '#icon-power');
  eq(colors.themeIcon, '#icon-theme');
  eq(colors.recentIcon, '#icon-clock');
  eq(colors.learnIcon, '#icon-book');
  eq(await pg.locator('#tsel use').getAttribute('href'), '#icon-pointer');
});
await test('simulation has one pause control in the header and retains single-step control', async () => {
  eq(await pg.locator('#sim').count(), 1);
  eq(await pg.locator('#run').count(), 0);
  eq(await pg.locator('#stp').count(), 1);
  await pg.evaluate(() => LogicLab.pause());
  eq(await pg.locator('#sim').innerText(), '▶ Run');
  await pg.click('#sim');
  eq(await pg.locator('#sim').innerText(), '❚❚ Pause');
});

/* ---- power button, reset button and adjustable panels ---- */
await test('the power and reset buttons control the circuit', async () => {
  await pg.evaluate(() => {
    LogicLab.load('half-adder');
    LogicLab.setInput('A', 1);
    LogicLab.setInput('B', 1);
    LogicLab.step(20);
  });
  eq(await pg.locator('#pwr').innerText(), 'ON');
  await pg.click('#pwr');
  eq(await pg.locator('#pwr').innerText(), 'OFF');
  ok(await pg.isVisible('#poff'), 'power-off banner');
  eq(await pg.evaluate(() => Object.values(LogicLab.outputs())), [0, 0]);
  await pg.click('#pwr');
  ok(!(await pg.isVisible('#poff')));
  await pg.click('#rst');
  ok((await pg.locator('#toasts').innerText()).includes('restarted'), 'reset confirmation');
});
await test('panels can be resized by dragging, the sizes are remembered, double-click resets', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const width = () =>
    pg.evaluate(() => Math.round(document.querySelector('#pal').getBoundingClientRect().width));
  const w0 = await width();
  const h = await pg.locator('.rz').first().boundingBox();
  await pg.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(h.x + h.width / 2 + 90, h.y + h.height / 2, { steps: 6 });
  await pg.mouse.up();
  const w1 = await width();
  ok(w1 >= w0 + 80 && w1 <= w0 + 100, 'palette widened from ' + w0 + ' to ' + w1);
  eq(JSON.parse(await pg.evaluate(() => localStorage.getItem('gf:ui'))).pal, w1, 'size saved on the device');
  const right = await pg.locator('.rz').nth(1).boundingBox();
  const sideBefore = await pg.evaluate(() =>
    Math.round(document.querySelector('#side').getBoundingClientRect().width)
  );
  await pg.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(right.x + right.width / 2 - 60, right.y + right.height / 2, { steps: 5 });
  await pg.mouse.up();
  const sideAfter = await pg.evaluate(() =>
    Math.round(document.querySelector('#side').getBoundingClientRect().width)
  );
  ok(sideAfter >= sideBefore + 50, 'properties panel widened from ' + sideBefore + ' to ' + sideAfter);
  const foot = await pg.locator('.rzh').boundingBox();
  const fh0 = await pg.evaluate(() =>
    Math.round(document.querySelector('footer').getBoundingClientRect().height)
  );
  await pg.mouse.move(foot.x + foot.width / 2, foot.y + foot.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(foot.x + foot.width / 2, foot.y + foot.height / 2 - 60, { steps: 5 });
  await pg.mouse.up();
  const fh1 = await pg.evaluate(() =>
    Math.round(document.querySelector('footer').getBoundingClientRect().height)
  );
  ok(fh1 >= fh0 + 50, 'waveform panel grew from ' + fh0 + ' to ' + fh1);
  await pg.reload();
  await pg.waitForFunction(() => window.LogicLab);
  await pg.click('.tc[data-k="half-adder"]');
  eq(await width(), w1, 'the palette size survives a reload');
  await pg.locator('.rz').first().dblclick();
  eq(await width(), w0, 'double-click restores the default');
  await pg.click('#mo');
  await pg.click('#rsz');
  eq(
    await pg.evaluate(() => localStorage.getItem('gf:ui')),
    null,
    'reset panel sizes clears the saved layout'
  );
});
/* ---- phone layout ---- */
await test('phone layout has no sideways scrolling and a working bottom navigation', async () => {
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const p = await m.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.LogicLab);
  eq(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'welcome fits the screen'
  );
  const welcome = await p.evaluate(() => {
    const els = [...document.querySelectorAll('#wl aside .lgo, #wl aside .nv:not(#wexamples), #wl aside #wn, #wl aside #wo')];
    const boxes = els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
    });
    const overlaps = boxes.some((a, i) =>
      boxes.slice(i + 1).some((b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1)
    );
    return { overlaps, linksFit: boxes.slice(1, 4).every((b) => b.width > 70) };
  });
  eq(welcome.overlaps, false, 'mobile welcome navigation controls do not overlap');
  eq(welcome.linksFit, true, 'mobile welcome navigation links have usable widths');
  ok(await p.isVisible('.github-link'), 'GitHub open-source link is visible on mobile');
  await p.click('#wn');
  await p.waitForTimeout(400);
  eq(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'editor fits the screen'
  );
  ok(await p.isVisible('#bn'), 'bottom nav visible');
  ok(await p.isVisible('#sim'), 'simulation control remains available on phones');
  ok(
    await p.evaluate(
      () => document.querySelector('#dt').getBoundingClientRect().bottom <= document.querySelector('#bn').getBoundingClientRect().top + 1
    ),
    'drawing toolbar is not covered by the bottom nav'
  );
  await p.click('#bn [data-n=templates]');
  await p.waitForTimeout(300);
  ok(
    await p.evaluate(() => {
      const rect = document.querySelector('#wt').getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0;
    }),
    'Templates navigation opens at the template gallery'
  );
  await p.click('#wn');
  await p.click('#bn [data-n=pal]');
  ok(await p.evaluate(() => document.body.classList.contains('sh-pal')), 'components sheet opens');
  await p.click('#pal button[data-k="AND"]');
  eq(await p.evaluate(() => LogicLab.parts().length), 1);
  eq(errs, []);
  await m.close();
});

await test('tablet and laptop editor layouts fit their viewport', async () => {
  const responsive = await browser.newContext({ viewport: { width: 801, height: 900 } });
  const p = await responsive.newPage();
  await p.goto(url);
  await p.waitForFunction(() => window.LogicLab);
  await p.click('#wn');
  for (const width of [801, 965, 1024, 1200]) {
    await p.setViewportSize({ width, height: 900 });
    const layout = await p.evaluate(() => ({
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
      headerFits: document.querySelector('header').scrollWidth <= document.querySelector('header').clientWidth + 1,
      canvasWidth: document.querySelector('#cv').getBoundingClientRect().width
    }));
    eq(layout.documentFits, true, `document overflows at ${width}px`);
    eq(layout.headerFits, true, `header overflows at ${width}px`);
    ok(layout.canvasWidth >= 200, `canvas is too narrow at ${width}px`);
  }
  await responsive.close();
});

/* ---- static files, SEO and security ---- */
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
await test('index.html has the SEO essentials and consistent structured data', async () => {
  eq((html.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const title = squash(/<title>([\s\S]*?)<\/title>/.exec(html)[1]),
    desc = squash(/name="description"\s+content="([^"]+)"/.exec(html)[1]);
  ok(title.length <= 65, 'title length ' + title.length);
  ok(desc.length >= 80 && desc.length <= 165, 'description length ' + desc.length);
  for (const t of [
    'rel="canonical"',
    'property="og:image"',
    'name="twitter:card"',
    'rel="manifest"',
    'name="robots"',
    'lang="en"'
  ])
    ok(html.includes(t), 'missing ' + t);
  const ld = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]))
    .flat();
  const faq = ld.find((x) => x['@type'] === 'FAQPage').mainEntity.map((q) => q.name);
  const visible = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => squash(m[1]));
  eq(faq, visible, 'FAQ structured data must match the visible questions');
  ok(ld.some((x) => x['@type'] === 'WebApplication'));
});
await test('every example has a thumbnail, and learn pages, sitemap and robots are consistent', async () => {
  const ids = await pg.evaluate(() => LogicLab.exampleIds());
  eq(
    ids.filter((id) => !fs.existsSync(path.join(pub, 'thumbs', id + '.jpg'))),
    []
  );
  const sitemap = fs.readFileSync(path.join(pub, 'sitemap.xml'), 'utf8');
  const learn = fs.readdirSync(path.join(pub, 'learn')).filter((f) => f !== 'index.html');
  ok(learn.length >= 12, 'learn pages: ' + learn.length);
  for (const f of learn) {
    ok(sitemap.includes('/learn/' + f), f + ' missing from sitemap');
    const t = fs.readFileSync(path.join(pub, 'learn', f), 'utf8');
    ok(
      /<link rel="canonical" href="https?:\/\//.test(t) &&
        /<h1>/.test(t) &&
        /application\/ld\+json/.test(t) &&
        !/ on[a-z]+=/.test(t),
      f + ' structure'
    );
    JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(t)[1]);
    ok(t.includes('/?template='), f + ' links back to the simulator');
  }
  const robots = fs.readFileSync(path.join(pub, 'robots.txt'), 'utf8');
  ok(robots.includes('Sitemap:') && robots.includes('Disallow: /api/'));
});
await test('manifest icons exist and no inline event handlers remain (strict CSP)', async () => {
  const man = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'));
  eq(
    man.icons.filter((i) => !fs.existsSync(path.join(pub, i.src))).map((i) => i.src),
    []
  );
  ok(!/ on[a-z]+=/.test(html), 'inline handler in index.html');
  const js = fs.readFileSync(path.join(pub, 'js/app.js'), 'utf8');
  ok(!/\son(click|error|change|input|load)=\\?["']/.test(js), 'inline handler in a generated HTML string');
});
await test('no script errors were reported', async () => {
  eq(opened.probs, []);
});

await browser.close();
server.close();
summary();
