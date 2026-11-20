import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { generateMenu, regenerateSlot } from '../src/generator.js';
import { aggregate, groupShopping, recipeFactor, shoppingText, totalCost } from '../src/shopping.js';
import { load } from '../src/store.js';
import { addToMeal, cookingBatches, distributeMenu, removeFromMeal, sanitizeWeek } from '../src/week.js';

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

test('generating keeps pinned dishes even with a lower target or a conflicting favorite', () => {
  const [slot] = generateMenu(data, {
    pins: ['sirniki', 'omlet'], blocks: ['omlet'], favorites: ['blini'], picks: { breakfasts: 1 },
  });
  assert.deepEqual(slot.dishes, [{ id: 'sirniki' }]);
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

test('every catalog ingredient has a department and a price when quantified', () => {
  const readYaml = (name) => YAML.parse(readFileSync(new URL(`../data/${name}.yml`, import.meta.url), 'utf8'));
  const dishes = readYaml('dishes').categories.flatMap((cat) => cat.dishes);
  const list = aggregate(dishes);
  const { prices, departments } = readYaml('prices');
  assert.equal(totalCost(list, prices).missing, 0);
  const groups = groupShopping(list, departments);
  assert.ok(!groups.some((group) => group.name === 'Прочее'));
  assert.equal(groups.flatMap((group) => group.items).length, list.length);
});

test('shopping uses each recipe yield and rounds a whole batch only once', () => {
  const dishes = [
    {
      recipe: { portions: 6, wholeBatch: true },
      ingredients: [{ name: 'утка', qty: 1, unit: 'шт' }, { name: 'яблоко', qty: 6, unit: 'шт' }],
    },
    {
      recipe: { portions: 4 },
      ingredients: [{ name: 'яблоко', qty: 1, unit: 'шт' }, { name: 'мука', qty: 200, unit: 'г' }],
    },
    {
      recipe: { portions: 12 },
      ingredients: [{ name: 'яблоко', qty: 1, unit: 'шт' }],
    },
  ];
  const list = aggregate(dishes, (dish) => recipeFactor(dish.recipe, 3));
  assert.deepEqual(list, [
    { name: 'мука', qty: 150, unit: 'г' },
    { name: 'утка', qty: 1, unit: 'шт' },
    { name: 'яблоко', qty: 7, unit: 'шт' },
  ]);
  assert.equal(recipeFactor(dishes[0].recipe, 7), 2);
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
        prices: { 'яйцо__шт': 18, 'квас__шт': 120, 'картофель__шт': 10, 'картофель__г': 0.14 },
      }),
    },
  });
  assert.deepEqual(load(), {
    version: 1,
    persons: 3,
    picks: {},
    favorites: ['sirniki'],
    blocks: ['oladi'],
    pins: [],
    lastMenu: [{ categoryId: 'breakfasts', dishIds: ['blini'] }],
    checked: { 'яйцо__шт': 2, 'соль__по вкусу': 0 },
    week: {},
    weekChecked: {},
    view: 'menu',
    prices: { 'яйцо__шт': 18, 'квас__мл': 0.12, 'картофель__г': 0.14 },
  });
});

test('a repeat uses the original cooking batch and can become the new first serving', () => {
  const week = {};
  assert.equal(addToMeal(week, 'mon-lunch', 'utka'), true);
  assert.equal(addToMeal(week, 'tue-lunch', 'utka', 'mon-lunch'), true);
  assert.equal(addToMeal(week, 'wed-lunch', 'utka', 'tue-lunch'), false);
  assert.equal(addToMeal(week, 'wed-lunch', 'utka', 'mon-lunch'), true);
  assert.equal(addToMeal(week, 'wed-lunch', 'utka'), false);
  assert.equal(addToMeal(week, 'sat-lunch', 'utka'), true);
  assert.deepEqual(cookingBatches(week), [
    { mealId: 'mon-lunch', dishId: 'utka', mealCount: 3 },
    { mealId: 'sat-lunch', dishId: 'utka', mealCount: 1 },
  ]);
  removeFromMeal(week, 'mon-lunch', 'utka');
  assert.deepEqual(week['wed-lunch'], [{ dishId: 'utka', from: 'tue-lunch' }]);
  assert.deepEqual(cookingBatches(week), [
    { mealId: 'tue-lunch', dishId: 'utka', mealCount: 2 },
    { mealId: 'sat-lunch', dishId: 'utka', mealCount: 1 },
  ]);
});

test('restoring and distributing the weekly plan preserves valid entries', () => {
  const week = sanitizeWeek({
    'mon-breakfast': [{ dishId: 'blini', from: 'sun-breakfast' }, { dishId: 'blini' }, { dishId: 'unknown' }],
    'tue-breakfast': [{ dishId: 'blini', from: 'mon-breakfast' }],
    other: [{ dishId: 'blini' }],
  }, (id) => id !== 'unknown');
  assert.deepEqual(week, {
    'mon-breakfast': [{ dishId: 'blini', from: null }],
    'tue-breakfast': [{ dishId: 'blini', from: 'mon-breakfast' }],
  });
  assert.equal(distributeMenu(week, [{ categoryId: 'breakfasts', dishes: category.dishes }]), 3);
  assert.equal(distributeMenu(week, [{ categoryId: 'breakfasts', dishes: category.dishes }]), 0);
  assert.deepEqual(cookingBatches(week).map((batch) => batch.mealCount), [2, 1, 1, 1]);
});

test('copied shopping list keeps store departments and checkmarks', () => {
  const list = [{ name: 'молоко', qty: 300, unit: 'мл', checked: true }, { name: 'укроп', qty: 1, unit: 'пучок' }];
  const groups = groupShopping(list, [
    { name: 'Овощи и зелень', ingredients: ['укроп'] },
    { name: 'Молочное', ingredients: ['молоко'] },
  ]);
  assert.equal(shoppingText(groups), 'Овощи и зелень\n☐ укроп — 1 пучок\n\nМолочное\n✓ молоко — 300 мл');
});
