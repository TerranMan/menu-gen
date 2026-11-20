import { cookingBatches, dateAfter, mealDayIndex } from './week.js';

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

export function sanitizeBatchRecords(raw, week) {
  const records = {};
  for (const { mealId, dishId } of cookingBatches(week)) {
    const key = batchKey(mealId, dishId);
    const record = raw?.[key];
    if (Number.isSafeInteger(record?.cookedAt) && record.cookedAt > 0 && record.cookedAt <= Date.now()
        && ['unknown', 'fridge', 'freezer'].includes(record.storage)) {
      records[key] = { cookedAt: record.cookedAt, storage: record.storage };
    }
  }
  return records;
}
