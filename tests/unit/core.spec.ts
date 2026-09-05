import { expect, test } from '@playwright/test';
import {
  applyFilter,
  cartsByDay,
  defaultFilter,
  EMPTY_DIET,
  flattenSummary,
  matchesDiet,
  possibleDietaries,
  sortRows,
} from '../../src/core';
import type { BaseItem, CartsResponse, Dietaries, EaterOption, Row, Summary } from '../../src/types';

const diet = (over: Partial<Dietaries> = {}): Dietaries => ({ ...EMPTY_DIET, none: false, ...over });

const item = (over: Partial<BaseItem> & { name: string; price: number }): BaseItem => ({
  type: 'SingleItem',
  id: over.name.toLowerCase().replace(/\W+/g, '-'),
  description: '',
  dietaries: diet(),
  availability: { useAllLocations: true, locationIds: [] },
  ...over,
});

const option: EaterOption = {
  orderId: 'ord1',
  orderHumanId: 1001,
  vendorId: 'v1',
  vendorName: 'Yolk - Soho',
  vendorLocationName: 'Soho',
  vendorLocationCapacityStatus: 'AVAILABLE',
  itemIds: ['chosen-one'],
};

const summary = (sections: Summary['item']['individualChoice']['menuContent']['sections'], locId = 'loc1'): Summary => ({
  item: {
    vendor: { id: 'v1', name: 'Yolk' },
    individualChoice: { menuContent: { sections }, budget: 20, choiceDeadline: '2026-09-07T09:30:00+01:00' },
    requestedDeliveryDate: '2026-09-07T12:30:00+01:00',
    selectedVendorLocation: { id: locId, name: 'Soho' },
  },
});

test.describe('flattenSummary', () => {
  test('skips hidden sections and items not available at the selected location', () => {
    const rows = flattenSummary(
      summary([
        { title: 'Mains', hidden: false, items: [item({ name: 'Burrito', price: 9 }), item({ name: 'Elsewhere only', price: 5, availability: { useAllLocations: false, locationIds: ['other'] } })] },
        { title: 'Christmas', hidden: true, items: [item({ name: 'Turkey', price: 12 })] },
        { title: 'Sides', hidden: false, items: [item({ name: 'Here too', price: 3, availability: { useAllLocations: false, locationIds: ['loc1', 'x'] } })] },
      ]),
      option,
      '12:00 - 12:30',
    );
    expect(rows.map((r) => r.name)).toEqual(['Burrito', 'Here too']);
    expect(rows[0]).toMatchObject({ vendorName: 'Yolk - Soho', slot: '12:00 - 12:30', section: 'Mains', budget: 20, orderId: 'ord1' });
  });

  test('marks chosen items and lists allergens', () => {
    const rows = flattenSummary(
      summary([
        {
          title: 'Mains',
          hidden: false,
          items: [
            item({ name: 'Chosen One', id: 'chosen-one', price: 9, allergens: { gluten: true, sulphurDioxide: true, milk: false, none: false, notProvided: false } }),
          ],
        },
      ]),
      option,
      'slot',
    );
    expect(rows[0].chosen).toBe(true);
    expect(rows[0].allergens).toEqual(['gluten', 'sulphur dioxide']);
  });
});

test.describe('possibleDietaries', () => {
  test('ignores the API possibleDietaries field on custom items (it is the worst case, not the best)', () => {
    const it = item({ name: 'BYO Tray', price: 9, type: 'CustomItem', dietaries: diet({ vegetarian: true }), possibleDietaries: diet() });
    expect(possibleDietaries(it).vegetarian).toBe(true);
  });

  test('bundle can be vegan only if every choice group has a vegan option', () => {
    const vegan = item({ name: 'Vegan burger', price: 8, dietaries: diet({ vegan: true, vegetarian: true }) });
    const chicken = item({ name: 'Chicken burger', price: 8, dietaries: diet() });
    const fries = item({ name: 'Fries', price: 2, dietaries: diet({ vegan: true, vegetarian: true, noGluten: true }) });
    const bundle = item({
      name: 'Bundle',
      price: 11,
      type: 'ItemBundle',
      groups: [
        { type: 'ChoiceGroup', heading: 'Burger', items: [vegan, chicken] },
        { type: 'ChoiceGroup', heading: 'Side', items: [fries] },
      ],
    });
    const p = possibleDietaries(bundle);
    expect(p.vegan).toBe(true);
    expect(p.vegetarian).toBe(true);
    expect(p.noGluten).toBe(false); // burgers are not gluten free
  });
});

function row(over: Partial<Row> & { name: string; price: number }): Row {
  return {
    key: over.name,
    itemId: over.name,
    description: '',
    kcal: null,
    type: 'SingleItem',
    section: 'Mains',
    foodType: 'main',
    image: null,
    imageLarge: null,
    vendorName: 'V',
    vendorLocationName: '',
    vendorLogo: null,
    vendorColor: '#000',
    orderId: 'o',
    orderHumanId: 1,
    slot: '12:00 - 12:30',
    capacity: 'AVAILABLE',
    dietaries: diet(),
    possibleDietaries: diet(),
    allergens: [],
    ingredients: [],
    spicy: false,
    budget: 20,
    chosen: false,
    ...over,
  };
}

const veg = row({ name: 'Veg', price: 8, dietaries: diet({ vegetarian: true }) });
const pesc = row({ name: 'Fish', price: 10, dietaries: diet({ pescatarian: true }) });
const vegPesc = row({ name: 'Both', price: 9, dietaries: diet({ vegetarian: true, pescatarian: true }) });
const meat = row({ name: 'Steak', price: 14 });
const maybeVeg = row({ name: 'Custom', price: 7, type: 'ItemBundle', possibleDietaries: diet({ vegetarian: true }) });

