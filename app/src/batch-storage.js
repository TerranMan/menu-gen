import { cookingBatches, dateAfter, dishAndServings, mealDayIndex } from './week.js';

export const batchKey = (mealId, dishId) => `${mealId}/${dishId}`;

export function fridgeHours(dish) {
  return dish.ingredients.some(({ name }) => name === 'рис') ? 24 : 48;
}

export function needsFreezer(dish, from, to) {
  // Без заданных часов подачи берём весь календарный день.
  return mealDayIndex(to) - mealDayIndex(from) >= fridgeHours(dish) / 24;
}

export function fridgeDeadline(dish, record) {
  return record.cookedAt + fridgeHours(dish) * 3_600_000;
}

export function servingDayStart(weekStart, mealId) {
  return new Date(`${dateAfter(weekStart, mealDayIndex(mealId))}T00:00:00`).getTime();
}

export function servingDayEnd(weekStart, mealId) {
  return new Date(`${dateAfter(weekStart, mealDayIndex(mealId) + 1)}T00:00:00`).getTime() - 1;
}

export function storageCounts(value) {
  const quantity = (count) => Number.isInteger(count) && count >= 0 && count <= 999 ? count : 0;
  return { fridge: quantity(value?.fridge), freezer: quantity(value?.freezer) };
}

export function availablePortions(record, dish, weekStart, mealId, persons, now) {
  const end = servingDayEnd(weekStart, mealId);
  if (Math.max(now, record.cookedAt) > end) return null;
  const deadline = fridgeDeadline(dish, record);
  const fridge = deadline > Math.max(now, end) ? Math.min(persons, record.reserve.fridge) : 0;
  const freezer = persons - fridge;
  return freezer <= record.reserve.freezer ? { fridge, freezer } : null;
}

export function sanitizeBatchRecords(raw, week) {
  const records = {};
  for (const { mealId, dishId } of cookingBatches(week)) {
    const key = batchKey(mealId, dishId);
    const record = raw?.[key];
    if (!Number.isSafeInteger(record?.cookedAt) || record.cookedAt <= 0 || record.cookedAt > Date.now()) continue;
    const portions = {};
    for (const { mealId: serving } of dishAndServings(week, mealId, dishId)) {
      const counts = storageCounts(record.portions?.[serving]);
      if (counts.fridge || counts.freezer) portions[serving] = counts;
    }
    const legacy = record.legacyStorage ?? record.storage;
    records[key] = {
      cookedAt: record.cookedAt, portions, reserve: storageCounts(record.reserve),
      ...(Number.isInteger(record.servings) && record.servings > 0 && record.servings <= 252
        && { servings: record.servings }),
      ...(['fridge', 'freezer'].includes(legacy) && { legacyStorage: legacy }),
    };
  }
  return records;
}
