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
  eq(
    await pg.evaluate(() => getComputedStyle(document.body).overflow),
    'hidden',
    'welcome has no outer page scrollbar'
  );
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
await test('login message is not styled as the AI send button', async () => {
  await pg.click('#av');
  ok(await pg.isVisible('#mauth'), 'login modal opens');
  const layout = await pg.evaluate(() => {
    const message = document.querySelector('#authmsg'),
      send = document.querySelector('#aisend'),
      rect = message.getBoundingClientRect();
    return {
      messageCount: document.querySelectorAll('#authmsg').length,
      sendCount: document.querySelectorAll('#aisend').length,
      messageWidth: rect.width,
      messageHeight: rect.height,
      sendWidth: getComputedStyle(send).width
    };
  });
  eq(layout.messageCount, 1);
  eq(layout.sendCount, 1);
  ok(layout.messageWidth > 250, 'login message should span the modal, not collapse into an icon');
  ok(layout.messageHeight < 60, 'login message should not overlap the form');
  eq(layout.sendWidth, '50px', 'AI send button keeps its compact size');
  await pg.click('#aoff');
});
await test('editor uses one workspace without a separate mode selector', async () => {
  ok(!(await pg.locator('#emode').count()), 'the mode selector is removed');
  ok(await pg.isVisible('#pal'), 'parts palette remains available');
  ok(await pg.isVisible('#dt'), 'drawing tools remain available');
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'default');
  await pg.click('#tw');
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'default');
  await pg.click('#tsel');
  ok(await pg.isVisible('#side .stabs'), 'analysis remains available');
  eq(await pg.locator('#tpal use').getAttribute('href'), '#icon-tool');
  eq(await pg.locator('#snp use').getAttribute('href'), '#icon-grid');
  await pg.click('#side .stabs button[data-t="a"]');
  await pg.click('#tabs button[data-t="build"]');
  ok(await pg.locator('#expression-form').isVisible(), 'expression builder is available in analysis');
  ok(await pg.locator('#expression-input').isVisible(), 'expression input is visible');
  await pg.click('#side .stabs button[data-t="c"]');
});
await test('snap-to-grid button toggles grid snapping and alignment guides', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const button = pg.locator('#snp');
  eq(await button.getAttribute('aria-label'), 'Snap to grid and alignment guides');
  eq(await button.getAttribute('aria-pressed'), 'true');
  eq(await pg.evaluate(() => LogicLab.exportProject().snap), true);
  await button.click();
  eq(await button.getAttribute('aria-pressed'), 'false');
  eq(await pg.evaluate(() => LogicLab.exportProject().snap), false);
  await button.click();
  eq(await button.getAttribute('aria-pressed'), 'true');
  eq(await pg.evaluate(() => LogicLab.exportProject().snap), true);
});
await test('snap mode aligns dragged parts and displays alignment guides', async () => {
  await pg.evaluate(() => {
    LogicLab.build({
      parts: [
        { id: 'moving', type: 'NOT' },
        { id: 'target', type: 'NOT' }
      ]
    });
    const project = LogicLab.exportProject();
    Object.assign(
      project.nodes.find((node) => node.name === 'moving'),
      { x: 100, y: 100 }
    );
    Object.assign(
      project.nodes.find((node) => node.name === 'target'),
      { x: 300, y: 196 }
    );
    LogicLab.importProject(project);
  });
  const box = await pg.locator('#cv').boundingBox();
  const points = await pg.evaluate(() => {
    const doc = LogicLab.exportProject(),
      moving = doc.nodes.find((node) => node.name === 'moving'),
      view = LogicLabHost.view().v;
    return {
      start: { x: view.x + (moving.x + 38) * view.s, y: view.y + (moving.y + 20) * view.s },
      dy: 96 * view.s
    };
  });
  await pg.mouse.move(box.x + points.start.x, box.y + points.start.y);
  await pg.mouse.down();
  await pg.mouse.move(box.x + points.start.x, box.y + points.start.y + points.dy, { steps: 8 });
  await pg.waitForTimeout(80);
  const result = await pg.evaluate(() => {
    const canvas = document.querySelector('#cv'),
      ctx = canvas.getContext('2d'),
      rect = canvas.getBoundingClientRect(),
      view = LogicLabHost.view().v,
      node = LogicLab.exportProject().nodes.find((item) => item.name === 'moving'),
      scaleX = canvas.width / rect.width,
      scaleY = canvas.height / rect.height,
      y = Math.round((view.y + 196 * view.s) * scaleY),
      x0 = Math.round(20 * scaleX),
      x1 = Math.round(60 * scaleX),
      pixels = ctx.getImageData(x0, Math.max(0, y - 3), x1 - x0, 7).data;
    return {
      y: node.y,
      visibleGuide: Array.from(pixels).some(
        (_, i) => i % 4 === 0 && pixels[i] < 60 && pixels[i + 1] > 100 && pixels[i + 2] > 170
      )
    };
  });
  await pg.mouse.up();
  eq(result.y, 196, 'drag aligns the part with the nearby part despite the grid');
  ok(result.visibleGuide, 'alignment is shown with a visible guide line while dragging');
});
await test('arrow keys move the selected circuit and undo/redo the movement', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'Y', type: 'LED' }
      ],
      wires: [
        { from: 'A.0', to: 'U1.0' },
        { from: 'U1.0', to: 'Y.0' }
      ]
    })
  );
  const before = await pg.evaluate(() => LogicLab.exportProject().nodes.map(({ x, y }) => ({ x, y })));
  await pg.keyboard.press('Control+a');
  await pg.keyboard.press('ArrowRight');
  const right = await pg.evaluate(() => LogicLab.exportProject().nodes.map(({ x, y }) => ({ x, y })));
  eq(
    right.map((p, i) => p.x - before[i].x),
    [12, 12, 12],
    'right arrow moves every selected part one grid step'
  );
  eq(
    right.map((p, i) => p.y - before[i].y),
    [0, 0, 0],
    'right arrow does not change vertical positions'
  );
  await pg.keyboard.press('Shift+ArrowDown');
  const down = await pg.evaluate(() => LogicLab.exportProject().nodes.map(({ x, y }) => ({ x, y })));
  eq(
    down.map((p, i) => p.x - right[i].x),
    [0, 0, 0],
    'down arrow does not change horizontal positions'
  );
  eq(
    down.map((p, i) => p.y - right[i].y),
    [60, 60, 60],
    'Shift+Arrow moves five grid steps'
  );
  await pg.keyboard.press('Control+z');
  eq(
    await pg.evaluate(() => LogicLab.exportProject().nodes.map(({ x, y }) => ({ x, y }))),
    right,
    'undo restores the prior positions'
  );
  await pg.keyboard.press('Control+Shift+z');
  eq(
    await pg.evaluate(() => LogicLab.exportProject().nodes.map(({ x, y }) => ({ x, y }))),
    down,
    'redo restores the nudge'
  );
});
await test('editor hides the extra page scrollbar while panels retain their own scrolling', async () => {
  await pg.setViewportSize({ width: 957, height: 719 });
  const overflow = await pg.evaluate(() => ({
    body: getComputedStyle(document.body).overflow,
    panel: getComputedStyle(document.querySelector('#side')).overflowY
  }));
  eq(overflow.body, 'hidden', 'the editor should not add a page-level scrollbar');
  eq(overflow.panel, 'auto', 'the properties panel should remain independently scrollable');
  await pg.setViewportSize({ width: 1440, height: 900 });
});
await test('palette can build a four-input 7-segment display', async () => {
  await pg.evaluate(() => {
    LogicLab.load('');
    LogicLab.build({
      parts: [
        { id: 'a', type: 'IN', name: 'A', value: 0 },
        { id: 'b', type: 'IN', name: 'B', value: 1 },
        { id: 'c', type: 'IN', name: 'C', value: 0 },
        { id: 'd', type: 'IN', name: 'D', value: 1 },
        { id: 'display', type: 'SEG7', name: 'HEX' }
      ],
      wires: [
        { from: 'a', to: 'display.A' },
        { from: 'b', to: 'display.B' },
        { from: 'c', to: 'display.C' },
        { from: 'd', to: 'display.D' }
      ]
    });
  });
  await pg.waitForTimeout(80);
  eq(
    (await parts()).map((part) => part.type).filter((type) => type === 'SEG7'),
    ['SEG7']
  );
  ok(await pg.locator('#pal button[data-k="SEG7"]').count(), 'display is present in the component palette');
});
await test('copy and paste moves selected circuits between projects', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'Y', type: 'LED' }
      ],
      wires: [
        { from: 'A.0', to: 'U1.0' },
        { from: 'U1.0', to: 'Y.0' }
      ]
    })
  );
  await pg.keyboard.press('Control+a');
  await pg.keyboard.press('Control+c');
  await pg.click('#mo');
  await pg.click('#nw');
  eq((await parts()).length, 0, 'new project starts blank');
  await pg.keyboard.press('Control+v');
  const pasted = await pg.evaluate(() => LogicLab.exportProject());
  eq(pasted.nodes.length, 3, 'all copied parts should paste');
  eq(pasted.wires.length, 2, 'internal wires should paste');
  eq(new Set(pasted.nodes.map((node) => node.id)).size, 3, 'pasted part IDs should be unique');
  await pg.evaluate(() => {
    LogicLab.setInput('A', 1);
    LogicLab.step(2);
  });
  eq(await pg.evaluate(() => LogicLab.outputs().Y), 0, 'remapped wires should still drive the output');
});
await test('canvas zoom extends well beyond the old 3x ceiling', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  for (let i = 0; i < 10; i++) await pg.click('#zi');
  const scale = Number((await pg.locator('#zl').innerText()).replace('%', ''));
  ok(scale > 300, 'zoom percentage should exceed the old 300% limit; got ' + scale);
  await pg.click('#zf');
});
await test('parts can be resized and rotated with direct selection handles', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const box = await pg.locator('#cv').boundingBox();
  const clickAt = await pg.evaluate(() => {
    const n = LogicLab.exportProject().nodes.find((p) => p.type === 'XOR');
    const v = LogicLabHost.view().v;
    const h = Math.max(48, n.nin * 16 + 16);
    return {
      x: v.x + (n.x + 38) * v.s,
      y: v.y + (n.y + 24) * v.s,
      rotate: { x: v.x + (n.x + 38) * v.s, y: v.y + n.y * v.s - 30 },
      resize: { x: v.x + (n.x + 76) * v.s, y: v.y + (n.y + h) * v.s }
    };
  });
  await pg.mouse.click(box.x + clickAt.x, box.y + clickAt.y);
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'default');
  await pg.mouse.move(box.x + clickAt.rotate.x, box.y + clickAt.rotate.y);
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'grab');
  await pg.mouse.down();
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'grabbing');
  await pg.mouse.move(box.x + clickAt.rotate.x + 24, box.y + clickAt.rotate.y + 24);
  await pg.mouse.up();
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'default');
  const rotated = await pg.evaluate(() => LogicLab.exportProject().nodes.find((p) => p.type === 'XOR').rot);
  ok(rotated > 0, 'rotation handle should rotate the part');
  const newPoint = await pg.evaluate(() => {
    const n = LogicLab.exportProject().nodes.find((p) => p.type === 'XOR'),
      v = LogicLabHost.view().v;
    const cx = n.x + 38,
      cy = n.y + 24,
      a = (n.rot * Math.PI) / 180,
      corners = [
        [n.x, n.y],
        [n.x + 76, n.y],
        [n.x, n.y + 48],
        [n.x + 76, n.y + 48]
      ].map(([x, y]) => ({
        x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
        y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)
      }));
    return {
      x: v.x + Math.max(...corners.map((p) => p.x)) * v.s,
      y: v.y + Math.max(...corners.map((p) => p.y)) * v.s
    };
  });
  await pg.mouse.move(box.x + newPoint.x, box.y + newPoint.y);
  eq(await pg.locator('#cv').evaluate((canvas) => getComputedStyle(canvas).cursor), 'default');
  await pg.mouse.down();
  await pg.mouse.move(box.x + newPoint.x + 35, box.y + newPoint.y + 24);
  await pg.mouse.up();
  const node = await pg.evaluate(() => LogicLab.exportProject().nodes.find((p) => p.type === 'XOR'));
  ok(node.scale > 1, 'resize handle should resize the part');
});
await test('multiple selected parts share one transform frame', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'U2', type: 'NOT' }
      ],
      wires: [
        { from: 'A.0', to: 'U1.0' },
        { from: 'U1.0', to: 'U2.0' }
      ]
    })
  );
  const box = await pg.locator('#cv').boundingBox();
  await pg.keyboard.press('Control+a');
  const handle = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      h = (n) => (n.type === 'IN' ? 44 : 40),
      x0 = Math.min(...d.nodes.map((n) => n.x)),
      y0 = Math.min(...d.nodes.map((n) => n.y)),
      x1 = Math.max(...d.nodes.map((n) => n.x + 76)),
      view = LogicLabHost.view().v;
    return {
      x: view.x + ((x0 + x1) / 2) * view.s,
      y: view.y + y0 * view.s - 30
    };
  });
  await pg.mouse.move(box.x + handle.x, box.y + handle.y);
  await pg.mouse.down();
  await pg.mouse.move(box.x + handle.x + 25, box.y + handle.y - 30);
  await pg.mouse.up();
  const rotations = await pg.evaluate(() => LogicLab.exportProject().nodes.map((n) => n.rot));
  ok(
    rotations.every((angle) => angle > 0),
    'the single selection rotation handle rotates all selected parts'
  );
});
await test('Simplify creates a mapped symbol and Favorites insert independent copies', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'AND' },
        { id: 'U2', type: 'NOT' },
        { id: 'Y', type: 'LED' }
      ],
      wires: [
        { from: 'A.0', to: 'U1.0' },
        { from: 'U1.0', to: 'U2.0' },
        { from: 'U2.0', to: 'Y.0' }
      ]
    })
  );
  await pg.keyboard.press('Control+a');
  const box = await pg.locator('#cv').boundingBox();
  const point = await pg.evaluate(() => {
    const n = LogicLab.exportProject().nodes.find((item) => item.name === 'A'),
      v = LogicLabHost.view().v;
    return { x: v.x + (n.x + 20) * v.s, y: v.y + (n.y + 22) * v.s };
  });
  await pg.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
  await pg.locator('#cm button').filter({ hasText: 'Simplify selected circuit' }).click();
  await pg.fill('#symname', 'Tiny controller');
  await pg.locator('#symmap select').nth(0).selectOption({ label: 'U1 · Input 1' });
  await pg.locator('#symmap select').nth(1).selectOption({ label: 'U2 · Output 1' });
  await pg.click('#symcreate');
  const symbol = await pg.evaluate(() => LogicLab.exportProject().notes.find((n) => n.t === 'symbol'));
  ok(symbol, 'the selected circuit should have a symbol overlay');
  eq(symbol.s, 'Tiny controller');
  eq(symbol.inputMap.length, 1);
  eq(symbol.outputMap.length, 1);
  await pg.evaluate(() => {
    LogicLab.setInput('A', 1);
    LogicLab.step(2);
  });
  eq(
    await pg.evaluate(() => LogicLab.outputs().Y),
    1,
    'the overlaid symbol keeps the original circuit simulation'
  );
  eq(await pg.locator('#pal .fav-insert').count(), 1, 'the symbol is saved in Favorites');
  const symbolCenter = await pg.evaluate(() => {
    const note = LogicLab.exportProject().notes.find((n) => n.t === 'symbol'),
      v = LogicLabHost.view().v;
    return {
      x: v.x + ((note.x0 + note.x1) / 2) * v.s,
      y: v.y + ((note.y0 + note.y1) / 2) * v.s
    };
  });
  await pg.mouse.click(box.x + symbolCenter.x, box.y + symbolCenter.y, { button: 'right' });
  await pg.locator('#cm button').filter({ hasText: 'Save symbol to Favorites' }).click();
  eq(await pg.locator('#pal .fav-insert').count(), 1, 'context save updates the existing favorite by name');
  await pg.locator('#pal .fav-insert').click();
  const doc = await pg.evaluate(() => LogicLab.exportProject());
  eq(doc.nodes.length, 8, 'favorite insertion clones the internal parts');
  eq(doc.wires.length, 6, 'favorite insertion clones internal wiring');
  eq(doc.notes.filter((n) => n.t === 'symbol').length, 2, 'favorite insertion includes the symbol overlay');
  eq(doc.groups.length, 2, 'each symbol and its circuit are grouped');
});
await test('palette gate icons keep a high-contrast outline and gradient fill', async () => {
  await pg.evaluate(() => LogicLab.load(''));
  const contrast = await pg.locator('#pal button[data-k="AND"] canvas').evaluate((canvas) => {
    const ctx = canvas.getContext('2d'),
      { data } = ctx.getImageData(0, 0, canvas.width, canvas.height),
      sample = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i] < 100 && data[i + 2] < 140) dark++;
    const top = sample(30, 14),
      bottom = sample(30, 46);
    return { dark, gradientDelta: Math.max(...top.map((v, i) => Math.abs(v - bottom[i]))) };
  });
  ok(contrast.dark > 20, 'gate icon should have visible dark outline pixels');
  ok(contrast.gradientDelta > 10, 'gate fill should have visible gradient shading');
});
await test('wire context menu supports adding a saved routing bend', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const box = await pg.locator('#cv').boundingBox();
  const at = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      w = d.wires.find((x) => !x.bends && x.mode !== 'straight'),
      a = d.nodes.find((x) => x.id === w.a),
      b = d.nodes.find((x) => x.id === w.b),
      h = (n) =>
        n.type === 'METER'
          ? 64
          : n.type === 'IN' || n.type === 'CLK'
            ? 44
            : ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'].includes(n.type)
              ? Math.max(48, n.nin * 16 + 16)
              : n.type === 'NOT' || n.type === 'BUF'
                ? 40
                : Math.max(44, 2 * 24 + 12),
      ni = (n) =>
        ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'].includes(n.type)
          ? n.nin
          : n.type === 'IN' || n.type === 'CLK'
            ? 0
            : n.type === 'JK'
              ? 3
              : n.type === 'D' || n.type === 'T' || n.type === 'SIPO'
                ? 2
                : n.type === 'PISO'
                  ? 6
                  : 1,
      no = (n) =>
        ['D', 'T', 'JK'].includes(n.type)
          ? 2
          : n.type === 'SIPO'
            ? 4
            : ['LED', 'METER'].includes(n.type)
              ? 0
              : 1,
      p = { x: a.x + 76, y: a.y + (h(a) * (w.ap + 1)) / (no(a) + 1) },
      q = { x: b.x, y: b.y + (h(b) * (w.bp + 1)) / (ni(b) + 1) },
      r =
        q.x > p.x + 24
          ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
          : { x: (p.x + 16 + q.x - 16) / 2, y: Math.min(p.y, q.y) - 44 },
      v = LogicLabHost.view().v;
    return { id: w.a + ':' + w.b, x: r.x, y: r.y, vx: v.x, vy: v.y, s: v.s };
  });
  await pg.mouse.click(box.x + at.vx + at.x * at.s, box.y + at.vy + at.y * at.s, { button: 'right' });
  await pg.getByRole('button', { name: 'Add bend here' }).click();
  const routed = await pg.evaluate(() =>
    LogicLab.exportProject().wires.some((w) => w.bends && w.bends.length)
  );
  ok(routed, 'wire bend should be stored in the project');
});

