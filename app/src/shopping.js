// Агрегация ингредиентов по всем блюдам недельного меню.
// Группировка по (name, unit). "по вкусу" не суммируется — оставляем как пометку.
// В списке покупок округление применяется после сложения масштабированных количеств.
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

export function recipeFactor(recipe, persons) {
  const factor = persons / recipe.portions;
  return recipe.wholeBatch ? Math.ceil(factor) : factor;
}

export function scaleQty(qty, unit, factor, { roundPieces = true } = {}) {
  if (unit === 'по вкусу') return qty;
  const raw = qty * factor;
  if (roundPieces && UPWARD_UNITS.has(unit)) {
    // Убираем погрешность сложения дробных порций около целого числа.
    return Math.ceil(raw - Number.EPSILON * raw * 2);
  }
  return Math.round(raw * 10) / 10;
}

export function aggregate(dishes, factor = 1) {
  const map = new Map();
  for (const d of dishes) {
    const multiplier = typeof factor === 'function' ? factor(d) : factor;
    for (const ing of d.ingredients ?? []) {
      const norm = normalizeForShopping(ing);
      const key = `${norm.name}__${norm.unit}`;
      const qty = norm.unit === 'по вкусу' ? norm.qty : norm.qty * multiplier;
      const existing = map.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        map.set(key, { ...norm, qty });
      }
    }
  }
  for (const ing of map.values()) {
    ing.qty = scaleQty(ing.qty, ing.unit, 1);
  }
  const list = [...map.values()];
  list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return list;
}

export function formatLine(ing) {
  if (ing.unit === 'по вкусу') return `${ing.name} — по вкусу`;
  return `${ing.name} — ${fmt.format(ing.qty)} ${ing.unit}`;
}

export function stockQuantity(qty, unit) {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (UPWARD_UNITS.has(unit)) return Math.floor(qty);
  if (unit !== 'г' && unit !== 'мл') return 0;
  const rounded = Math.round(qty * 10) / 10;
  return Number.isFinite(rounded) ? rounded : 0;
}

export function subtractStock(ingredients, stock) {
  return ingredients.flatMap((ingredient) => {
    const inStock = stockQuantity(stock[priceKey(ingredient)], ingredient.unit);
    if (ingredient.unit === 'по вкусу') return [ingredient];
    const qty = scaleQty(Math.max(0, ingredient.qty - inStock), ingredient.unit, 1);
    return qty > 0 ? [{ ...ingredient, qty, inStock }] : [];
  });
}

export function groupShopping(list, departments) {
  const groups = departments.map(({ name }) => ({ name, items: [] }));
  const other = { name: 'Прочее', items: [] };
  const byIngredient = new Map();
  for (const [index, { ingredients }] of departments.entries()) {
    for (const ingredient of ingredients) byIngredient.set(ingredient, groups[index]);
  }
  for (const ingredient of list) {
    (byIngredient.get(ingredient.name) ?? other).items.push(ingredient);
  }
  return [...groups, other].filter((group) => group.items.length);
}

export function shoppingText(groups) {
  return groups.map(({ name, items }) => [
    name,
    ...items.map((item) => `${item.checked ? '✓' : '☐'} ${item.text ?? formatLine(item)}`),
  ].join('\n')).join('\n\n');
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
