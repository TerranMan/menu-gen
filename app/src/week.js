export const DAYS = [
  { id: 'mon', name: 'Понедельник', short: 'Пн' },
  { id: 'tue', name: 'Вторник', short: 'Вт' },
  { id: 'wed', name: 'Среда', short: 'Ср' },
  { id: 'thu', name: 'Четверг', short: 'Чт' },
  { id: 'fri', name: 'Пятница', short: 'Пт' },
  { id: 'sat', name: 'Суббота', short: 'Сб' },
  { id: 'sun', name: 'Воскресенье', short: 'Вс' },
];

const MEAL_TYPES = [
  { id: 'breakfast', name: 'Завтрак' },
  { id: 'lunch', name: 'Обед' },
  { id: 'dinner', name: 'Ужин' },
];

export const MEALS = DAYS.flatMap((day) => MEAL_TYPES.map((type) => ({
  id: `${day.id}-${type.id}`,
  dayId: day.id,
  type: type.id,
  name: type.name,
  label: `${day.short} · ${type.name.toLowerCase()}`,
})));
const mealOrder = new Map(MEALS.map((meal, index) => [meal.id, index]));

export function localDayId(date) {
  return DAYS[(date.getDay() + 6) % 7].id;
}

export function formatWeekSchedule(week, dishName) {
  const sections = [];
  for (const day of DAYS) {
    const lines = [];
    for (const meal of MEALS.filter((item) => item.dayId === day.id)) {
      const dishes = (week[meal.id] ?? []).map(({ dishId, from }) => {
        const name = dishName(dishId);
        if (!name) return null;
        const source = MEALS[mealOrder.get(from)];
        return source ? `${name} (из готовой партии · ${source.label})` : name;
      }).filter(Boolean);
      if (dishes.length) lines.push(`${meal.name} — ${dishes.join(', ')}`);
    }
    if (lines.length) sections.push([day.name, ...lines].join('\n'));
  }
  return sections.join('\n\n');
}

const MEAL_CATEGORIES = {
  breakfast: [['breakfasts'], ['bakery', 'fruits_vegetables']],
  lunch: [['soups', 'dishes', 'meat'], ['salads', 'garnishes']],
  dinner: [['dishes', 'meat'], ['soups'], ['salads', 'garnishes']],
};

export function sanitizeWeek(raw, isKnownDish = () => true) {
  const week = {};
  for (const { id } of MEALS) {
    const entries = raw?.[id];
    if (!Array.isArray(entries)) continue;
    const seen = new Set();
    for (const entry of entries) {
      if (typeof entry?.dishId !== 'string' || !isKnownDish(entry.dishId) || seen.has(entry.dishId)) continue;
      seen.add(entry.dishId);
      const cookedEarlier = mealOrder.get(entry.from) < mealOrder.get(id)
        && week[entry.from]?.some((dish) => dish.dishId === entry.dishId && !dish.from);
      (week[id] ??= []).push({ dishId: entry.dishId, from: cookedEarlier ? entry.from : null });
    }
  }
  return week;
}

export function addToMeal(week, mealId, dishId, from = null) {
  if (!mealOrder.has(mealId) || week[mealId]?.some((dish) => dish.dishId === dishId)) return false;
  if (from && !(mealOrder.get(from) < mealOrder.get(mealId)
      && week[from]?.some((dish) => dish.dishId === dishId && !dish.from))) return false;
  (week[mealId] ??= []).push({ dishId, from });
  return true;
}

export function removeFromMeal(week, mealId, dishId) {
  const entries = week[mealId];
  const index = entries?.findIndex((dish) => dish.dishId === dishId) ?? -1;
  if (index === -1) return;
  const [removed] = entries.splice(index, 1);
  if (!entries.length) delete week[mealId];
  if (removed.from) return;

  // Если убрали первое приготовление, готовим к самой ранней оставшейся подаче.
  let nextCookingMeal = null;
  for (const { id } of MEALS) {
    const repeat = week[id]?.find((dish) => dish.dishId === dishId && dish.from === mealId);
    if (!repeat) continue;
    repeat.from = nextCookingMeal;
    nextCookingMeal ??= id;
  }
}