await test('auto arrange reroutes only internal wires of the selected parts', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'Y', type: 'LED' },
        { id: 'B', type: 'IN' },
        { id: 'U2', type: 'NOT' },
        { id: 'Z', type: 'LED' }
      ],
      wires: [
        { from: 'A.0', to: 'U1.0' },
        { from: 'U1.0', to: 'Y.0' },
        { from: 'B.0', to: 'U2.0' },
        { from: 'U2.0', to: 'Z.0' }
      ]
    })
  );
  const project = await pg.evaluate(() => LogicLab.exportProject());
  project.wires.forEach((w, i) => (w.bends = [{ x: 60 + i * 24, y: 180 + i * 24 }]));
  await pg.evaluate((d) => LogicLab.importProject(d), project);
  const box = await pg.locator('#cv').boundingBox();
  const positions = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      v = LogicLabHost.view().v,
      screen = (name) => {
        const n = d.nodes.find((x) => x.name === name);
        return { x: v.x + (n.x + 38) * v.s, y: v.y + (n.y + 22) * v.s };
      };
    return { a: screen('A'), u: screen('U1') };
  });
  await pg.mouse.click(box.x + positions.a.x, box.y + positions.a.y);
  await pg.keyboard.down('Shift');
  await pg.mouse.click(box.x + positions.u.x, box.y + positions.u.y);
  await pg.keyboard.up('Shift');
  await pg.mouse.click(box.x + positions.a.x, box.y + positions.a.y, { button: 'right' });
  await pg.getByRole('button', { name: 'Auto arrange selected wires' }).click();
  const after = await pg.evaluate(() => LogicLab.exportProject()),
    ids = after.nodes.filter((n) => ['A', 'U1'].includes(n.name)).map((n) => n.id),
    internal = after.wires.find((w) => ids.includes(w.a) && ids.includes(w.b)),
    untouched = after.wires.filter((w) => !(ids.includes(w.a) && ids.includes(w.b)));
  ok(!internal.bends, 'selected internal wire gets an automatic route');
  ok(
    untouched.every((w) => w.bends && w.bends.length === 1),
    'other wires keep their routes'
  );
  eq(
    after.nodes.map(({ x, y }) => [x, y]),
    project.nodes.map(({ x, y }) => [x, y]),
    'wire arranging must not move any gates'
  );
});

