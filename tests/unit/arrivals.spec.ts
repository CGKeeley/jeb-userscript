import { expect, test } from '@playwright/test';
import {
  agoText,
  allArrived,
  applyOwnOrders,
  arrivedAt,
  boardEntries,
  boardSummary,
  cartItemLines,
  daysAhead,
  describeTiming,
  IDLE_POLL_MS,
  POLL_MS,
  pollInterval,
  secondsAgoText,
  sortBoard,
  statusKind,
  untilText,
  updateNote,
  yoursSummary,
  type BoardEntry,
} from '../../src/arrivals';
import { fetchTracking } from '../../src/api';
import { formatTime, localDayKey } from '../../src/core';
import type { Cart, CartResponse, CartsResponse, EaterOption, OrderTracking } from '../../src/types';

// Shapes taken from real responses on 2026-10-26.
const enRoute = (start: string, end: string, over: Partial<OrderTracking> = {}): OrderTracking => ({
  currentStatus: { title: 'On its way to you', subtitle: 'Your order is with the driver' },
  upcomingStatuses: [{ title: 'Delivered', subtitle: '' }],
  deliveryWindowStart: start,
  deliveryWindowEnd: end,
  lastUpdatedAt: '2026-10-26T11:50:42+00:00',
  completedAt: null,
  updateMessage: 'No updates for this order at the moment',
  ...over,
});
// What the endpoint returns ahead of the day: no steps listed, the requested slot as the window.
const confirmed = (start: string, end: string): OrderTracking => ({
  currentStatus: { title: 'Order confirmed', subtitle: 'Unfortunately, we cannot provide any tracking information for this order, but we are working on getting your order to you as quickly and safely as possible.' },
  upcomingStatuses: [],
  deliveryWindowStart: start,
  deliveryWindowEnd: end,
  lastUpdatedAt: null,
  completedAt: null,
  updateMessage: 'No updates for this order at the moment',
});
const delivered = (at: string): OrderTracking => ({
  currentStatus: { title: 'Delivered', subtitle: '' },
  upcomingStatuses: [],
  deliveryWindowStart: '2026-10-26T12:00:00+00:00',
  deliveryWindowEnd: '2026-10-26T12:30:00+00:00',
  lastUpdatedAt: at,
  completedAt: at,
  updateMessage: 'No updates for this order at the moment',
});

const entry = (name: string, tracking: OrderTracking | null, over: Partial<BoardEntry> = {}): BoardEntry => ({
  orderId: `o-${name}`,
  orderHumanId: name.length,
  mine: false,
  items: [],
  vendorName: name,
  logo: null,
  requestedAt: '2026-10-26T12:30:00+00:00',
  tracking,
  error: null,
  ...over,
});

const at = (hhmmss: string) => new Date(`2026-10-26T${hhmmss}+00:00`);
// Clock times render in the machine's zone, so expectations go through the same formatter.
const hm = (hhmm: string) => formatTime(`2026-10-26T${hhmm}:00+00:00`);

test.describe('statusKind', () => {
  test('classifies the statuses seen live, and falls back on the number of steps left', () => {
    expect(statusKind(null)).toBe('unknown');
    expect(statusKind(enRoute('2026-10-26T12:00:00Z', '2026-10-26T12:10:00Z'))).toBe('enroute');
    expect(statusKind(delivered('2026-10-26T12:09:16+00:00'))).toBe('delivered');
    const preparing = enRoute('2026-10-26T12:00:00Z', '2026-10-26T12:10:00Z', {
      currentStatus: { title: 'Being prepared', subtitle: '' },
      upcomingStatuses: [{ title: 'On its way to you', subtitle: '' }, { title: 'Delivered', subtitle: '' }],
    });
    expect(statusKind(preparing)).toBe('preparing');
    expect(statusKind({ ...preparing, currentStatus: { title: 'Order cancelled', subtitle: '' } })).toBe('problem');
    expect(statusKind(confirmed('2026-10-27T12:00:00Z', '2026-10-27T12:30:00Z'))).toBe('preparing');
  });

  test('treats a "Delivered" title without completedAt as arrived, at the last update', () => {
    const t = { ...delivered('2026-10-26T12:09:16+00:00'), completedAt: null };
    expect(statusKind(t)).toBe('delivered');
    expect(arrivedAt(t)).toBe('2026-10-26T12:09:16+00:00');
    expect(arrivedAt(enRoute('2026-10-26T12:00:00Z', '2026-10-26T12:10:00Z'))).toBeNull();
  });
});

