// Lunch arrivals board: a live, station-style list of every restaurant delivering to the office today.
// Rendered into a shadow root like the comparison overlay, and shares its palette and h() helper.
import { fetchCart, fetchCarts, fetchTracking } from './api';
import { allArrived, applyOwnOrders, arrivedAt, boardSummary, cartItemLines, describeTiming, pollInterval, secondsAgoText, sortBoard, statusKind, updateNote, yoursSummary, type BoardEntry } from './arrivals';
import { h } from './ui';

export interface BoardOptions {
  dayLabel: string;
  entries: BoardEntry[];
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.backdrop { position: fixed; inset: 0; background: rgba(20,20,30,.55); z-index: 2147483000; display: flex; align-items: flex-start; justify-content: center; padding: 20px 24px; font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2430; }
.panel { background: #fff; border-radius: 10px; width: 100%; max-width: 1100px; max-height: 100%; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.35); font-size: 15px; }
.panel:fullscreen { max-width: none; border-radius: 0; font-size: 21px; }
header { display: flex; align-items: center; gap: 14px; padding: .4em 1em; background: #1f2430; color: #fff; }
header h1 { font-size: 1.15em; margin: 0; font-weight: 700; white-space: nowrap; }
header h1 .day { font-weight: 400; color: #c9ced8; }
header .summary { color: #c9ced8; font-size: .9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yours { padding: .25em 1em; background: #fff4e6; border-left: 6px solid #ff8000; border-bottom: 1px solid #f3dcc0; color: #8a4b00; font-size: .9em; }
.yours b { color: #1f2430; margin-right: .4em; }
header .grow { flex: 1; }
.clock { flex: none; font-size: 1.6em; font-weight: 700; font-variant-numeric: tabular-nums; color: #ff8000; letter-spacing: .02em; }
.clock .sec { font-size: .55em; color: #c9ced8; margin-left: 2px; }
header button { border: 0; background: rgba(255,255,255,.12); color: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 14px; white-space: nowrap; flex: none; }
header button:hover { background: rgba(255,255,255,.22); }
.tablewrap { overflow: auto; flex: 1; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: .25em .7em; border-bottom: 1px solid #eceef2; vertical-align: middle; text-align: left; }
th { position: sticky; top: 0; background: #f4f5f8; white-space: nowrap; font-weight: 600; color: #3a4150; font-size: .75em; text-transform: uppercase; letter-spacing: .04em; z-index: 1; padding-top: .4em; padding-bottom: .4em; }
tr.section td { background: #fafbfc; color: #5a6272; font-weight: 600; font-size: .75em; text-transform: uppercase; letter-spacing: .04em; padding-top: .5em; padding-bottom: .3em; }
tr.row { --accent: #c9ced8; }
tr.row[data-timing="expected"][data-kind="enroute"] { --accent: #0a5bd6; }
tr.row[data-timing="due"] { --accent: #b85c00; }
tr.row[data-timing="late"], tr.row[data-kind="problem"] { --accent: #b3261e; }
tr.row[data-timing="arrived"] { --accent: #1b6b3a; }
td.time { border-left: 6px solid var(--accent); white-space: nowrap; width: 1%; }
.t { font-size: 1.2em; font-weight: 700; font-variant-numeric: tabular-nums; }
td.rel { white-space: nowrap; width: 1%; font-size: .9em; color: #3a4150; font-variant-numeric: tabular-nums; padding-left: 0; }
tr[data-timing="due"] .rel { color: #8a5a00; font-weight: 700; }
tr[data-timing="late"] .rel { color: #b3261e; font-weight: 700; }
tr[data-timing="arrived"] .rel, tr[data-timing="scheduled"] .rel { color: #5a6272; }
tr[data-timing="arrived"] .t, tr[data-timing="arrived"] .vname { color: #3a4150; }
td.from .v { display: flex; align-items: center; gap: .6em; }
.logo { width: 1.7em; height: 1.7em; flex: none; border-radius: 50%; object-fit: cover; background: #fff; border: 1px solid #d7dbe3; }
.logo.text { display: flex; align-items: center; justify-content: center; font-size: .7em; font-weight: 700; color: #fff; background: #5a6272; border: 0; }
.vname { font-weight: 600; }
.vname .num { display: none; margin-left: .4em; color: #5a6272; font-weight: 400; font-size: .85em; }
/* The eater's own orders: tinted row, a Yours tag and what they ordered. */
tr.row.mine td { background: #fff4e6; }
.you { display: inline-block; margin-left: .5em; padding: 0 .45em; border-radius: 4px; background: #b85c00; color: #fff; font-size: .72em; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; vertical-align: .1em; }
.items { margin-left: .5em; color: #8a4b00; font-weight: 400; font-size: .87em; }
td.order { white-space: nowrap; width: 1%; color: #5a6272; font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
td.status { width: 35%; }
.pill { display: inline-flex; align-items: center; gap: .45em; padding: .05em .65em; border-radius: 999px; font-weight: 600; font-size: .92em; white-space: nowrap; background: #eef0f4; color: #3a4150; }
.pill::before { content: ''; width: .55em; height: .55em; border-radius: 50%; background: currentColor; flex: none; }
.pill[data-kind="delivered"] { background: #e2f5e9; color: #1b6b3a; }
.pill[data-kind="delivered"]::before { content: '\\2713'; width: auto; height: auto; background: none; font-weight: 700; }
.pill[data-kind="enroute"] { background: #e3edfb; color: #0a4aa8; }
.pill[data-kind="enroute"]::before { animation: pulse 1.6s ease-in-out infinite; }
.pill[data-kind="problem"] { background: #fde3e1; color: #8c1d18; }
.pill[data-kind="problem"]::before { content: '!'; width: auto; height: auto; background: none; font-weight: 800; }
.pill[data-kind="unknown"] { background: #fff; border: 1px dashed #c9ced8; color: #5a6272; }
.note { display: inline; font-size: .8em; color: #8a5a00; margin-left: .6em; }
.note.err { color: #b3261e; }
tr.flash td { animation: flash 2.5s ease-out; }
footer { display: flex; align-items: center; gap: 10px; padding: 5px 16px; border-top: 1px solid #e4e6eb; background: #fafbfc; color: #5a6272; font-size: 13px; }
footer .live { width: 8px; height: 8px; border-radius: 50%; background: #1b6b3a; animation: pulse 1.6s ease-in-out infinite; }
footer .live.off { background: #c9ced8; animation: none; }
footer .err { color: #b3261e; }
footer button { border: 0; background: #eef0f4; border-radius: 6px; padding: 2px 10px; cursor: pointer; font: inherit; }
footer button:hover { background: #dfe3ea; }
footer .grow { flex: 1; }
.empty { padding: 40px; text-align: center; color: #5a6272; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@keyframes flash { from { background: #ffe2c2; } }
@media (prefers-reduced-motion: reduce) { .pill::before, footer .live, tr.flash td { animation: none !important; } }
@media (max-width: 720px) {
  .backdrop { padding: 0; }
  .panel { border-radius: 0; }
  header { flex-wrap: wrap; }
  th.order, td.order { display: none; }
  .vname .num { display: inline; }
  /* Each row becomes two lines: time over countdown on the left, restaurant over status on the right. */
  thead { display: none; }
  tr.row { display: grid; grid-template-columns: auto 1fr; border-bottom: 1px solid #eceef2; border-left: 6px solid var(--accent); }
  tr.row td { border-bottom: 0; padding: .2em .6em; width: auto; }
  td.time { grid-area: 1 / 1; border-left: 0; }
  td.rel { grid-area: 2 / 1; padding-left: .6em; }
  td.from { grid-area: 1 / 2; }
  td.status { grid-area: 2 / 2; }
  tr.section { display: block; }
  tr.section td { display: block; }
}
`;

interface RowView {
  tr: HTMLTableRowElement;
  time: HTMLElement;
  rel: HTMLElement;
  pill: HTMLElement;
  note: HTMLElement;
  you: HTMLElement;
  items: HTMLElement;
  title: string | null; // last status title shown, to flash the row when it changes
}

const pad = (n: number) => String(n).padStart(2, '0');
const everyText = (ms: number) => (ms < 60_000 ? `${ms / 1000} s` : `${ms / 60_000} min`);

let closeCurrent: (() => void) | null = null;

export function openBoard(opts: BoardOptions): HTMLElement {
  closeCurrent?.();
  const host = h('div', { id: 'jefb-arrivals-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = h('style');
  style.textContent = CSS;
  shadow.append(style);

  const entries = opts.entries;
  let loaded = false;
  let lastPoll = 0;
  let polling = false;
  let pollTimer: number | undefined;
  let pollMs = 0; // the interval the pending timer was set with, shown in the footer

  // Header: title, live summary, clock.
  const summary = h('span', { class: 'summary' });
  // Where the eater's own deliveries are, in a strip under the header tinted like their rows.
  const yoursText = h('span');
  const yours = h('div', { class: 'yours' }, h('b', {}, 'Yours'), yoursText);
  yours.hidden = true;
  const clockMain = h('span');
  const clockSec = h('span', { class: 'sec' });
  const clock = h('span', { class: 'clock', title: 'Current time' }, clockMain, clockSec);
  const fsBtn = h('button', { type: 'button', title: 'Show the board full screen, e.g. on a shared office display' }, 'Full screen');
  fsBtn.addEventListener('click', () => {
    if (shadow.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void panel.requestFullscreen().catch(() => undefined);
  });
  const closeBtn = h('button', { type: 'button', title: 'Close the board (Esc)' }, 'Close ✕');
  closeBtn.addEventListener('click', () => close());
  const header = h('header', {}, h('h1', { id: 'jefb-arrivals-title' }, 'Lunch arrivals ', h('span', { class: 'day' }, `· ${opts.dayLabel}`)), summary, h('span', { class: 'grow' }), clock, fsBtn, closeBtn);

  const tbody = h('tbody');
  const table = h(
    'table',
    {},
    h('thead', {}, h('tr', {}, h('th', { colspan: '2' }, 'Time'), h('th', {}, 'From'), h('th', { class: 'order' }, 'Order'), h('th', {}, 'Status'))),
    tbody,
  );
  const wrap = h('div', { class: 'tablewrap' }, table);

  const live = h('span', { class: 'live off' });
  const footStatus = h('span');
  const refreshBtn = h('button', { type: 'button', title: 'Check every order now' }, 'Refresh now');
  refreshBtn.addEventListener('click', () => void poll());
  const footer = h('footer', {}, live, footStatus, h('span', { class: 'grow' }), refreshBtn);

  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'jefb-arrivals-title' }, header, yours, wrap, footer);
  // Element fullscreen is missing on iPhone Safari, where the button would do nothing.
  fsBtn.hidden = !document.fullscreenEnabled || typeof panel.requestFullscreen !== 'function';
  const backdrop = h('div', { class: 'backdrop' }, panel);
  shadow.append(backdrop);

  const comingHead = h('tr', { class: 'section' }, h('td', { colspan: '5' }));
  const arrivedHead = h('tr', { class: 'section' }, h('td', { colspan: '5' }));

  const views = new Map<number, RowView>();
  function viewFor(e: BoardEntry): RowView {
    let v = views.get(e.orderHumanId);
    if (v) return v;
    const time = h('td', { class: 'time t' });
    const rel = h('td', { class: 'rel' });
    const pill = h('span', { class: 'pill' });
    const note = h('span', { class: 'note' });
    const logo = e.logo ? h('img', { class: 'logo', src: e.logo, alt: '' }) : h('div', { class: 'logo text' }, e.vendorName.slice(0, 2).toUpperCase());
    const num = `#${e.orderHumanId}`;
    const you = h('span', { class: 'you' }, 'Yours');
    const items = h('span', { class: 'items' });
    const tr = h(
      'tr',
      { class: 'row', 'data-order-human-id': String(e.orderHumanId) },
      time,
      rel,
      h('td', { class: 'from' }, h('div', { class: 'v' }, logo, h('div', { class: 'vname' }, e.vendorName, you, items, h('span', { class: 'num' }, num)))),
      h('td', { class: 'order', title: 'Order number' }, num),
      h('td', { class: 'status' }, pill, note),
    );
    tr.addEventListener('animationend', () => tr.classList.remove('flash'));
    v = { tr, time, rel, pill, note, you, items, title: null };
    views.set(e.orderHumanId, v);
    return v;
  }

  /** Clock-dependent parts of a row; cheap enough to run every second. */
  function updateTiming(e: BoardEntry, v: RowView, now: Date): void {
    const t = describeTiming(e, now);
    v.tr.dataset.timing = t.timing;
    v.time.textContent = t.time;
    v.rel.textContent = t.rel;
  }

  /** The Yours tag and order lines; change when the eater's carts are re-read. */
  function updateMine(e: BoardEntry, v: RowView): void {
    v.tr.classList.toggle('mine', e.mine);
    v.you.hidden = !e.mine;
    v.items.textContent = e.items.join(', ');
    v.items.hidden = !e.mine || e.items.length === 0;
  }

  /** Status parts of a row; only change when a poll comes back. */
  function updateStatus(e: BoardEntry, v: RowView): void {
    const kind = statusKind(e.tracking);
    v.tr.dataset.kind = kind;
    v.pill.dataset.kind = kind;
    const title = e.tracking?.currentStatus?.title ?? (e.error ? 'Not available' : loaded ? 'No status yet' : 'Checking…');
    v.pill.textContent = title;
    v.pill.title = e.tracking?.currentStatus?.subtitle || '';
    if (v.title !== null && v.title !== title) {
      v.tr.classList.remove('flash');
      void v.tr.offsetWidth; // restart the animation if it is still running
      v.tr.classList.add('flash');
    }
    if (e.tracking || e.error) v.title = title;
    const remark = updateNote(e.tracking);
    v.note.className = `note${e.error ? ' err' : ''}`;
    v.note.textContent = e.error ? (e.tracking ? `Couldn’t refresh (${e.error}); showing the last known status` : `Couldn’t load tracking (${e.error})`) : (remark ?? '');
    v.note.hidden = !v.note.textContent;
  }

  function tick(): void {
    const now = new Date();
    clockMain.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    clockSec.textContent = pad(now.getSeconds());
    summary.textContent = loaded && entries.length ? boardSummary(entries, now) : '';
    yoursText.textContent = loaded ? yoursSummary(entries, now) : '';
    yours.hidden = !yoursText.textContent;
    for (const e of entries) updateTiming(e, viewFor(e), now);
    speedUpIfDue(now);
    updateFooter(now);
  }

  function updateFooter(now: Date): void {
    const failed = entries.filter((e) => e.error).length;
    const done = allArrived(entries) || entries.length === 0;
    live.className = `live${loaded && !done ? '' : ' off'}`;
    footStatus.replaceChildren(
      !loaded
        ? `Loading… ${entries.filter((e) => e.tracking || e.error).length} of ${entries.length}`
        : entries.length === 0
          ? 'Nothing to track.'
          : done
            ? 'Everything has arrived, so the board has stopped refreshing.'
            : `Live · updated ${secondsAgoText(lastPoll, now)} · refreshes every ${everyText(pollMs || pollInterval(entries, now))}`,
    );
    if (failed) footStatus.append(' ', h('span', { class: 'err' }, `· ${failed} of ${entries.length} couldn’t be checked`));
    refreshBtn.hidden = done;
  }

  function render(): void {
    const { coming, arrived } = sortBoard(entries);
    (comingHead.firstChild as HTMLElement).textContent = `Expected · ${coming.length}`;
    (arrivedHead.firstChild as HTMLElement).textContent = `Arrived · ${arrived.length}`;
    const rows: HTMLTableRowElement[] = [];
    if (coming.length) rows.push(comingHead, ...coming.map((e) => viewFor(e).tr));
    if (arrived.length) rows.push(arrivedHead, ...arrived.map((e) => viewFor(e).tr));
    // Existing row nodes are moved rather than rebuilt, so logos don't reload and flashes keep running.
    tbody.replaceChildren(...rows);
    for (const e of entries) {
      updateStatus(e, viewFor(e));
      updateMine(e, viewFor(e));
    }
    tick();
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    window.clearTimeout(pollTimer);
    // Arrived orders are final, so only the rest are re-checked.
    const targets = loaded ? entries.filter((e) => !arrivedAt(e.tracking)) : entries;
    try {
      await pollTargets(targets);
    } finally {
      // Whatever went wrong above, never leave the board stuck "polling" with no timer set.
      polling = false;
      loaded = true;
      lastPoll = Date.now();
    }
    if (!host.isConnected) return;
    render();
    schedule();
  }

  function pollTargets(targets: BoardEntry[]): Promise<unknown> {
    return Promise.all(
      targets.map((e) =>
        fetchTracking(e.orderHumanId)
          .then((t) => {
            e.tracking = t;
            e.error = null;
          })
          .catch((err: unknown) => {
            e.error = (err as Error).message ?? String(err);
          })
          // Fill rows in as answers arrive rather than holding the whole board for the slowest one.
          .finally(() => host.isConnected && render()),
      ),
    );
  }

  /**
   * The carts the board was opened with are the snapshot from when the page loaded, so re-read them in
   * case the eater has ordered since; then read each of their carts for quantities. Failures keep what the
   * snapshot said.
   */
  async function refreshOwnOrders(): Promise<void> {
    try {
      applyOwnOrders(entries, await fetchCarts());
    } catch {
      /* keep the snapshot */
    }
    await Promise.all(
      entries
        .filter((e) => e.mine)
        .map((e) =>
          fetchCart(e.orderId)
            .then((c) => {
              const lines = cartItemLines(c);
              if (lines.length) e.items = lines;
            })
            .catch(() => undefined),
        ),
    );
    if (host.isConnected) render();
  }

  // Polling pauses while the tab is hidden and catches up as soon as it is visible again.
  function schedule(ms = pollInterval(entries, new Date()), delay = ms): void {
    window.clearTimeout(pollTimer);
    if (entries.length === 0 || allArrived(entries)) return;
    pollMs = ms;
    pollTimer = window.setTimeout(() => {
      if (!document.hidden) void poll();
    }, delay);
  }

  /**
   * A 5-minute wait set while the next delivery was more than two hours off would otherwise run its course
   * after crossing that mark; switch to the faster interval as soon as it applies.
   */
  function speedUpIfDue(now: Date): void {
    if (!loaded || polling || !pollMs) return;
    const ms = pollInterval(entries, now);
    if (ms < pollMs) schedule(ms, Math.max(0, lastPoll + ms - now.getTime()));
  }
  const onVisibility = () => {
    if (!document.hidden && loaded && !allArrived(entries) && Date.now() - lastPoll >= pollInterval(entries, new Date())) void poll();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !shadow.fullscreenElement) close();
    if (e.key === 'Tab') {
      // Keep keyboard focus inside the board, which covers the page.
      const focusable = [fsBtn, closeBtn, refreshBtn].filter((b) => !b.hidden);
      const i = focusable.indexOf(shadow.activeElement as HTMLButtonElement);
      e.preventDefault();
      focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
    }
  };
  const onFullscreen = () => {
    fsBtn.textContent = shadow.fullscreenElement ? 'Exit full screen' : 'Full screen';
  };
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFullscreen);
  const ticker = window.setInterval(tick, 1000);

  function close(): void {
    window.clearInterval(ticker);
    window.clearTimeout(pollTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFullscreen);
    if (shadow.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    host.remove();
    closeCurrent = null;
    if (opener?.isConnected) opener.focus();
  }
  closeCurrent = close;

  if (entries.length === 0) wrap.replaceChildren(h('div', { class: 'empty' }, 'No deliveries on this day.'));
  render();
  // Move focus into the board, and give it back to whatever opened it (the day's button) on close.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(host);
  closeBtn.focus();
  void poll();
  void refreshOwnOrders();
  return host;
}