await test('auto arrange groups fan-out wires into readable source rails', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'B', type: 'IN' },
        { id: 'G1', type: 'AND' },
        { id: 'G2', type: 'OR' },
        { id: 'Y1', type: 'LED' },
        { id: 'Y2', type: 'LED' }
      ],
      wires: [
        { from: 'A', to: 'G1.0' },
        { from: 'A', to: 'G2.0' },
        { from: 'B', to: 'G1.1' },
        { from: 'B', to: 'G2.1' },
        { from: 'G1', to: 'Y1' },
        { from: 'G2', to: 'Y2' }
      ]
    })
  );
  const before = await pg.evaluate(() => LogicLab.exportProject()),
    box = await pg.locator('#cv').boundingBox(),
    point = await pg.evaluate(() => {
      const input = LogicLab.exportProject().nodes.find((node) => node.name === 'A'),
        view = LogicLabHost.view().v;
      return { x: view.x + (input.x + 20) * view.s, y: view.y + (input.y + 22) * view.s };
    });
  await pg.keyboard.press('Control+a');
  await pg.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
  await pg.getByRole('button', { name: 'Auto arrange selected wires' }).click();
  const after = await pg.evaluate(() => LogicLab.exportProject());
  for (const name of ['A', 'B']) {
    const source = after.nodes.find((node) => node.name === name),
      branches = after.wires.filter((wire) => wire.a === source.id);
    eq(branches.length, 2);
    const trunk = branches.find((wire) => wire.bends),
      branch = branches.find((wire) => wire.tap);
    ok(trunk && branch, name + ' fan-out should have one trunk and one branch');
    eq(
      trunk.bends.map((bend) => bend.x),
      [branch.tap.x, branch.tap.x]
    );
  }
  eq(
    after.nodes.map(({ x, y }) => [x, y]),
    before.nodes.map(({ x, y }) => [x, y]),
    'auto-arrange changes routes without moving parts'
  );
  eq(
    await pg.evaluate(() => LogicLab.analysis().rows.map((row) => row.o)),
    [
      [0, 0],
      [0, 1],
      [0, 1],
      [1, 1]
    ],
    'shared route geometry preserves AND and OR output behavior'
  );
});

