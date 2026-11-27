// A complete local copy of the site for tests: static files from /public plus the real API code
// (functions/api/[[path]].js) running on an in-memory SQLite database that stands in for D1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDB } from './d1shim.mjs';
import { onRequest } from '../functions/api/[[path]].js';

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

export function startApp(extraEnv = {}) {
  const env = { DB: makeDB(), JWT_SECRET: 'test-secret-'.repeat(4), ADMIN_SETUP_CODE: 'setup', ...extraEnv };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const request = new Request('http://' + req.headers.host + req.url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
      });
      const out = await onRequest({
        request,
        env,
        params: { path: u.pathname.slice(5).split('/').filter(Boolean) }
      });
      const headers = {};
      out.headers.forEach((v, k) => (headers[k] = v));
      const sc = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
      if (sc.length) headers['set-cookie'] = sc;
      res.writeHead(out.status, headers);
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    const url = decodeURIComponent(u.pathname);
    const file = path.join(root, url.endsWith('/') ? url + 'index.html' : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        env,
        server,
        url: 'http://127.0.0.1:' + server.address().port + '/',
        close: () => server.close()
      })
    )
  );
}
