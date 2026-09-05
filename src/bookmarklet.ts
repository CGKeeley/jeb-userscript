// Entry point. Adds a "Compare menus" button to each day on /my-meals and opens the comparison overlay.
import { fetchCarts } from './api';
import { cartsByDay } from './core';
import type { Cart, CartsResponse } from './types';
import { openOverlay } from './ui';

const HOST = 'app.business.just-eat.co.uk';
const MARK = 'data-jefb-compare';

interface State {
  carts: Promise<CartsResponse>;
  observer: MutationObserver | null;
}

declare global {
  interface Window {
    __jefbCompare?: State;
  }
}

function main(): void {
  if (location.hostname !== HOST) {
    location.href = `https://${HOST}/my-meals`;
    return;
  }
  if (window.__jefbCompare) {
    // Already installed: refresh the carts and re-inject buttons.
    window.__jefbCompare.carts = fetchCarts();
    void inject(window.__jefbCompare);
    return;
  }
  const state: State = { carts: fetchCarts(), observer: null };
  window.__jefbCompare = state;
  void inject(state);

  let timer: number | undefined;
  state.observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void inject(state), 300);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });
}

function orderIdsIn(el: Element): number[] {
  const ids: number[] = [];
  for (const span of el.querySelectorAll('[test-id="orderHumanId"]')) {
    const m = /(\d+)/.exec(span.textContent ?? '');
    if (m) ids.push(Number(m[1]));
  }
  return ids;
}

/** Map each orderHumanId inside a day to the "12:00 - 12:30" delivery window shown on its card. */
function slotLabelsIn(dayEl: Element): Map<number, string> {
  const out = new Map<number, string>();
  for (const card of dayEl.querySelectorAll('[test-id="mealCard"]')) {
    const win = card.querySelector('[test-id="deliveryWindow"]')?.getAttribute('title')?.trim() ?? card.querySelector('[test-id="deliveryWindow"]')?.textContent?.trim() ?? '';
    for (const id of orderIdsIn(card)) out.set(id, win);
  }
  return out;
}

let injecting = false;
let injectAgain = false;

async function inject(state: State): Promise<void> {
  // Serialise: the observer can fire while we are still awaiting the carts, and two overlapping runs
  // would both see the same unmarked days and add duplicate buttons.
  if (injecting) {
    injectAgain = true;
    return;
  }
  injecting = true;
  try {
    await injectOnce(state);
  } finally {
    injecting = false;
    if (injectAgain) {
      injectAgain = false;
      void inject(state);
    }
  }
}

async function injectOnce(state: State): Promise<void> {
  if (!document.querySelector(`li[test-id="days"]:not([${MARK}])`)) return;
  let carts: CartsResponse;
  try {
    carts = await state.carts;
  } catch (e) {
    console.warn('[jefb-compare] could not load carts', e);
    return;
  }
  // Query after the await so days marked by a previous run are excluded.
  const days = document.querySelectorAll(`li[test-id="days"]:not([${MARK}])`);
  const byOrderId = new Map<number, Cart>();
  for (const c of carts.items) for (const o of c.eaterOptions) byOrderId.set(o.orderHumanId, c);
  const byDay = cartsByDay(carts);

  for (const day of days) {
    day.setAttribute(MARK, '1');
    const ids = orderIdsIn(day);
    const dayCarts = new Set<Cart>();
    for (const id of ids) {
      const c = byOrderId.get(id);
      if (c) dayCarts.add(c);
    }
    // Fall back to all carts on the same local day as the ones we matched (covers cards not yet rendered).
    if (dayCarts.size) {
      const first = [...dayCarts][0];
      const key = [...byDay.entries()].find(([, cs]) => cs.includes(first))?.[0];
      if (key) for (const c of byDay.get(key)!) dayCarts.add(c);
    }
    if (dayCarts.size === 0) continue; // e.g. previous meals with no upcoming cart

    const dateText = day.querySelector('[test-id="deliveryDate"]')?.textContent?.trim() ?? '';
    const dowText = day.querySelector('[test-id="deliveryDayOfWeek"]')?.textContent?.trim() ?? '';
    const label = [dowText, dateText].filter(Boolean).join(' ');
    const slotLabels = slotLabelsIn(day);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Compare menus';
    btn.className = 'button button--secondary';
    btn.setAttribute('data-jefb-compare-button', '1');
    btn.style.cssText = 'margin-top:8px;padding:6px 10px;font-size:12px;white-space:nowrap;cursor:pointer;';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOverlay({ dayLabel: label, carts: [...dayCarts], slotLabels: slotLabelsIn(day) });
    });

    const desktop = day.querySelector('.my-meals-list-layout__delivery-date-desktop');
    const mobile = day.querySelector('[test-id="mobileDeliveryDate"]');
    if (desktop) desktop.append(btn);
    if (mobile) mobile.append(btn.cloneNode(true) as HTMLButtonElement);
    // cloneNode drops listeners; re-wire the mobile copy.
    mobile?.querySelector('[data-jefb-compare-button]')?.addEventListener('click', (e) => {
      e.preventDefault();
      openOverlay({ dayLabel: label, carts: [...dayCarts], slotLabels });
    });
    if (!desktop && !mobile) day.prepend(btn);
  }
}

main();
