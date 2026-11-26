import http from 'node:http';
import { startApp } from './app-server.mjs';
import { test, eq, ok, summary } from './harness.mjs';
import { storeKey, storeProviderKey, saveSetting } from '../server/settings.js';

const app = await startApp();
const nativeFetch = globalThis.fetch;
let groqStatus = 429;
let geminiStatus = 200;
const calls = [];
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  calls.push({
    path: req.url,
    hasAuthorization: !!req.headers.authorization,
    body: JSON.parse(Buffer.concat(chunks).toString())
  });
  if (req.url === '/gemini/chat/completions') {
    if (geminiStatus !== 200) {
      res.writeHead(geminiStatus, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Gemini temporarily unavailable.' } }));
    }
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

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'))
    return nativeFetch(baseUrl + '/gemini/chat/completions', init);
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
const ask = (mode = 'overwrite', projectExplanation = '') =>
  nativeFetch(app.url + 'api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      project_name: 'AI test project',
      mode,
      message: 'Continue the circuit task.',
      chat_history: [],
      components: ['IN', 'AND', 'OR', 'LED'],
      expression: '',
      project_explanation: projectExplanation
    })
  });
const askExpression = (expression, extra = {}) =>
  nativeFetch(app.url + 'api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      project_name: 'AI test project',
      mode: 'overwrite',
      message: expression,
      chat_history: [],
      components: ['IN', 'AND', 'OR', 'LED'],
      expression,
      project_explanation: '',
      ...extra
    })
  });

await test('AI falls back from Groq to Gemini and restores recovered Groq', async () => {
  const invalid = await ask('unknown');
  eq(invalid.status, 400, 'unsupported AI modes are rejected');
  const first = await ask();
  const fallback = await first.json();
  eq(first.status, 200);
  eq(Object.keys(fallback).sort(), ['chat', 'tool']);
  eq(fallback.tool, null);
  ok(
    calls[0].body.messages[0].content.includes('Mode: overwrite'),
    'selected action mode is included in LangChain system context'
  );
  eq(
    calls.map((call) => call.path),
    ['/v1/chat/completions', '/gemini/chat/completions']
  );
  ok(calls[1].hasAuthorization, 'Gemini fallback uses its saved API key');
  eq(calls[1].body.max_tokens, 32768, 'Gemini has enough output budget for large circuit plans');

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
  geminiStatus = 503;
  const recovered = await ask();
  const primary = await recovered.json();
  eq(recovered.status, 200);
  eq(Object.keys(primary).sort(), ['chat', 'tool']);
  eq(calls.at(-1).path, '/v1/chat/completions', 'recovered Groq is tried before Gemini');

  geminiStatus = 200;
  const largeContext = 'compact circuit netlist '.repeat(4000);
  const large = await ask('read', largeContext);
  const largeResult = await large.json();
  eq(large.status, 200);
  ok(
    calls.at(-1).body.messages[0].content.includes(largeContext),
    'full project explanation reaches Gemini intact'
  );
  eq(calls.at(-1).body.tools, undefined, 'read mode does not expose a modifying tool');
  eq(calls.at(-1).body.max_tokens, 32768, 'Gemini can return large circuit analysis results');
});

await test('structured request returns tool/chat and exposes only expression actions', async () => {
  const before = calls.length;
  const invalid = await askExpression('A AND B', { extra_context: 'project data' });
  eq(invalid.status, 400, 'structured mode rejects fields outside the defined schema');
  eq(calls.length, before, 'invalid expression requests do not reach the model');

  const response = await askExpression('A+B');
  eq(response.status, 200);
  const request = calls.at(-1).body,
    userMessages = request.messages.filter((message) => message.role === 'user'),
    system = request.messages.find((message) => message.role === 'system').content;
  eq(userMessages.map((message) => message.content), ['A+B']);
  ok(system.includes('Project name: AI test project'), 'project name is included');
  ok(system.includes('Mode: overwrite'), 'selected mode is included');
  ok(system.includes('Requested expression: A+B'), 'expression is included');
  ok(system.includes('IN'), 'component inventory is included');
  ok(system.includes('Project explanation:'), 'project explanation is included');
  ok(system.includes('Available components'), 'the complete component list is included');
  ok(system.includes('Project explanation'), 'project context is included');
  ok(system.includes('append mode'), 'the system explains append behavior');
  eq(request.tools.length, 1, 'expression mode exposes only circuit construction');
  eq(request.tools[0].function.name, 'apply_expression');
  eq(request.tools[0].function.parameters.required, ['expression', 'mode']);
  eq(request.tools[0].function.parameters.properties.mode.enum, ['overwrite', 'append']);
});

globalThis.fetch = nativeFetch;
await new Promise((resolve) => upstream.close(resolve));
await app.close();
summary();
