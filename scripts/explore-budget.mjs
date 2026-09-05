// Prints, for every vendor order on the first few days, the cart endpoint's availableBudget and what
// (if anything) has been ordered, to learn how the subsidy is shared across slots and vendors.
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
    lines.push(`CART ${c.requestedDeliveryDate} subsidised=${c.isSubsidisedChoice} singleVendor=${c.enforceSingleVendorChoice}`);
    for (const o of c.eaterOptions) {
      if (o.vendorLocationCapacityStatus === 'SOLD_OUT') continue;
      const r = await fetch(`/api/eaters/me/orders/${o.orderId}/cart`);
      const cart = r.ok ? await r.json() : null;
      const it = cart?.item;
      lines.push(
        `  ${o.vendorName.padEnd(28)} status=${String(o.eaterCartStatus).padEnd(9)} http=${r.status} items=${it?.cartItems?.length ?? '-'} itemsCost=${it?.costBreakdown?.itemsCost?.gross ?? '-'} eaterPays=${it?.eaterCostBreakdown?.totalEaterCost?.gross ?? '-'} availableBudget=${it?.costBreakdown?.availableBudget ?? '-'} eaterAvail=${it?.eaterCostBreakdown?.availableBudget ?? '-'}`,
      );
    }
  }
  return lines.join('\n');
});
console.log(out);
await ctx.close();
