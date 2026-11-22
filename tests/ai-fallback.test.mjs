import http from 'node:http';
import { startApp } from './app-server.mjs';
import { test, eq, ok, summary } from './harness.mjs';
import { storeKey, storeProviderKey, saveSetting } from '../server/settings.js';

const app = await startApp();
const nativeFetch = globalThis.fetch;
let groqStatus = 429;
const calls = [];
const upstream = http.createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* consume provider body */
  }
  calls.push({ path: req.url, hasAuthorization: !!req.headers.authorization });
  if (req.url === '/gemini/chat/completions') {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Gemini temporarily unavailable.' } }));
  }
  if (req.url === '/v1/chat/completions' && groqStatus === 429) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
    return res.end(JSON.stringify({ error: { message: 'rate limit reached' } }));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Provider recovered.' } }]
    })
  );
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + upstream.address().port;
await saveSetting(app.env, 'ai_provider', 'groq');
await saveSetting(app.env, 'ai_model', 'llama-3.3-70b-versatile');
await saveSetting(app.env, 'ai_base_url', baseUrl + '/v1');
await storeKey(app.env, 'groq-test-key');
await storeProviderKey(app.env, 'gemini', 'gemini-test-key');
await storeProviderKey(app.env, 'nvidia', 'nvidia-test-key');

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'))
    return nativeFetch(baseUrl + '/gemini/chat/completions', init);
  if (url.startsWith('https://integrate.api.nvidia.com/v1/chat/completions'))
    return nativeFetch(baseUrl + '/nvidia/chat/completions', init);
  return nativeFetch(input, init);
};

const signup = await nativeFetch(app.url + 'api/auth/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'AI tester',
    email: 'ai-fallback@example.com',
    password: 'testing password 7'
  })
});
const cookie = signup.headers.get('set-cookie').split(';')[0];
const ask = () =>
  nativeFetch(app.url + 'api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Continue the circuit task.' }] })
  });

await test('AI tries its second and NVIDIA third provider, then restores recovered Groq', async () => {
  const first = await ask();
  const fallback = await first.json();
  eq([first.status, fallback.provider], [200, 'nvidia']);
  eq(
    calls.map((call) => call.path),
    ['/v1/chat/completions', '/gemini/chat/completions', '/nvidia/chat/completions']
  );
  ok(calls[1].hasAuthorization, 'second provider uses a saved API key');
  ok(calls[2].hasAuthorization, 'NVIDIA uses its saved API key');

  const row = await app.env.DB.prepare('SELECT v FROM settings WHERE k=?')
    .bind('ai_groq_rate_state:llama-3.3-70b-versatile')
    .first();
  const state = JSON.parse(row.v);
  state.retryAt = Date.now() - 1;
  state.lastRequestAt = 0;
  await app.env.DB.prepare('UPDATE settings SET v=? WHERE k=?')
    .bind(JSON.stringify(state), 'ai_groq_rate_state:llama-3.3-70b-versatile')
    .run();

  groqStatus = 200;
  const recovered = await ask();
  const primary = await recovered.json();
  eq([recovered.status, primary.provider], [200, 'groq']);
  eq(calls.at(-1).path, '/v1/chat/completions', 'recovered Groq is tried before Gemini');
});

globalThis.fetch = nativeFetch;
await new Promise((resolve) => upstream.close(resolve));
await app.close();
summary();
