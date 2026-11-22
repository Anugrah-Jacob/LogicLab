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
  return [invalid.status, cleared.status, (await cleared.json()).fallbackProvider];
});
eq(
  fallbackConfig,
  [400, 200, ''],
  'no-second-provider setting persists and duplicate providers are rejected'
);
await page.selectOption('[name=provider]', 'openai');
await page.locator('[name=apiKey]').fill('sk-test-openai-key-1234');
await page.locator('[name=fallbackApiKey]').fill('gemini-test-key-5678');
await page.locator('[name=nvidiaApiKey]').fill('nvidia-test-key-9012');
await page.click('#aiform button.pr');
await page.waitForFunction(() =>
  document.querySelector('[name=fallbackApiKey]')?.placeholder.includes('••••')
);

await test('admin configures primary, second, and NVIDIA third provider keys', async () => {
  const settings = await page.evaluate(async () => (await fetch('/api/admin/settings')).json());
  eq([settings.provider, settings.fallbackProvider, settings.thirdProvider], ['openai', 'gemini', 'nvidia']);
  eq(
    ['openai', 'gemini', 'nvidia'].map((provider) => settings.providers[provider].hasKey),
    [true, true, true]
  );
  eq(
    ['openai', 'gemini', 'nvidia'].map((provider) => settings.providers[provider].keyHint),
    ['••••1234', '••••5678', '••••9012']
  );
  const response = JSON.stringify(settings);
  ok(!response.includes('sk-test-openai-key-1234'), 'OpenAI key is not returned');
  ok(!response.includes('gemini-test-key-5678'), 'Gemini key is not returned');
  ok(!response.includes('nvidia-test-key-9012'), 'NVIDIA key is not returned');
});

await browser.close();
await app.close();
summary();
