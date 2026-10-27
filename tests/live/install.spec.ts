// The bookmark URL itself (compressed loader, not the plain dist/bookmarklet.js the other live tests run)
// starts the userscript in real Chrome. Requires `npm run build` first.
import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROFILE = path.resolve('auth/profile');
const URL_FILE = path.resolve('dist/bookmarklet.url.txt');
const BASE = 'https://app.business.just-eat.co.uk';

test.describe('bookmark URL', () => {
  test.skip(!fs.existsSync(PROFILE), 'run `npm run login` first');
  test.skip(!fs.existsSync(URL_FILE), 'run `npm run build` first');

  test('inflates and runs, adding both buttons to the meals page', async () => {
    const url = fs.readFileSync(URL_FILE, 'utf8').trim();
    expect(url.startsWith('javascript:')).toBe(true);
    expect(url.length).toBeLessThan(32 * 1024); // keep well under bookmark URL limits
    const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 1000 } });
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('li[test-id="days"]').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500); // the app re-navigates once shortly after load
      // What the browser runs when the bookmark is clicked: the URL body, percent-decoded.
      await page.evaluate(decodeURIComponent(url.slice('javascript:'.length)));
      await expect(page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]').first()).toBeVisible();
      await expect(page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-arrivals-button]').first()).toBeVisible();
      expect(dialogs).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('on any other site, goes to the meals page without unpacking (which a strict CSP could block)', async () => {
    const url = fs.readFileSync(URL_FILE, 'utf8').trim();
    const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 1000 } });
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      // A page whose CSP forbids eval, standing in for sites like github.com.
      await page.route('https://csp.example/', (route) =>
        route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': "script-src 'self'" }, body: '<p>elsewhere</p>' }),
      );
      await page.goto('https://csp.example/');
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      await Promise.all([page.waitForURL(`${BASE}/my-meals**`, { timeout: 30_000 }), page.evaluate(decodeURIComponent(url.slice('javascript:'.length)))]);
      expect(dialogs).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
