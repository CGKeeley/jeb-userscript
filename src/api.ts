// Thin wrappers over the same-origin JSON API the Angular app uses. Cookies are sent automatically.
import type { CartsResponse, Summary } from './types';

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${path}`);
  return (await r.json()) as T;
}

/** Upcoming carts (one per meal slot), each listing the vendors the eater can choose from. */
export function fetchCarts(): Promise<CartsResponse> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return getJson<CartsResponse>(`/api/eaters/me/carts?from=${encodeURIComponent(from.toISOString())}`);
}

/** Full menu for one vendor order (an eaterOption.orderId). Works even before the choice window opens. */
export function fetchSummary(orderId: string): Promise<Summary> {
  return getJson<Summary>(`/api/individual-choice/${encodeURIComponent(orderId)}/summary`);
}
