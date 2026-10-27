// Thin wrappers over the same-origin JSON API the Angular app uses. Cookies are sent automatically.
import type { CartResponse, CartsResponse, OrderTracking, Summary } from './types';

async function getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${path}`);
  return (await r.json()) as T;
}

/** Upcoming carts (one per meal slot), each listing the vendors the eater can choose from. */
export function fetchCarts(): Promise<CartsResponse> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return getJson<CartsResponse>(`/api/eaters/me/carts?from=${encodeURIComponent(from.toISOString())}`);
}

/** The eater's confirmed cart for one vendor order: what was chosen and what it cost. */
export function fetchCart(orderId: string): Promise<CartResponse> {
  return getJson<CartResponse>(`/api/eaters/me/orders/${encodeURIComponent(orderId)}/cart`);
}

/** Full menu for one vendor order (an eaterOption.orderId). Works even before the choice window opens. */
export function fetchSummary(orderId: string): Promise<Summary> {
  return getJson<Summary>(`/api/individual-choice/${encodeURIComponent(orderId)}/summary`);
}

/**
 * Live delivery status for one vendor order, by its human order number. Polled, so never served from
 * cache, and given up on after `timeoutMs` so one hung request can't stall the board.
 */
export async function fetchTracking(orderHumanId: number, timeoutMs = 15_000): Promise<OrderTracking> {
  let t: Partial<OrderTracking> | null;
  try {
    t = await getJson<Partial<OrderTracking> | null>(`/api/eaters/order-tracking/${orderHumanId}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw (e as Error).name === 'TimeoutError' ? new Error('timed out') : e;
  }
  if (!t || typeof t !== 'object') throw new Error('unexpected response');
  // Fill gaps so an unexpected shape can't break the board's maths for every row.
  return {
    currentStatus: t.currentStatus ?? null,
    upcomingStatuses: Array.isArray(t.upcomingStatuses) ? t.upcomingStatuses : [],
    deliveryWindowStart: t.deliveryWindowStart ?? null,
    deliveryWindowEnd: t.deliveryWindowEnd ?? null,
    lastUpdatedAt: t.lastUpdatedAt ?? null,
    completedAt: t.completedAt ?? null,
    updateMessage: t.updateMessage ?? null,
  };
}
