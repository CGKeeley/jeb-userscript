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
    if ((await overlay.locator('table').count()) === 0) await overlay.locator('.seg label', { hasText: 'Table' }).click();
    return overlay;
  }

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 1000 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('load', () => {
      loads++;
      console.log(`[live] page load #${loads} at ${new Date().toISOString()} ${page.url()}`);
    });
    page.on('framenavigated', (f) => f === page.mainFrame() && console.log(`[live] navigated ${new Date().toISOString()} ${f.url()}`));
    await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('li[test-id="days"]').first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      localStorage.removeItem('jefb-compare-view');
      localStorage.removeItem('jefb-compare-filters');
      localStorage.removeItem('jefb-compare-favs');
    });
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
    // Tiles are the default view; the rest of this test reads the table.
    await expect(overlay.locator('.tiles')).toBeVisible();
    await overlay.locator('.seg label', { hasText: 'Table' }).click();

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

  test('tiles view shows one card per item with a large photo, and the sort dropdown works', async () => {
    const overlay = await ensureOverlay();
    const rowCount = await overlay.locator('tbody tr').count();
    await overlay.locator('.seg label', { hasText: 'Tiles' }).click();
    const tiles = overlay.locator('.tile');
    await expect(tiles).toHaveCount(rowCount);
    await expect(overlay.locator('table')).toHaveCount(0);
    const photos = await overlay.locator('.tile img.photo').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
    expect(photos.length).toBeGreaterThan(rowCount / 2);
    for (const src of photos) expect(src).toMatch(/medium-|large-|thumbnail-/);

    await overlay.locator('select.sort').selectOption({ label: 'Price: low to high' });
    const prices = await overlay.locator('.tile .price').allTextContents();
    const nums = prices.map((p) => Number(p.replace('£', '')));
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1]);

    await overlay.locator('.seg label', { hasText: 'Table' }).click();
    await expect(overlay.locator('tbody tr')).toHaveCount(rowCount);
    await expect(overlay.locator('th', { hasText: 'Price' }).locator('.arrow')).toHaveText('▲');
    await overlay.locator('select.sort').selectOption({ label: 'Price: high to low' });
  });

  test('provider checkboxes drop and restore a provider; tiles carry its logo and colour', async () => {
    const overlay = await ensureOverlay();
    // Reset the diet filter left by the previous test.
    await overlay.locator('.seg label', { hasText: 'Match any' }).click();
    for (const d of ['Vegetarian', 'Pescatarian']) {
      const box = overlay.locator('label.chk', { hasText: d }).locator('input');
      if (await box.isChecked()) await box.click();
    }
    await overlay.locator('.seg label', { hasText: 'Tiles' }).click();
    const total = await overlay.locator('.tile').count();
    const first = overlay.locator('label.chk.vendor').first();
    const orderId = (await first.locator('input').getAttribute('data-order-id'))!;
    const ofVendor = await overlay.locator(`.tile[data-order-id="${orderId}"]`).count();
    expect(ofVendor).toBeGreaterThan(0);
    await expect(overlay.locator(`.tile[data-order-id="${orderId}"] .logo`).first()).toBeVisible();
    const colour = await overlay.locator(`.tile[data-order-id="${orderId}"]`).first().evaluate((e) => getComputedStyle(e).borderTopColor);
    const otherColour = await overlay.locator(`.tile:not([data-order-id="${orderId}"])`).first().evaluate((e) => getComputedStyle(e).borderTopColor);
    expect(colour).not.toEqual(otherColour);

    await first.click();
    await expect(overlay.locator('.tile')).toHaveCount(total - ofVendor);
    await expect(overlay.locator(`.tile[data-order-id="${orderId}"]`)).toHaveCount(0);
    await overlay.locator('.group .quick', { hasText: 'none' }).click();
    await expect(overlay.locator('.tile')).toHaveCount(0);
    await overlay.locator('.group .quick', { hasText: 'all' }).click();
    await expect(overlay.locator('.tile')).toHaveCount(total);
    await overlay.locator('.seg label', { hasText: 'Table' }).click();
  });

  test('header shows the day budget with spend and remaining; Copy as Markdown copies grouped details', async () => {
    const overlay = await ensureOverlay();
    const budget = overlay.locator('header .budget');
    await expect(budget).toContainText('Budget £');
    // Monday has confirmed orders in both slots, so spend and remaining must appear.
    const dayHasOrder = (await page.locator('li[test-id="days"]').first().locator('[test-id="clearOrder"]').count()) > 0;
    if (dayHasOrder) {
      await expect(budget).toContainText('remaining');
      const txt = (await budget.textContent())!;
      const nums = [...txt.matchAll(/(-?)£(\d+\.\d\d)/g)].map((m) => Number(m[1] + m[2]));
      expect(nums.length).toBe(3); // budget, spent, remaining
      expect(Math.round((nums[0] - nums[1]) * 100) / 100).toBe(nums[2]);
    }

    await overlay.locator('button.copy').click();
    const md = await page.evaluate(() => navigator.clipboard.readText());
    expect(md.startsWith('# Lunch options · ')).toBe(true);
    expect(md).toContain('## Delivery slot ');
    expect(md).toMatch(/### .+ \(\d+ items/);
    const shown = Number((await overlay.locator('.status').textContent())!.match(/^(\d+) of/)![1]);
    expect((md.match(/^- \*\*/gm) ?? []).length).toBe(shown);
    if (dayHasOrder) expect(md).toMatch(/Remaining: -?£/);
    await expect(page.locator('#jefb-compare-toast .t')).toContainText('Copied');
  });

  test('reopening the comparison via the pill re-fetches carts, so remaining budget can reflect a new order without a page reload', async () => {
    // opts.carts is a snapshot taken when the day list was rendered, so it goes stale once the user
    // confirms an order on a provider page and comes back. We can't actually confirm a real order in a
    // test (never place orders from this profile), so this checks the fix's actual mechanism instead: a
    // fresh GET /api/eaters/me/carts fires every time the overlay is brought back via the pill, which is
    // what lets "remaining" pick up a just-confirmed order.
    const overlay = await ensureOverlay();
    let cartsRequests = 0;
    const onRequest = (req: import('@playwright/test').Request) => {
      if (/\/api\/eaters\/me\/carts\?/.test(req.url())) cartsRequests++;
    };
    page.on('request', onRequest);

    await page.keyboard.press('Escape'); // hide()
    await expect(overlay.locator('.pill')).toBeVisible();
    await overlay.locator('.pill button.primary').click(); // show() -> should trigger a fresh carts fetch
    await expect(overlay.locator('.backdrop')).toBeVisible();
    await expect.poll(() => cartsRequests).toBeGreaterThan(0);

    page.off('request', onRequest);
  });

  test('a day the site has not opened for choosing has a disabled Compare menus button', async () => {
    // The previous test leaves its overlay open, covering the page; close it via its own button (proper
    // teardown) before interacting with the underlying day list.
    const stale = page.locator('#jefb-compare-host');
    if ((await stale.count()) > 0) await stale.locator('button.close').click();
    await ensureInjected();

    // Find this from real page state (the site's own "Order is not open" text on every vendor row for the
    // day), not a guess at which day that will be, so the test stays valid as the account's rolling choice
    // windows move on. Inspecting the real DOM confirmed the lock is atomic per day: either every vendor row
    // shows it or none do, so requiring all of them keeps this to genuinely fully-locked days.
    const days = page.locator('li[test-id="days"]');
    const n = await days.count();
    let lockedDay = null;
    for (let i = 0; i < n; i++) {
      const day = days.nth(i);
      const vendors = await day.locator('[test-id="eaterOption"]').count();
      const locked = await day.locator('[test-id="eaterOption"]', { hasText: /Order is not open/i }).count();
      if (vendors > 0 && vendors === locked) {
        lockedDay = day;
        break;
      }
    }
    test.skip(!lockedDay, 'no fully locked day currently visible on this account');

    const lockedBtn = lockedDay!.locator('[data-jefb-compare-button]').first();
    await expect(lockedBtn).toBeDisabled();
    await expect(lockedBtn).toHaveAttribute('title', /./); // explains why (an open time, or a fallback message)

    // A day known to be open — the first day, which earlier tests already opened successfully — stays enabled.
    await expect(days.first().locator('[data-jefb-compare-button]').first()).toBeEnabled();
  });

  test('type chips, within-budget toggle, favourites and lightbox', async () => {
    const overlay = await ensureOverlay();
    await overlay.locator('.seg label', { hasText: 'Match any' }).click();
    for (const d of ['Vegetarian', 'Pescatarian']) {
      const box = overlay.locator('label.chk', { hasText: d }).locator('input');
      if (await box.isChecked()) await box.click();
    }
    const total = await overlay.locator('tbody tr').count();

    // Type: untick Mains -> fewer rows; all remaining rows are non-mains (we cannot see kind directly, so check counts add up).
    await overlay.locator('label.chk', { hasText: 'Mains' }).click();
    const nonMains = await overlay.locator('tbody tr').count();
    expect(nonMains).toBeLessThan(total);
    await overlay.locator('label.chk', { hasText: 'Mains' }).click();
    for (const k of ['Sides', 'Desserts', 'Other']) await overlay.locator('label.chk', { hasText: k }).click();
    const mains = await overlay.locator('tbody tr').count();
    expect(mains + nonMains).toBe(total);
    for (const k of ['Sides', 'Desserts', 'Other']) await overlay.locator('label.chk', { hasText: k }).click();
    await expect(overlay.locator('tbody tr')).toHaveCount(total);

    // Within budget: every remaining price <= remaining budget (or none if it is used up).
    const budgetTxt = (await overlay.locator('header .budget').textContent())!;
    const money = [...budgetTxt.matchAll(/(-?)£(\d+\.\d\d)/g)].map((m) => Number(m[1] + m[2]));
    const remaining = money[money.length - 1];
    await overlay.locator('label.chk', { hasText: 'Within budget' }).click();
    const prices = (await overlay.locator('td.price').allTextContents()).map((p) => Number(p.replace(/[£-]/g, '')));
    for (const p of prices) expect(p).toBeLessThanOrEqual(remaining);
    if (remaining <= 0) expect(prices).toHaveLength(0);
    await overlay.locator('label.chk', { hasText: 'Within budget' }).click();
    await expect(overlay.locator('tbody tr')).toHaveCount(total);

    // Favourites: star the first row, filter to favourites, see only it, unstar.
    const firstName = (await overlay.locator('tbody tr .name').first().evaluate((e) => e.textContent ?? '')).replace(/[★☆]/g, '').trim();
    await overlay.locator('tbody tr button.star').first().click();
    await expect(overlay.locator('tbody tr button.star').first()).toHaveAttribute('data-fav', '1');
    await overlay.locator('label.chk.fav').click();
    await expect(overlay.locator('tbody tr')).toHaveCount(1);
    expect((await overlay.locator('tbody tr .name').first().textContent())!.replace(/[★☆]/g, '').trim()).toBe(firstName);
    await overlay.locator('tbody tr button.star').first().click();
    await expect(overlay.locator('tbody tr')).toHaveCount(0);
    await overlay.locator('label.chk.fav').click();
    await expect(overlay.locator('tbody tr')).toHaveCount(total);

    // Lightbox: click a thumbnail, Escape closes the lightbox but keeps the overlay.
    await overlay.locator('td.item img.thumb').first().click();
    await expect(overlay.locator('.lightbox img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay.locator('.lightbox')).toHaveCount(0);
    await expect(overlay.locator('.backdrop')).toBeVisible();
  });

  test('filters persist across a fresh run of the bookmarklet', async () => {
    const overlay = await ensureOverlay();
    await overlay.locator('label.chk', { hasText: 'Vegan' }).click();
    await overlay.locator('.seg label', { hasText: 'Match all' }).click();
    await overlay.locator('label.chk', { hasText: 'Desserts' }).click();
    const firstVendor = overlay.locator('label.chk.vendor').first();
    const vendorName = (await firstVendor.textContent())!.trim();
    await firstVendor.click();
    await overlay.locator('input.num').fill('12');
    await overlay.locator('button.close').click();
    await expect(overlay).toHaveCount(0);

    // Simulate a fresh page: reload and run the bookmarklet again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('li[test-id="days"]').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await page.evaluate(code);
    const again = await ensureOverlay();
    await expect(again.locator('label.chk', { hasText: 'Vegan' }).locator('input')).toBeChecked();
    await expect(again.locator('label.chk', { hasText: 'Vegetarian' }).locator('input')).not.toBeChecked();
    await expect(again.locator('.seg label', { hasText: 'Match all' }).locator('input')).toBeChecked();
    await expect(again.locator('label.chk', { hasText: 'Desserts' }).locator('input')).not.toBeChecked();
    await expect(again.locator('label.chk.vendor', { hasText: vendorName }).locator('input')).not.toBeChecked();
    await expect(again.locator('input.num')).toHaveValue('12');
    // Restore defaults for the remaining tests.
    await again.locator('label.chk', { hasText: 'Vegan' }).click();
    await again.locator('.seg label', { hasText: 'Match any' }).click();
    await again.locator('label.chk', { hasText: 'Desserts' }).click();
    await again.locator('label.chk.vendor', { hasText: vendorName }).click();
    await again.locator('input.num').fill('');
  });

  test('max price is scoped to the day it was set on, not shared with other days', async () => {
    const overlay = await ensureOverlay(); // first day
    await overlay.locator('input.num').fill('3');
    await overlay.locator('button.close').click();

    // Find a second, distinct, currently-open day (desktop button only — the mobile clone duplicates it).
    const openDays = page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]:not([disabled])');
    test.skip((await openDays.count()) < 2, 'need at least two open days to check the cap does not leak between them');
    await openDays.nth(1).click();
    const otherOverlay = page.locator('#jefb-compare-host');
    await expect(otherOverlay.locator('.status')).not.toContainText('loading', { timeout: 30_000 });
    if ((await otherOverlay.locator('table').count()) === 0) await otherOverlay.locator('.seg label', { hasText: 'Table' }).click();
    await expect(otherOverlay.locator('input.num')).toHaveValue('');
    await otherOverlay.locator('button.close').click();

    // Reopening the first day still has its own cap.
    const again = await ensureOverlay();
    await expect(again.locator('input.num')).toHaveValue('3');
    await again.locator('input.num').fill('');
  });

  test('search and sort by name work; Escape closes', async () => {
    const overlay = await ensureOverlay();
    await overlay.locator('.seg label', { hasText: 'Match any' }).click();
    for (const d of ['Vegetarian', 'Pescatarian']) {
      const box = overlay.locator('label.chk', { hasText: d }).locator('input');
      if (await box.isChecked()) await box.click();
    }

    await overlay.locator('th', { hasText: 'Item' }).click();
    const names = await overlay.locator('tbody tr .name').evaluateAll((els) =>
      els.map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim()),
    );
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);

    const word = names.find((n) => /^[a-z]{4,}/i.test(n))!.split(' ')[0];
    await overlay.locator('input.search').fill(word);
    const after = await overlay.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.textContent?.toLowerCase() ?? ''));
    expect(after.length).toBeGreaterThan(0);
    for (const t of after) expect(t).toContain(word.toLowerCase());

    // Escape hides (state kept) and shows the pill; the pill's x discards.
    await page.keyboard.press('Escape');
    await expect(overlay.locator('.backdrop')).toBeHidden();
    await expect(overlay.locator('.pill')).toBeVisible();
    await overlay.locator('.pill button.primary').click();
    await expect(overlay.locator('.backdrop')).toBeVisible();
    await expect(overlay.locator('input.search')).toHaveValue(word);
    await overlay.locator('button.close').click();
    await expect(overlay).toHaveCount(0);
  });
});