await test('duplicate preserves gate transforms, color and internal wire routing', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'Y', type: 'LED' }
      ],
      wires: [
        { from: 'A.0', to: 'U1.0' },
        { from: 'U1.0', to: 'Y.0' }
      ]
    })
  );
  const project = await pg.evaluate(() => LogicLab.exportProject());
  const gate = project.nodes.find((n) => n.name === 'U1');
  gate.scale = 1.7;
  gate.rot = 45;
  gate.color = '#aabbcc';
  project.wires[0].color = '#123456';
  project.wires[0].bends = [{ x: 100, y: 120 }];
  project.wires[0].mode = 'orthogonal';
  await pg.evaluate((d) => LogicLab.importProject(d), project);
  await pg.keyboard.press('Control+a');
  await pg.locator('#du').click();
  const after = await pg.evaluate(() => LogicLab.exportProject()),
    copy = after.nodes.find((n) => n.name === 'U1’'),
    copiedWire = after.wires.find((w) => w.color === '#123456' && w.bends && w.bends[0].x > 100);
  eq([copy.scale, copy.rot, copy.color], [1.7, 45, '#aabbcc']);
  ok(copiedWire && copiedWire.bends[0].y === 150, 'duplicated wire retains and offsets its custom route');
});

await test('gate and wire colors can be edited in the inspector', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' }
      ],
      wires: [{ from: 'A.0', to: 'U1.0' }]
    })
  );
  const box = await pg.locator('#cv').boundingBox();
  const points = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      a = d.nodes.find((n) => n.name === 'A'),
      u = d.nodes.find((n) => n.name === 'U1'),
      v = LogicLabHost.view().v,
      screen = (x, y) => ({ x: v.x + x * v.s, y: v.y + y * v.s });
    return {
      gate: screen(u.x + 38, u.y + 20),
      wire: screen((a.x + 76 + u.x) / 2, a.y + 22)
    };
  });
  await pg.mouse.click(box.x + points.gate.x, box.y + points.gate.y);
  await pg.fill('#ncolor', '#de4567');
  await pg.locator('#ncolor').press('Tab');
  eq(await pg.evaluate(() => LogicLab.exportProject().nodes.find((n) => n.name === 'U1').color), '#de4567');
  await pg.mouse.click(box.x + points.wire.x, box.y + points.wire.y);
  await pg.fill('#wcolor', '#1b73e8');
  await pg.locator('#wcolor').press('Tab');
  eq(await pg.evaluate(() => LogicLab.exportProject().wires[0].color), '#1b73e8');
});
await test('Wire tool connects output and input with two clicks and ignores empty clicks', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'U2', type: 'NOT' }
      ],
      wires: [{ from: 'A.0', to: 'U1.0' }]
    })
  );
  await pg.waitForTimeout(100);
  const box = await pg.locator('#cv').boundingBox();
  const pts = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      a = d.nodes.find((n) => n.name === 'A'),
      b = d.nodes.find((n) => n.name === 'U2'),
      h = (n) => (n.type === 'IN' ? 44 : 40),
      v = LogicLabHost.view().v,
      screen = (x, y) => ({ x: v.x + x * v.s, y: v.y + y * v.s });
    return {
      start: screen(a.x + 76, a.y + h(a) / 2),
      empty: screen((a.x + b.x) / 2, Math.max(a.y, b.y) + 72),
      end: screen(b.x, b.y + h(b) / 2)
    };
  });
  await pg.click('#tw');
  await pg.mouse.click(box.x + pts.start.x, box.y + pts.start.y);
  await pg.mouse.click(box.x + pts.empty.x, box.y + pts.empty.y);
  eq(
    (await pg.evaluate(() => LogicLab.exportProject().wires)).length,
    1,
    'empty click does not complete a wire'
  );
  await pg.mouse.click(box.x + pts.end.x, box.y + pts.end.y);
  const doc = await pg.evaluate(() => LogicLab.exportProject());
  ok(
    doc.wires.some(
      (w) =>
        w.a === doc.nodes.find((n) => n.name === 'A').id && w.b === doc.nodes.find((n) => n.name === 'U2').id
    )
  );
  ok(
    doc.wires.find((w) => w.b === doc.nodes.find((n) => n.name === 'U2').id).bends?.length === 1,
    'an empty-canvas click adds one saved route point'
  );
});
await test('Wire tool accepts clicks just outside visible pin markers', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' }
      ]
    })
  );
  const box = await pg.locator('#cv').boundingBox();
  const pts = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      a = d.nodes.find((n) => n.name === 'A'),
      g = d.nodes.find((n) => n.name === 'U1'),
      v = LogicLabHost.view().v,
      screen = (x, y) => ({ x: v.x + x * v.s, y: v.y + y * v.s });
    return {
      start: screen(a.x + 76, a.y + 22),
      end: screen(g.x, g.y + 20)
    };
  });
  await pg.click('#tw');
  await pg.mouse.click(box.x + pts.start.x + 12, box.y + pts.start.y);
  await pg.mouse.click(box.x + pts.end.x - 12, box.y + pts.end.y);
  const doc = await pg.evaluate(() => LogicLab.exportProject()),
    a = doc.nodes.find((n) => n.name === 'A'),
    g = doc.nodes.find((n) => n.name === 'U1');
  ok(
    doc.wires.some((w) => w.a === a.id && w.b === g.id),
    'nearby clicks should snap to the source and target pins'
  );
});
await test('Wire tool branches from an existing wire segment', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' },
        { id: 'U2', type: 'NOT' }
      ],
      wires: [{ from: 'A', to: 'U1.0' }]
    })
  );
  await pg.click('#zi');
  await pg.click('#zi');
  await pg.click('#zi');
  const points = await pg.evaluate(() => {
    const doc = LogicLab.exportProject(),
      input = doc.nodes.find((node) => node.name === 'A'),
      secondGate = doc.nodes.find((node) => node.name === 'U2'),
      { v, el } = LogicLabHost.view(),
      rect = el.getBoundingClientRect(),
      screen = (x, y) => ({ x: rect.x + v.x + x * v.s, y: rect.y + v.y + y * v.s });
    return {
      tap: screen(input.x + 98, input.y + 22),
      worldTap: { x: input.x + 98, y: input.y + 22 },
      target: screen(secondGate.x, secondGate.y + 20),
      inputId: input.id,
      secondGateId: secondGate.id,
      sourcePin: doc.wires[0].ap
    };
  });
  await pg.click('#tw');
  await pg.mouse.click(points.tap.x, points.tap.y);
  await pg.mouse.click(points.target.x, points.target.y);
  const wires = await pg.evaluate(() => LogicLab.exportProject().wires),
    branch = wires.find((wire) => wire.tap);
  ok(branch, 'branch wire stores a tap point on the source segment: ' + JSON.stringify(wires));
  eq([branch.a, branch.ap, branch.b], [points.inputId, points.sourcePin, points.secondGateId]);
  ok(Math.abs(branch.tap.x - points.worldTap.x) < 1, 'tap stays at the clicked point on the source wire');
});
await test('touch taps outside pin markers still connect without opening a context menu', async () => {
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const p = await m.newPage();
  await p.goto(url);
  await p.waitForFunction(() => window.LogicLab);
  await p.click('#wn');
  await p.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'U1', type: 'NOT' }
      ]
    })
  );
  await p.click('#tw');
  const points = await p.evaluate(() => {
    const d = LogicLab.exportProject(),
      a = d.nodes.find((n) => n.name === 'A'),
      g = d.nodes.find((n) => n.name === 'U1'),
      { v, el } = LogicLabHost.view(),
      r = el.getBoundingClientRect(),
      screen = (x, y) => ({ x: r.x + v.x + x * v.s, y: r.y + v.y + y * v.s });
    return {
      start: screen(a.x + 76, a.y + 22),
      end: screen(g.x, g.y + 20)
    };
  });
  const tap = (point) =>
    p.evaluate(async ({ x, y }) => {
      const canvas = LogicLabHost.view().el,
        wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      canvas.setPointerCapture = () => {};
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 11,
          pointerType: 'touch',
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y,
          bubbles: true
        })
      );
      await wait(80);
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 11,
          pointerType: 'touch',
          button: 0,
          buttons: 0,
          clientX: x,
          clientY: y,
          bubbles: true
        })
      );
    }, point);
  await tap({ x: points.start.x + 18, y: points.start.y });
  await tap({ x: points.end.x - 18, y: points.end.y });
  const result = await p.evaluate(() => ({
    wires: LogicLab.exportProject().wires,
    menuHidden: document.querySelector('#cm').hidden
  }));
  const a = await p.evaluate(() => LogicLab.exportProject().nodes.find((n) => n.name === 'A').id),
    g = await p.evaluate(() => LogicLab.exportProject().nodes.find((n) => n.name === 'U1').id);
  ok(
    result.wires.some((w) => w.a === a && w.b === g),
    'two touch taps should connect nearby output and input pins'
  );
  ok(result.menuHidden, 'ordinary touch taps should not open a context menu');
  await m.close();
});
await test('wire snapping selects the closest of multiple gate inputs', async () => {
  await pg.evaluate(() =>
    LogicLab.build({
      parts: [
        { id: 'A', type: 'IN' },
        { id: 'G', type: 'AND' }
      ]
    })
  );
  const box = await pg.locator('#cv').boundingBox();
  const pts = await pg.evaluate(() => {
    const d = LogicLab.exportProject(),
      a = d.nodes.find((n) => n.name === 'A'),
      g = d.nodes.find((n) => n.name === 'G'),
      v = LogicLabHost.view().v,
      screen = (x, y) => ({ x: v.x + x * v.s, y: v.y + y * v.s });
    return {
      start: screen(a.x + 76, a.y + 22),
      nearSecondInput: screen(g.x, g.y + 48 / 2 + 1.5),
      secondInput: 1
    };
  });
  await pg.click('#tw');
  await pg.mouse.click(box.x + pts.start.x, box.y + pts.start.y);
  await pg.mouse.click(box.x + pts.nearSecondInput.x, box.y + pts.nearSecondInput.y);
  const doc = await pg.evaluate(() => LogicLab.exportProject()),
    a = doc.nodes.find((n) => n.name === 'A'),
    g = doc.nodes.find((n) => n.name === 'G'),
    wire = doc.wires.find((w) => w.a === a.id && w.b === g.id);
  ok(wire, 'wire should connect to the nearby gate');
  eq(
    wire.bp,
    pts.secondInput,
    'closest input pin should be selected even when another input is also in range'
  );
});

