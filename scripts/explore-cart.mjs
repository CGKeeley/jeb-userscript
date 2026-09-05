// Records the API calls the site makes when adding an item to, and removing it from, a basket.
// Uses a Tuesday order (choice open, nothing chosen). Never confirms/places an order.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'https://app.business.just-eat.co.uk';
const OUT = 'auth/cart-explore';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false, viewport: { width: 1400, height: 1000 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const log = [];
let n = 0;
page.on('request', (r) => {
  if (!r.url().startsWith(BASE + '/api/')) return;
  log.push({ t: Date.now(), dir: 'REQ', method: r.method(), url: r.url(), headers: r.headers(), body: r.postData() ?? null });
});
page.on('response', async (r) => {
  if (!r.url().startsWith(BASE + '/api/')) return;
  let body = null;
  try {
    body = await r.text();
  } catch {}
  const name = `${String(++n).padStart(3, '0')}_${r.request().method()}_${r.url().replace(BASE, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 120)}.json`;
  if (body) fs.writeFileSync(`${OUT}/${name}`, body);
  log.push({ t: Date.now(), dir: 'RES', method: r.request().method(), url: r.url(), status: r.status(), file: name });
});
const mark = (m) => {
  log.push({ t: Date.now(), dir: 'MARK', m });
  console.log('---', m);
};

await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
await page.locator('li[test-id="days"]').first().waitFor();

// Pick Tuesday's first cart, first available vendor with nothing chosen.
const carts = await page.evaluate(async () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return (await fetch(`/api/eaters/me/carts?from=${from.toISOString()}`)).json();
});
const tuesday = carts.items.filter((c) => new Date(c.requestedDeliveryDate).getDay() === 2 && !c.isCancelled);
const cart = tuesday[0];
const opt = cart.eaterOptions.find((o) => o.vendorLocationCapacityStatus === 'AVAILABLE' && !(o.itemIds?.length));
console.log('Tuesday cart', cart.requestedDeliveryDate, 'vendor', opt.vendorName, 'order', opt.orderId, 'humanId', opt.orderHumanId);
fs.writeFileSync(`${OUT}/chosen-option.json`, JSON.stringify({ cart: { orderId: cart.orderId, requestedDeliveryDate: cart.requestedDeliveryDate }, opt }, null, 1));

mark('navigate to vendor page');
await page.goto(`${BASE}/my-meals/${opt.orderId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/vendor-page.png`, fullPage: false });
fs.writeFileSync(`${OUT}/vendor-page.html`, await page.content());

// Dump the controls of the first item so we know the selectors.
const controls = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => /increase|add|plus|\+/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '') || /quantity/i.test(b.getAttribute('test-id') ?? ''));
  return btns.slice(0, 8).map((b) => ({ text: b.textContent?.trim(), aria: b.getAttribute('aria-label'), testId: b.getAttribute('test-id'), analyticsid: b.getAttribute('analyticsid'), cls: b.className, disabled: b.disabled }));
});
console.log('candidate buttons', JSON.stringify(controls, null, 1));

// Find the first menu item whose "+" is enabled and click it.
const plus = page.locator('button[test-id="increment"], button[aria-label*="ncrease"], button[analyticsid*="increase"], button[analyticsid*="add-item"]').first();
if ((await plus.count()) === 0) {
  console.log('No plus button found by known selectors; dumping all buttons');
  const all = await page.evaluate(() => [...document.querySelectorAll('button')].slice(0, 60).map((b) => `${b.getAttribute('test-id')}|${b.getAttribute('analyticsid')}|${b.getAttribute('aria-label')}|${b.textContent?.trim().slice(0, 30)}`));
  console.log(all.join('\n'));
} else {
  const itemName = await plus.evaluate((b) => b.closest('[test-id*="item"], li, article, .menu-item, div')?.textContent?.trim().slice(0, 80));
  mark(`click + on: ${itemName}`);
  await plus.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/after-plus.png` });
  fs.writeFileSync(`${OUT}/after-plus.html`, await page.content());

  const minus = page.locator('button[test-id="decrement"], button[aria-label*="ecrease"], button[analyticsid*="decrease"], button[analyticsid*="remove-item"]').first();
  mark('click - to remove');
  if (await minus.count()) {
    await minus.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/after-minus.png` });
  } else {
    console.log('No minus button found');
  }
}
fs.writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1));
console.log(
  log
    .filter((l) => l.dir !== 'RES')
    .map((l) => (l.dir === 'MARK' ? `--- ${l.m}` : `${l.method} ${l.url.replace(BASE, '')} ${l.body ? l.body.slice(0, 300) : ''}`))
    .join('\n'),
);
await ctx.close();
