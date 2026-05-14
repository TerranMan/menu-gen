// Агрегация ингредиентов по всем блюдам недельного меню.
// Группировка по (name, unit). "по вкусу" не суммируется — оставляем как пометку.
// scaleQty применяется в двух местах: к ингредиентам внутри карточки (до агрегации)
// и к финальному qty группы внутри aggregate (один раз на группу, без накопления ceil).
// Ложки нормализуются в граммы/мл перед агрегацией шопинг-листа, чтобы одинаковые
// ингредиенты не дублировались («сахар 15 ст.л.» + «сахар 150 г» → одна строка в г).

const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

const UPWARD_UNITS = new Set(['шт', 'зубчик', 'пучок']);
const SPOON_UNITS = new Set(['ст.л.', 'ч.л.']);

// Стандартные кулинарные плотности (грамм или мл на 1 ложку).
// Жидкости → мл (объём ложки), сыпучие и густые → грамм (плотность × объём).
const SPOON_NORM = {
  // Жидкости
  'масло растительное': { 'ст.л.': 15, 'ч.л.': 5, unit: 'мл' },
  'масло оливковое':    { 'ст.л.': 15, 'ч.л.': 5, unit: 'мл' },
  'соевый соус':        { 'ст.л.': 15, 'ч.л.': 5, unit: 'мл' },
  'уксус':              { 'ст.л.': 15, 'ч.л.': 5, unit: 'мл' },

  // Сыпучие
  'сахар':              { 'ст.л.': 25, 'ч.л.': 5,  unit: 'г' },
  'мука':               { 'ст.л.': 25, 'ч.л.': 10, unit: 'г' },
  'крахмал':            { 'ст.л.': 30, 'ч.л.': 10, unit: 'г' },
  'сода':               { 'ст.л.': 28, 'ч.л.': 12, unit: 'г' },
  'разрыхлитель':       { 'ст.л.': 10, 'ч.л.': 4,  unit: 'г' },
  'дрожжи сухие':       { 'ст.л.': 12, 'ч.л.': 4,  unit: 'г' },
  'ванилин':            { 'ст.л.': 12, 'ч.л.': 4,  unit: 'г' },
  'корица':             { 'ст.л.': 20, 'ч.л.': 8,  unit: 'г' },
  'специи':             { 'ст.л.': 10, 'ч.л.': 5,  unit: 'г' },

  // Густые
  'мёд':                { 'ст.л.': 30, 'ч.л.': 12, unit: 'г' },
  'сметана':            { 'ст.л.': 25, 'ч.л.': 10, unit: 'г' },
  'майонез':            { 'ст.л.': 25, 'ч.л.': 10, unit: 'г' },
  'томатная паста':     { 'ст.л.': 30, 'ч.л.': 10, unit: 'г' },
  'джем':               { 'ст.л.': 30, 'ч.л.': 10, unit: 'г' },
  'горчица':            { 'ст.л.': 25, 'ч.л.': 10, unit: 'г' },
};

const DEFAULT_SPOON = { 'ст.л.': 15, 'ч.л.': 5, unit: 'г' };

function normalizeForShopping(ing) {
  if (!SPOON_UNITS.has(ing.unit)) return ing;
  const spec = SPOON_NORM[ing.name] ?? DEFAULT_SPOON;
  return { name: ing.name, qty: ing.qty * spec[ing.unit], unit: spec.unit };
}

export function scaleQty(qty, unit, factor) {
  if (unit === 'по вкусу') return qty;
  const raw = qty * factor;
  if (UPWARD_UNITS.has(unit)) return Math.ceil(raw);
  return Math.round(raw * 10) / 10;
}

export function aggregate(dishes, factor = 1) {
  const map = new Map();
  for (const d of dishes) {
    for (const ing of d.ingredients ?? []) {
      const norm = normalizeForShopping(ing);
      const key = `${norm.name}__${norm.unit}`;
      const existing = map.get(key);
      if (existing) {
        existing.qty += norm.qty;
      } else {
        map.set(key, { ...norm });
      }
    }
  }
  for (const ing of map.values()) {
    ing.qty = scaleQty(ing.qty, ing.unit, factor);
  }
  const list = [...map.values()];
  list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return list;
}

export function formatLine(ing) {
  if (ing.unit === 'по вкусу') return `${ing.name} — по вкусу`;
  return `${ing.name} — ${fmt.format(ing.qty)} ${ing.unit}`;
}

// Для карточки блюда: ложки с подсказкой в граммах/мл. «сахар — 1 ст.л. (15 г)».
// Если unit не ложка — обычный формат как formatLine.
export function formatCardIngredient(ing) {
  if (ing.unit === 'по вкусу') return `${ing.name} — по вкусу`;
  if (SPOON_UNITS.has(ing.unit)) {
    const spec = SPOON_NORM[ing.name] ?? DEFAULT_SPOON;
    const normQty = Math.round(ing.qty * spec[ing.unit] * 10) / 10;
    return `${ing.name} — ${fmt.format(ing.qty)} ${ing.unit} (${fmt.format(normQty)} ${spec.unit})`;
  }
  return `${ing.name} — ${fmt.format(ing.qty)} ${ing.unit}`;
}

export function priceKey(ing) {
  return `${ing.name}__${ing.unit}`;
}

// Стоимость строки: qty × цена за единицу. null если цены нет или unit=по вкусу.
// p = 0 считается валидной ценой (специи).
export function lineCost(ing, prices) {
  if (ing.unit === 'по вкусу') return null;
  const p = prices[priceKey(ing)];
  if (typeof p !== 'number' || p < 0) return null;
  return Math.round(ing.qty * p);
}

export function totalCost(list, prices) {
  let sum = 0;
  let missing = 0;
  for (const ing of list) {
    const c = lineCost(ing, prices);
    if (c == null) {
      if (ing.unit !== 'по вкусу') missing++;
    } else {
      sum += c;
    }
  }
  return { sum, missing };
}

const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export function formatMoney(n) {
  return `${moneyFmt.format(n)} ₽`;
}