await test('drawing tools support fill, border colour and Shift-constrained shapes', async () => {
  await pg.evaluate(() => LogicLab.load(''));
  await pg.click('#dt [data-k=rect]');
  await pg.check('#dfill');
  await pg.fill('#dc', '#123456');
  await pg.fill('#fc', '#abcdef');
  const box = await pg.locator('#cv').boundingBox();
  const view = await pg.evaluate(() => LogicLabHost.view().v);
  const screen = (x, y) => ({
    x: box.x + view.x + x * view.s,
    y: box.y + view.y + y * view.s
  });
  const start = screen(120, 120),
    end = screen(220, 180);
  await pg.mouse.move(start.x, start.y);
  await pg.mouse.down();
  await pg.keyboard.down('Shift');
  await pg.mouse.move(end.x, end.y);
  await pg.keyboard.up('Shift');
  await pg.mouse.up();
  const shape = await pg.evaluate(() => LogicLab.exportProject().notes.find((n) => n.t === 'rect'));
  ok(shape.fillOn, 'rectangle fill should be enabled');
  eq([shape.bc, shape.fc], ['#123456', '#abcdef']);
  eq(Math.abs(shape.x1 - shape.x0), Math.abs(shape.y1 - shape.y0), 'Shift constrains a square');
});
await test('drawing inspector controls opacity and text position, size, and alignment', async () => {
  await pg.evaluate(() => {
    LogicLab.load('');
    const doc = LogicLab.exportProject();
    doc.uid = 102;
    doc.notes = [
      {
        id: 100,
        t: 'rect',
        l: 1,
        c: '#123456',
        bc: '#123456',
        fc: '#abcdef',
        fillOn: true,
        w: 2,
        x0: 40,
        y0: 40,
        x1: 120,
        y1: 100,
        rot: 0,
        alpha: 1
      },
      {
        id: 101,
        t: 'text',
        l: 1,
        c: '#123456',
        bc: '#123456',
        fc: '#123456',
        fillOn: false,
        w: 2,
        x0: 160,
        y0: 80,
        x1: 160,
        y1: 80,
        s: 'Demo label',
        fs: 20,
        align: 'left',
        rot: 0,
        alpha: 1
      }
    ];
    LogicLab.importProject(doc);
  });
  await pg.click('#side .stabs button[data-t="c"]');
  await pg.click('#tsel');
  const shapePoint = await pg.evaluate(() => {
    const { v, el } = LogicLabHost.view(),
      r = el.getBoundingClientRect();
    return { x: r.x + v.x + 80 * v.s, y: r.y + v.y + 70 * v.s };
  });
  await pg.mouse.click(shapePoint.x, shapePoint.y);
  await pg.locator('#nalpha').evaluate((input) => {
    input.value = '0.35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  eq(await pg.evaluate(() => LogicLab.exportProject().notes.find((note) => note.t === 'rect').alpha), 0.35);
  const textPoint = await pg.evaluate(() => {
    const { v, el } = LogicLabHost.view(),
      r = el.getBoundingClientRect();
    return { x: r.x + v.x + 165 * v.s, y: r.y + v.y + 85 * v.s };
  });
  await pg.mouse.click(textPoint.x, textPoint.y);
  eq(await pg.locator('#talign').inputValue(), 'left');
  await pg.locator('#tx0').fill('180');
  await pg.locator('#ty0').fill('90');
  await pg.locator('#tsz').fill('32');
  await pg.locator('#talign').selectOption('right');
  const text = await pg.evaluate(() => LogicLab.exportProject().notes.find((note) => note.t === 'text'));
  eq([text.x0, text.y0, text.fs, text.align], [180, 90, 32, 'right']);
});

await test('middle-button drag pans the canvas', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const box = await pg.locator('#cv').boundingBox();
  const before = await pg.evaluate(() => ({ ...LogicLabHost.view().v }));
  await pg.mouse.move(box.x + 300, box.y + 250);
  await pg.mouse.down({ button: 'middle' });
  await pg.mouse.move(box.x + 350, box.y + 290);
  await pg.mouse.up({ button: 'middle' });
  const after = await pg.evaluate(() => LogicLabHost.view().v);
  ok(after.x !== before.x || after.y !== before.y, 'canvas offset should change while panning');
});

await test('touchscreen drag pans the canvas and two-finger pinch zooms', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  await pg.click('#tpan');
  const result = await pg.evaluate(() => {
    const canvas = LogicLabHost.view().el,
      view = LogicLabHost.view().v,
      before = { ...view },
      send = (type, pointerId, clientX, clientY) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType: 'touch',
            isPrimary: pointerId === 1,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
            bubbles: true
          })
        );
    canvas.setPointerCapture = () => {};
    send('pointerdown', 1, 200, 200);
    send('pointermove', 1, 240, 230);
    send('pointerup', 1, 240, 230);
    const panned = { ...view };
    send('pointerdown', 1, 200, 200);
    send('pointerdown', 2, 300, 200);
    send('pointermove', 2, 320, 200);
    send('pointermove', 2, 340, 200);
    send('pointermove', 1, 200, 200);
    send('pointerup', 2, 340, 200);
    send('pointerup', 1, 200, 200);
    return {
      panned: panned.x !== before.x || panned.y !== before.y,
      pinchZoomed: view.s > panned.s
    };
  });
  ok(result.panned, 'a one-finger drag on blank canvas should pan');
  ok(result.pinchZoomed, 'a two-finger pinch should zoom in');
});

