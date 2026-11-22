// A tiny stand-in for Cloudflare D1 built on node:sqlite, so the server code can be tested without wrangler.
// Only what the server uses: prepare().bind().first()/all()/run(), and batch().
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function makeDB(files) {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(root, 'migrations');
  const list = files || fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of list) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() {
      return db.prepare(sql).get(...args) ?? null;
    },
    async all() {
      return { results: db.prepare(sql).all(...args) };
    },
    async run() {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: r.changes } };
    }
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    async batch(list) {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    }
  };
}
