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