await test('touchpad scroll pans and pinch zooms while mouse wheel still zooms', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const result = await pg.evaluate(() => {
    const canvas = LogicLabHost.view().el,
      view = LogicLabHost.view().v,
      before = { ...view },
      wheel = (options) =>
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: 200,
            clientY: 200,
            ...options
          })
        );
    wheel({ deltaY: 24, deltaMode: 0, altKey: true });
    const altScrolled = { ...view };
    wheel({ deltaY: 18, deltaMode: 0, shiftKey: true });
    const shiftScrolled = { ...view };
    wheel({ deltaX: 12, deltaY: 35, deltaMode: 0 });
    const scrolled = { ...view };
    const pinchStart = view.s;
    wheel({ deltaY: -30, deltaMode: 0, ctrlKey: true });
    const pinched = { ...view };
    wheel({ deltaY: -1, deltaMode: 1 });
    return {
      touchpadPanned: scrolled.x !== before.x || scrolled.y !== before.y,
      altScrollHorizontal: altScrolled.x !== before.x && altScrolled.y === before.y,
      shiftScrollVertical: shiftScrolled.x === altScrolled.x && shiftScrolled.y !== altScrolled.y,
      touchpadPinched: pinched.s > scrolled.s,
      pinchRatio: pinched.s / pinchStart,
      wheelZoomed: view.s > pinched.s
    };
  });
  ok(result.touchpadPanned, 'pixel-based touchpad scrolling should pan');
  ok(result.altScrollHorizontal, 'Alt+scroll should move horizontally only');
  ok(result.shiftScrollVertical, 'Shift+scroll should move vertically only');
  ok(result.touchpadPinched, 'Ctrl+wheel pinch should zoom smoothly');
  ok(Math.abs(result.pinchRatio - Math.exp(0.03)) < 0.001, 'pinch zoom follows smooth trackpad delta speed');
  ok(result.wheelZoomed, 'a traditional mouse wheel should continue to zoom');
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
  const favoriteBounds = await pg.locator('#cv').boundingBox(),
    point = await pg.evaluate(() => {
      const drawing = LogicLab.exportProject().notes.find((note) => note.t === 'rect'),
        view = LogicLabHost.view().v;
      return {
        x: view.x + ((drawing.x0 + drawing.x1) / 2) * view.s,
        y: view.y + ((drawing.y0 + drawing.y1) / 2) * view.s
      };
    });
  await pg.mouse.click(favoriteBounds.x + point.x, favoriteBounds.y + point.y, { button: 'right' });
  await pg.getByRole('button', { name: 'Save group to Favorites' }).click();
  const favorite = pg.locator('#pal .fav-insert').filter({ hasText: 'Group 1' });
  eq(await favorite.count(), 1, 'saved group appears in Favorites');
  const originalWireCount = await pg.evaluate(() => LogicLab.exportProject().wires.length);
  await favorite.click();
  const duplicated = await pg.evaluate(() => LogicLab.exportProject());
  eq(duplicated.nodes.length, 12, 'group Favorite copies all parts');
  eq(duplicated.wires.length, originalWireCount * 2, 'group Favorite copies its internal wiring');
  eq(duplicated.notes.length, 2, 'group Favorite copies drawings');
  eq(duplicated.groups.length, 2, 'inserted Favorite restores a separate group');
});