test.describe('diet filter', () => {
  test('inclusive matches any selected diet', () => {
    const f = { ...defaultFilter(), diets: new Set(['vegetarian', 'pescatarian'] as const), mode: 'any' as const };
    expect(applyFilter([veg, pesc, vegPesc, meat], f).map((r) => r.name)).toEqual(['Veg', 'Fish', 'Both']);
  });

  test('exclusive requires all selected diets', () => {
    const f = { ...defaultFilter(), diets: new Set(['vegetarian', 'pescatarian'] as const), mode: 'all' as const };
    expect(applyFilter([veg, pesc, vegPesc, meat], f).map((r) => r.name)).toEqual(['Both']);
  });

  test('no diets selected matches everything', () => {
    expect(matchesDiet(meat, defaultFilter())).toBe(true);
  });

  test('items that can be made to fit are included', () => {
    const f = { ...defaultFilter(), diets: new Set(['vegetarian'] as const) };
    expect(applyFilter([maybeVeg, meat], f).map((r) => r.name)).toEqual(['Custom']);
  });
});

test.describe('other filters', () => {
  test('search matches all words across name, description and ingredients', () => {
    const rows = [row({ name: 'Chicken Katsu', price: 9, ingredients: ['rice', 'curry sauce'] }), row({ name: 'Tofu bowl', price: 8, description: 'with rice' })];
    expect(applyFilter(rows, { ...defaultFilter(), search: 'rice curry' }).map((r) => r.name)).toEqual(['Chicken Katsu']);
    expect(applyFilter(rows, { ...defaultFilter(), search: 'RICE' })).toHaveLength(2);
  });

  test('hides sold out vendors by default and respects slot and max price', () => {
    const rows = [
      row({ name: 'A', price: 9, capacity: 'SOLD_OUT' }),
      row({ name: 'B', price: 9, slot: '12:30 - 13:00' }),
      row({ name: 'C', price: 25 }),
      row({ name: 'D', price: 9 }),
    ];
    expect(applyFilter(rows, defaultFilter()).map((r) => r.name)).toEqual(['B', 'C', 'D']);
    expect(applyFilter(rows, { ...defaultFilter(), hideSoldOut: false })).toHaveLength(4);
    expect(applyFilter(rows, { ...defaultFilter(), slots: new Set(['12:00 - 12:30']) }).map((r) => r.name)).toEqual(['C', 'D']);
    expect(applyFilter(rows, { ...defaultFilter(), maxPrice: 10 }).map((r) => r.name)).toEqual(['B', 'D']);
  });

  test('provider filter keeps only the selected orders (OR across providers)', () => {
    const rows = [row({ name: 'A', price: 1, orderId: 'o1' }), row({ name: 'B', price: 1, orderId: 'o2' }), row({ name: 'C', price: 1, orderId: 'o3' })];
    expect(applyFilter(rows, { ...defaultFilter(), vendors: new Set(['o1', 'o3']) }).map((r) => r.name)).toEqual(['A', 'C']);
    expect(applyFilter(rows, { ...defaultFilter(), vendors: new Set() })).toHaveLength(0);
    expect(applyFilter(rows, { ...defaultFilter(), vendors: null })).toHaveLength(3);
  });
});

test.describe('sortRows', () => {
  test('default price descending, ties broken by name', () => {
    const rows = [veg, pesc, vegPesc, meat, row({ name: 'Also 10', price: 10 })];
    expect(sortRows(rows, { key: 'price', dir: 'desc' }).map((r) => r.name)).toEqual(['Steak', 'Also 10', 'Fish', 'Both', 'Veg']);
  });

  test('kcal sorts nulls last when descending', () => {
    const rows = [row({ name: 'x', price: 1, kcal: null }), row({ name: 'y', price: 1, kcal: 500 }), row({ name: 'z', price: 1, kcal: 200 })];
    expect(sortRows(rows, { key: 'kcal', dir: 'desc' }).map((r) => r.name)).toEqual(['y', 'z', 'x']);
  });

  test('string columns sort alphabetically', () => {
    const rows = [row({ name: 'b', price: 1, vendorName: 'Zed' }), row({ name: 'a', price: 1, vendorName: 'Alpha' })];
    expect(sortRows(rows, { key: 'vendorName', dir: 'asc' }).map((r) => r.vendorName)).toEqual(['Alpha', 'Zed']);
  });
});

test('cartsByDay groups slots on the same day and drops cancelled carts', () => {
  const carts: CartsResponse = {
    count: 3,
    items: [
      { orderId: 'a', isCancelled: false, requestedDeliveryDate: '2026-09-07T12:30:00+01:00', eaterOptions: [], orderDeadline: '', choiceOpenTime: '', choiceDeadline: '', location: { name: '' } },
      { orderId: 'b', isCancelled: false, requestedDeliveryDate: '2026-09-07T13:00:00+01:00', eaterOptions: [], orderDeadline: '', choiceOpenTime: '', choiceDeadline: '', location: { name: '' } },
      { orderId: 'c', isCancelled: true, requestedDeliveryDate: '2026-09-08T12:30:00+01:00', eaterOptions: [], orderDeadline: '', choiceOpenTime: '', choiceDeadline: '', location: { name: '' } },
    ],
  };
  const byDay = cartsByDay(carts);
  expect([...byDay.keys()]).toHaveLength(1);
  expect([...byDay.values()][0].map((c) => c.orderId)).toEqual(['a', 'b']);
});
