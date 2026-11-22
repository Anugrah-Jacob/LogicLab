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
await page.click('.provider-keys summary');
await page.locator('[data-provider-key=groq]').fill('gsk-test-groq-key-1234');
await page.locator('[data-provider-key=gemini]').fill('gemini-test-key-5678');
await page.locator('[data-provider-key=anthropic]').fill('anthropic-test-key-9012');
await page.click('#aiform button.pr');
await page.waitForFunction(() =>
  document.querySelector('[data-provider-key=gemini]')?.placeholder.includes('••••')
);

await test('admin stores multiple provider keys independently and masks them', async () => {
  const settings = await page.evaluate(async () => (await fetch('/api/admin/settings')).json());
  eq(
    ['groq', 'gemini', 'anthropic'].map((provider) => settings.providers[provider].hasKey),
    [true, true, true]
  );
  eq(
    ['groq', 'gemini', 'anthropic'].map((provider) => settings.providers[provider].keyHint),
    ['••••1234', '••••5678', '••••9012']
  );
  const response = JSON.stringify(settings);
  ok(!response.includes('gsk-test-groq-key-1234'), 'Groq key is not returned');
  ok(!response.includes('gemini-test-key-5678'), 'Gemini key is not returned');
  ok(!response.includes('anthropic-test-key-9012'), 'Anthropic key is not returned');
});

await browser.close();
await app.close();
summary();
