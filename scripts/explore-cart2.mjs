// Adds one item to the on-page basket, dumps browser storage, then clicks Confirm Choice while
// ABORTING every non-GET request to the app so nothing is actually ordered. Records what would be sent.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'https://app.business.just-eat.co.uk';
const OUT = 'auth/cart-explore2';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const { opt } = JSON.parse(fs.readFileSync('auth/cart-explore/chosen-option.json', 'utf8'));

const ctx = await chromium.launchPersistentContext('auth/profile', { headless: false, viewport: { width: 1400, height: 1000 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const blocked = [];
// Safety net: from now on, no write request reaches the server.
await ctx.route(`${BASE}/**`, (route) => {
  const r = route.request();
  if (r.method() !== 'GET' && !r.url().includes('/cdn-cgi/')) {
    blocked.push({ method: r.method(), url: r.url(), headers: r.headers(), body: r.postData() });
    console.log('BLOCKED', r.method(), r.url().replace(BASE, ''), (r.postData() ?? '').slice(0, 500));
    return route.abort('failed');
  }
  return route.continue();
});

await page.goto(`${BASE}/my-meals/${opt.orderId}`, { waitUntil: 'domcontentloaded' });
await page.locator('button[test-id="increment"]').first().waitFor();
await page.waitForTimeout(1500);

const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
await page.locator('button[test-id="increment"]').first().click();
await page.waitForTimeout(1500);
const storageAfter = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
const changed = {};
for (const kind of ['local', 'session']) {
  for (const k of new Set([...Object.keys(storageBefore[kind]), ...Object.keys(storageAfter[kind])])) {
    if (storageBefore[kind][k] !== storageAfter[kind][k]) changed[`${kind}:${k}`] = { before: storageBefore[kind][k]?.slice(0, 300), after: storageAfter[kind][k]?.slice(0, 1500) };
  }
}
console.log('storage keys (local):', Object.keys(storageAfter.local).join(', '));
console.log('storage keys (session):', Object.keys(storageAfter.session).join(', '));
console.log('changed by adding an item:', JSON.stringify(changed, null, 1));
fs.writeFileSync(`${OUT}/storage-after.json`, JSON.stringify(storageAfter, null, 1));

// Also: does the URL carry basket state?
console.log('URL after add:', page.url());

// Click Confirm Choice with writes blocked.
const submit = page.locator('button[test-id="submitButton"]');
console.log('submit enabled:', await submit.isEnabled());
await submit.click();
await page.waitForTimeout(2500);
// An in-page confirmation dialog may appear.
const ok = page.locator('button[test-id="confirmButton"]:visible');
if (await ok.count()) {
  console.log('dialog text:', (await page.locator('[role="dialog"], .dialog, mat-dialog-container').first().textContent().catch(() => ''))?.trim().slice(0, 400));
  await ok.first().click();
  await page.waitForTimeout(3000);
}
await page.screenshot({ path: `${OUT}/after-confirm-blocked.png` });
fs.writeFileSync(`${OUT}/blocked.json`, JSON.stringify(blocked, null, 1));
console.log('blocked requests:', blocked.length);

// Verify nothing was persisted: reload the cart from the server.
const cart = await page.evaluate(async (id) => (await fetch(`/api/eaters/me/orders/${id}/cart`)).json(), opt.orderId);
console.log('server cartItems after test:', JSON.stringify(cart.item?.cartItems));
await ctx.close();
