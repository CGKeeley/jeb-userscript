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
export function flattenSummary(summary: Summary, option: EaterOption, slot: string): Row[] {
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
  hideSoldOut: boolean;
  maxPrice: number | null;
}

export function defaultFilter(): FilterState {
  return { diets: new Set(), mode: 'any', search: '', slots: null, hideSoldOut: true, maxPrice: null };
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
