import { chromium, test, eq, ok, summary } from './harness.mjs';
import { startApp } from './app-server.mjs';

const app = await startApp();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(app.url);
await page.evaluate(async () => {
  const signup = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin',
      email: 'admin-provider-keys@example.com',
      password: 'provider key test 9'
    })
  });
  if (!signup.ok) throw new Error('Could not create test admin account.');
  const claim = await fetch('/api/admin/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'setup' })
  });
  if (!claim.ok) throw new Error('Could not claim test admin account.');
});
await page.goto(app.url + 'admin/');
await page.waitForSelector('.stat');
await page.click('.nav a[data-page=settings]');
await page.waitForSelector('#aiform');
const fallbackConfig = await page.evaluate(async () => {
  const unsupported = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai' })
  });
  const invalid = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'groq', fallbackProvider: 'groq' })
  });
  const cleared = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'groq', fallbackProvider: '' })
  });
  return [unsupported.status, invalid.status, cleared.status, (await cleared.json()).fallbackProvider];
});
eq(
  fallbackConfig,
  [400, 400, 200, ''],
  'only Groq and Gemini are supported and duplicate providers are rejected'
);
await page.selectOption('[name=provider]', 'groq');
await page.locator('[name=fallbackModel]').fill('gemini-test-fallback-model');
await page.locator('[name=apiKey]').fill('gsk-test-groq-key-1234');
await page.locator('[name=fallbackApiKey]').fill('gemini-test-key-5678');
await page.click('#aiform button.pr');
await page.waitForFunction(() =>
  document.querySelector('[name=fallbackApiKey]')?.placeholder.includes('••••')
);

await test('admin configures Groq and Gemini provider keys', async () => {
  const settings = await page.evaluate(async () => (await fetch('/api/admin/settings')).json());
  eq([settings.provider, settings.fallbackProvider], ['groq', 'gemini']);
  eq(settings.fallbackModel, 'gemini-test-fallback-model', 'admin can choose the second provider model');
  eq(
    ['groq', 'gemini'].map((provider) => settings.providers[provider].hasKey),
    [true, true]
  );
  eq(
    ['groq', 'gemini'].map((provider) => settings.providers[provider].keyHint),
    ['••••1234', '••••5678']
  );
  const response = JSON.stringify(settings);
  ok(!response.includes('gsk-test-groq-key-1234'), 'Groq key is not returned');
  ok(!response.includes('gemini-test-key-5678'), 'Gemini key is not returned');
  eq(Object.keys(settings.providers).sort(), ['gemini', 'groq'], 'other providers are not exposed');
});

await browser.close();
await app.close();
summary();
