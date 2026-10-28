// Pure logic for the Lunch arrivals board: which orders are on it, what state each is in relative to "now",
// and how to order them. No DOM access here so it is unit-testable.
import { cartsByDay, formatTime } from './core';
import type { CartResponse, CartsResponse, EaterOption, OrderTracking } from './types';

/** One restaurant delivery on the board. `tracking` is the last good response; `error` the last failure. */
export interface BoardEntry {
  orderId: string;
  orderHumanId: number;
  vendorName: string;
  /** The eater has an order from this restaurant on this day. */
  mine: boolean;
  /** What they ordered, e.g. ["2× Falafel wrap", "Hummus"]; empty when not theirs. */
  items: string[];
  logo: string | null;
  requestedAt: string; // the cart's requested delivery time, only used until tracking gives a window
  tracking: OrderTracking | null;
  error: string | null;
}

/** Every vendor order delivering on `dayKey` (a localDayKey), whether or not the eater ordered from it. */
export function boardEntries(carts: CartsResponse, dayKey: string): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const c of cartsByDay(carts).get(dayKey) ?? []) {
    for (const o of c.eaterOptions) {
      out.push({
        orderId: o.orderId,
        orderHumanId: o.orderHumanId,
        vendorName: o.vendorName,
        ...ownOrder(o),
        logo: o.vendorImage?.[0]?.thumbnail ?? null,
        requestedAt: c.requestedDeliveryDate,
        tracking: null,
        error: null,
      });
    }
  }
  return out;
}

/** Same test the comparison uses for "you already ordered from this provider". */
function ownOrder(o: EaterOption): Pick<BoardEntry, 'mine' | 'items'> {
  const mine = o.eaterCartStatus === 'confirmed' || (o.itemIds?.length ?? 0) > 0;
  return { mine, items: mine ? (o.itemNames ?? []) : [] };
}

/**
 * Re-reads which entries are the eater's from a fresh carts response (the snapshot the page was loaded
 * with goes stale as soon as they order). Entries missing from `carts` are left as they were.
 */
export function applyOwnOrders(entries: BoardEntry[], carts: CartsResponse): void {
  const byHumanId = new Map<number, EaterOption>();
  for (const c of carts.items) for (const o of c.eaterOptions) byHumanId.set(o.orderHumanId, o);
  for (const e of entries) {
    const o = byHumanId.get(e.orderHumanId);
    if (o) Object.assign(e, ownOrder(o));
  }
}

/** Item lines from the eater's cart for one order, with a quantity prefix when more than one. */
export function cartItemLines(cart: CartResponse): string[] {
  return cart.item.cartItems.map((ci) => (ci.quantity > 1 ? `${ci.quantity}× ${ci.item.name}` : ci.item.name));
}

/** What the restaurant says is happening, independent of the clock. */
export type StatusKind = 'delivered' | 'enroute' | 'preparing' | 'problem' | 'unknown';

export function statusKind(t: OrderTracking | null): StatusKind {
  if (!t) return 'unknown';
  const title = t.currentStatus?.title ?? '';
  if (t.completedAt || /^delivered$/i.test(title.trim())) return 'delivered';
  if (/cancel|fail|problem|unable|issue/i.test(title)) return 'problem';
  // Only seen live so far: "On its way to you", with "Delivered" as the sole upcoming step. Earlier steps
  // have more still to come, so the step count is a sturdier signal than matching their wording.
  if (/way|driver|route|transit|collected|picked/i.test(title) || t.upcomingStatuses.length === 1) return 'enroute';
  return 'preparing';
}

/** When it arrived: completedAt, or the last update if the status says delivered but completedAt is missing. */
export function arrivedAt(t: OrderTracking | null): string | null {
  if (!t) return null;
  if (t.completedAt) return t.completedAt;
  return statusKind(t) === 'delivered' ? (t.lastUpdatedAt ?? t.deliveryWindowEnd) : null;
}

/** Where the delivery stands against its window right now. */
export type Timing = 'arrived' | 'expected' | 'due' | 'late' | 'scheduled';

export interface TimingInfo {
  timing: Timing;
  /** "12:07–12:17" while expected, "12:09" once arrived, or the requested time if there is no window yet. */
  time: string;
  /** "in 3 min", "Due now", "4 min late", "18 min ago", "Requested time". */
  rel: string;
}

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const MIN = 60_000;

/** Calendar days from `now` to `iso` in local time: 0 for later today, 1 for tomorrow. */
export function daysAhead(iso: string, now: Date): number {
  const a = new Date(now);
  const b = new Date(iso);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000); // round, not floor: DST days are 23 or 25 h
}

/**
 * "in 3 min" for a future instant later today. Rounds up, so anything still to come reads as at least a
 * minute away. On a later day a countdown is noise, so it reads "tomorrow" or "in 3 days" instead.
 */
export function untilText(iso: string, now: Date): string {
  const days = daysAhead(iso, now);
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return `in ${minutes(Math.max(1, Math.ceil((new Date(iso).getTime() - now.getTime()) / MIN)))}`;
}

/** "6 seconds ago" for the board's last refresh, which is never more than a few minutes old. */
export function secondsAgoText(thenMs: number, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - thenMs) / 1000));
  if (s < 1) return 'just now';
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'} ago`;
  return `${minutes(Math.floor(s / 60))} ago`;
}

