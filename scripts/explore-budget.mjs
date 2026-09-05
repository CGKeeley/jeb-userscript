// Prints budget-related fields per cart / vendor order so we can show remaining budget correctly.
import { chromium } from '@playwright/test';
const BASE = 'https://app.business.just-eat.co.uk';
const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/my-meals`, { waitUntil: 'domcontentloaded' });
await page.locator('li[test-id="days"]').first().waitFor();
const out = await page.evaluate(async () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const carts = await (await fetch(`/api/eaters/me/carts?from=${from.toISOString()}`)).json();
  const lines = [];
  for (const c of carts.items.slice(0, 4)) {
    lines.push(`CART ${c.requestedDeliveryDate} group=${c.orderId} subsidised=${c.isSubsidisedChoice}`);
    for (const o of c.eaterOptions) {
      const s = await (await fetch(`/api/individual-choice/${o.orderId}/summary`)).json().catch(() => null);
      const ic = s?.item?.individualChoice ?? {};
      let cartInfo = '';
      if (o.itemIds?.length || o.eaterCartStatus) {
        const cart = await (await fetch(`/api/eaters/me/orders/${o.orderId}/cart`)).json().catch(() => null);
        const it = cart?.item;
        cartInfo = ` CART: items=${JSON.stringify(it?.cartItems?.map((x) => ({ item: x.item ?? x.itemId ?? x.id, qty: x.quantity, type: x.type })))} itemsCost=${JSON.stringify(it?.costBreakdown?.itemsCost?.gross)} eaterTotal=${JSON.stringify(it?.eaterCostBreakdown?.totalEaterCost?.gross)} availableBudget=${it?.costBreakdown?.availableBudget} keys=${Object.keys(it ?? {}).join(',')}`;
      }
      lines.push(`  ${o.vendorName} status=${JSON.stringify(o.eaterCartStatus)} topUp=${JSON.stringify(o.topUpValue)} items=${JSON.stringify(o.itemNames)} | summary budget=${ic.budget} advanced=${ic.advancedBudgeting} hidden=${s?.item?.useHiddenBudget} keys=${Object.keys(ic).join(',')}${cartInfo}`);
    }
  }
  return lines.join('\n');
});
console.log(out);
await ctx.close();
