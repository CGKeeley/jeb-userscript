// Comparison overlay. Rendered into a shadow root so the host page's CSS cannot interfere.
import { fetchCart, fetchSummary } from './api';
import {
  applyFilter,
  defaultFilter,
  DIET_KEYS,
  DIET_LABELS,
  DIET_SHORT,
  flattenSummary,
  formatPrice,
  remainingBudget,
  sortRows,
  toMarkdown,
  vendorColor,
  DIET_LABELS as DL,
  type Spend,
  type FilterState,
  type SortKey,
  type SortState,
} from './core';
import { chooseItem, toast } from './choose';
import type { Cart, EaterOption, Row } from './types';

export interface OverlayOptions {
  dayLabel: string;
  carts: Cart[];
  /** orderHumanId -> delivery window label, e.g. "12:00 - 12:30". */
  slotLabels: Map<number, string>;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.backdrop { position: fixed; inset: 0; background: rgba(20,20,30,.55); z-index: 2147483000; display: flex; align-items: stretch; justify-content: center; padding: 20px 24px; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2430; }
.panel { background: #fff; border-radius: 10px; width: 100%; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
header { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-bottom: 1px solid #e4e6eb; background: #fafbfc; }
header h1 { font-size: 18px; margin: 0; font-weight: 700; }
header .meta { color: #5a6272; font-size: 13px; }
header .budget { font-size: 13px; color: #1f2430; background: #f1f3f6; border-radius: 6px; padding: 4px 10px; }
header .budget b { font-weight: 700; }
header .budget b.neg { color: #b3261e; }
header .budget b.pos { color: #1b6b3a; }
button.copy { border: 0; background: #eef0f4; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
button.copy:hover { background: #dfe3ea; }
header .grow { flex: 1; }
button.close { border: 0; background: #eef0f4; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
button.minimise { border: 0; background: #eef0f4; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
button.minimise:hover, button.close:hover { background: #dfe3ea; }
.pill { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; display: flex; align-items: center; gap: 6px; background: #1f2430; color: #fff; border-radius: 999px; padding: 8px 8px 8px 16px; font: 14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.35); }
.pill button { border: 0; background: transparent; color: #fff; cursor: pointer; font: inherit; padding: 4px 8px; border-radius: 999px; }
.pill button.primary { background: #ff8000; font-weight: 600; }
.pill button:hover { background: rgba(255,255,255,.15); }
.pill button.primary:hover { background: #e67300; }
[hidden] { display: none !important; }
button.close:hover { background: #dfe3ea; }
.controls { display: flex; flex-wrap: wrap; gap: 10px 18px; padding: 10px 18px; border-bottom: 1px solid #e4e6eb; align-items: center; }
.group { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.group .title { font-weight: 600; color: #3a4150; margin-right: 2px; }
label.chk { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; padding: 3px 8px; border: 1px solid #d7dbe3; border-radius: 999px; user-select: none; background: #fff; }
label.chk:has(input:checked) { background: #ff8000; border-color: #ff8000; color: #fff; }
label.chk input { margin: 0; }
.seg { display: inline-flex; border: 1px solid #d7dbe3; border-radius: 6px; overflow: hidden; }
.seg label { padding: 3px 10px; cursor: pointer; user-select: none; }
.seg label:has(input:checked) { background: #1f2430; color: #fff; }
.seg input { display: none; }
input.search { padding: 5px 9px; border: 1px solid #d7dbe3; border-radius: 6px; min-width: 220px; font: inherit; }
input.num { padding: 5px 7px; border: 1px solid #d7dbe3; border-radius: 6px; width: 80px; font: inherit; }
.status { color: #5a6272; font-size: 13px; }
.status .err { color: #b3261e; }
.tablewrap { overflow: auto; flex: 1; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 8px 10px; border-bottom: 1px solid #eceef2; vertical-align: top; text-align: left; }
th { position: sticky; top: 0; background: #f4f5f8; cursor: pointer; user-select: none; white-space: nowrap; font-weight: 600; color: #3a4150; z-index: 1; }
th:hover { background: #e9ebf0; }
th .arrow { opacity: .5; font-size: 11px; margin-left: 4px; }
tr:hover td { background: #fffaf3; }
td.item { min-width: 320px; }
.name { font-weight: 600; }
.desc { color: #5a6272; font-size: 12.5px; margin-top: 2px; }
.thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; float: left; margin-right: 10px; background: #eee; }
td.price { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
td.price.over { color: #b3261e; }
td.kcal { text-align: right; white-space: nowrap; color: #5a6272; }
.vendor a { color: #0a5bd6; text-decoration: none; font-weight: 600; }
.vendor a:hover { text-decoration: underline; }
.slot { display: block; font-size: 12px; color: #5a6272; }
.badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 4px; vertical-align: middle; }
.badge.warn { background: #fff1d6; color: #8a5a00; }
.badge.bad { background: #fde3e1; color: #8c1d18; }
.badge.ok { background: #e2f5e9; color: #1b6b3a; }
.badge.type { background: #eef0f4; color: #3a4150; }
.tags span { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: #e2f5e9; color: #1b6b3a; margin: 1px 3px 1px 0; }
.tags span.maybe { background: #fff; border: 1px dashed #1b6b3a; }
.allergens { font-size: 11px; color: #8a5a00; margin-top: 3px; }
.empty { padding: 40px; text-align: center; color: #5a6272; }
button.choose { border: 0; background: #ff8000; color: #fff; border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
button.choose:hover { background: #e67300; }
button.choose:disabled { background: #d7dbe3; cursor: default; }
td.act { text-align: right; }
.tile .act { display: flex; justify-content: flex-end; }
select.sort { padding: 5px 7px; border: 1px solid #d7dbe3; border-radius: 6px; font: inherit; background: #fff; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; padding: 14px 18px; }
.tile { position: relative; border: 1px solid #e4e6eb; border-top: 5px solid var(--vc, #e4e6eb); border-radius: 10px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
.tile .logo { position: absolute; right: 10px; bottom: 10px; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #fff; border: 3px solid var(--vc, #ccc); box-shadow: 0 2px 8px rgba(0,0,0,.2); }
.tile .logo.text { display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; background: var(--vc, #999); }
.tile .vendor a { color: var(--vc, #0a5bd6); }
.tile .act { padding-right: 52px; }
tr[data-order-id] td.item { border-left: 5px solid var(--vc, transparent); }
.vlogo { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; vertical-align: -4px; margin-right: 4px; border: 1px solid #d7dbe3; background: #fff; }
label.chk.vendor { border-color: var(--vc); }
label.chk.vendor:has(input:checked) { background: var(--vc); border-color: var(--vc); color: #fff; }
.group .quick { color: #0a5bd6; cursor: pointer; font-size: 12.5px; text-decoration: underline; }
.tile:hover { box-shadow: 0 4px 16px rgba(0,0,0,.12); }
.tile .photo { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #f0f1f4; display: block; }
.tile .nophoto { width: 100%; aspect-ratio: 4 / 3; background: #f0f1f4; display: flex; align-items: center; justify-content: center; color: #9aa1ae; font-size: 12px; }
.tile .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
.tile .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.tile .price { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tile .price.over { color: #b3261e; }
.tile .desc { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tile .vendor { margin-top: auto; padding-top: 6px; font-size: 12.5px; }
.tile .kcal { color: #5a6272; font-size: 12px; }
`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, cls = 'chk', title = ''): HTMLLabelElement {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: cls, title }, input, label);
}

function radioGroup<T extends string>(name: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLSpanElement {
  const seg = h('span', { class: 'seg' });
  for (const [val, label] of options) {
    const input = h('input', { type: 'radio', name });
    input.checked = val === value;
    input.addEventListener('change', () => input.checked && onChange(val));
    seg.append(h('label', {}, input, label));
  }
  return seg;
}

export function openOverlay(opts: OverlayOptions): HTMLElement {
  document.querySelector('#jefb-compare-host')?.remove();
  const host = h('div', { id: 'jefb-compare-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = h('style');
  style.textContent = CSS;
  shadow.append(style);

  const options: { option: EaterOption; slot: string; color: string }[] = [];
  const soldOutVendors: string[] = [];
  for (const cart of opts.carts) {
    for (const o of cart.eaterOptions) {
      // The menu endpoint answers 409 for sold-out vendors, and you cannot order from them anyway.
      if (o.vendorLocationCapacityStatus === 'SOLD_OUT') {
        soldOutVendors.push(o.vendorName);
        continue;
      }
      const slot = opts.slotLabels.get(o.orderHumanId) ?? new Date(cart.requestedDeliveryDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      options.push({ option: o, slot, color: vendorColor(options.length) });
    }
  }
  const slotNames = [...new Set(options.map((o) => o.slot))];

  const state = {
    rows: [] as Row[],
    filter: defaultFilter() as FilterState,
    sort: { key: 'price', dir: 'desc' } as SortState,
    loaded: 0,
    errors: [] as string[],
    budget: null as number | null,
    spent: [] as Spend[],
    remaining: null as number | null,
    view: (safeGet('jefb-compare-view') === 'table' ? 'table' : 'tiles') as 'table' | 'tiles',
  };

  const close = () => {
    host.remove();
    document.removeEventListener('keydown', onKey);
  };
  // Hide keeps the overlay (rows, filters, view, scroll) in memory and shows a pill to bring it back.
  const hide = () => {
    backdrop.hidden = true;
    pill.hidden = false;
  };
  const show = () => {
    backdrop.hidden = false;
    pill.hidden = true;
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !backdrop.hidden) hide();
  };
  document.addEventListener('keydown', onKey);

  const backdrop = h('div', { class: 'backdrop' });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hide();
  });
  const panel = h('div', { class: 'panel' });
  backdrop.append(panel);
  const pillOpen = h('button', { class: 'primary', type: 'button', title: 'Reopen the comparison with your filters intact' }, 'Back to comparison');
  pillOpen.addEventListener('click', show);
  const pillClose = h('button', { type: 'button', title: 'Discard the comparison' }, '\u2715');
  pillClose.addEventListener('click', close);
  const pill = h('div', { class: 'pill' }, `${opts.dayLabel}`, pillOpen, pillClose);
  pill.hidden = true;
  shadow.append(backdrop, pill);

  // Header
  const meta = h('span', { class: 'meta' });
  const budgetEl = h('span', { class: 'budget' });
  const copyBtn = h('button', { class: 'copy', type: 'button', title: 'Copy the items currently shown as Markdown, grouped by slot and provider, e.g. to paste into an LLM' }, 'Copy as Markdown');
  copyBtn.addEventListener('click', () => void copyMarkdown());
  const closeBtn = h('button', { class: 'close', type: 'button', title: 'Discard the comparison' }, 'Close ✕');
  closeBtn.addEventListener('click', close);
  const minBtn = h('button', { class: 'minimise', type: 'button', title: 'Hide the comparison; a button at the bottom right brings it back' }, 'Minimise \u2013');
  minBtn.addEventListener('click', hide);
  const viewToggle = radioGroup<'table' | 'tiles'>('view', [['table', 'Table'], ['tiles', 'Tiles']], state.view, (v) => {
    state.view = v;
    safeSet('jefb-compare-view', v);
    render();
  });
  panel.append(h('header', {}, h('h1', {}, `Compare menus · ${opts.dayLabel}`), budgetEl, meta, h('span', { class: 'grow' }), copyBtn, viewToggle, minBtn, closeBtn));

  // Controls
  const controls = h('div', { class: 'controls' });
  panel.append(controls);

  const dietGroup = h('div', { class: 'group' }, h('span', { class: 'title' }, 'Diet'));
  for (const k of DIET_KEYS) {
    dietGroup.append(
      checkbox(DIET_LABELS[k], false, (v) => {
        if (v) state.filter.diets.add(k);
        else state.filter.diets.delete(k);
        render();
      }),
    );
  }
  dietGroup.append(
    radioGroup('mode', [['any', 'Match any (inclusive)'], ['all', 'Match all (exclusive)']], state.filter.mode, (v) => {
      state.filter.mode = v;
      render();
    }),
  );
  controls.append(dietGroup);

  // Provider checkboxes: all on by default; unticking removes that provider (OR across the ticked ones).
  state.filter.vendors = new Set(options.map((o) => o.option.orderId));
  const vendorGroup = h('div', { class: 'group' }, h('span', { class: 'title' }, 'Providers'));
  const vendorBoxes: HTMLInputElement[] = [];
  for (const { option: o, color } of options) {
    const input = h('input', { type: 'checkbox', 'data-order-id': o.orderId });
    input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) state.filter.vendors!.add(o.orderId);
      else state.filter.vendors!.delete(o.orderId);
      render();
    });
    vendorBoxes.push(input);
    const label = h('label', { class: 'chk vendor', style: `--vc:${color}`, title: `${o.vendorName}${o.vendorLocationName ? ' \u00b7 ' + o.vendorLocationName : ''}` }, input);
    const logo = o.vendorImage?.[0]?.thumbnail;
    if (logo) label.append(h('img', { class: 'vlogo', src: logo, alt: '' }));
    label.append(o.vendorName.split(' - ')[0]);
    vendorGroup.append(label);
  }
  const setAll = (on: boolean) => {
    for (const b of vendorBoxes) b.checked = on;
    state.filter.vendors = new Set(on ? options.map((o) => o.option.orderId) : []);
    render();
  };
  const allLink = h('span', { class: 'quick' }, 'all');
  allLink.addEventListener('click', () => setAll(true));
  const noneLink = h('span', { class: 'quick' }, 'none');
  noneLink.addEventListener('click', () => setAll(false));
  vendorGroup.append(allLink, noneLink);
  controls.append(vendorGroup);

  if (slotNames.length > 1) {
    const slotGroup = h('div', { class: 'group' }, h('span', { class: 'title' }, 'Slot'));
    state.filter.slots = new Set(slotNames);
    for (const s of slotNames) {
      slotGroup.append(
        checkbox(s, true, (v) => {
          if (v) state.filter.slots!.add(s);
          else state.filter.slots!.delete(s);
          render();
        }),
      );
    }
    controls.append(slotGroup);
  }

  // type=text rather than search: Escape in a search box clears it natively, and Escape is our hide key.
  const search = h('input', { class: 'search', type: 'text', placeholder: 'Search name, description, ingredients…' });
  search.addEventListener('input', () => {
    state.filter.search = search.value;
    render();
  });
  const maxPrice = h('input', { class: 'num', type: 'number', step: '0.5', min: '0', placeholder: 'Max £' });
  maxPrice.addEventListener('input', () => {
    state.filter.maxPrice = maxPrice.value === '' ? null : Number(maxPrice.value);
    render();
  });
  const SORTS: [string, SortState][] = [
    ['Price: high to low', { key: 'price', dir: 'desc' }],
    ['Price: low to high', { key: 'price', dir: 'asc' }],
    ['Name', { key: 'name', dir: 'asc' }],
    ['Provider', { key: 'vendorName', dir: 'asc' }],
    ['Section', { key: 'section', dir: 'asc' }],
    ['Kcal: high to low', { key: 'kcal', dir: 'desc' }],
    ['Kcal: low to high', { key: 'kcal', dir: 'asc' }],
  ];
  const sortSelect = h('select', { class: 'sort', title: 'Sort' });
  for (const [label] of SORTS) sortSelect.append(h('option', {}, label));
  sortSelect.addEventListener('change', () => {
    state.sort = { ...SORTS[sortSelect.selectedIndex][1] };
    renderHead();
    render();
  });
  const syncSortSelect = () => {
    const i = SORTS.findIndex(([, s]) => s.key === state.sort.key && s.dir === state.sort.dir);
    sortSelect.selectedIndex = i < 0 ? 0 : i;
  };
  const status = h('span', { class: 'status' });
  controls.append(h('div', { class: 'group' }, search, maxPrice, sortSelect, status));

  // Table
  const wrap = h('div', { class: 'tablewrap' });
  panel.append(wrap);
  const tiles = h('div', { class: 'tiles' });
  const table = h('table');
  const thead = h('thead');
  const tbody = h('tbody');
  table.append(thead, tbody);
  wrap.append(table);
  const empty = h('div', { class: 'empty' });

  const columns: [SortKey | null, string, string][] = [
    ['name', 'Item', 'item'],
    ['vendorName', 'Provider', 'vendor'],
    ['section', 'Section', 'section'],
    ['price', 'Price', 'price'],
    ['kcal', 'Kcal', 'kcal'],
    [null, 'Diet', 'tags'],
    [null, '', 'act'],
  ];

  function renderHead() {
    thead.replaceChildren();
    const tr = h('tr');
    for (const [key, label] of columns) {
      const th = h('th', {}, label);
      if (key) {
        if (state.sort.key === key) th.append(h('span', { class: 'arrow' }, state.sort.dir === 'asc' ? '▲' : '▼'));
        th.addEventListener('click', () => {
          if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
          else state.sort = { key, dir: key === 'price' || key === 'kcal' ? 'desc' : 'asc' };
          renderHead();
          render();
        });
      }
      tr.append(th);
    }
    thead.append(tr);
  }

  function capacityBadge(c: string): HTMLElement | null {
    if (c === 'ALMOST_SOLD_OUT') return h('span', { class: 'badge warn' }, 'Almost sold out');
    if (c === 'SOLD_OUT') return h('span', { class: 'badge bad' }, 'Sold out');
    return null;
  }

  const limit = () => state.remaining ?? state.budget;
  const isOver = (price: number) => {
    const lim = limit();
    return lim != null && price > lim;
  };
  const overTitle = (price: number) => {
    const lim = limit()!;
    if (lim <= 0) return `Full price ${formatPrice(price)}: today's budget is used up`;
    return state.spent.length ? `${formatPrice(price - lim)} top-up: only ${formatPrice(lim)} of the budget is left today` : `Over the ${formatPrice(lim)} budget by ${formatPrice(price - lim)}`;
  };

  function visibleRows(): Row[] {
    return sortRows(applyFilter(state.rows, state.filter), state.sort);
  }

  function filterSummary(): string {
    const parts: string[] = [];
    if (state.filter.diets.size) parts.push(`diet: ${[...state.filter.diets].map((k) => DL[k]).join(state.filter.mode === 'any' ? ' or ' : ' and ')}`);
    if (state.filter.vendors && state.filter.vendors.size < options.length) parts.push(`${state.filter.vendors.size} of ${options.length} providers`);
    if (state.filter.slots && state.filter.slots.size < slotNames.length) parts.push(`slot ${[...state.filter.slots].join(', ')}`);
    if (state.filter.search.trim()) parts.push(`search "${state.filter.search.trim()}"`);
    if (state.filter.maxPrice != null) parts.push(`max ${formatPrice(state.filter.maxPrice)}`);
    return parts.join('; ');
  }

  async function copyMarkdown(): Promise<void> {
    const md = toMarkdown(visibleRows(), { dayLabel: opts.dayLabel, budget: state.budget, spent: state.spent, remaining: state.remaining, filterSummary: filterSummary(), totalRows: state.rows.length });
    let ok = false;
    try {
      await navigator.clipboard.writeText(md);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
    toast(ok ? `Copied ${visibleRows().length} items as Markdown (${(md.length / 1024).toFixed(0)} KB).` : 'Could not copy to the clipboard.', 5000);
  }

  function chooseButton(r: Row): HTMLButtonElement {
    const b = h('button', { class: 'choose', type: 'button', 'data-item-id': r.itemId, 'data-order-id': r.orderId, 'data-type': r.type, 'data-vendor-chosen': r.vendorChosen ? '1' : '0' }, r.type === 'SingleItem' ? 'Choose' : 'Choose…');
    if (r.capacity === 'SOLD_OUT') b.disabled = true;
    b.title = r.type === 'SingleItem' ? 'Open this provider and add the item to your basket. You then confirm on their page.' : 'Open this provider at this item so you can pick its options.';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      hide();
      void chooseItem(r);
    });
    return b;
  }

  function rowEl(r: Row): HTMLTableRowElement {
    const tr = h('tr', { 'data-item-id': r.itemId, 'data-type': r.type, 'data-order-id': r.orderId, style: `--vc:${r.vendorColor}` });
    const itemCell = h('td', { class: 'item' });
    if (r.image) itemCell.append(h('img', { class: 'thumb', src: r.image, alt: '', loading: 'lazy' }));
    const nameLine = h('div', { class: 'name' }, r.name);
    if (r.type === 'CustomItem') nameLine.append(h('span', { class: 'badge type', title: 'Has options to choose from' }, 'options'));
    if (r.type === 'ItemBundle') nameLine.append(h('span', { class: 'badge type', title: 'Bundle of several items' }, 'bundle'));
    if (r.spicy) nameLine.append(h('span', { class: 'badge warn' }, 'spicy'));
    if (r.chosen) nameLine.append(h('span', { class: 'badge ok' }, '✓ chosen'));
    itemCell.append(nameLine);
    if (r.description) itemCell.append(h('div', { class: 'desc' }, r.description));
    if (r.allergens.length) itemCell.append(h('div', { class: 'allergens' }, `Allergens: ${r.allergens.join(', ')}`));
    tr.append(itemCell);

    const vendorCell = h('td', { class: 'vendor' });
    if (r.vendorLogo) vendorCell.append(h('img', { class: 'vlogo', src: r.vendorLogo, alt: '' }));
    const a = h('a', { href: `/my-meals/${r.orderId}`, title: `Open ${r.vendorName} for this slot`, style: `color:${r.vendorColor}` }, r.vendorName);
    vendorCell.append(a);
    const badge = capacityBadge(r.capacity);
    if (badge) vendorCell.append(badge);
    vendorCell.append(h('span', { class: 'slot' }, `${r.slot}${r.vendorLocationName ? ` · ${r.vendorLocationName}` : ''}`));
    tr.append(vendorCell);

    tr.append(h('td', { class: 'section' }, r.section));
    const over = isOver(r.price);
    tr.append(h('td', { class: `price${over ? ' over' : ''}`, title: over ? overTitle(r.price) : '' }, formatPrice(r.price)));
    tr.append(h('td', { class: 'kcal' }, r.kcal == null ? '' : String(r.kcal)));

    const tags = h('td', { class: 'tags' });
    for (const k of DIET_KEYS) {
      if (r.dietaries[k]) tags.append(h('span', { title: DIET_LABELS[k] }, DIET_SHORT[k]));
      else if (r.possibleDietaries[k]) tags.append(h('span', { class: 'maybe', title: `${DIET_LABELS[k]} if you pick the right component` }, DIET_SHORT[k]));
    }
    tr.append(tags);
    tr.append(h('td', { class: 'act' }, chooseButton(r)));
    return tr;
  }

  function tileEl(r: Row): HTMLElement {
    const tile = h('div', { class: 'tile', 'data-item-id': r.itemId, 'data-type': r.type, 'data-order-id': r.orderId, style: `--vc:${r.vendorColor}` });
    if (r.imageLarge) tile.append(h('img', { class: 'photo', src: r.imageLarge, alt: '', loading: 'lazy' }));
    else tile.append(h('div', { class: 'nophoto' }, 'No photo'));
    const body = h('div', { class: 'body' });
    const over = isOver(r.price);
    body.append(
      h(
        'div',
        { class: 'top' },
        h('span', { class: 'name' }, r.name),
        h('span', { class: `price${over ? ' over' : ''}`, title: over ? overTitle(r.price) : '' }, formatPrice(r.price)),
      ),
    );
    const badges = h('div');
    if (r.type === 'CustomItem') badges.append(h('span', { class: 'badge type' }, 'options'));
    if (r.type === 'ItemBundle') badges.append(h('span', { class: 'badge type' }, 'bundle'));
    if (r.spicy) badges.append(h('span', { class: 'badge warn' }, 'spicy'));
    if (r.chosen) badges.append(h('span', { class: 'badge ok' }, '\u2713 chosen'));
    const cap = capacityBadge(r.capacity);
    if (cap) badges.append(cap);
    if (badges.childElementCount) body.append(badges);
    const tags = h('div', { class: 'tags' });
    for (const k of DIET_KEYS) {
      if (r.dietaries[k]) tags.append(h('span', { title: DIET_LABELS[k] }, DIET_SHORT[k]));
      else if (r.possibleDietaries[k]) tags.append(h('span', { class: 'maybe', title: `${DIET_LABELS[k]} if you pick the right component` }, DIET_SHORT[k]));
    }
    if (r.kcal != null) tags.append(h('span', { class: 'kcal' }, `${r.kcal} kcal`));
    if (tags.childElementCount) body.append(tags);
    const allergenNote = r.allergens.length ? `Allergens: ${r.allergens.join(', ')}` : '';
    if (r.description) body.append(h('div', { class: 'desc', title: allergenNote ? `${r.description}\n\n${allergenNote}` : r.description }, r.description));
    if (allergenNote) body.append(h('div', { class: 'allergens' }, allergenNote));
    body.append(h('div', { class: 'vendor' }, h('a', { href: `/my-meals/${r.orderId}` }, r.vendorName), h('span', { class: 'slot' }, `${r.slot} \u00b7 ${r.section}`)));
    body.append(h('div', { class: 'act' }, chooseButton(r)));
    tile.append(body);
    if (r.vendorLogo) tile.append(h('img', { class: 'logo', src: r.vendorLogo, alt: r.vendorName, title: r.vendorName }));
    else tile.append(h('div', { class: 'logo text', title: r.vendorName }, r.vendorName.slice(0, 2).toUpperCase()));
    return tile;
  }

  function render() {
    const visible = sortRows(applyFilter(state.rows, state.filter), state.sort);
    syncSortSelect();
    if (state.view === 'tiles') {
      tiles.replaceChildren(...visible.map(tileEl));
      table.remove();
      if (!tiles.isConnected) wrap.prepend(tiles);
    } else {
      tbody.replaceChildren(...visible.map(rowEl));
      tiles.remove();
      if (!table.isConnected) wrap.prepend(table);
    }
    const loading = state.loaded < options.length;
    status.replaceChildren(
      `${visible.length} of ${state.rows.length} items` + (loading ? ` · loading ${state.loaded}/${options.length} providers…` : ''),
    );
    if (state.errors.length) status.append(' ', h('span', { class: 'err' }, `${state.errors.length} failed: ${state.errors.join('; ')}`));
    empty.textContent = loading ? 'Loading menus…' : 'No items match the current filters.';
    if (visible.length === 0) wrap.append(empty);
    else empty.remove();
    state.remaining = remainingBudget(state.budget, state.spent);
    budgetEl.replaceChildren();
    if (state.budget != null) {
      budgetEl.append('Budget ', h('b', {}, formatPrice(state.budget)));
      if (state.spent.length) {
        budgetEl.append(` · spent ${formatPrice(state.spent.reduce((a, s) => a + s.cost, 0))} on ${state.spent.map((s) => s.vendorName).join(', ')} · remaining `, h('b', { class: state.remaining! > 0 ? 'pos' : 'neg' }, formatPrice(state.remaining!)));
      }
    } else {
      budgetEl.textContent = 'Budget: loading…';
    }
    meta.textContent = [`${options.length} providers`, soldOutVendors.length ? `sold out: ${soldOutVendors.join(', ')}` : null].filter(Boolean).join(' · ');
  }

  renderHead();
  render();
  document.body.append(host);

  // What has already been ordered today (both slots share one budget).
  for (const cart of opts.carts) {
    for (const o of cart.eaterOptions) {
      if (o.eaterCartStatus !== 'confirmed' && !(o.itemIds?.length)) continue;
      fetchCart(o.orderId)
        .then((c) => {
          const cost = c.item.costBreakdown?.itemsCost?.gross ?? c.item.cartItems.reduce((a, ci) => a + ci.quantity * ci.item.price, 0);
          state.spent.push({ vendorName: o.vendorName, itemNames: c.item.cartItems.map((ci) => ci.item.name), cost });
          render();
        })
        .catch(() => {
          state.spent.push({ vendorName: o.vendorName, itemNames: o.itemNames ?? [], cost: 0 });
          render();
        });
    }
  }

  // Load all menus concurrently, rendering as each arrives.
  for (const { option, slot, color } of options) {
    fetchSummary(option.orderId)
      .then((summary) => {
        state.rows.push(...flattenSummary(summary, option, slot, color));
        if (state.budget == null && summary.item.individualChoice.budget != null) state.budget = summary.item.individualChoice.budget;
      })
      .catch((e: unknown) => {
        state.errors.push(`${option.vendorName} (${(e as Error).message ?? e})`);
      })
      .finally(() => {
        state.loaded++;
        render();
      });
  }

  return host;
}