test.describe('relative times', () => {
  test('rounds future times up and past times down', () => {
    expect(untilText('2026-10-26T12:07:18Z', at('12:04:00'))).toBe('in 4 min');
    expect(untilText('2026-10-26T12:07:18Z', at('12:07:00'))).toBe('in 1 min');
    // Local wall-clock times, so "later today" stays the same day in every zone.
    expect(untilText(new Date(2026, 9, 26, 13, 35).toISOString(), new Date(2026, 9, 26, 12, 30))).toBe('in 1 h 5 min');
    expect(untilText(new Date(2026, 9, 26, 14, 30).toISOString(), new Date(2026, 9, 26, 12, 30))).toBe('in 2 h');
    expect(agoText('2026-10-26T12:09:16Z', at('12:09:50'))).toBe('just now');
    expect(agoText('2026-10-26T11:52:24Z', at('12:10:00'))).toBe('17 min ago');
    expect(secondsAgoText(at('12:10:00').getTime(), at('12:10:00'))).toBe('just now');
    expect(secondsAgoText(at('12:10:00').getTime(), at('12:10:01'))).toBe('1 second ago');
    expect(secondsAgoText(at('12:10:00').getTime(), at('12:10:06'))).toBe('6 seconds ago');
    expect(secondsAgoText(at('12:10:00').getTime(), at('12:12:05'))).toBe('2 min ago');
  });

  test('on a later day, says which day rather than counting down hours', () => {
    expect(untilText('2026-10-27T12:00:00Z', at('12:10:00'))).toBe('tomorrow');
    expect(untilText('2026-10-29T12:00:00Z', at('12:10:00'))).toBe('in 3 days');
    // Calendar days in local time: late tonight is still today, just after midnight is tomorrow.
    expect(daysAhead(new Date(2026, 9, 26, 23, 30).toISOString(), new Date(2026, 9, 26, 0, 30))).toBe(0);
    expect(daysAhead(new Date(2026, 9, 27, 0, 15).toISOString(), new Date(2026, 9, 26, 23, 50))).toBe(1);
  });
});

test.describe('describeTiming', () => {
  const t = enRoute('2026-10-26T12:07:18+00:00', '2026-10-26T12:17:18+00:00');

  test('before the window: shows the window and a countdown to its start', () => {
    expect(describeTiming(entry('A', t), at('12:03:00'))).toEqual({ timing: 'expected', time: `${hm('12:07')}–${hm('12:17')}`, rel: 'in 5 min' });
  });

  test('inside the window: due now; after it: how late', () => {
    expect(describeTiming(entry('A', t), at('12:10:00'))).toMatchObject({ timing: 'due', rel: 'Due now' });
    expect(describeTiming(entry('A', t), at('12:17:18'))).toMatchObject({ timing: 'due' });
    expect(describeTiming(entry('A', t), at('12:17:30'))).toMatchObject({ timing: 'late', rel: '1 min late' });
    expect(describeTiming(entry('A', t), at('12:26:00'))).toMatchObject({ timing: 'late', rel: '9 min late' });
  });

  test('once delivered: the arrival time, not the window (which reverts to the requested slot)', () => {
    expect(describeTiming(entry('A', delivered('2026-10-26T12:09:16+00:00')), at('12:30:00'))).toEqual({ timing: 'arrived', time: hm('12:09'), rel: '20 min ago' });
  });

  test('no tracking yet: falls back to the requested delivery time', () => {
    expect(describeTiming(entry('A', null), at('10:00:00'))).toEqual({ timing: 'scheduled', time: hm('12:30'), rel: 'Requested time' });
  });
});

