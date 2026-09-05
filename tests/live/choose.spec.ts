// Choose flow on a Tuesday order: overlay -> provider page -> item quantity 1 -> back to 0.
// A route handler aborts every non-GET request to the app, so an order can never be placed by this test.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROFILE = path.resolve('auth/profile');
const SCRIPT = path.resolve('dist/bookmarklet.js');
const BASE = 'https://app.business.just-eat.co.uk';

test.describe('Choose an item from the comparison (Tuesday)', () => {
  test.skip(!fs.existsSync(PROFILE), 'run `npm run login` first');
  test.skip(!fs.existsSync(SCRIPT), 'run `npm run build` first');

  let ctx: BrowserContext;
  let page: Page;
  const blockedWrites: string[] = [];
  const code = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8') : '';

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 1000 } });
    await ctx.route(`${BASE}/**`, (route) => {
      const r = route.request();
      if (r.method() !== 'GET' && !r.url().includes('/cdn-cgi/')) {
        blockedWrites.push(`${r.method()} ${r.url()}`);
        return route.abort('failed');
      }
      return route.continue();
    });
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('li[test-id="days"]').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500); // the app re-navigates once shortly after load
    await page.evaluate(() => localStorage.removeItem('jefb-compare-filters'));
  });

  test.afterAll(async () => {
    await ctx?.close();
  });

  test('Choose opens the provider in-app, adds the item, and never writes to the server', async () => {
    await page.evaluate(code);
    const tuesday = page.locator('li[test-id="days"]', { has: page.locator('[test-id="deliveryDayOfWeek"]', { hasText: 'Tuesday' }) }).first();
    await expect(tuesday).toBeVisible();
    await tuesday.locator('[data-jefb-compare-button]').first().click();

    const overlay = page.locator('#jefb-compare-host');
    await expect(overlay.locator('.status')).not.toContainText('loading', { timeout: 30_000 });
    await overlay.locator('.seg label', { hasText: 'Table' }).click();

    // Set a filter so we can check it survives the round trip.
    await overlay.locator('label.chk', { hasText: 'Pescatarian' }).click();
    const shownBefore = await overlay.locator('.status').textContent();

    // Pick a plain item from a provider that is open for choice (has an Add/Choose button on the list).
    // Skip vendors already ordered from: their list entry has Clear Order instead of Add, so Choose falls back to a full navigation.
    const choose = overlay.locator('button.choose[data-type="SingleItem"][data-vendor-chosen="0"]:not([disabled])').first();
    const itemId = (await choose.getAttribute('data-item-id'))!;
    const orderId = (await choose.getAttribute('data-order-id'))!;
    const row = overlay.locator(`tbody tr[data-item-id="${itemId}"]`).first();
    const itemName = (await row.locator('.name').evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('')))!.trim();
    const vendor = (await row.locator('td.vendor a').textContent())!.trim();
    console.log(`[choose] ${itemName} from ${vendor} (order ${orderId})`);
    await choose.click();

    // Hidden, not destroyed: pill visible, backdrop hidden.
    await expect(overlay.locator('.backdrop')).toBeHidden();
    await expect(overlay.locator('.pill')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/my-meals/${orderId}$`), { timeout: 20_000 });
    const itemEl = page.locator(`[test-id="root"][data-item-id="${itemId}"]`).first();
    await expect(itemEl).toBeVisible({ timeout: 20_000 });
    await expect(itemEl.locator('input[test-id="quantityInput"]')).toHaveValue('1', { timeout: 10_000 });
    await expect(page.locator('#jefb-compare-toast')).toBeAttached();
    // Depending on how much of today's budget is left, the site shows Confirm Choice (subsidised) or Pay (card).
    // Either way we never press it.
    const confirmOrPay = page.locator('button[test-id="submitButton"], button[test-id="payButton"]');
    await expect(confirmOrPay.first()).toBeVisible();
    const isPay = (await page.locator('button[test-id="payButton"]').count()) > 0;
    await expect(page.locator('#jefb-compare-toast .t')).toContainText(isPay ? 'card payment' : 'Confirm Choice');
    expect(blockedWrites, 'no write request should have been attempted').toEqual([]);

    // Undo: press - so the basket is empty again.
    await itemEl.locator('button[test-id="decrement"]').click();
    await expect(itemEl.locator('input[test-id="quantityInput"]')).toHaveValue('0');

    const cart = await page.evaluate(async (id) => (await fetch(`/api/eaters/me/orders/${id}/cart`)).json(), orderId);
    expect(cart.item.cartItems).toEqual([]);

    // Bring the comparison back from the provider page: filter and counts intact.
    await overlay.locator('.pill button.primary').click();
    await expect(overlay.locator('.backdrop')).toBeVisible();
    await expect(overlay.locator('label.chk', { hasText: 'Pescatarian' }).locator('input')).toBeChecked();
    await expect(overlay.locator('.status')).toHaveText(shownBefore!);

    // Choose from a different provider while still on this provider's page: goes back to the list in-app first.
    const other = overlay.locator(`button.choose[data-type="SingleItem"][data-vendor-chosen="0"]:not([disabled]):not([data-order-id="${orderId}"])`).first();
    const otherItem = (await other.getAttribute('data-item-id'))!;
    const otherOrder = (await other.getAttribute('data-order-id'))!;
    await other.click();
    await expect(page).toHaveURL(new RegExp(`/my-meals/${otherOrder}$`), { timeout: 25_000 });
    const otherEl = page.locator(`[test-id="root"][data-item-id="${otherItem}"]`).first();
    await expect(otherEl.locator('input[test-id="quantityInput"]')).toHaveValue('1', { timeout: 20_000 });
    await otherEl.locator('button[test-id="decrement"]').click();
    await expect(otherEl.locator('input[test-id="quantityInput"]')).toHaveValue('0');
    expect(blockedWrites).toEqual([]);
  });

  test('going back to the list re-adds the Compare buttons without re-running the bookmarklet', async () => {
    for (let i = 0; i < 3 && !/\/my-meals$/.test(page.url()); i++) await page.goBack();
    await expect(page).toHaveURL(/\/my-meals$/);
    await expect(page.locator('[data-jefb-compare-button]').first()).toBeVisible({ timeout: 10_000 });
    expect(blockedWrites).toEqual([]);
  });
});
