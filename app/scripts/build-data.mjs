#!/usr/bin/env node
// yml → json. Валидирует уникальность id, корректность единиц измерения,
// существование указанных файлов картинок.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DISHES_YML = resolve(ROOT, 'data', 'dishes.yml');
const DISHES_JSON = resolve(ROOT, 'data', 'dishes.json');
const PRICES_YML = resolve(ROOT, 'data', 'prices.yml');
const PRICES_JSON = resolve(ROOT, 'data', 'prices.json');
const IMAGES_DIR = resolve(ROOT, 'public', 'images');

const ALLOWED_UNITS = new Set([
  'г', 'мл', 'шт', 'ст.л.', 'ч.л.', 'зубчик', 'пучок', 'по вкусу',
]);

function fail(msg) {
  console.error(`build-data: ${msg}`);
  process.exit(1);
}

function buildDishes() {
  if (!existsSync(DISHES_YML)) fail(`не найден ${DISHES_YML}`);
  const doc = YAML.parse(readFileSync(DISHES_YML, 'utf-8'));

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
      issues.push(`${cat.id}: pick=${cat.pick} > ${cat.dishes.length} блюд — будет повтор при генерации`);
    }
    for (const d of cat.dishes) {
      if (!d.id || !d.name) fail(`блюдо без id/name в ${cat.id}: ${JSON.stringify(d)}`);
      if (allIds.has(d.id)) fail(`дублирующийся id: ${d.id}`);
      allIds.add(d.id);
      total++;

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
