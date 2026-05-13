#!/usr/bin/env node
// Wikimedia Commons → public/images/{id}.webp + credits.json.
// Идемпотентный: пропускает блюда у которых уже есть файл. Можно прерывать и продолжать.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DISHES_YML = resolve(ROOT, 'data', 'dishes.yml');
const CREDITS = resolve(ROOT, 'data', 'credits.json');
const IMG_DIR = resolve(ROOT, 'public', 'images');

const UA = 'menu-gen/0.1 (family menu generator; https://github.com/TerranMan/menu-gen)';
const API = 'https://commons.wikimedia.org/w/api.php';
const PEXELS_API = 'https://api.pexels.com/v1/search';
const PEXELS_KEY = process.env.PEXELS_API_KEY ?? '';

const ARGS = new Set(process.argv.slice(2));
const FORCE = ARGS.has('--force'); // переcкачать даже если файл есть
const PEXELS_FIRST = ARGS.has('--pexels-first');
const LIMIT = (() => {
  for (const a of ARGS) {
    const m = a.match(/^--limit=(\d+)$/);
    if (m) return Number(m[1]);
  }
  return Infinity;
})();

// English-подсказки для русских блюд — Commons лучше находит их.
// Не обязательны; если нет — поиск идёт по русскому имени и упрощённой версии.
const EN_HINT = {
  // bakery
  'pirozhki-s-yaitsom-i-lukom': 'baked pirozhki pastry buns Russian',
  'pirozhki-s-yablokom': 'pirozhki apple',
  'sloiki-s-vishnei': 'cherry puff pastry',
  sharlotka: 'sharlotka Russian apple pie',
  'sloiki-s-yablokom-i-koritsei': 'apple cinnamon puff pastry',
  mannik: 'mannik manna cake Russian semolina dessert',
  'pechene-sdobnoe': 'sweet biscuit cookies',
  keks: 'pound cake',
  chebureki: 'chebureki',
  'pirog-s-persikami': 'peach pie',

  // breakfasts
  blini: 'blini Russian pancakes',
  oladi: 'oladi Russian pancakes',
  sirniki: 'syrniki cottage cheese pancakes',
  'mannaya-kasha': 'semolina porridge',
  'ovsyanaya-kasha': 'oatmeal porridge',
  yogurt: 'yogurt bowl',
  bekon: 'bacon strips cooked',
  glazunya: 'sunny side up egg',
  'skrembl-s-pomidorami': 'scrambled eggs tomatoes',
  'pshenichnaya-kasha': 'wheat porridge',
  'konservirovannie-yagodi': 'canned berries',
  'svezhie-yagodi': 'fresh berries bowl',
  'konservirovannie-frukti': 'canned fruit',
  'svezhie-frukti': 'fresh fruit bowl',
  vetchina: 'ham slices',
  sosiski: 'sausages cooked',
  goroshek: 'green peas bowl',
  grenki: 'toast bread',
  'goryachie-tosti-s-dzhemom': 'toast with jam',
  'khlopya-s-molokom': 'cereal with milk',
  'khlopya-s-yogurtom': 'cereal with yogurt',
  omlet: 'omelette plate',
  tvorog: 'cottage cheese bowl',
  'tvorozhnaya-massa': 'sweet cottage cheese',

  // dishes
  plov: 'plov Uzbek pilaf rice meat carrot dish',
  lagman: 'lagman Uzbek noodle soup beef',
  okroshka: 'okroshka soup',
  'kartoshka-zharenaya': 'fried potatoes',
  'kartoshka-s-selyodkoi': 'potatoes with herring',
  'varyonaya-kukuruza': 'boiled corn cob',
  'kapusta-tushyonaya': 'braised cabbage',
  'kuritsa-s-kartoshkoi-v-dukhovke': 'roast chicken potatoes',
  'zapekanka-gorokhovaya-kasha-s-myasom': 'pea porridge with meat',
  pelmeni: 'pelmeni dumplings',
  chakhokhbili: 'chakhokhbili Georgian chicken stew',
  ragu: 'meat stew ragout',

  // fruits/vegetables
  banani: 'bananas',
  greipfruti: 'grapefruit',
  apelsini: 'oranges',
  mandarini: 'mandarin oranges',
  yabloki: 'apples red fresh fruit bowl',
  grushi: 'pears',
  vinograd: 'grapes',
  kivi: 'kiwifruit',
  avokado: 'avocado fruit',
  persiki: 'peaches',
  khurma: 'persimmon fruit',
  slivi: 'plums fruit',
  'yagodi-po-sezonu': 'mixed berries',
  abrikosi: 'apricots',
  nektarini: 'nectarines',

  // garnishes
  pyure: 'mashed potatoes',
  grechka: 'buckwheat porridge',
  ris: 'cooked rice',
  makaroni: 'pasta cooked',
  'svezhie-ovoshchi': 'fresh vegetables plate',
  'zamorozka-ovoshchnaya': 'frozen vegetables mix',
  lapsha: 'noodles cooked',
  yachnevaya: 'barley porridge',

  // meat
  steiki: 'steak meat',
  kotleti: 'kotleti Russian cooked meat patties cutlets',
  'riba-belaya': 'cooked cod fillet white fish plate',
  'riba-krasnaya': 'salmon fillet',
  gulyash: 'goulash',
  'kurinie-berda': 'chicken thighs',
  'kurinie-krilya': 'chicken wings',
  'kurinie-nogi': 'chicken legs',
  'kurinaya-grudka': 'chicken breast',
  befstroganov: 'beef stroganoff',
  krevetki: 'cooked shrimps',
  'vetchina-2': 'ham slices',
  'sosiski-2': 'sausages cooked',
  sardelki: 'pork sausages',
  krolik: 'rabbit stew',
  utka: 'roasted duck',

  // salads
  'ogurtsi-pomidori': 'cucumber tomato salad',
  'koul-slou': 'coleslaw',
  'svyokla-s-chesnokom-i-orekhami': 'beet salad nuts',
  'kapustnii-salat-vitaminnii-s-morkovkoi-y': 'cabbage carrot salad',
  krabovii: 'crab salad',
  'selyodka-pod-shuboi': 'shuba dressed herring salad',
  olive: 'olivier salad',
  's-kartoshkoi-i-yaitsom': 'potato egg salad',
  grecheskii: 'greek salad',
  vinegret: 'vinaigrette Russian salad',

  // soups
  borshch: 'borscht soup',
  shchi: 'shchi cabbage soup',
  gorokhovii: 'pea soup',
  solyanka: 'solyanka soup',
  'ukha-po-finski': 'finnish creamy fish soup',
  'krem-sup-iz-chechevitsi': 'lentil cream soup',
  'sup-iz-ribnoi-konservi': 'canned fish soup',
  'kurinaya-lapsha': 'chicken noodle soup',
};

