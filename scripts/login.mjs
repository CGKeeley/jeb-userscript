// Opens a headed Chromium with a persistent profile so the user can log in.
// Once /my-meals loads while logged in, saves cookies+storage to auth/state.json.
// Also logs XHR/fetch request URLs seen during the session to auth/requests.log.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'https://app.business.just-eat.co.uk';
const ctx = await chromium.launchPersistentContext('auth/profile', {
  headless: false,
  viewport: null,
  args: ['--start-maximized'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const log = fs.createWriteStream('auth/requests.log', { flags: 'a' });
ctx.on('request', (r) => {
  const t = r.resourceType();
  if (t === 'xhr' || t === 'fetch' || t === 'document') {
    log.write(`${new Date().toISOString()} ${r.method()} ${r.url()}\n`);
  }
});
ctx.on('response', async (r) => {
  const ct = r.headers()['content-type'] ?? '';
  if (ct.includes('json') && r.url().startsWith(BASE)) {
    try {
      const body = await r.text();
      const name = r.url().replace(BASE, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 150);
      fs.mkdirSync('auth/responses', { recursive: true });
      fs.writeFileSync(`auth/responses/${Date.now()}_${name}.json`, body);
    } catch {}
  }
});

await page.goto(`${BASE}/my-meals`);
console.log('Please log in in the browser window. Waiting for /my-meals to load while authenticated...');

// Wait until we are on /my-meals and it looks logged in (no login form, cookies present).
const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const url = page.url();
  if (url.startsWith(`${BASE}/my-meals`)) {
    const hasLogin = await page.locator('input[type="password"]').count();
    if (!hasLogin) break;
  }
}
await page.waitForTimeout(5000); // let the page settle & capture API calls
await ctx.storageState({ path: 'auth/state.json' });
console.log('Saved auth/state.json. You can close the browser.');
await ctx.close();