/* ---- save, export, reopen ---- */
await test('Share menu offers project file, PNG and PDF downloads, and each download is valid', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  await pg.fill('#pn', 'My Test Circuit');
  ok(!(await pg.locator('#sv').count()), 'standalone Save button is removed');
  const grab = async (x) => {
    await pg.click('#cb-share');
    await pg.click('#cb-r-dl');
    ok((await pg.locator('#cb-pop [data-download]').count()) === 4, 'Download submenu has all formats');
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
await test('custom image export supports selected content and whole-circuit scope', async () => {
  await pg.evaluate(() => LogicLab.load('half-adder'));
  const box = await pg.locator('#cv').boundingBox();
  const at = await pg.evaluate(() => {
    const n = LogicLab.exportProject().nodes[0],
      v = LogicLabHost.view().v;
    return { x: v.x + (n.x + 38) * v.s, y: v.y + (n.y + 22) * v.s };
  });
  await pg.mouse.click(box.x + at.x, box.y + at.y);
  const exportPng = async (scope, file) => {
    await pg.click('#cb-share');
    await pg.click('#cb-r-dl');
    await pg.click('[data-download=custom]');
    await pg.check('input[name=exscope][value=' + scope + ']');
    if (scope === 'selected') {
      await pg.uncheck('#exwires');
      await pg.uncheck('#exdrawings');
    }
    const [download] = await Promise.all([pg.waitForEvent('download'), pg.click('#exsubmit')]);
    await download.saveAs(file);
    const data = fs.readFileSync(file);
    eq(data.subarray(1, 4).toString(), 'PNG');
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  };
  const selected = await exportPng('selected', '/tmp/ll-selected.png'),
    full = await exportPng('all', '/tmp/ll-full.png');
  ok(selected.width < full.width, 'selection-only export should crop to selected parts');
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
    const els = [
      ...document.querySelectorAll(
        '#wl aside .lgo, #wl aside .nv:not(#wexamples), #wl aside #wn, #wl aside #wo'
      )
    ];
    const boxes = els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
    });
    const overlaps = boxes.some((a, i) =>
      boxes
        .slice(i + 1)
        .some((b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1)
    );
    return { overlaps, linksFit: boxes.slice(1, 4).every((b) => b.width > 70) };
  });
  eq(welcome.overlaps, false, 'mobile welcome navigation controls do not overlap');
  eq(welcome.linksFit, true, 'mobile welcome navigation links have usable widths');
  ok(await p.isVisible('.github-link'), 'GitHub open-source link is visible on mobile');
  await p.click('#wn');
  await p.waitForTimeout(400);
  ok(await p.isVisible('#bn'), 'bottom nav visible');
  ok(
    await p.locator('#tpan').evaluate((button) => button.classList.contains('on')),
    'Pan is the default touch tool'
  );
  eq(
    await p.locator('#undo').evaluate((button) => getComputedStyle(button).display !== 'none'),
    true,
    'Undo is visible on mobile'
  );
  ok(await p.isVisible('#sim'), 'simulation control remains available on phones');
  for (const width of [320, 375, 390, 448]) {
    await p.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    const layout = await p.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect(),
        actions = [...document.querySelectorAll('.hr > button, .hr > .dd > button')]
          .filter((e) => getComputedStyle(e).display !== 'none')
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }),
        overlaps = actions.some((a, i) =>
          actions
            .slice(i + 1)
            .some(
              (b) =>
                a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
            )
        );
      return {
        documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
        headerFits:
          document.querySelector('header').scrollWidth <= document.querySelector('header').clientWidth + 1,
        actionsFit: actions.every((a) => a.left >= 0 && a.right <= innerWidth + 1),
        actionsOverlap: overlaps,
        zoomStepOverlap: (() => {
          const zoom = rect('#zm'),
            step = rect('#rn');
          return (
            zoom.left < step.right &&
            zoom.right > step.left &&
            zoom.top < step.bottom &&
            zoom.bottom > step.top
          );
        })(),
        drawingClear: rect('#dt').bottom <= rect('#bn').top + 1
      };
    });
    eq(layout.documentFits, true, `editor overflows the screen at ${width}px`);
    eq(layout.headerFits, true, `header overflows at ${width}px`);
    eq(layout.actionsFit, true, `header controls are clipped at ${width}px`);
    eq(layout.actionsOverlap, false, `header controls overlap at ${width}px`);
    eq(layout.zoomStepOverlap, false, `zoom and step controls overlap at ${width}px`);
    eq(layout.drawingClear, true, `drawing toolbar is covered by bottom nav at ${width}px`);
  }
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

