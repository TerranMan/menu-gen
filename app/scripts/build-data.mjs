#!/usr/bin/env node
// yml → json. Валидирует уникальность id, корректность единиц измерения,
// существование указанных файлов картинок.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DISHES_YML = resolve(ROOT, 'data', 'dishes.yml');
const DISHES_JSON = resolve(ROOT, 'data', 'dishes.json');
const RECIPES_YML = resolve(ROOT, 'data', 'recipes.yml');
const DOUGH_YML = resolve(ROOT, 'data', 'dough.yml');
const PRICES_YML = resolve(ROOT, 'data', 'prices.yml');
const PRICES_JSON = resolve(ROOT, 'data', 'prices.json');
const ALLOWED_UNITS = new Set([
  'г', 'мл', 'шт', 'ст.л.', 'ч.л.', 'зубчик', 'пучок', 'по вкусу',
]);

function fail(msg) {
  console.error(`build-data: ${msg}`);
  process.exit(1);
}

function readRecipeMap(path) {
  if (!existsSync(path)) fail(`не найден ${path}`);
  const recipes = YAML.parse(readFileSync(path, 'utf8'));
  if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) {
    fail(`${basename(path)}: ожидается словарь рецептов по id блюд`);
  }
  return recipes;
}

function hasSteps(steps) {
  return Array.isArray(steps) && steps.length > 0 &&
    steps.every((step) => typeof step === 'string' && step.trim());
}

function validateRecipe(id, recipe) {
  if (!recipe || !Number.isInteger(recipe.portions) || recipe.portions < 1 ||
      !Number.isInteger(recipe.minutes) || recipe.minutes < 1 ||
      (recipe.wholeBatch !== undefined && typeof recipe.wholeBatch !== 'boolean') ||
      (recipe.timeNote !== undefined && (typeof recipe.timeNote !== 'string' || !recipe.timeNote.trim())) ||
      !hasSteps(recipe.steps)) {
    fail(`${id}: рецепт должен содержать положительные portions/minutes и непустые steps`);
  }
}

function buildDough(dish, dough) {
  if (!dough || typeof dough.type !== 'string' || !dough.type.trim()) {
    fail(`${dish.id}: у теста должен быть указан type`);
  }
  if (dough.replaces === undefined) {
    if (Object.keys(dough).some((key) => key !== 'type')) {
      fail(`${dish.id}: состав и шаги встроенного теста указываются в основном рецепте`);
    }
    return dough;
  }
  if (!dish.ingredients?.some((ing) => ing.name === dough.replaces)) {
    fail(`${dish.id}: готового продукта ${dough.replaces} нет в составе блюда`);
  }
  if (!Number.isInteger(dough.minutes) || dough.minutes < 1
      || (dough.complete !== undefined && typeof dough.complete !== 'boolean')) {
    fail(`${dish.id}: у домашнего варианта должны быть положительные minutes`);
  }
  if (!hasSteps(dough.steps) || !Array.isArray(dough.ingredients) || !dough.ingredients.length) {
    fail(`${dish.id}: у домашней замены должны быть ingredients и steps`);
  }
  if (dough.title !== undefined && (typeof dough.title !== 'string' || !dough.title.trim())) {
    fail(`${dish.id}: название домашнего варианта должно быть непустой строкой`);
  }
  const keys = new Set();
  for (const ing of dough.ingredients) {
    if (!ing || typeof ing.name !== 'string' || !ing.name.trim() || !ALLOWED_UNITS.has(ing.unit) ||
        !Number.isFinite(ing.qty) || ing.qty < 0 || (ing.qty === 0 && ing.unit !== 'по вкусу')) {
      fail(`${dish.id}: некорректный ингредиент теста ${JSON.stringify(ing)}`);
    }
    const key = `${ing.name}/${ing.unit}`;
    if (keys.has(key)) fail(`${dish.id}: дублирующийся ингредиент теста ${ing.name}`);
    keys.add(key);
  }
  return dough;
}

