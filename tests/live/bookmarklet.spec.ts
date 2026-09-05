// Drives the real site with the logged-in persistent profile from `npm run login`.
// Requires `npm run build` first. Skipped when no profile exists.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROFILE = path.resolve('auth/profile');
const SCRIPT = path.resolve('dist/bookmarklet.js');
const BASE = 'https://app.business.just-eat.co.uk';

test.describe('bookmarklet on /my-meals', () => {
  test.skip(!fs.existsSync(PROFILE), 'run `npm run login` first');
  test.skip(!fs.existsSync(SCRIPT), 'run `npm run build` first');

  let ctx: BrowserContext;
  let page: Page;
  let loads = 0;
  const code = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8') : '';

  /** Run the bookmarklet if the page has (re)loaded since it was last injected. */
  async function ensureInjected() {
    const present = await page.evaluate(() => !!(window as unknown as { __jefbCompare?: unknown }).__jefbCompare);
    if (!present) await page.evaluate(code);
    await expect(page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]').first()).toBeVisible();
  }

  /** Open the first day's overlay if it is not already open, and wait for all menus to load. */
  async function ensureOverlay() {
    await ensureInjected();
    const overlay = page.locator('#jefb-compare-host');
    if ((await overlay.count()) === 0) {
      await page.locator('li[test-id="days"]').first().locator('[data-jefb-compare-button]').first().click();
    }
    await expect(overlay).toBeAttached();
    await expect(overlay.locator('.status')).not.toContainText('loading', { timeout: 30_000 });
    return overlay;
  }

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 1000 } });
    page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('load', () => {
      loads++;
      console.log(`[live] page load #${loads} at ${new Date().toISOString()} ${page.url()}`);
    });
    page.on('framenavigated', (f) => f === page.mainFrame() && console.log(`[live] navigated ${new Date().toISOString()} ${f.url()}`));
    await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('li[test-id="days"]').first()).toBeVisible({ timeout: 30_000 });
    const consent = page.getByRole('button', { name: 'Accept All' });
    if (await consent.isVisible().catch(() => false)) {
      // CookieYes reloads the page shortly after consent is given; wait that out.
      await consent.click();
      await page.waitForTimeout(6000);
    }
    await expect(page.locator('li[test-id="days"]').first()).toBeVisible();
  });

  test.afterAll(async () => {
    await ctx?.close();
  });

  test('adds a Compare menus button to each upcoming day', async () => {
    await page.evaluate(code);
    const days = page.locator('li[test-id="days"]');
    const n = await days.count();
    expect(n).toBeGreaterThan(0);
    const buttons = page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]');
    await expect(buttons).toHaveCount(n);
  });

  test('running it twice does not duplicate buttons', async () => {
    await ensureInjected();
    await page.evaluate(code);
    const n = await page.locator('li[test-id="days"]').count();
    await expect(page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]')).toHaveCount(n);
  });

  test('opens the comparison overlay with items from every provider, sorted by price desc', async () => {
    await ensureInjected();
    const day = page.locator('li[test-id="days"]').first();
    const vendorCount = await day.locator('[test-id="eaterOption"]').count();
    const soldOut = await day.locator('[test-id="eaterOption"]', { has: page.locator('text=/^\s*Sold out\s*$/') }).count();
    console.log(`[live] ${new Date().toISOString()} vendors=${vendorCount} soldOut=${soldOut}`);
    const expected = vendorCount - soldOut;
    await day.locator('[data-jefb-compare-button]').first().click();

    const overlay = page.locator('#jefb-compare-host');
    await expect(overlay).toBeAttached();
    const status = overlay.locator('.status');
    await expect(status).not.toContainText('loading', { timeout: 30_000 });
    await expect(status).not.toContainText('failed');
    await expect(overlay.locator('header .meta')).toContainText(`${expected} providers`);

    const rows = overlay.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(expected); // several items per provider

    const prices = await overlay.locator('td.price').allTextContents();
    const nums = prices.map((p) => Number(p.replace('£', '')));
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeLessThanOrEqual(nums[i - 1]);

    const vendorsShown = new Set(await overlay.locator('td.vendor a').allTextContents());
    expect(vendorsShown.size).toBe(expected);
    expect(loads, 'page should not have reloaded during the test').toBeLessThanOrEqual(2);
  });

  test('diet filter: inclusive shows vegetarian OR pescatarian, exclusive shows only both', async () => {
    const overlay = await ensureOverlay();
    // Solid tags are listed flags; dashed (.maybe) tags are bundle components that can fit. Both count.
    const tagsOf = async () =>
      overlay.locator('tbody tr td.tags').evaluateAll((tds) => tds.map((td) => [...td.querySelectorAll('span')].map((s) => s.textContent)));

    await overlay.locator('label.chk', { hasText: 'Vegetarian' }).click();
    await overlay.locator('label.chk', { hasText: 'Pescatarian' }).click();
    let tags = await tagsOf();
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t.includes('V') || t.includes('P')).toBe(true);
    expect(tags.some((t) => !t.includes('P'))).toBe(true); // inclusive really is OR: some rows are veg-only

    await overlay.locator('.seg label', { hasText: 'Match all' }).click();
    tags = await tagsOf();
    for (const t of tags) expect(t.includes('V') && t.includes('P')).toBe(true);
  });

  test('search and sort by name work; Escape closes', async () => {
    const overlay = await ensureOverlay();
    await overlay.locator('.seg label', { hasText: 'Match any' }).click();
    for (const d of ['Vegetarian', 'Pescatarian']) {
      const box = overlay.locator('label.chk', { hasText: d }).locator('input');
      if (await box.isChecked()) await box.click();
    }

    await overlay.locator('th', { hasText: 'Item' }).click();
    const names = await overlay.locator('tbody tr .name').evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? ''));
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);

    const word = names.find((n) => /^[a-z]{4,}/i.test(n))!.split(' ')[0];
    await overlay.locator('input.search').fill(word);
    const after = await overlay.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.textContent?.toLowerCase() ?? ''));
    expect(after.length).toBeGreaterThan(0);
    for (const t of after) expect(t).toContain(word.toLowerCase());

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  });
});
