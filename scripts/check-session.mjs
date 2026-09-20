// Read-only check of whether auth/profile still has a valid session, without running the full test suite.
// Exits 1 if not logged in, so `npm run check-session || npm run login` chains cleanly.
import { chromium } from '@playwright/test';

const BASE = 'https://app.business.just-eat.co.uk';
const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false, viewport: { width: 1400, height: 1000 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const loggedIn = (await page.locator('input[type="password"]').count()) === 0 && (await page.locator('li[test-id="days"]').count()) > 0;
console.log(loggedIn ? `Logged in (${page.url()}).` : `Not logged in — landed on ${page.url()}. Run \`npm run login\`.`);
await ctx.close();
process.exit(loggedIn ? 0 : 1);