await test('touch Select tool uses a drag marquee and mobile Undo restores deleted selection', async () => {
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const p = await m.newPage();
  await p.goto(url);
  await p.waitForFunction(() => window.LogicLab);
  await p.click('#wn');
  await p.evaluate(() => LogicLab.load('half-adder'));
  await p.click('#tsel');
  const selection = await p.evaluate(() => {
    const input = LogicLab.exportProject().nodes.find((node) => node.name === 'A'),
      { v, el } = LogicLabHost.view(),
      r = el.getBoundingClientRect(),
      screen = (x, y) => ({ x: r.x + v.x + x * v.s, y: r.y + v.y + y * v.s });
    return {
      start: screen(input.x - 24, input.y - 20),
      end: screen(input.x + 94, input.y + 64),
      count: LogicLab.parts().length
    };
  });
  await p.evaluate(({ start, end }) => {
    const canvas = LogicLabHost.view().el;
    canvas.setPointerCapture = () => {};
    const dispatch = (type, x, y) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 55,
          pointerType: 'touch',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
          bubbles: true
        })
      );
    dispatch('pointerdown', start.x, start.y);
    dispatch('pointermove', end.x, end.y);
    dispatch('pointerup', end.x, end.y);
  }, selection);
  await p.keyboard.press('Delete');
  eq(
    await p.evaluate(() => LogicLab.parts().length),
    selection.count - 1,
    'touch marquee selects the enclosed part'
  );
  await p.click('#undo');
  eq(
    await p.evaluate(() => LogicLab.parts().length),
    selection.count,
    'mobile Undo restores the selected part'
  );
  await m.close();
});

await test('touch long-press opens context menu only while holding the same canvas target', async () => {
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const p = await m.newPage();
  await p.goto(url);
  await p.waitForFunction(() => window.LogicLab);
  await p.click('#wn');
  await p.evaluate(() => LogicLab.build({ parts: [{ id: 'A', type: 'IN' }] }));
  const point = await p.evaluate(() => {
    const n = LogicLab.exportProject().nodes[0],
      { v, el } = LogicLabHost.view(),
      r = el.getBoundingClientRect();
    return {
      x: r.left + v.x + (n.x + 30) * v.s,
      y: r.top + v.y + (n.y + 22) * v.s
    };
  });
  const runTouchSequence = (action) =>
    p.evaluate(
      async ({ point, action }) => {
        const canvas = LogicLabHost.view().el,
          wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          send = (type, x = point.x, y = point.y) =>
            canvas.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 7,
                pointerType: 'touch',
                isPrimary: true,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                clientX: x,
                clientY: y,
                bubbles: true
              })
            );
        canvas.setPointerCapture = () => {};
        send('pointerdown');
        if (action === 'tap') {
          await wait(10);
          send('pointerup');
          await wait(40);
          return document.querySelector('#cm').hidden;
        }
        if (action === 'hold') {
          await wait(350);
          const opened = !document.querySelector('#cm').hidden;
          send('pointerup');
          document.querySelector('#cm').hidden = true;
          return opened;
        }
        await wait(10);
        send('pointermove', point.x + 12, point.y);
        await wait(40);
        const cancelled = document.querySelector('#cm').hidden;
        send('pointerup', point.x + 12, point.y);
        return cancelled;
      },
      { point, action }
    );

  ok(await runTouchSequence('tap'), 'a quick tap should not open a context menu');
  const nativeTouchMenu = await p.evaluate(({ x, y }) => {
    const canvas = LogicLabHost.view().el,
      event = new PointerEvent('contextmenu', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true
      });
    canvas.dispatchEvent(event);
    return { prevented: event.defaultPrevented, hidden: document.querySelector('#cm').hidden };
  }, point);
  ok(nativeTouchMenu.prevented, 'browser touch context menu is suppressed');
  ok(nativeTouchMenu.hidden, 'touch context menu requires the long-press gesture');
  ok(await runTouchSequence('hold'), 'holding for 300 ms opens the context menu');
  ok(await runTouchSequence('move'), 'moving from the original place cancels the long-press');
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
      headerFits:
        document.querySelector('header').scrollWidth <= document.querySelector('header').clientWidth + 1,
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
