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
