// Lunch arrivals board on the real site, using the logged-in profile from `npm run login`.
// Requires `npm run build` first. Skipped when no profile exists or nothing is delivering.
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROFILE = path.resolve('auth/profile');
const SCRIPT = path.resolve('dist/bookmarklet.js');
const BASE = 'https://app.business.just-eat.co.uk';

test.describe('Lunch arrivals board', () => {
  test.skip(!fs.existsSync(PROFILE), 'run `npm run login` first');
  test.skip(!fs.existsSync(SCRIPT), 'run `npm run build` first');

  let ctx: BrowserContext;
  let page: Page;
  const code = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8') : '';

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 1000 } });
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('li[test-id="days"]').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500); // the app re-navigates once shortly after load
    await page.evaluate(code);
    await expect(page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]').first()).toBeVisible();
  });

  test.afterAll(async () => {
    await ctx?.close();
  });

  // A test that fails mid-way would leave its board covering the page and break every later click.
  test.afterEach(async () => {
    await page.evaluate(() => document.getElementById('jefb-arrivals-host')?.remove());
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  /** orderHumanIds of every vendor order delivering on the n-th upcoming delivery day, straight from the API. */
  const ordersOnDay = (n: number) =>
    page.evaluate(async (n) => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const carts = await (await fetch(`/api/eaters/me/carts?from=${from.toISOString()}`)).json();
      const live = (carts.items as { isCancelled: boolean; requestedDeliveryDate: string; eaterOptions: { orderHumanId: number }[] }[]).filter((c) => !c.isCancelled);
      const day = [...new Set(live.map((c) => new Date(c.requestedDeliveryDate).toDateString()))][n];
      return live.filter((c) => new Date(c.requestedDeliveryDate).toDateString() === day).flatMap((c) => c.eaterOptions.map((o) => o.orderHumanId));
    }, n);

  const desktopButtons = () => page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-arrivals-button]');

  test('is offered on every upcoming day', async () => {
    await expect(desktopButtons()).toHaveCount(await page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-compare-button]').count());
  });

  test('ahead of the day, lists every restaurant with its requested slot and which day it is', async () => {
    const ids = await ordersOnDay(1);
    test.skip(ids.length === 0, 'only one upcoming delivery day');
    await desktopButtons().nth(1).click();
    const board = page.locator('#jefb-arrivals-host');
    await expect(board.locator('footer')).not.toContainText('Loading', { timeout: 30_000 });
    await expect(board.locator('tr.row')).toHaveCount(ids.length);
    await expect(board.locator('header .summary')).toHaveText(new RegExp(`^${ids.length} deliver(y|ies) (tomorrow|in \\d+ days)$`));
    await expect(board.locator('footer')).toContainText('refreshes every 5 min');
    for (const row of await board.locator('tr.row').all()) await expect(row.locator('.rel')).toHaveText(/^(tomorrow|in \d+ days)$/);
    await page.keyboard.press('Escape');
    await expect(board).toHaveCount(0);
  });

  test('lists every restaurant delivering on the first day with its live status', async () => {
    const ids = await ordersOnDay(0);
    test.skip(ids.length === 0, 'nothing is delivering');
    await desktopButtons().first().click();
    const board = page.locator('#jefb-arrivals-host');
    await expect(board.locator('footer')).not.toContainText('Loading', { timeout: 30_000 });
    await expect(board.locator('footer .err')).toHaveCount(0);
    const rows = board.locator('tr.row');
    await expect(rows).toHaveCount(ids.length);
    expect((await rows.evaluateAll((trs) => trs.map((tr) => Number(tr.getAttribute('data-order-human-id'))))).sort()).toEqual([...ids].sort());
    for (const id of ids) await expect(board.locator('td.order', { hasText: `#${id}` })).toBeVisible();

    // Every row has a time (a window "12:07–12:17" or an arrival "12:09"), a relative time and a status title.
    for (const row of await rows.all()) {
      await expect(row.locator('.t')).toHaveText(/^\d\d:\d\d(–\d\d:\d\d)?$/);
      // The first delivery day is tomorrow or later when nothing is delivering today.
      await expect(row.locator('.rel')).toHaveText(/^(in \d|Due now|\d+ (h|min).* (late|ago)|just now|Requested time|tomorrow)/);
      expect((await row.locator('.pill').textContent())?.trim()).toBeTruthy();
    }
    await expect(board.locator('.clock')).toHaveText(/^\d\d:\d\d\d\d$/);
    await expect(board.locator('footer')).toContainText(/updated (just now|\d+ seconds? ago)|stopped refreshing/);
    await page.keyboard.press('Escape');
    await expect(board).toHaveCount(0);
  });

  test('highlights the eater\'s own orders with what they ordered, re-reading carts when the board opens', async () => {
    const ids = await ordersOnDay(0);
    test.skip(ids.length < 2, 'needs at least two deliveries');
    // After the page (and its carts snapshot) loaded, the eater "orders" from the second restaurant.
    const mineHumanId = ids[1];
    let mineOrderId = '';
    await page.route('**/api/eaters/me/carts?*', async (route) => {
      const json = await (await route.fetch()).json();
      for (const c of json.items) {
        for (const o of c.eaterOptions) {
          const mine = o.orderHumanId === mineHumanId;
          if (mine) mineOrderId = o.orderId;
          Object.assign(o, mine ? { eaterCartStatus: 'confirmed', itemIds: ['a', 'b'], itemNames: ['Falafel wrap', 'Hummus'] } : { eaterCartStatus: null, itemIds: [], itemNames: [] });
        }
      }
      return route.fulfill({ json });
    });
    await page.route('**/api/eaters/me/orders/*/cart', (route) =>
      route.request().url().includes(`/orders/${mineOrderId}/`)
        ? route.fulfill({ json: { item: { cartItems: [{ quantity: 2, item: { name: 'Falafel wrap', price: 6 } }, { quantity: 1, item: { name: 'Hummus', price: 3 } }] } } })
        : route.continue(),
    );
    try {
      await desktopButtons().first().click();
      const board = page.locator('#jefb-arrivals-host');
      await expect(board.locator('footer')).not.toContainText('Loading', { timeout: 30_000 });
      const mine = board.locator('tr.row.mine');
      await expect(mine).toHaveCount(1);
      await expect(mine).toHaveAttribute('data-order-human-id', String(mineHumanId));
      await expect(mine.locator('.you')).toHaveText('Yours');
      await expect(mine.locator('.items')).toHaveText('2× Falafel wrap, Hummus'); // quantities from the cart
      await expect(board.locator('tr.row:not(.mine) .you:visible')).toHaveCount(0);
      const vendor = (await mine.locator('.vname').evaluate((el) => el.firstChild?.textContent ?? '')).split(' - ')[0];
      await expect(board.locator('.yours')).toContainText(`Yours${vendor}`);
      await page.keyboard.press('Escape');
    } finally {
      await page.unroute('**/api/eaters/me/carts?*');
      await page.unroute('**/api/eaters/me/orders/*/cart');
    }
  });

  /**
   * Answer the tracking endpoint ourselves, so polling can be checked whatever the time of day: the first
   * order asked about is on its way, every other one has been delivered (unless `allDelivered`).
   * Returns the order numbers requested, in order.
   */
  async function fakeTracking(allDelivered = false): Promise<string[]> {
    const hits: string[] = [];
    let enRouteId: string | null = null;
    await page.route('**/api/eaters/order-tracking/*', (route) => {
      const id = route.request().url().split('/').pop()!;
      hits.push(id);
      enRouteId ??= allDelivered ? '' : id;
      const enRoute = id === enRouteId;
      const now = Date.now();
      return route.fulfill({
        json: {
          currentStatus: { title: enRoute ? 'On its way to you' : 'Delivered', subtitle: '' },
          upcomingStatuses: enRoute ? [{ title: 'Delivered', subtitle: '' }] : [],
          deliveryWindowStart: new Date(now + 10 * 60_000).toISOString(),
          deliveryWindowEnd: new Date(now + 20 * 60_000).toISOString(),
          lastUpdatedAt: new Date(now).toISOString(),
          completedAt: enRoute ? null : new Date(now - 60_000).toISOString(),
          updateMessage: 'No updates for this order at the moment',
        },
      });
    });
    return hits;
  }

  test('re-checks only what is still to come every 30 s, counting up "updated … ago" between; closing stops it', async () => {
    test.setTimeout(120_000);
    const ids = await ordersOnDay(0);
    test.skip(ids.length < 2, 'needs at least two deliveries');
    const hits = await fakeTracking();
    try {
      await desktopButtons().first().click();
      const board = page.locator('#jefb-arrivals-host');
      const footer = board.locator('footer');
      await expect(footer).toContainText('refreshes every 30 s', { timeout: 30_000 });
      expect(hits).toHaveLength(ids.length);
      const enRouteId = hits[0];
      await expect(board.locator('tr.row[data-timing="arrived"]')).toHaveCount(ids.length - 1);

      await expect(footer).toContainText(/updated \d+ seconds? ago/, { timeout: 5000 });
      const first = await footer.textContent();
      await expect(footer).not.toHaveText(first!, { timeout: 3000 });

      await expect.poll(() => hits.length, { timeout: 35_000 }).toBe(ids.length + 1);
      expect(hits[ids.length]).toBe(enRouteId);
      await expect(footer).toContainText(/updated (just now|\d seconds? ago)/);

      await page.keyboard.press('Escape');
      await expect(board).toHaveCount(0);
      await page.waitForTimeout(32_000);
      expect(hits).toHaveLength(ids.length + 1);
    } finally {
      await page.unroute('**/api/eaters/order-tracking/*');
    }
  });

  test('stops refreshing once everything has arrived', async () => {
    test.setTimeout(90_000);
    const ids = await ordersOnDay(0);
    test.skip(ids.length === 0, 'nothing is delivering');
    const hits = await fakeTracking(true);
    try {
      await desktopButtons().first().click();
      const board = page.locator('#jefb-arrivals-host');
      await expect(board.locator('footer')).toContainText('stopped refreshing', { timeout: 30_000 });
      await expect(board.locator('header .summary')).toHaveText(`All ${ids.length} arrived`);
      await page.waitForTimeout(32_000);
      expect(hits).toHaveLength(ids.length);
      await page.keyboard.press('Escape');
    } finally {
      await page.unroute('**/api/eaters/order-tracking/*');
    }
  });

  test('a failed check shows on its row and in the footer, keeps the last good status, and recovers', async () => {
    const ids = await ordersOnDay(0);
    test.skip(ids.length < 2, 'needs at least two deliveries');
    // First check: order A answers "on its way", order B fails. Second check: A fails, B has been delivered.
    const [a, b] = ids.map(String);
    const calls = new Map<string, number>();
    await page.route('**/api/eaters/order-tracking/*', (route) => {
      const id = route.request().url().split('/').pop()!;
      const n = (calls.get(id) ?? 0) + 1;
      calls.set(id, n);
      const now = Date.now();
      const body = (delivered: boolean) => ({
        currentStatus: { title: delivered ? 'Delivered' : 'On its way to you', subtitle: '' },
        upcomingStatuses: delivered ? [] : [{ title: 'Delivered', subtitle: '' }],
        deliveryWindowStart: new Date(now + 10 * 60_000).toISOString(),
        deliveryWindowEnd: new Date(now + 20 * 60_000).toISOString(),
        lastUpdatedAt: new Date(now).toISOString(),
        completedAt: delivered ? new Date(now).toISOString() : null,
        updateMessage: 'No updates for this order at the moment',
      });
      if ((id === b && n === 1) || (id === a && n === 2)) return route.fulfill({ status: 500, body: 'oops' });
      return route.fulfill({ json: body(id !== a) });
    });
    await desktopButtons().first().click();
    const board = page.locator('#jefb-arrivals-host');
    const row = (id: string) => board.locator(`tr.row[data-order-human-id="${id}"]`);
    await expect(board.locator('footer')).not.toContainText('Loading', { timeout: 30_000 });
    await expect(row(b).locator('.pill')).toHaveText('Not available');
    await expect(row(b).locator('.note.err')).toContainText('Couldn’t load tracking (500');
    await expect(board.locator('footer .err')).toHaveText(`· 1 of ${ids.length} couldn’t be checked`);

    await board.getByRole('button', { name: 'Refresh now' }).click();
    await expect(row(b)).toHaveAttribute('data-timing', 'arrived');
    await expect(row(b).locator('.note')).toBeHidden();
    await expect(row(a).locator('.pill')).toHaveText('On its way to you'); // last good status kept
    await expect(row(a).locator('.note.err')).toContainText('Couldn’t refresh (500');
    await expect(board.locator('footer .err')).toHaveText(`· 1 of ${ids.length} couldn’t be checked`);
  });

  test('opens as a dialog with focus on Close, keeps Tab inside, and hands focus back on Escape', async () => {
    await desktopButtons().first().focus();
    await page.keyboard.press('Enter');
    const board = page.locator('#jefb-arrivals-host');
    await expect(board.getByRole('dialog', { name: /Lunch arrivals/ })).toBeVisible();
    const focused = () => page.evaluate(() => document.getElementById('jefb-arrivals-host')?.shadowRoot?.activeElement?.textContent ?? null);
    await expect.poll(focused).toBe('Close ✕');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await focused()).not.toBeNull(); // still inside the board
    }
    await page.keyboard.press('Escape');
    await expect(board).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-jefb-arrivals-button'))).toBe(true);
  });
});
