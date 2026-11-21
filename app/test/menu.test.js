import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { generateMenu, regenerateSlot } from '../src/generator.js';
import { aggregate, groupShopping, recipeFactor, recipeIngredients, shoppingText, subtractStock, totalCost } from '../src/shopping.js';
import { decodeBackup, encodeBackup, loadLegacyState, mergeChanges } from '../src/store.js';
import { availablePortions, fridgeDeadline, needsFreezer, sanitizeBatchRecords } from '../src/batch-storage.js';
import {
  addToMeal, cookingBatches, distributeMenu, fillEmptyMeals,
  formatWeekSchedule, localDayId, moveMealDish, removeFromMeal, replaceMealDish, sanitizeWeek,
} from '../src/week.js';

const category = {
  id: 'breakfasts',
  name: 'Завтраки',
  pick: 2,
  dishes: ['blini', 'oladi', 'sirniki', 'omlet'].map((id) => ({ id })),
};
const data = { categories: [category] };

test('a portable backup round-trips the full state and rejects partial snapshots', () => {
  const state = {
    ...loadLegacyState(),
    weekStart: '2026-11-23',
    week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
    stock: { 'мука__г': 800 },
  };
  const text = encodeBackup(state);
  const backup = JSON.parse(text);
  assert.deepEqual(decodeBackup(text), { savedAt: backup.savedAt, state });
  assert.equal(decodeBackup('{'), null);
  assert.equal(decodeBackup(JSON.stringify({ ...backup, version: 99 })), null);
  delete backup.state.stock;
  assert.equal(decodeBackup(JSON.stringify(backup)), null);
  backup.state.stock = { 'мука__г': '800' };
  assert.equal(decodeBackup(JSON.stringify(backup)), null);
});

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
    { name: 'сахар', qty: 7.1, unit: 'г' },
    { name: 'яйцо', qty: 1, unit: 'шт' },
  ]);
  assert.deepEqual(totalCost(list, { 'сахар__г': 0.1, 'яйцо__шт': 18 }), { sum: 19, missing: 0 });
});

