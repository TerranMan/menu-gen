// Агрегация ингредиентов по всем блюдам недельного меню.
// Группировка по (name, unit). "по вкусу" не суммируется — оставляем как пометку.

const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function aggregate(dishes) {
  const map = new Map();
  for (const d of dishes) {
    for (const ing of d.ingredients ?? []) {
      const key = `${ing.name}__${ing.unit}`;
      const existing = map.get(key);
      if (existing) {
        existing.qty += ing.qty;
      } else {
        map.set(key, { ...ing });
      }
    }
  }
  const list = [...map.values()];
  list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return list;
}

export function formatLine(ing) {
  if (ing.unit === 'по вкусу') return `${ing.name} — по вкусу`;
  return `${ing.name} — ${fmt.format(ing.qty)} ${ing.unit}`;
}

export function priceKey(ing) {
  return `${ing.name}__${ing.unit}`;
}

// Стоимость строки: qty × цена за единицу. null если цены нет или unit=по вкусу.
export function lineCost(ing, prices) {
  if (ing.unit === 'по вкусу') return null;
  const p = prices[priceKey(ing)];
  if (typeof p !== 'number' || p <= 0) return null;
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
