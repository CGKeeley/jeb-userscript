// Comparison overlay. Rendered into a shadow root so the host page's CSS cannot interfere.
import { fetchSummary } from './api';
import {
  applyFilter,
  defaultFilter,
  DIET_KEYS,
  DIET_LABELS,
  DIET_SHORT,
  flattenSummary,
  formatPrice,
  sortRows,
  type FilterState,
  type SortKey,
  type SortState,
} from './core';
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
.backdrop { position: fixed; inset: 0; background: rgba(20,20,30,.55); z-index: 2147483000; display: flex; align-items: stretch; justify-content: center; padding: 16px; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2430; }
.panel { background: #fff; border-radius: 10px; width: min(1400px, 100%); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
header { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-bottom: 1px solid #e4e6eb; background: #fafbfc; }
header h1 { font-size: 18px; margin: 0; font-weight: 700; }
header .meta { color: #5a6272; font-size: 13px; }
header .grow { flex: 1; }
button.close { border: 0; background: #eef0f4; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
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

  const options: { option: EaterOption; slot: string }[] = [];
  const soldOutVendors: string[] = [];
  for (const cart of opts.carts) {
    for (const o of cart.eaterOptions) {
      // The menu endpoint answers 409 for sold-out vendors, and you cannot order from them anyway.
      if (o.vendorLocationCapacityStatus === 'SOLD_OUT') {
        soldOutVendors.push(o.vendorName);
        continue;
      }
      const slot = opts.slotLabels.get(o.orderHumanId) ?? new Date(cart.requestedDeliveryDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      options.push({ option: o, slot });
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
  };

  const close = () => {
    host.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const backdrop = h('div', { class: 'backdrop' });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  const panel = h('div', { class: 'panel' });
  backdrop.append(panel);
  shadow.append(backdrop);

  // Header
  const meta = h('span', { class: 'meta' });
  const closeBtn = h('button', { class: 'close', type: 'button' }, 'Close ✕');
  closeBtn.addEventListener('click', close);
  panel.append(h('header', {}, h('h1', {}, `Compare menus · ${opts.dayLabel}`), meta, h('span', { class: 'grow' }), closeBtn));

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

  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search name, description, ingredients…' });
  search.addEventListener('input', () => {
    state.filter.search = search.value;
    render();
  });
  const maxPrice = h('input', { class: 'num', type: 'number', step: '0.5', min: '0', placeholder: 'Max £' });
  maxPrice.addEventListener('input', () => {
    state.filter.maxPrice = maxPrice.value === '' ? null : Number(maxPrice.value);
    render();
  });
  const status = h('span', { class: 'status' });
  controls.append(h('div', { class: 'group' }, search, maxPrice, status));

  // Table
  const wrap = h('div', { class: 'tablewrap' });
  panel.append(wrap);
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

  function rowEl(r: Row): HTMLTableRowElement {
    const tr = h('tr');
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
    const a = h('a', { href: `/my-meals/${r.orderId}`, title: `Open ${r.vendorName} for this slot` }, r.vendorName);
    vendorCell.append(a);
    const badge = capacityBadge(r.capacity);
    if (badge) vendorCell.append(badge);
    vendorCell.append(h('span', { class: 'slot' }, `${r.slot}${r.vendorLocationName ? ` · ${r.vendorLocationName}` : ''}`));
    tr.append(vendorCell);

    tr.append(h('td', { class: 'section' }, r.section));
    const over = r.budget != null && r.price > r.budget;
    tr.append(h('td', { class: `price${over ? ' over' : ''}`, title: over ? `Over the ${formatPrice(r.budget!)} budget` : '' }, formatPrice(r.price)));
    tr.append(h('td', { class: 'kcal' }, r.kcal == null ? '' : String(r.kcal)));

    const tags = h('td', { class: 'tags' });
    for (const k of DIET_KEYS) {
      if (r.dietaries[k]) tags.append(h('span', { title: DIET_LABELS[k] }, DIET_SHORT[k]));
      else if (r.possibleDietaries[k]) tags.append(h('span', { class: 'maybe', title: `${DIET_LABELS[k]} if you pick the right component` }, DIET_SHORT[k]));
    }
    tr.append(tags);
    return tr;
  }

  function render() {
    const visible = sortRows(applyFilter(state.rows, state.filter), state.sort);
    tbody.replaceChildren(...visible.map(rowEl));
    const loading = state.loaded < options.length;
    status.replaceChildren(
      `${visible.length} of ${state.rows.length} items` + (loading ? ` · loading ${state.loaded}/${options.length} providers…` : ''),
    );
    if (state.errors.length) status.append(' ', h('span', { class: 'err' }, `${state.errors.length} failed: ${state.errors.join('; ')}`));
    empty.textContent = loading ? 'Loading menus…' : 'No items match the current filters.';
    if (visible.length === 0) wrap.append(empty);
    else empty.remove();
    meta.textContent = [
      `${options.length} providers`,
      state.budget != null ? `budget ${formatPrice(state.budget)}` : null,
      soldOutVendors.length ? `sold out: ${soldOutVendors.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  renderHead();
  render();
  document.body.append(host);

  // Load all menus concurrently, rendering as each arrives.
  for (const { option, slot } of options) {
    fetchSummary(option.orderId)
      .then((summary) => {
        state.rows.push(...flattenSummary(summary, option, slot));
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