test.describe('a board opened ahead of the day', () => {
  const entries = [
    entry('Garbanzos', confirmed('2026-10-27T12:30:00+00:00', '2026-10-27T13:00:00+00:00')),
    entry('atis', confirmed('2026-10-27T12:00:00+00:00', '2026-10-27T12:30:00+00:00')),
  ];

  test('rows show the requested slot and the day; the summary counts deliveries', () => {
    expect(describeTiming(entries[1], at('12:10:00'))).toEqual({ timing: 'expected', time: `${hm('12:00')}–${hm('12:30')}`, rel: 'tomorrow' });
    expect(boardSummary(entries, at('12:10:00'))).toBe('2 deliveries tomorrow');
    expect(sortBoard(entries).coming.map((e) => e.vendorName)).toEqual(['atis', 'Garbanzos']);
  });

  test('polls every 5 min until the next delivery is within two hours, then every 30 s', () => {
    expect(pollInterval(entries, at('12:10:00'))).toBe(IDLE_POLL_MS);
    expect(pollInterval(entries, new Date('2026-10-27T09:59:00Z'))).toBe(IDLE_POLL_MS);
    expect(pollInterval(entries, new Date('2026-10-27T10:00:00Z'))).toBe(POLL_MS);
    // Once a delivery is due or late it stays on the fast interval.
    expect(pollInterval(entries, new Date('2026-10-27T12:45:00Z'))).toBe(POLL_MS);
  });
});

test('updateNote hides the stock "no updates" message but shows anything else', () => {
  expect(updateNote(enRoute('2026-10-26T12:00:00Z', '2026-10-26T12:10:00Z'))).toBeNull();
  expect(updateNote(enRoute('2026-10-26T12:00:00Z', '2026-10-26T12:10:00Z', { updateMessage: 'Driver is running 10 minutes late' }))).toBe('Driver is running 10 minutes late');
  expect(updateNote(null)).toBeNull();
});

test.describe('sortBoard and summary', () => {
  const entries = [
    entry('Late one', enRoute('2026-10-26T11:50:00Z', '2026-10-26T12:00:00Z')),
    entry('Honi Poke', enRoute('2026-10-26T12:21:03Z', '2026-10-26T12:31:03Z')),
    entry('LEON', enRoute('2026-10-26T12:07:52Z', '2026-10-26T12:17:52Z')),
    entry('Atcha', delivered('2026-10-26T11:52:24Z')),
    entry('Abokado', delivered('2026-10-26T12:09:16Z')),
    entry('No tracking', null, { requestedAt: '2026-10-26T13:00:00Z' }),
  ];

  test('still to come is soonest first; arrived is most recent first', () => {
    const { coming, arrived } = sortBoard(entries);
    expect(coming.map((e) => e.vendorName)).toEqual(['Late one', 'LEON', 'Honi Poke', 'No tracking']);
    expect(arrived.map((e) => e.vendorName)).toEqual(['Abokado', 'Atcha']);
  });

  test('summary counts arrivals, due and late orders, and the next expected one', () => {
    expect(boardSummary(entries, at('12:10:00'))).toBe('2 of 6 arrived · 1 due now · 1 late · next in 12 min');
    expect(allArrived(entries)).toBe(false);
    const done = [entry('Atcha', delivered('2026-10-26T11:52:24Z'))];
    expect(boardSummary(done, at('12:10:00'))).toBe('All 1 arrived');
    expect(allArrived(done)).toBe(true);
    expect(allArrived([])).toBe(false);
  });
});