export function cookingBatches(week) {
  const batches = new Map();
  for (const { id } of MEALS) {
    for (const { dishId, from } of week[id] ?? []) {
      const key = `${from ?? id}/${dishId}`;
      const batch = batches.get(key);
      if (batch) batch.mealCount++;
      else batches.set(key, { mealId: id, dishId, mealCount: 1 });
    }
  }
  return [...batches.values()];
}

export function earlierBatches(week, mealId) {
  const scheduled = new Set(week[mealId]?.map((dish) => dish.dishId));
  return cookingBatches(week).filter((batch) =>
    mealOrder.get(batch.mealId) < mealOrder.get(mealId) && !scheduled.has(batch.dishId));
}

export function distributeMenu(week, menu) {
  const categoryDishes = new Map(menu.map((slot) => [slot.categoryId, slot.dishes]));
  const scheduled = new Set(cookingBatches(week).map((batch) => batch.dishId));
  const breakfasts = MEALS.filter((meal) => meal.type === 'breakfast');
  const lunches = MEALS.filter((meal) => meal.type === 'lunch');
  const dinners = MEALS.filter((meal) => meal.type === 'dinner');
  const mainMeals = MEALS.filter((meal) => meal.type !== 'breakfast');
  const empty = (meal) => !week[meal.id]?.length;

  function place(categoryId, targets, preferEmpty) {
    const ordered = [...targets.filter((meal) => empty(meal) === preferEmpty),
      ...targets.filter((meal) => empty(meal) !== preferEmpty)];
    const dishes = (categoryDishes.get(categoryId) ?? []).filter((dish) => !scheduled.has(dish.id));
    for (const [index, dish] of dishes.entries()) {
      addToMeal(week, ordered[index % ordered.length].id, dish.id);
      scheduled.add(dish.id);
    }
    return dishes.length;
  }

  return place('breakfasts', breakfasts, true) + place('soups', lunches, true)
    + place('dishes', mainMeals, true) + place('meat', dinners, true)
    + place('garnishes', dinners, false) + place('salads', mainMeals, false)
    + place('bakery', breakfasts, false) + place('fruits_vegetables', breakfasts, false);
}

export function fillEmptyMeals(week, data, state, menu) {
  const uses = new Map();
  function countUse(dishId) {
    uses.set(dishId, (uses.get(dishId) ?? 0) + 1);
  }
  for (const entries of Object.values(week)) {
    for (const entry of entries) countUse(entry.dishId);
  }

  const blocked = new Set(state.blocks);
  const pinned = new Set(state.pins);
  const favorites = new Set(state.favorites);
  const selected = new Set(menu.flatMap((slot) => slot.dishes.map((dish) => dish.id)));
  const available = new Map(data.categories.map((category) => [
    category.id,
    category.dishes.filter((dish) => !blocked.has(dish.id)).map((dish) => ({
      id: dish.id,
      categoryId: category.id,
      preference: (pinned.has(dish.id) ? 4 : 0) + (selected.has(dish.id) ? 2 : 0) + (favorites.has(dish.id) ? 1 : 0),
    })),
  ]));

  function choose(candidates) {
    if (!candidates?.length) return null;
    const fewestUses = Math.min(...candidates.map(({ id }) => uses.get(id) ?? 0));
    const leastUsed = candidates.filter(({ id }) => (uses.get(id) ?? 0) === fewestUses);
    const preference = Math.max(...leastUsed.map((dish) => dish.preference));
    const best = leastUsed.filter((dish) => dish.preference === preference);
    return best[Math.floor(Math.random() * best.length)];
  }

  let filled = 0;
  let remaining = 0;
  for (const meal of MEALS) {
    if (week[meal.id]?.length) continue;
    const pool = MEAL_CATEGORIES[meal.type]
      .map((group) => group.flatMap((categoryId) => available.get(categoryId) ?? []))
      .find((group) => group.length);
    const main = choose(pool);
    if (!main) {
      remaining++;
      continue;
    }
    addToMeal(week, meal.id, main.id);
    countUse(main.id);
    filled++;

    if (main.categoryId === 'meat') {
      const side = choose(available.get('garnishes'));
      if (side && addToMeal(week, meal.id, side.id)) countUse(side.id);
    }
  }
  return { filled, remaining };
}
