// Pure data logic: flattening menus into rows, filtering, sorting. No DOM access here so it is unit-testable.
import type { BaseItem, Cart, CartsResponse, Dietaries, DietKey, EaterOption, Row, Summary } from './types';

export const DIET_KEYS: DietKey[] = ['vegetarian', 'vegan', 'pescatarian', 'noGluten', 'noDairy', 'noNuts', 'halal'];

export const DIET_LABELS: Record<DietKey, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  noGluten: 'Gluten free',
  noDairy: 'Dairy free',
  noNuts: 'Nut free',
  halal: 'Halal',
};

export const DIET_SHORT: Record<DietKey, string> = {
  vegetarian: 'V',
  vegan: 'VE',
  pescatarian: 'P',
  noGluten: 'GF',
  noDairy: 'DF',
  noNuts: 'NF',
  halal: 'H',
};

/** Distinct colours assigned to providers in list order so the same provider is easy to spot. */
// All have a contrast ratio of at least 4.5:1 against white text (checked in the unit tests).
export const VENDOR_COLORS = ['#3b6ea8', '#c0392b', '#4a7d2c', '#7d5ba6', '#b85c00', '#0f7c91', '#6b6b1f', '#a8325f', '#7a5230', '#2c5f8a', '#8e3a80', '#c2185b', '#5c6bc0', '#00838f', '#455a64'];

export function vendorColor(index: number): string {
  return VENDOR_COLORS[index % VENDOR_COLORS.length];
}

export const EMPTY_DIET: Dietaries = {
  vegetarian: false,
  vegan: false,
  noNuts: false,
  noGluten: false,
  noDairy: false,
  halal: false,
  pescatarian: false,
  none: true,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Group non-cancelled carts by local delivery day. */
export function cartsByDay(carts: CartsResponse): Map<string, Cart[]> {
  const out = new Map<string, Cart[]>();
  for (const c of carts.items) {
    if (c.isCancelled) continue;
    const k = localDayKey(c.requestedDeliveryDate);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(c);
  }
  return out;
}

function orDiet(a: Dietaries, b: Dietaries): Dietaries {
  const o = { ...a };
  for (const k of DIET_KEYS) o[k] = a[k] || b[k];
  o.none = !DIET_KEYS.some((k) => o[k]);
  return o;
}

/**
 * Best-case dietaries: what the item can be if you pick the right bundle components.
 * Note the API's own `possibleDietaries` field on CustomItems is the *worst* case (flags that survive every
 * option), so it is deliberately ignored here; an item with options is judged on its listed flags.
 */
export function possibleDietaries(item: BaseItem): Dietaries {
  if (item.type === 'ItemBundle' && item.groups?.length) {
    // Within a choice group take the union of what its items offer. Across groups take the intersection:
    // a bundle can only be e.g. vegan if every group has a vegan choice.
    let acc: Dietaries | null = null;
    for (const g of item.groups) {
      let union: Dietaries = { ...EMPTY_DIET };
      for (const gi of g.items) union = orDiet(union, gi.dietaries ?? EMPTY_DIET);
      if (!acc) acc = union;
      else {
        const next: Dietaries = { ...acc };
        for (const k of DIET_KEYS) next[k] = acc[k] && union[k];
        acc = next;
      }
    }
    return orDiet(item.dietaries ?? EMPTY_DIET, acc ?? EMPTY_DIET);
  }
  return item.dietaries ?? EMPTY_DIET;
}

function isAvailableAtLocation(item: BaseItem, locationId: string | null | undefined): boolean {
  const a = item.availability;
  if (!a) return true;
  if (a.useAllLocations) return true;
  if (!locationId) return true;
  return a.locationIds.includes(locationId);
}

function allergenList(item: BaseItem): string[] {
  if (!item.allergens) return [];
  return Object.entries(item.allergens)
    .filter(([k, v]) => v && k !== 'none' && k !== 'notProvided')
    .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase());
}

