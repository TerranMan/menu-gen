#!/usr/bin/env node
// One-shot: legacy/settings.yml → app/data/dishes.yml в новой схеме.
// Запуск: npm run migrate  (с --force чтобы перезаписать существующий dishes.yml)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import CyrillicToTranslitModule from 'cyrillic-to-translit-js';

const CyrillicToTranslit = CyrillicToTranslitModule.default || CyrillicToTranslitModule;
const translit = new CyrillicToTranslit();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SRC = resolve(ROOT, 'legacy', 'settings.yml');
const OUT = resolve(ROOT, 'app', 'data', 'dishes.yml');

const FORCE = process.argv.includes('--force');

// Фикс старой опечатки + сохранение остальных id.
const TYPE_REMAP = {
  fregetables: 'fruits_vegetables',
};

function slugify(name) {
  return translit
    .transform(name.toLowerCase(), '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function uniqueSlug(base, taken) {
  let slug = base || 'dish';
  let i = 2;
  while (taken.has(slug)) {
    slug = `${base}-${i++}`;
  }
  taken.add(slug);
  return slug;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dedupeByName(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const v = capitalize(raw.trim().replace(/\s+/g, ' '));
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

function migrate() {
  if (!existsSync(SRC)) {
    console.error(`Не найден ${SRC}`);
    process.exit(1);
  }
  if (existsSync(OUT) && !FORCE) {
    console.error(`${OUT} уже существует. Используй --force чтобы перезаписать.`);
    process.exit(1);
  }

  const legacy = YAML.parse(readFileSync(SRC, 'utf-8'));

  const usedIds = new Set();
  const categories = legacy.map((cat) => {
    const catId = TYPE_REMAP[cat.type] ?? cat.type;
    const dishes = dedupeByName(cat.values).map((name) => {
      const id = uniqueSlug(slugify(name), usedIds);
      return {
        id,
        name,
        image: null,
        tags: [],
        ingredients: [],
      };
    });
    return {
      id: catId,
      name: cat.name,
      pick: cat.count,
      dishes,
    };
  });

  const doc = {
    version: 1,
    portions: 2,
    categories,
  };

  writeFileSync(
    OUT,
    `# Источник правды по блюдам.\n# Сгенерирован из legacy/settings.yml. Правится вручную.\n\n` +
      YAML.stringify(doc, { lineWidth: 0 }),
    'utf-8',
  );

  const total = categories.reduce((s, c) => s + c.dishes.length, 0);
  console.log(`OK: ${categories.length} категорий, ${total} блюд → ${OUT}`);
}

migrate();