/** "18 min ago" for a past instant, "just now" within the first minute. */
export function agoText(iso: string, now: Date): string {
  const m = Math.floor((now.getTime() - new Date(iso).getTime()) / MIN);
  return m < 1 ? 'just now' : `${minutes(m)} ago`;
}

export function describeTiming(e: Pick<BoardEntry, 'tracking' | 'requestedAt'>, now: Date): TimingInfo {
  const t = e.tracking;
  const at = arrivedAt(t);
  if (at) return { timing: 'arrived', time: formatTime(at), rel: agoText(at, now) };
  const start = t?.deliveryWindowStart;
  const end = t?.deliveryWindowEnd ?? start;
  if (!start || !end) return { timing: 'scheduled', time: formatTime(e.requestedAt), rel: 'Requested time' };
  const time = start === end ? formatTime(start) : `${formatTime(start)}–${formatTime(end)}`;
  const n = now.getTime();
  if (n < new Date(start).getTime()) return { timing: 'expected', time, rel: untilText(start, now) };
  if (n <= new Date(end).getTime()) return { timing: 'due', time, rel: 'Due now' };
  return { timing: 'late', time, rel: `${minutes(Math.max(1, Math.ceil((n - new Date(end).getTime()) / MIN)))} late` };
}

/** The site's free-text remark, unless it is the stock "No updates for this order at the moment". */
export function updateNote(t: OrderTracking | null): string | null {
  const m = t?.updateMessage?.trim();
  return m && !/^no updates\b/i.test(m) ? m : null;
}

/** When it should arrive: the start of the tracking window, or the requested time before there is one. */
function expectedIso(e: BoardEntry): string {
  return e.tracking?.deliveryWindowStart ?? e.requestedAt;
}

function expectedAt(e: BoardEntry): number {
  return new Date(expectedIso(e)).getTime();
}

/**
 * Split into what is still to come (soonest first, like a departures board) and what has arrived (most
 * recent first, so the latest arrival is at the top of that section). Ties go by restaurant name.
 */
export function sortBoard(entries: BoardEntry[]): { coming: BoardEntry[]; arrived: BoardEntry[] } {
  const byName = (a: BoardEntry, b: BoardEntry) => a.vendorName.localeCompare(b.vendorName);
  const coming = entries.filter((e) => !arrivedAt(e.tracking)).sort((a, b) => expectedAt(a) - expectedAt(b) || byName(a, b));
  const arrived = entries
    .filter((e) => arrivedAt(e.tracking))
    .sort((a, b) => new Date(arrivedAt(b.tracking)!).getTime() - new Date(arrivedAt(a.tracking)!).getTime() || byName(a, b));
  return { coming, arrived };
}

/**
 * One line for the header, e.g. "5 of 13 arrived · 2 due now · 1 late · next in 4 min", or for a board
 * opened ahead of the day, "13 deliveries tomorrow".
 */
export function boardSummary(entries: BoardEntry[], now: Date): string {
  const timings = entries.map((e) => describeTiming(e, now));
  const count = (t: Timing) => timings.filter((x) => x.timing === t).length;
  const arrived = count('arrived');
  if (entries.length && arrived === entries.length) return `All ${arrived} arrived`;
  const first = sortBoard(entries).coming[0];
  if (first && daysAhead(expectedIso(first), now) > 0) {
    return `${entries.length} ${entries.length === 1 ? 'delivery' : 'deliveries'} ${untilText(expectedIso(first), now)}`;
  }
  const parts = [`${arrived} of ${entries.length} arrived`];
  if (count('due')) parts.push(`${count('due')} due now`);
  if (count('late')) parts.push(`${count('late')} late`);
  const next = sortBoard(entries).coming.find((e) => describeTiming(e, now).timing === 'expected');
  if (next?.tracking?.deliveryWindowStart) parts.push(`next ${untilText(next.tracking.deliveryWindowStart, now)}`);
  return parts.join(' · ');
}

export const POLL_MS = 30_000;
export const IDLE_POLL_MS = 5 * 60_000;
const IDLE_LEAD_MS = 2 * 60 * 60_000;

/**
 * How long to wait before the next check. Statuses only move around delivery time, so while the next
 * delivery is more than two hours off (a board opened for a later day, or first thing in the morning)
 * checking every 30 s would just repeat the same answer for 13-odd orders.
 */
export function pollInterval(entries: BoardEntry[], now: Date): number {
  const first = sortBoard(entries).coming[0];
  return first && expectedAt(first) - now.getTime() > IDLE_LEAD_MS ? IDLE_POLL_MS : POLL_MS;
}

/** For the header: where the eater's own deliveries are, e.g. "YACOB's in 4 min · LEON arrived 12:13". */
export function yoursSummary(entries: BoardEntry[], now: Date): string {
  const { coming, arrived } = sortBoard(entries.filter((e) => e.mine));
  return [...coming, ...arrived]
    .map((e) => {
      const t = describeTiming(e, now);
      const when = t.timing === 'arrived' ? `arrived ${t.time}` : t.timing === 'scheduled' ? t.time : t.rel.charAt(0).toLowerCase() + t.rel.slice(1);
      return `${e.vendorName.split(' - ')[0]} ${when}`;
    })
    .join(' · ');
}

/** Whether polling can stop: every order has arrived, so nothing on the board can change any more. */
export function allArrived(entries: BoardEntry[]): boolean {
  return entries.length > 0 && entries.every((e) => arrivedAt(e.tracking));
}