function firstWord(name) {
  // "Пирожки с яйцом..." → "Пирожки"
  return name.split(/\s+/)[0];
}

function fetchJson(url) {
  return fetch(url, { headers: { 'User-Agent': UA } }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  });
}

function fetchBuffer(url) {
  return fetch(url, { headers: { 'User-Agent': UA } }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.arrayBuffer().then((b) => Buffer.from(b));
  });
}

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1200',
    origin: '*',
  });
  const data = await fetchJson(`${API}?${params}`);
  const pages = data?.query?.pages;
  if (!pages) return [];
  return Object.values(pages)
    .map((p) => ({
      title: p.title,
      info: p.imageinfo?.[0],
    }))
    .filter((p) => p.info && /^image\/(jpeg|png|webp)$/.test(p.info.mime))
    .filter((p) => (p.info.width ?? 0) >= 400 && (p.info.height ?? 0) >= 300);
}

async function searchPexels(query) {
  if (!PEXELS_KEY) return [];
  const params = new URLSearchParams({ query, per_page: '5', orientation: 'landscape' });
  const r = await fetch(`${PEXELS_API}?${params}`, {
    headers: { Authorization: PEXELS_KEY, 'User-Agent': UA },
  });
  if (!r.ok) throw new Error(`Pexels HTTP ${r.status}`);
  const data = await r.json();
  return (data.photos ?? []).map((p) => ({
    title: `Pexels #${p.id} by ${p.photographer}`,
    info: {
      mime: 'image/jpeg',
      url: p.src.original,
      thumburl: p.src.large,
      width: p.width,
      height: p.height,
      descriptionurl: p.url,
      extmetadata: {
        Artist: { value: p.photographer },
        LicenseShortName: { value: 'Pexels License' },
      },
    },
  }));
}