test('every catalog ingredient has a department and a price when quantified', () => {
  const readYaml = (name) => YAML.parse(readFileSync(new URL(`../data/${name}.yml`, import.meta.url), 'utf8'));
  const variants = readYaml('dough');
  const dishes = readYaml('dishes').categories.flatMap((cat) => cat.dishes);
  const recipes = dishes.flatMap((dish) => variants[dish.id]?.replaces
    ? [dish, { ingredients: recipeIngredients({ ...dish, dough: variants[dish.id] }, true) }] : [dish]);
  const list = aggregate(recipes);
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
        stock: { 'картофель__г': 120.26, 'яйцо__шт': 2.9, 'соль__по вкусу': 1, invalid: 4 },
        prices: { 'яйцо__шт': 18, 'квас__шт': 120, 'картофель__шт': 10, 'картофель__г': 0.14 },
      }),
    },
  });
  assert.deepEqual(loadLegacyState(), {
    version: 2,
    persons: 3,
    picks: {},
    favorites: ['sirniki'],
    blocks: ['oladi'],
    pins: [],
    lastMenu: [{ categoryId: 'breakfasts', dishIds: ['blini'] }],
    homemade: {},
    quickDinners: false,
    checked: { 'яйцо__шт': 2, 'соль__по вкусу': 0 },
    week: {},
    weekStart: null,
    batchRecords: {},
    weekChecked: {},
    weekHistory: [],
    stock: { 'картофель__г': 120.3, 'яйцо__шт': 2 },
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

test('autofill preserves complete meals and batch links, favors pins and skips blocked dishes', () => {
  const week = {
    'mon-breakfast': [{ dishId: 'blini', from: null }],
    'mon-lunch': [{ dishId: 'borshch', from: null }],
    'tue-lunch': [{ dishId: 'borshch', from: 'mon-lunch' }],
  };
  const previous = structuredClone(week);
  const result = fillEmptyMeals(week, data, { pins: ['sirniki', 'oladi'], blocks: ['oladi'] }, []);
  assert.deepEqual(result, { filled: 6, remaining: 12 });
  assert.deepEqual(week['tue-breakfast'], [{ dishId: 'sirniki', from: null }]);
  for (const [id, entries] of Object.entries(previous)) assert.deepEqual(week[id], entries);
  assert.ok(!Object.values(week).flat().some((entry) => entry.dishId === 'oladi'));
  assert.deepEqual(fillEmptyMeals(week, data, {}, []), { filled: 0, remaining: 12 });
});

test('weekly suggestions pair fish with a suitable side and complete mains with a light salad', () => {
  const catalog = { categories: [
    { id: 'dishes', dishes: [{ id: 'plov' }] },
    { id: 'meat', dishes: [{ id: 'fish', tags: ['light-side'] }] },
    { id: 'garnishes', dishes: [
      { id: 'potatoes' }, { id: 'bulgur', tags: ['light'] }, { id: 'broccoli', tags: ['light'] },
    ] },
    { id: 'salads', dishes: [{ id: 'olive' }, { id: 'arugula', tags: ['light'] }] },
  ] };
  const week = {};
  fillEmptyMeals(week, catalog, { blocks: ['broccoli'], pins: ['potatoes', 'olive'] }, []);
  const meals = Object.values(week).map((entries) => entries.map(({ dishId }) => dishId));
  assert.ok(meals.some(([id]) => id === 'plov'));
  assert.ok(meals.some(([id]) => id === 'fish'));
  for (const meal of meals) {
    assert.deepEqual(meal, meal[0] === 'plov' ? ['plov', 'arugula'] : ['fish', 'bulgur']);
  }

  const manual = {
    'mon-dinner': [{ dishId: 'plov', from: null }],
    'tue-lunch': [{ dishId: 'fish', from: null }],
  };
  const selection = [
    { categoryId: 'garnishes', dishes: [{ id: 'bulgur', tags: ['light'] }] },
    { categoryId: 'salads', dishes: [{ id: 'arugula', tags: ['light'] }] },
  ];
  assert.equal(distributeMenu(manual, selection, catalog), 2);
  assert.deepEqual(manual['mon-dinner'].map(({ dishId }) => dishId), ['plov', 'arugula']);
  assert.deepEqual(manual['tue-lunch'].map(({ dishId }) => dishId), ['fish', 'bulgur']);
});

test('quick dinners respect the whole meal time and preserve existing plans', () => {
  const catalog = { categories: [
    { id: 'meat', dishes: [
      { id: 'fish', tags: ['light-side'], recipe: { minutes: 20 } },
      { id: 'slow', recipe: { minutes: 75 } },
      { id: 'frozen', recipe: { minutes: 20, timeNote: 'без размораживания' } },
    ] },
    { id: 'garnishes', dishes: [
      { id: 'salad', tags: ['light'], recipe: { minutes: 10 } },
      { id: 'potatoes', recipe: { minutes: 15 } },
    ] },
  ] };
  const week = { 'mon-dinner': [{ dishId: 'slow', from: null }] };
  fillEmptyMeals(week, catalog, { quickDinners: true, pins: ['slow', 'frozen', 'potatoes'] }, []);
  assert.deepEqual(week['mon-dinner'], [{ dishId: 'slow', from: null }]);
  for (const [id, entries] of Object.entries(week)) {
    if (id.endsWith('-dinner') && id !== 'mon-dinner') {
      assert.deepEqual(entries.map(({ dishId }) => dishId), ['fish', 'salad']);
    }
  }
});

test('stored reserve combines fridge and freezer and keeps legacy storage without guessing quantities', () => {
  const week = { 'mon-lunch': [{ dishId: 'plov', from: null }] };
  const cookedAt = new Date(2025, 0, 6, 10).getTime();
  const dish = { ingredients: [{ name: 'рис' }] };
  const key = 'mon-lunch/plov';
  const legacy = sanitizeBatchRecords({ [key]: { cookedAt, storage: 'fridge' } }, week)[key];
  assert.equal(legacy.legacyStorage, 'fridge');
  assert.deepEqual(legacy.reserve, { fridge: 0, freezer: 0 });
  const record = { cookedAt, reserve: { fridge: 1, freezer: 2 } };
  assert.deepEqual(availablePortions(record, dish, '2025-01-06', 'mon-dinner', 2, cookedAt), { fridge: 1, freezer: 1 });
  assert.deepEqual(availablePortions(record, dish, '2025-01-06', 'tue-dinner', 2, cookedAt), { fridge: 0, freezer: 2 });
  assert.equal(availablePortions(record, dish, '2025-01-06', 'tue-dinner', 3, cookedAt), null);
});

test('copied shopping list keeps store departments and checkmarks', () => {
  const list = [{ name: 'молоко', qty: 300, unit: 'мл', checked: true }, { name: 'укроп', qty: 1, unit: 'пучок' }];
  const groups = groupShopping(list, [
    { name: 'Овощи и зелень', ingredients: ['укроп'] },
    { name: 'Молочное', ingredients: ['молоко'] },
  ]);
  assert.equal(shoppingText(groups), 'Овощи и зелень\n☐ укроп — 1 пучок\n\nМолочное\n✓ молоко — 300 мл');
});

test('local weekday and shared schedule preserve cooking and repeat order', () => {
  assert.equal(localDayId(new Date(2026, 10, 22)), 'sun');
  assert.equal(localDayId(new Date(2026, 10, 23)), 'mon');
  const week = {
    'tue-lunch': [{ dishId: 'borshch', from: 'mon-lunch' }],
    'mon-lunch': [{ dishId: 'borshch', from: null }, { dishId: 'unknown', from: null }],
  };
  assert.equal(formatWeekSchedule(week, (id) => ({ borshch: 'Борщ' })[id]),
    'Понедельник\nОбед — Борщ\n\nВторник\nОбед — Борщ (повторная подача · Пн · обед)');
});

test('stale writes merge unrelated edits and reject competing changes to the same plan', () => {
  const base = loadLegacyState();
  const week = { 'mon-lunch': [{ dishId: 'borshch', from: null }] };
  const saved = mergeChanges(base, { ...base, week, weekStart: '2026-11-23' }, base);
  assert.equal(saved.error, '');
  const merged = mergeChanges(base, { ...base, persons: 4, prices: { 'рис__г': 0 } }, saved.state);
  assert.equal(merged.error, '');
  assert.deepEqual(merged.state.week, week);
  assert.equal(merged.state.prices['рис__г'], 0);
  const competing = mergeChanges(base, { ...base, week: { 'tue-lunch': week['mon-lunch'] } }, merged.state);
  assert.equal(competing.error, 'conflict');
  assert.equal(competing.state.persons, 4);
  assert.deepEqual(competing.state.week, week);
});

test('a group move preserves links and freezer intent while isolated replacement detaches the repeat', () => {
  const week = {
    'mon-lunch': [{ dishId: 'plov', from: null }],
    'tue-dinner': [{ dishId: 'plov', from: 'mon-lunch', storage: 'freezer' }],
    'wed-lunch': [{ dishId: 'soup', from: null }],
  };
  assert.equal(moveMealDish(week, 'mon-lunch', 'sun-lunch', 'plov'), null);
  assert.equal(moveMealDish(week, 'tue-dinner', 'mon-breakfast', 'plov'), null);
  const moved = moveMealDish(week, 'mon-lunch', 'tue-lunch', 'plov');
  assert.deepEqual(moved['wed-dinner'], [{ dishId: 'plov', from: 'tue-lunch', storage: 'freezer' }]);
  assert.deepEqual(moved['wed-lunch'], week['wed-lunch']);
  assert.equal(cookingBatches(moved).find(({ dishId }) => dishId === 'plov').mealCount, 2);
  const replacedGroup = replaceMealDish(moved, 'tue-lunch', 'plov', 'duck');
  assert.deepEqual(replacedGroup['wed-dinner'], [{ dishId: 'duck', from: 'tue-lunch', storage: 'freezer' }]);
  const separate = replaceMealDish(moved, 'wed-dinner', 'plov', 'duck');
  assert.deepEqual(separate['wed-dinner'], [{ dishId: 'duck', from: null }]);
});

test('rice uses the shorter planning window and deadline', () => {
  const rice = { ingredients: [{ name: 'рис' }] };
  const soup = { ingredients: [{ name: 'картофель' }] };
  assert.equal(needsFreezer(rice, 'mon-lunch', 'mon-dinner'), false);
  assert.equal(needsFreezer(rice, 'mon-lunch', 'tue-breakfast'), true);
  assert.equal(needsFreezer(soup, 'mon-lunch', 'tue-dinner'), false);
  assert.equal(needsFreezer(soup, 'mon-lunch', 'wed-breakfast'), true);
  assert.equal(fridgeDeadline(rice, { cookedAt: 1 }), 86_400_001);
  assert.equal(fridgeDeadline(soup, { cookedAt: 1 }), 172_800_001);
});

test('stock deducts only the matching units and covered products leave the shopping list', () => {
  const ingredients = [
    { name: 'картофель', qty: 200.3, unit: 'г' },
    { name: 'яйцо', qty: 2, unit: 'шт' },
    { name: 'соль', qty: 0, unit: 'по вкусу' },
    { name: 'молоко', qty: 120, unit: 'мл' },
  ];
  assert.deepEqual(subtractStock(ingredients, {
    'картофель__г': 120.2, 'яйцо__шт': 3, 'соль__по вкусу': 5, 'молоко__г': 100,
  }), [
    { name: 'картофель', qty: 80.1, unit: 'г', inStock: 120.2 },
    ingredients[2],
    { ...ingredients[3], inStock: 0 },
  ]);
});

test('the dough catalog covers homemade dough, packaged dough and pasta used in the dishes', () => {
  const readYaml = (name) => YAML.parse(readFileSync(new URL(`../data/${name}.yml`, import.meta.url), 'utf8'));
  const dishes = readYaml('dishes').categories.flatMap((category) => category.dishes);
  const recipes = readYaml('recipes');
  const dough = readYaml('dough');
  const packaged = new Set(['тесто слоёное', 'лапша', 'макароны', 'пельмени']);
  const expected = dishes.filter((dish) => dish.id === 'sirniki' ||
    dish.ingredients.some(({ name }) => packaged.has(name)) ||
    recipes[dish.id].steps.some((step) => /тест(?:о|а|у|е|ом)(?=[\s,.!?]|$)/iu.test(step)));
  assert.deepEqual(new Set(Object.keys(dough)), new Set(expected.map(({ id }) => id)));
  assert.notEqual(dough.blini.type, dough.oladi.type);
  assert.notEqual(dough.lagman.type, dough.lapsha.type);
  assert.equal(dough['sloiki-s-vishnei'].replaces, 'тесто слоёное');
  for (const entry of Object.values(dough)) {
    if (!entry.replaces) assert.deepEqual(Object.keys(entry), ['type']);
  }
  assert.ok(dough.pelmeni.ingredients.some(({ name }) => name === 'мясо говядина'));
});
