// Логика выбора блюд. Чистые функции, без побочных эффектов.
// Состояние (favorites/blocks) приходит снаружи.

const FAVORITE_WEIGHT = 3; // во сколько раз чаще должны попадаться избранные

function weightedSample(pool, count) {
  // Без возврата: каждое блюдо может попасть в одно меню один раз.
  // Если запрошено больше блюд чем есть — берём сколько есть.
  const items = pool.slice();
  const picked = [];
  const max = Math.min(count, items.length);
  for (let i = 0; i < max; i++) {
    const totalWeight = items.reduce((s, x) => s + x.weight, 0);
    if (totalWeight <= 0) break;
    let r = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < items.length; idx++) {
      r -= items[idx].weight;
      if (r <= 0) break;
    }
    picked.push(items[idx].dish);
    items.splice(idx, 1);
  }
  return picked;
}

function buildPool(category, { favorites, blocks }, excludeIds = []) {
  const blocked = new Set(blocks);
  const exclude = new Set(excludeIds);
  const fav = new Set(favorites);
  return category.dishes
    .filter((d) => !blocked.has(d.id) && !exclude.has(d.id))
    .map((dish) => ({ dish, weight: fav.has(dish.id) ? FAVORITE_WEIGHT : 1 }));
}

export function generateMenu(data, state) {
  return data.categories.map((cat) => {
    const override = state.picks?.[cat.id];
    const effective = Number.isInteger(override) ? override : cat.pick;
    const pool = buildPool(cat, state);
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      dishes: weightedSample(pool, effective),
    };
  });
}

export function regenerateSlot(data, state, categoryId, currentDishId) {
  const cat = data.categories.find((c) => c.id === categoryId);
  if (!cat) return null;
  const pool = buildPool(cat, state, [currentDishId]);
  if (pool.length === 0) return null; // нечем заменить
  const [picked] = weightedSample(pool, 1);
  return picked ?? null;
}

// Добрать n блюд из категории, исключая уже выбранные.
// Используется когда пользователь увеличивает per-category счётчик.
export function pickMore(data, state, categoryId, excludeIds, n) {
  if (n <= 0) return [];
  const cat = data.categories.find((c) => c.id === categoryId);
  if (!cat) return [];
  const pool = buildPool(cat, state, excludeIds);
  return weightedSample(pool, n);
}