/** Flatten one vendor's summary into rows. */
export function flattenSummary(summary: Summary, option: EaterOption, slot: string, color = VENDOR_COLORS[0]): Row[] {
  const it = summary.item;
  const locId = it.selectedVendorLocation?.id ?? null;
  const rows: Row[] = [];
  const chosenIds = new Set(option.itemIds ?? []);
  for (const sec of it.individualChoice.menuContent.sections) {
    if (sec.hidden) continue;
    for (const item of sec.items) {
      if (!isAvailableAtLocation(item, locId)) continue;
      rows.push({
        key: `${option.orderId}:${item.id}`,
        itemId: item.id,
        name: item.name,
        description: item.description ?? '',
        price: item.price,
        kcal: typeof item.kcal === 'number' ? item.kcal : null,
        type: item.type,
        section: sec.title,
        foodType: item.foodType ?? '',
        image: item.images?.[0]?.thumbnail ?? null,
        imageLarge: item.images?.[0]?.medium ?? item.images?.[0]?.large ?? item.images?.[0]?.thumbnail ?? null,
        vendorName: option.vendorName || it.vendor.name,
        vendorLocationName: option.vendorLocationName || it.selectedVendorLocation?.name || '',
        vendorLogo: option.vendorImage?.[0]?.thumbnail ?? null,
        vendorColor: color,
        orderId: option.orderId,
        orderHumanId: option.orderHumanId,
        slot,
        capacity: option.vendorLocationCapacityStatus,
        dietaries: item.dietaries ?? EMPTY_DIET,
        possibleDietaries: possibleDietaries(item),
        allergens: allergenList(item),
        ingredients: item.ingredients ?? [],
        spicy: !!item.spicy,
        budget: it.individualChoice.budget ?? null,
        chosen: chosenIds.has(item.id),
      });
    }
  }
  return rows;
}

export type FilterMode = 'any' | 'all';

export interface FilterState {
  diets: Set<DietKey>;
  mode: FilterMode;
  search: string;
  slots: Set<string> | null; // null = all
  vendors: Set<string> | null; // orderIds; null = all
  hideSoldOut: boolean;
  maxPrice: number | null;
}

export function defaultFilter(): FilterState {
  return { diets: new Set(), mode: 'any', search: '', slots: null, vendors: null, hideSoldOut: true, maxPrice: null };
}

export function matchesDiet(row: Row, f: FilterState): boolean {
  if (f.diets.size === 0) return true;
  // An item that CAN fit (e.g. a bundle with a vegan choice) counts as fitting.
  const has = (k: DietKey) => row.dietaries[k] || row.possibleDietaries[k];
  const keys = [...f.diets];
  return f.mode === 'any' ? keys.some(has) : keys.every(has);
}

