// Opens /my-meals with the saved profile, runs the built bookmarklet, opens the first day's Lunch arrivals
// board (or the n-th day's, with --day n) and saves screenshots to auth/preview-arrivals*.png.
// --simulate answers the tracking endpoint with a mid-lunch mix (some arrived, some on their way, one due,
// one late, some still being prepared) instead of the real statuses, makes two of the first day's orders
// the eater's own (one with a quantity), and saves *-simulated.png instead.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://app.business.just-eat.co.uk';
const code = fs.readFileSync('dist/bookmarklet.js', 'utf8');
const simulate = process.argv.includes('--simulate');
const suffix = simulate ? '-simulated' : '';
const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false, viewport: { width: 1400, height: 1000 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());

if (simulate) {
  const MIN = 60_000;
  const status = (title, subtitle = '') => ({ title, subtitle });
  const DELIVERED = status('Delivered');
  const ON_ITS_WAY = status('On its way to you', 'Your order is with the driver');
  // [current status, steps still to come, window start / end and completion in minutes from now, remark]
  const SCENARIOS = [
    [DELIVERED, [], -40, -10, -14],
    [ON_ITS_WAY, [DELIVERED], 4, 14],
    [DELIVERED, [], -35, -5, -6],
    [ON_ITS_WAY, [DELIVERED], -3, 7], // due now
    [status('Being prepared', 'The restaurant is preparing your order'), [ON_ITS_WAY, DELIVERED], 26, 56],
    [DELIVERED, [], -30, 0, -1],
    [ON_ITS_WAY, [DELIVERED], -14, -4, null, 'Your driver is running a little late'], // late
    [ON_ITS_WAY, [DELIVERED], 9, 19],
    [DELIVERED, [], -50, -20, -22],
    [ON_ITS_WAY, [DELIVERED], 12, 22],
    [status('Being prepared', 'The restaurant is preparing your order'), [ON_ITS_WAY, DELIVERED], 31, 61],
    [DELIVERED, [], -33, -3, -3],
    [ON_ITS_WAY, [DELIVERED], 6, 16],
  ];
  // Pretend the eater ordered from the 2nd and 4th restaurants of the first day.
  const MINE = { 1: ['Lebanese Chicken Shawarma Bowl'], 3: ['Pork Belly Bánh Mì', 'Spring Rolls'] };
  const mineIds = new Map();
  await page.route('**/api/eaters/me/carts?*', async (route) => {
    const json = await (await route.fetch()).json();
    const firstDay = new Date(json.items[0].requestedDeliveryDate).toDateString();
    const options = json.items.filter((c) => new Date(c.requestedDeliveryDate).toDateString() === firstDay).flatMap((c) => c.eaterOptions);
    options.forEach((o, i) => {
      const names = MINE[i];
      Object.assign(o, names ? { eaterCartStatus: 'confirmed', itemIds: names.map((_, j) => `sim-${i}-${j}`), itemNames: names } : { eaterCartStatus: null, itemIds: [], itemNames: [] });
      if (names) mineIds.set(o.orderId, names);
    });
    return route.fulfill({ json });
  });
  await page.route('**/api/eaters/me/orders/*/cart', (route) => {
    const names = mineIds.get(route.request().url().split('/').at(-2));
    if (!names) return route.continue();
    return route.fulfill({ json: { item: { cartItems: names.map((name, j) => ({ quantity: j === 1 ? 2 : 1, item: { name, price: 5 } })) } } });
  });
  const assigned = new Map();
  await page.route('**/api/eaters/order-tracking/*', (route) => {
    const id = route.request().url().split('/').pop();
    if (!assigned.has(id)) assigned.set(id, SCENARIOS[assigned.size % SCENARIOS.length]);
    const [currentStatus, upcomingStatuses, start, end, completed = null, remark] = assigned.get(id);
    const at = (m) => new Date(Date.now() + m * MIN).toISOString();
    return route.fulfill({
      json: {
        currentStatus,
        upcomingStatuses,
        deliveryWindowStart: at(start),
        deliveryWindowEnd: at(end),
        lastUpdatedAt: at(completed ?? -1),
        completedAt: completed == null ? null : at(completed),
        updateMessage: remark ?? 'No updates for this order at the moment',
      },
    });
  });
}

await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
await page.locator('li[test-id="days"]').first().waitFor();
await page.waitForTimeout(2500); // the app re-navigates once shortly after load
await page.evaluate(code);
await page.locator('[data-jefb-compare-button]').first().waitFor();
if (!simulate) await page.screenshot({ path: 'auth/preview-arrivals-buttons.png' });
const dayArg = process.argv.indexOf('--day');
const dayIndex = dayArg > 0 ? Number(process.argv[dayArg + 1]) : 0;
await page.locator('.my-meals-list-layout__delivery-date-desktop [data-jefb-arrivals-button]').nth(dayIndex).click();
await page.waitForFunction(() => !document.querySelector('#jefb-arrivals-host')?.shadowRoot?.querySelector('footer')?.textContent?.includes('Loading'));
await page.waitForTimeout(3000); // let "updated … ago" count up
await page.screenshot({ path: `auth/preview-arrivals${suffix}.png` });
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(500);
await page.screenshot({ path: `auth/preview-arrivals${suffix}-narrow.png` });
console.log(`saved ${simulate ? '' : 'auth/preview-arrivals-buttons.png, '}auth/preview-arrivals${suffix}.png and auth/preview-arrivals${suffix}-narrow.png`);
if (process.argv.includes('--keep')) { await new Promise(() => {}); }
await ctx.close();
