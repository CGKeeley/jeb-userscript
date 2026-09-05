// "Choose" flow: navigate inside the Angular app to the provider's page and press + on the chosen item.
// Nothing is sent to the server until the user clicks the site's own Confirm Choice button, which is the
// actual order (it PUTs /api/eaters/me/orders/<orderId>/cart). We deliberately never call that ourselves.
import type { Row } from './types';

const HIGHLIGHT_CSS = 'outline: 3px solid #ff8000; outline-offset: 4px; border-radius: 8px; transition: outline-color 1s;';

export function toast(message: string, ms = 9000): void {
  document.querySelector('#jefb-compare-toast')?.remove();
  const host = document.createElement('div');
  host.id = 'jefb-compare-toast';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .t { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483001; background: #1f2430; color: #fff;
         padding: 12px 18px; border-radius: 10px; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.35); max-width: 90vw; display: flex; gap: 14px; align-items: center; }
    button { border: 0; background: #ff8000; color: #fff; border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; }
  `;
  const box = document.createElement('div');
  box.className = 't';
  box.textContent = message;
  const close = document.createElement('button');
  close.textContent = 'OK';
  close.addEventListener('click', () => host.remove());
  box.append(close);
  shadow.append(style, box);
  document.body.append(host);
  window.setTimeout(() => host.remove(), ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number, every = 150): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

/** Find the site's Add / Choose button for this vendor order on the /my-meals list. */
function findVendorButton(orderHumanId: number): HTMLElement | null {
  for (const opt of document.querySelectorAll('[test-id="eaterOption"]')) {
    const idText = opt.querySelector('[test-id="orderHumanId"]')?.textContent ?? '';
    if (!new RegExp(`\\b${orderHumanId}\\b`).test(idText)) continue;
    const btn = opt.querySelector<HTMLElement>('button[test-id="confirmedAddOrder"], button[analyticsid="add-order-button"], button[analyticsid*="choose"], .meal-card-layout__option-action button');
    return btn;
  }
  return null;
}

function currentQuantity(itemEl: Element): number {
  const input = itemEl.querySelector<HTMLInputElement>('input[test-id="quantityInput"]');
  const n = input ? Number(input.value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export async function chooseItem(row: Row): Promise<void> {
  const targetPath = `/my-meals/${row.orderId}`;
  if (!location.pathname.endsWith(targetPath)) {
    let btn = findVendorButton(row.orderHumanId);
    if (!btn && /\/my-meals\/[^/]+$/.test(location.pathname)) {
      // On another provider's page: step back to the list inside the app, then pick from there.
      history.back();
      await waitFor(() => document.querySelector('[test-id="eaterOption"]'), 10000);
      btn = findVendorButton(row.orderHumanId);
    }
    if (btn && !(btn as HTMLButtonElement).disabled) {
      btn.click(); // in-app navigation, our script keeps running
    } else {
      // Not choosable from the list (choice not open yet, or already chosen elsewhere): plain navigation.
      sessionStorage.setItem('jefb-compare-pending', JSON.stringify({ orderId: row.orderId, itemId: row.itemId, name: row.name }));
      location.href = targetPath;
      return;
    }
  }
  toast(`Opening ${row.vendorName}…`, 20000);
  const itemEl = await waitFor(() => (location.pathname.endsWith(targetPath) ? document.querySelector<HTMLElement>(`[data-item-id="${row.itemId}"]`) : null), 20000);
  if (!itemEl) {
    toast(`Could not find "${row.name}" on the ${row.vendorName} page. It may be in a hidden section or sold out.`);
    return;
  }
  await finishChoose(itemEl, row.name, row.type);
}

/** Scroll to the item, press + once if it is a simple item, and tell the user what to do next. */
export async function finishChoose(itemEl: HTMLElement, name: string, type: Row['type']): Promise<void> {
  itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = itemEl.getAttribute('style') ?? '';
  itemEl.setAttribute('style', `${prev};${HIGHLIGHT_CSS}`);
  window.setTimeout(() => itemEl.setAttribute('style', prev), 6000);
  await sleep(400);

  const plus = itemEl.querySelector<HTMLButtonElement>('button[test-id="increment"]');
  if (type === 'SingleItem' && plus && !plus.disabled) {
    if (currentQuantity(itemEl) === 0) plus.click();
    await sleep(300);
    toast(`"${name}" is in your basket. Review it on the right and click Confirm Choice to order.`, 12000);
  } else {
    toast(`Pick the options for "${name}", add it, then click Confirm Choice to order.`, 12000);
  }
}

/** After a full-page navigation fallback, resume the choose flow if the bookmarklet is run again. */
export async function resumePendingChoose(): Promise<boolean> {
  const raw = sessionStorage.getItem('jefb-compare-pending');
  if (!raw) return false;
  sessionStorage.removeItem('jefb-compare-pending');
  try {
    const p = JSON.parse(raw) as { orderId: string; itemId: string; name: string };
    if (!location.pathname.endsWith(`/my-meals/${p.orderId}`)) return false;
    const el = await waitFor(() => document.querySelector<HTMLElement>(`[data-item-id="${p.itemId}"]`), 15000);
    if (el) await finishChoose(el, p.name, 'SingleItem');
    return true;
  } catch {
    return false;
  }
}