test.describe('boardEntries and the eater\'s own orders', () => {
  const opt = (orderHumanId: number, vendorName: string, over: Partial<EaterOption> = {}): EaterOption => ({
    orderId: `o${orderHumanId}`,
    orderHumanId,
    vendorId: `v${orderHumanId}`,
    vendorName,
    vendorLocationName: '',
    vendorLocationCapacityStatus: 'AVAILABLE',
    ...over,
  });
  const cart = (requestedDeliveryDate: string, eaterOptions: EaterOption[], isCancelled = false): Cart => ({
    orderId: requestedDeliveryDate,
    isCancelled,
    requestedDeliveryDate,
    orderDeadline: '',
    choiceOpenTime: '',
    choiceDeadline: '',
    eaterOptions,
    location: { name: 'Office' },
  });
  // Local wall-clock delivery times: fixed UTC instants would land on another local day east of UTC+10.
  const local = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
  const day = localDayKey(local(26, 12, 30));
  // Shapes from the real carts response: a confirmed order carries its item ids and names.
  const yacob = opt(1, "YACOB's - Healthy Lebanese", {
    vendorImage: [{ thumbnail: 'logo.png' }],
    eaterCartStatus: 'confirmed',
    itemIds: ['6a7ee41dd1c75ce11d0a6142'],
    itemNames: ['Lebanese Chicken Shawarma Bowl'],
  });
  const carts: CartsResponse = {
    count: 4,
    items: [
      cart(local(26, 12, 30), [yacob, opt(2, 'Pure', { vendorLocationCapacityStatus: 'SOLD_OUT', eaterCartStatus: null, itemIds: [], itemNames: [] })]),
      cart(local(26, 13, 0), [opt(3, 'LEON')]),
      cart(local(26, 13, 0), [opt(4, 'Cancelled')], true),
      cart(local(27, 12, 30), [opt(5, 'Tomorrow')]),
    ],
  };

  test('lists every vendor order on the day, across slots, skipping cancelled carts', () => {
    const got = boardEntries(carts, day);
    expect(got.map((e) => e.vendorName)).toEqual(["YACOB's - Healthy Lebanese", 'Pure', 'LEON']);
    expect(got[0]).toMatchObject({ orderId: 'o1', orderHumanId: 1, logo: 'logo.png', requestedAt: local(26, 12, 30), tracking: null, error: null });
  });

  test('marks the eater\'s orders with what they ordered', () => {
    const got = boardEntries(carts, day);
    expect(got.map((e) => [e.mine, e.items])).toEqual([
      [true, ['Lebanese Chicken Shawarma Bowl']],
      [false, []],
      [false, []],
    ]);
  });

  test('applyOwnOrders picks up an order placed after the page loaded, and one that was dropped', () => {
    const entries = boardEntries(carts, day);
    // LEON is the eater's per the page's snapshot but absent from the fresh response.
    Object.assign(entries[2], { mine: true, items: ['Rice box'] });
    const fresh: CartsResponse = {
      count: 1,
      items: [cart(local(26, 12, 30), [opt(1, 'YACOB', { itemIds: [], itemNames: [] }), opt(2, 'Pure', { itemIds: ['x'], itemNames: ['Pure Bowl'] })])],
    };
    applyOwnOrders(entries, fresh);
    expect(entries.map((e) => [e.vendorName, e.mine, e.items])).toEqual([
      ["YACOB's - Healthy Lebanese", false, []],
      ['Pure', true, ['Pure Bowl']],
      ['LEON', true, ['Rice box']], // not in the fresh response: left as it was
    ]);
  });

  test('cartItemLines adds a quantity only when more than one', () => {
    const c = { item: { cartItems: [{ quantity: 2, item: { name: 'Falafel wrap', price: 6 } }, { quantity: 1, item: { name: 'Hummus', price: 3 } }] } } as CartResponse;
    expect(cartItemLines(c)).toEqual(['2× Falafel wrap', 'Hummus']);
  });
});

test('yoursSummary says where each of the eater\'s deliveries is, soonest first, then arrivals', () => {
  const entries = [
    entry('Not mine', enRoute('2026-10-26T12:20:00Z', '2026-10-26T12:30:00Z')),
    entry("YACOB's - Healthy Lebanese", enRoute('2026-10-26T12:14:00Z', '2026-10-26T12:24:00Z'), { mine: true }),
    entry('LEON', delivered('2026-10-26T12:09:16Z'), { mine: true }),
    entry('Pure', enRoute('2026-10-26T11:50:00Z', '2026-10-26T12:00:00Z'), { mine: true }),
  ];
  expect(yoursSummary(entries, at('12:10:00'))).toBe(`Pure 10 min late · YACOB's in 4 min · LEON arrived ${hm('12:09')}`);
  expect(yoursSummary([entries[0]], at('12:10:00'))).toBe('');
  expect(yoursSummary([entry('Rice Guys', null, { mine: true })], at('10:00:00'))).toBe(`Rice Guys ${hm('12:30')}`);
});

test.describe('fetchTracking', () => {
  const realFetch = globalThis.fetch;
  test.afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('gives up after the timeout with a readable error, so one hung request can\'t stall the board', async () => {
    // Never answers; only the abort signal ends it.
    globalThis.fetch = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    await expect(fetchTracking(1091423, 50)).rejects.toThrow('timed out');
  });

  test('fills in missing fields, and rejects a body that is not an object', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ currentStatus: { title: 'Order confirmed', subtitle: '' } }))) as typeof fetch;
    expect(await fetchTracking(1)).toEqual({
      currentStatus: { title: 'Order confirmed', subtitle: '' },
      upcomingStatuses: [],
      deliveryWindowStart: null,
      deliveryWindowEnd: null,
      lastUpdatedAt: null,
      completedAt: null,
      updateMessage: null,
    });
    globalThis.fetch = (async () => new Response('null')) as typeof fetch;
    await expect(fetchTracking(1)).rejects.toThrow('unexpected response');
  });
});
