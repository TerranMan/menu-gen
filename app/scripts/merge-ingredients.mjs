#!/usr/bin/env node
// Сливает ingredients-draft.yml в dishes.yml.
// Идемпотентный: повторный запуск даёт тот же результат.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DISHES = resolve(ROOT, 'data', 'dishes.yml');
const DRAFT = resolve(ROOT, 'data', 'ingredients-draft.yml');

if (!existsSync(DRAFT)) {
  console.error(`Не найден ${DRAFT}`);
  process.exit(1);
}

const doc = YAML.parse(readFileSync(DISHES, 'utf-8'));
const draft = YAML.parse(readFileSync(DRAFT, 'utf-8'));
const drafts = draft.ingredients ?? {};

let merged = 0;
let missing = 0;
const noDraft = [];

for (const cat of doc.categories) {
  for (const dish of cat.dishes) {
    const ing = drafts[dish.id];
    if (!ing) {
      missing++;
      noDraft.push(dish.id);
      continue;
    }
    dish.ingredients = ing;
    merged++;
  }
}

writeFileSync(DISHES, `# Источник правды по блюдам.\n\n` + YAML.stringify(doc, { lineWidth: 0 }), 'utf-8');

console.log(`Смерджено: ${merged} блюд`);
if (missing) {
  console.warn(`Без черновика: ${missing}: ${noDraft.join(', ')}`);
}