function buildDishes() {
  if (!existsSync(DISHES_YML)) fail(`не найден ${DISHES_YML}`);
  const doc = YAML.parse(readFileSync(DISHES_YML, 'utf-8'));
  const recipes = readRecipeMap(RECIPES_YML);
  const dough = readRecipeMap(DOUGH_YML);

  if (!Array.isArray(doc.categories)) fail('dishes.yml: categories должен быть массивом');

  const allIds = new Set();
  let total = 0;
  let withImages = 0;
  const issues = [];

  for (const cat of doc.categories) {
    if (!cat.id || !cat.name || typeof cat.pick !== 'number') {
      fail(`категория без id/name/pick: ${JSON.stringify(cat)}`);
    }
    if (!Array.isArray(cat.dishes) || cat.dishes.length === 0) {
      fail(`категория ${cat.id}: пустой список блюд`);
    }
    if (cat.pick > cat.dishes.length) {
      issues.push(`${cat.id}: pick=${cat.pick} > ${cat.dishes.length} блюд — меню будет меньше запрошенного`);
    }
    for (const d of cat.dishes) {
      if (!d.id || !d.name) fail(`блюдо без id/name в ${cat.id}: ${JSON.stringify(d)}`);
      if (allIds.has(d.id)) fail(`дублирующийся id: ${d.id}`);
      allIds.add(d.id);
      total++;
      if (cat.id === 'kids' && (!['breakfast', 'main'].includes(d.childMeal) ||
          typeof d.childServing !== 'string' || !d.childServing.trim())) {
        fail(`${d.id}: для детского блюда укажите приём пищи и способ подачи`);
      }
      validateRecipe(d.id, recipes[d.id]);
      d.recipe = recipes[d.id];
      if (Object.hasOwn(dough, d.id)) d.dough = buildDough(d, dough[d.id]);

      if (d.image) {
        const imgPath = resolve(ROOT, 'public', d.image);
        if (!existsSync(imgPath)) {
          issues.push(`${d.id}: image ${d.image} не найден на диске → выставляю null`);
          d.image = null;
        } else {
          withImages++;
        }
      }

      // Если image null — нужен emoji-фолбэк
      if (!d.image && !d.emoji) {
        issues.push(`${d.id}: image=null и нет emoji — UI покажет category-fallback`);
      }

      if (Array.isArray(d.ingredients)) {
        for (const ing of d.ingredients) {
          if (!ing.name) fail(`${d.id}: ингредиент без name`);
          if (ing.unit && !ALLOWED_UNITS.has(ing.unit)) {
            fail(`${d.id}/${ing.name}: неизвестная единица ${ing.unit}. Разрешены: ${[...ALLOWED_UNITS].join(', ')}`);
          }
        }
      }
    }
  }

  for (const id of Object.keys(recipes)) {
    if (!allIds.has(id)) fail(`recipes.yml: неизвестное блюдо ${id}`);
  }
  for (const id of Object.keys(dough)) {
    if (!allIds.has(id)) fail(`dough.yml: неизвестное блюдо ${id}`);
  }

  writeFileSync(DISHES_JSON, JSON.stringify(doc), 'utf-8');
  console.log(`dishes.json: ${doc.categories.length} категорий, ${total} блюд, ${withImages} с картинками`);
  if (issues.length) {
    console.warn('Предупреждения:');
    for (const i of issues) console.warn(`  - ${i}`);
  }
}

function buildPrices() {
  if (!existsSync(PRICES_YML)) {
    writeFileSync(PRICES_JSON, JSON.stringify({ prices: {} }), 'utf-8');
    console.log('prices.json: справочник цен пока пуст (prices.yml отсутствует)');
    return;
  }
  const doc = YAML.parse(readFileSync(PRICES_YML, 'utf-8'));
  writeFileSync(PRICES_JSON, JSON.stringify(doc), 'utf-8');
  console.log(`prices.json: ${Object.keys(doc.prices ?? {}).length} цен`);
}

buildDishes();
buildPrices();