async function tryWikimedia(dish) {
  const wikiQueries = [];
  const hint = EN_HINT[dish.id];
  if (hint) wikiQueries.push(hint);
  wikiQueries.push(dish.name);
  const fw = firstWord(dish.name);
  if (fw.length >= 4 && fw.toLowerCase() !== dish.name.toLowerCase()) {
    wikiQueries.push(fw);
  }
  if (hint && hint.split(/\s+/).length > 1) {
    wikiQueries.push(hint.split(/\s+/)[0]);
  }
  for (const q of wikiQueries) {
    try {
      const hits = await searchCommons(q);
      if (hits.length > 0) return { source: 'wikimedia', hit: hits[0], query: q };
    } catch (e) {
      console.warn(`  wiki "${q}" failed: ${e.message}`);
    }
  }
  return null;
}

async function tryPexels(dish) {
  if (!PEXELS_KEY) return null;
  const hint = EN_HINT[dish.id];
  const queries = [hint, dish.name].filter(Boolean);
  for (const q of queries) {
    try {
      const hits = await searchPexels(q);
      if (hits.length > 0) return { source: 'pexels', hit: hits[0], query: q };
    } catch (e) {
      console.warn(`  pexels "${q}" failed: ${e.message}`);
    }
  }
  return null;
}

async function findImage(dish) {
  if (PEXELS_FIRST) {
    return (await tryPexels(dish)) ?? (await tryWikimedia(dish));
  }
  return (await tryWikimedia(dish)) ?? (await tryPexels(dish));
}

function plainText(extmeta, key) {
  const v = extmeta?.[key]?.value;
  if (!v) return null;
  return String(v).replace(/<[^>]+>/g, '').trim();
}

async function processDish(dish, credits) {
  const outFile = resolve(IMG_DIR, `${dish.id}.webp`);
  if (!FORCE && existsSync(outFile)) {
    if (!dish.image) dish.image = `images/${dish.id}.webp`;
    return { status: 'skip', dish };
  }
  const found = await findImage(dish);
  if (!found) {
    console.warn(`  ${dish.id}: ничего не найдено`);
    return { status: 'miss', dish };
  }
  const { hit, query } = found;
  const downloadUrl = hit.info.thumburl || hit.info.url;
  try {
    const buf = await fetchBuffer(downloadUrl);
    await sharp(buf)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(outFile);

    dish.image = `images/${dish.id}.webp`;
    credits[dish.id] = {
      source: hit.info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(hit.title)}`,
      title: hit.title,
      query,
      artist: plainText(hit.info.extmetadata, 'Artist'),
      license: plainText(hit.info.extmetadata, 'LicenseShortName'),
    };
    return { status: 'ok', dish };
  } catch (e) {
    console.warn(`  ${dish.id}: ошибка скачивания/конверсии: ${e.message}`);
    return { status: 'error', dish };
  }
}

async function main() {
  if (!existsSync(DISHES_YML)) {
    console.error(`Не найден ${DISHES_YML}`);
    process.exit(1);
  }
  if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

  const raw = readFileSync(DISHES_YML, 'utf-8');
  const doc = YAML.parse(raw);
  const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf-8')) : {};

  const stats = { ok: 0, skip: 0, miss: 0, error: 0 };
  let processed = 0;

  for (const cat of doc.categories) {
    for (const dish of cat.dishes) {
      if (processed >= LIMIT) break;
      processed++;
      console.log(`[${processed}] ${dish.id} (${dish.name})`);
      const res = await processDish(dish, credits);
      stats[res.status]++;

      // Сохраняем YAML и credits после каждого успешного скачивания
      if (res.status === 'ok') {
        writeFileSync(DISHES_YML, YAML.stringify(doc, { lineWidth: 0 }), 'utf-8');
        writeFileSync(CREDITS, JSON.stringify(credits, null, 2), 'utf-8');
      }
      // мягкая пауза
      await new Promise((r) => setTimeout(r, 400));
    }
    if (processed >= LIMIT) break;
  }

  // Финальная запись (на случай если только skip)
  writeFileSync(DISHES_YML, YAML.stringify(doc, { lineWidth: 0 }), 'utf-8');
  writeFileSync(CREDITS, JSON.stringify(credits, null, 2), 'utf-8');

  console.log(`\nИтог: ok=${stats.ok}, skip=${stats.skip}, miss=${stats.miss}, error=${stats.error}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
