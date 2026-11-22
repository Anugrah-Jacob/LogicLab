// Syntax-check every JavaScript file the project ships (works on every operating system).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const dirs = ['public/js', 'public/admin', 'server', 'functions/api', 'scripts', 'tests', 'public'];
const files = new Set();
for (const d of dirs) {
  const dir = path.join(root, d);
  for (const f of fs.readdirSync(dir)) if (/\.(m?js)$/.test(f)) files.add(path.join(dir, f));
}
let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.error('Syntax error in ' + path.relative(root, f) + '\n' + e.stderr);
  }
}
console.log(files.size + ' files checked' + (bad ? ', ' + bad + ' with errors' : ', no syntax errors'));
process.exitCode = bad ? 1 : 0;
