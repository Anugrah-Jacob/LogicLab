// Minimal test harness: a static file server, a headless browser and tiny assertion helpers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json'
};

export function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, url.endsWith('/') ? url + 'index.html' : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })
    )
  );
}

export async function openApp(browser, url, opts = {}) {
  const page = await browser.newPage(opts);
  const problems = [];
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text()))
      problems.push('console: ' + m.text());
  });
  await page.goto(url + (opts.query || ''));
  await page.waitForFunction(() => window.LogicLab);
  return { page, problems };
}

let passed = 0,
  failed = 0;
const failures = [];
export async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       '));
  }
}
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual),
    b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || 'values differ') + '\n  expected ' + b + '\n  actual   ' + a);
}
export function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
export function summary() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failed: ' + failures.join(', '));
    process.exitCode = 1;
  }
}
export { chromium };
