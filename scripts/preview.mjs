// Opens /my-meals with the saved profile, runs the built bookmarklet, opens the first day's comparison
// and saves a screenshot to auth/preview.png. Handy for eyeballing UI changes.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://app.business.just-eat.co.uk';
const code = fs.readFileSync('dist/bookmarklet.js', 'utf8');
const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false, viewport: { width: 2560, height: 1300 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
await page.locator('li[test-id="days"]').first().waitFor();
await page.evaluate(code);
await page.locator('[data-jefb-compare-button]').first().waitFor();
await page.screenshot({ path: 'auth/preview-buttons.png' });
await page.locator('li[test-id="days"]').first().locator('[data-jefb-compare-button]').first().click();
await page.waitForFunction(() => !document.querySelector('#jefb-compare-host')?.shadowRoot?.querySelector('.status')?.textContent?.includes('loading'));
await page.screenshot({ path: 'auth/preview.png' });
await page.locator('#jefb-compare-host .seg label', { hasText: 'Tiles' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'auth/preview-tiles.png' });
await page.locator('#jefb-compare-host .seg label', { hasText: 'Table' }).click();
console.log('saved auth/preview-buttons.png and auth/preview.png');
if (process.argv.includes('--keep')) { await new Promise(() => {}); }
await ctx.close();
