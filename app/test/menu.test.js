import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { generateMenu, regenerateSlot } from '../src/generator.js';
import { aggregate, totalCost } from '../src/shopping.js';
import { load } from '../src/store.js';

const category = {
  id: 'breakfasts',
  name: 'Завтраки',
  pick: 2,
  dishes: ['blini', 'oladi', 'sirniki', 'omlet'].map((id) => ({ id })),
};
const data = { categories: [category] };

test('menu generation respects blocks, uniqueness and a disabled category', () => {
  const state = { favorites: ['omlet'], blocks: ['omlet', 'oladi'] };
  const [slot] = generateMenu(data, state);
  assert.deepEqual(new Set(slot.dishes.map(({ id }) => id)), new Set(['blini', 'sirniki']));
  const [disabled] = generateMenu(data, { ...state, picks: { breakfasts: 0 } });
  assert.deepEqual(disabled.dishes, []);
});

test('replacement excludes the current dish, selected dishes and blocked dishes', () => {
  const state = { favorites: ['blini', 'omlet'], blocks: ['omlet'] };
  const selected = ['blini', 'oladi'];
  assert.equal(regenerateSlot(data, state, category.id, 'oladi', selected).id, 'sirniki');
  assert.equal(regenerateSlot(data, state, category.id, 'oladi', [...selected, 'sirniki']), null);
});

test('shopping combines teaspoons with grams and rounds countable items once', () => {
  const dishes = [
    { ingredients: [{ name: 'сахар', qty: 1, unit: 'ч.л.' }, { name: 'яйцо', qty: 1, unit: 'шт' }] },
    { ingredients: [{ name: 'сахар', qty: 10, unit: 'г' }, { name: 'яйцо', qty: 1, unit: 'шт' }] },
  ];
  const list = aggregate(dishes, 0.5);
  assert.deepEqual(list, [
    { name: 'сахар', qty: 7.5, unit: 'г' },
    { name: 'яйцо', qty: 1, unit: 'шт' },
  ]);
  assert.deepEqual(totalCost(list, { 'сахар__г': 0.1, 'яйцо__шт': 18 }), { sum: 19, missing: 0 });
});

test('every quantified catalog ingredient has a price after normalization', () => {
  const readYaml = (name) => YAML.parse(readFileSync(new URL(`../data/${name}.yml`, import.meta.url), 'utf8'));
  const dishes = readYaml('dishes').categories.flatMap((cat) => cat.dishes);
  assert.equal(totalCost(aggregate(dishes), readYaml('prices').prices).missing, 0);
});

test('saved menus and shopping checks are sanitized without dropping valid preferences', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify({
        version: 1,
        persons: 3,
        favorites: ['sirniki', 'oladi', 'sirniki'],
        blocks: ['oladi'],
        lastMenu: [null, { categoryId: 'bakery' }, { categoryId: 'breakfasts', dishIds: ['blini', 1, 'blini'] }],
        checked: { 'яйцо__шт': 2, 'соль__по вкусу': 0, invalid: -1 },
        prices: { 'яйцо__шт': 18 },
      }),
    },
  });
  assert.deepEqual(load(), {
    version: 1,
    persons: 3,
    picks: {},
    favorites: ['sirniki'],
    blocks: ['oladi'],
    lastMenu: [{ categoryId: 'breakfasts', dishIds: ['blini'] }],
    checked: { 'яйцо__шт': 2, 'соль__по вкусу': 0 },
    prices: { 'яйцо__шт': 18 },
  });
});