export function applyFilter(rows: Row[], f: FilterState): Row[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.hideSoldOut && r.capacity === 'SOLD_OUT') return false;
    if (f.slots && !f.slots.has(r.slot)) return false;
    if (f.vendors && !f.vendors.has(r.orderId)) return false;
    if (f.maxPrice != null && r.price > f.maxPrice) return false;
    if (!matchesDiet(r, f)) return false;
    if (q) {
      const hay = `${r.name} ${r.description} ${r.vendorName} ${r.section} ${r.ingredients.join(' ')}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export type SortKey = 'price' | 'name' | 'vendorName' | 'kcal' | 'section';

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export function sortRows(rows: Row[], s: SortState): Row[] {
  const mul = s.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[s.key];
    const bv = b[s.key];
    let c: number;
    if (s.key === 'price' || s.key === 'kcal') {
      const an = av === null ? -Infinity : (av as number);
      const bn = bv === null ? -Infinity : (bv as number);
      c = an - bn;
    } else {
      c = String(av).localeCompare(String(bv));
    }
    if (c !== 0) return c * mul;
    // Ties: keep a stable, direction-independent order (price, then name ascending).
    return a.price - b.price || a.name.localeCompare(b.name);
  });
}

export function formatPrice(n: number): string {
  return `£${n.toFixed(2)}`;
}

/** WCAG relative luminance contrast of a hex colour against white. */
export function contrastWithWhite(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return 1.05 / (l + 0.05);
}

export interface Spend {
  vendorName: string;
  itemNames: string[];
  cost: number;
}

/** Remaining budget for the day: the budget is shared across both slots; each confirmed order eats into it. */
export function remainingBudget(budget: number | null, spent: Spend[]): number | null {
  if (budget == null) return null;
  return Math.round((budget - spent.reduce((a, s) => a + s.cost, 0)) * 100) / 100;
}

export interface MarkdownMeta {
  dayLabel: string;
  budget: number | null;
  spent: Spend[];
  remaining: number | null;
  filterSummary: string;
  totalRows: number;
}

function dietList(r: Row): string {
  const sure = DIET_KEYS.filter((k) => r.dietaries[k]).map((k) => DIET_LABELS[k]);
  const maybe = DIET_KEYS.filter((k) => !r.dietaries[k] && r.possibleDietaries[k]).map((k) => `${DIET_LABELS[k]} (with the right choice)`);
  return [...sure, ...maybe].join(', ');
}

/**
 * Markdown for pasting into an LLM: day -> slot -> provider -> items, with every detail we have.
 * Rows are emitted in the order given (i.e. the current sort), grouped without re-sorting.
 */
export function toMarkdown(rows: Row[], meta: MarkdownMeta): string {
  const out: string[] = [];
  out.push(`# Lunch options · ${meta.dayLabel}`, '');
  if (meta.budget != null) {
    const spentTxt = meta.spent.length ? ` · already spent ${formatPrice(meta.spent.reduce((a, s) => a + s.cost, 0))} on ${meta.spent.map((s) => `${s.itemNames.join(', ')} (${s.vendorName})`).join('; ')}` : '';
    out.push(`Subsidised budget for the day: ${formatPrice(meta.budget)}${spentTxt}. Remaining: ${formatPrice(meta.remaining ?? meta.budget)}. Anything above the remaining budget needs a personal top-up of the difference.`);
  }
  out.push(`Showing ${rows.length} of ${meta.totalRows} items${meta.filterSummary ? ` (${meta.filterSummary})` : ''}.`, '');
  const bySlot = new Map<string, Map<string, Row[]>>();
  for (const r of rows) {
    if (!bySlot.has(r.slot)) bySlot.set(r.slot, new Map());
    const byVendor = bySlot.get(r.slot)!;
    const key = `${r.vendorName}|${r.orderId}`;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(r);
  }
  for (const [slot, byVendor] of bySlot) {
    out.push(`## Delivery slot ${slot}`, '');
    for (const [, items] of byVendor) {
      const v = items[0];
      const notes: string[] = [];
      if (v.capacity === 'ALMOST_SOLD_OUT') notes.push('almost sold out');
      if (v.capacity === 'SOLD_OUT') notes.push('sold out');
      out.push(`### ${v.vendorName}${v.vendorLocationName ? ` · ${v.vendorLocationName}` : ''} (${items.length} items${notes.length ? `, ${notes.join(', ')}` : ''})`, '');
      for (const r of items) {
        const lim = meta.remaining ?? meta.budget;
        const bits: string[] = [formatPrice(r.price) + (lim != null && r.price > lim ? ` (top-up ${formatPrice(r.price - lim)})` : '')];
        if (r.kcal != null) bits.push(`${r.kcal} kcal`);
        const diets = dietList(r);
        if (diets) bits.push(diets);
        if (r.spicy) bits.push('spicy');
        if (r.type === 'CustomItem') bits.push('has options to choose');
        if (r.type === 'ItemBundle') bits.push('bundle with choices');
        if (r.chosen) bits.push('ALREADY CHOSEN');
        bits.push(`section: ${r.section}`);
        out.push(`- **${r.name}** — ${bits.join(' · ')}`);
        if (r.description) out.push(`  ${r.description.replace(/\s*\n\s*/g, ' ')}`);
        if (r.allergens.length) out.push(`  Allergens: ${r.allergens.join(', ')}`);
        if (r.ingredients.length) out.push(`  Ingredients: ${r.ingredients.join(', ')}`);
      }
      out.push('');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}
