// Prints the order-tracking response for every vendor order delivering today (or, with --all, on every
// upcoming day), to learn which statuses and
// fields the arrivals board has to handle (including vendors the eater did not order from).
import { chromium } from '@playwright/test';
const BASE = 'https://app.business.just-eat.co.uk';
const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
await page.locator('li[test-id="days"]').first().waitFor();
const all = process.argv.includes('--all');
const out = await page.evaluate(async (all) => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const carts = await (await fetch(`/api/eaters/me/carts?from=${from.toISOString()}`)).json();
  const today = new Date().toDateString();
  const lines = [];
  for (const c of carts.items) {
    if (!all && new Date(c.requestedDeliveryDate).toDateString() !== today) continue;
    for (const o of c.eaterOptions) {
      const r = await fetch(`/api/eaters/order-tracking/${o.orderHumanId}`);
      lines.push(`${c.requestedDeliveryDate} ${o.orderHumanId} ${o.vendorName} http=${r.status} isDelivered=${o.isDelivered} ${await r.text()}`);
    }
  }
  return lines.join('\n');
}, all);
console.log(out);
await ctx.close();
