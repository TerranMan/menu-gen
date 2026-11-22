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

export function localDateKey(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value ? date : null;
}

export function dateAfter(value, days) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function localWeekStart(date = new Date()) {
  return dateAfter(localDateKey(date), -((date.getDay() + 6) % 7));
}

export function isWeekStart(value) {
  return parseLocalDate(value)?.getDay() === 1 && Boolean(parseLocalDate(dateAfter(value, 7)));
}

export function mealDayIndex(mealId) {
  return Math.floor(mealOrder.get(mealId) / MEAL_TYPES.length);
}

export function formatWeekSchedule(week, dishName) {
  const sections = [];
  for (const day of DAYS) {
    const lines = [];
    for (const meal of MEALS.filter((item) => item.dayId === day.id)) {
      const dishes = (week[meal.id] ?? []).map(({ dishId, from, storage, homemade }) => {
        const name = dishName(dishId);
        if (!name) return null;
        const source = MEALS[mealOrder.get(from)];
        if (source) return `${name} (повторная подача · ${source.label}${storage === 'freezer' ? ' · заморозить' : ''})`;
        return homemade ? `${name} (домашний вариант)` : name;
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

const SIDE_CATEGORY = { dishes: 'salads', meat: 'garnishes' };

function sideCategory(main) {
  if (main?.tags.includes('needs-side')) return 'garnishes';
  return SIDE_CATEGORY[main?.categoryId];
}

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
      (week[id] ??= []).push({
        dishId: entry.dishId,
        from: cookedEarlier ? entry.from : null,
        ...(cookedEarlier && entry.storage === 'freezer' && { storage: 'freezer' }),
        ...(!entry.from && entry.homemade === true && { homemade: true }),
      });
    }
  }
  return week;
}

export function addToMeal(week, mealId, dishId, from = null, storage = null, homemade = false) {
  if (!mealOrder.has(mealId) || week[mealId]?.some((dish) => dish.dishId === dishId)) return false;
  if (from && !(mealOrder.get(from) < mealOrder.get(mealId)
      && week[from]?.some((dish) => dish.dishId === dishId && !dish.from))) return false;
  (week[mealId] ??= []).push({
    dishId, from,
    ...(from && storage === 'freezer' && { storage }),
    ...(!from && homemade && { homemade: true }),
  });
  return true;
}

export function removeFromMeal(week, mealId, dishId) {
  const entries = week[mealId];
  const index = entries?.findIndex((dish) => dish.dishId === dishId) ?? -1;
  if (index === -1) return;
  const [removed] = entries.splice(index, 1);
  if (!entries.length) delete week[mealId];
  if (removed.from) return null;

  // Если убрали первое приготовление, готовим к самой ранней оставшейся подаче.
  let nextCookingMeal = null;
  for (const { id } of MEALS) {
    const repeat = week[id]?.find((dish) => dish.dishId === dishId && dish.from === mealId);
    if (!repeat) continue;
    repeat.from = nextCookingMeal;
    if (!repeat.from) {
      delete repeat.storage;
      if (removed.homemade) repeat.homemade = true;
    }
    nextCookingMeal ??= id;
  }
  return nextCookingMeal;
}

export function dishAndServings(week, mealId, dishId) {
  const entries = [];
  for (const meal of MEALS) {
    for (const entry of week[meal.id] ?? []) {
      if (entry.dishId === dishId && (meal.id === mealId || entry.from === mealId)) {
        entries.push({ mealId: meal.id, entry });
      }
    }
  }
  return entries[0]?.mealId === mealId ? entries : [];
}

export function moveMealDish(week, from, to, dishId) {
  const source = dishAndServings(week, from, dishId);
  const offset = mealOrder.get(to) - mealOrder.get(from);
  if (!source.length || !Number.isInteger(offset) || !offset) return null;
  const targets = source.map(({ mealId }) => MEALS[mealOrder.get(mealId) + offset]?.id);
  if (targets.some((id) => !id)) return null;
  const next = sanitizeWeek(week);
  for (const { mealId } of source) {
    next[mealId] = next[mealId].filter((entry) => entry.dishId !== dishId);
  }
  for (const [index, { entry }] of source.entries()) {
    const parent = index > 0 ? to : entry.from;
    if (!addToMeal(next, targets[index], dishId, parent, entry.storage, entry.homemade)) return null;
  }
  return sanitizeWeek(next);
}

export function replaceMealDish(week, mealId, currentDishId, nextDishId) {
  if (currentDishId === nextDishId) return null;
  const source = dishAndServings(week, mealId, currentDishId);
  if (!source.length || source.some(({ mealId: id }) => week[id].some(({ dishId }) => dishId === nextDishId))) return null;
  const next = sanitizeWeek(week);
  for (const [index, { mealId: id, entry }] of source.entries()) {
    const row = next[id];
    const position = row.findIndex(({ dishId }) => dishId === currentDishId);
    row[position] = {
      dishId: nextDishId,
      from: index > 0 ? mealId : null,
      ...(index > 0 && entry.storage === 'freezer' && { storage: 'freezer' }),
    };
  }
  return next;
}

export function cookingBatches(week) {
  const batches = new Map();
  for (const { id } of MEALS) {
    for (const { dishId, from, homemade } of week[id] ?? []) {
      const key = `${from ?? id}/${dishId}`;
      const batch = batches.get(key);
      if (batch) batch.mealCount++;
      else batches.set(key, { mealId: id, dishId, mealCount: 1, ...(homemade && { homemade }) });
    }
  }
  return [...batches.values()];
}

export function earlierBatches(week, mealId) {
  const scheduled = new Set(week[mealId]?.map((dish) => dish.dishId));
  return cookingBatches(week).filter((batch) =>
    mealOrder.get(batch.mealId) < mealOrder.get(mealId) && !scheduled.has(batch.dishId));
}

export function distributeMenu(week, menu, data, homemade = {}) {
  const categoryDishes = new Map(menu.map((slot) => [slot.categoryId, slot.dishes]));
  const categories = data?.categories ?? menu.map((slot) => ({ id: slot.categoryId, dishes: slot.dishes }));
  const catalog = new Map(categories.flatMap((category) => category.dishes.map((dish) => [
    dish.id, { categoryId: category.id, tags: dish.tags ?? [] },
  ])));
  const scheduled = new Set(cookingBatches(week).map((batch) => batch.dishId));
  const breakfasts = MEALS.filter((meal) => meal.type === 'breakfast');
  const lunches = MEALS.filter((meal) => meal.type === 'lunch');
  const dinners = MEALS.filter((meal) => meal.type === 'dinner');
  const mainMeals = MEALS.filter((meal) => meal.type !== 'breakfast');
  const empty = (meal) => !week[meal.id]?.length;

  function place(categoryId, targets, preferEmpty, matchesMeal = () => true) {
    const ordered = [...targets.filter((meal) => empty(meal) === preferEmpty),
      ...targets.filter((meal) => empty(meal) !== preferEmpty)];
    const dishes = (categoryDishes.get(categoryId) ?? []).filter((dish) => !scheduled.has(dish.id) && matchesMeal(dish));
    for (const [index, dish] of dishes.entries()) {
      addToMeal(week, ordered[index % ordered.length].id, dish.id, null, null, Boolean(homemade[dish.id]));
      scheduled.add(dish.id);
    }
    return dishes.length;
  }

  function placeSides(categoryId) {
    const dishes = (categoryDishes.get(categoryId) ?? []).filter((dish) => !scheduled.has(dish.id));
    let added = 0;
    for (const dish of dishes) {
      let target = null;
      let best = -Infinity;
      for (const meal of [...dinners, ...lunches]) {
        const contents = (week[meal.id] ?? []).map(({ dishId }) => catalog.get(dishId)).filter(Boolean);
        const main = contents.find((entry) => entry.categoryId === 'dishes')
          ?? contents.find((entry) => entry.categoryId === 'meat');
        const preferredSide = sideCategory(main);
        if (preferredSide === 'salads' && categoryId === 'garnishes') continue;
        const paired = preferredSide === categoryId;
        const prefersLight = main?.tags.includes('light-side') ?? false;
        const light = dish.tags?.includes('light');
        const existing = contents.filter((entry) => entry.categoryId === categoryId).length;
        let score = (paired ? 4 : empty(meal) ? 2 : 1) - existing * 4;
        if (paired && categoryId === 'garnishes' && prefersLight === Boolean(light)) score++;
        if (paired && categoryId === 'salads' && light) score++;
        if (score > best) {
          best = score;
          target = meal.id;
        }
      }
      if (target && addToMeal(week, target, dish.id, null, null, Boolean(homemade[dish.id]))) {
        scheduled.add(dish.id);
        added++;
      }
    }
    return added;
  }

  return place('kids', breakfasts, true, (dish) => dish.childMeal === 'breakfast')
    + place('kids', mainMeals, true, (dish) => dish.childMeal === 'main')
    + place('breakfasts', breakfasts, true) + place('soups', lunches, true)
    + place('dishes', mainMeals, true) + place('meat', dinners, true)
    + placeSides('garnishes') + placeSides('salads')
    + place('bakery', breakfasts, false) + place('fruits_vegetables', breakfasts, false)
    + place('desserts', lunches, false);
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
    category.dishes.filter((dish) => !blocked.has(dish.id)).map((dish) => {
      const homemade = Boolean(dish.dough?.replaces && state.homemade?.[dish.id]);
      const minutes = homemade ? dish.dough.minutes : dish.recipe?.minutes;
      return {
        id: dish.id,
        categoryId: category.id,
        tags: dish.tags ?? [],
        childMeal: dish.childMeal,
        homemade,
        minutes: dish.recipe?.timeNote ? Infinity : (minutes ?? Infinity),
        preference: (pinned.has(dish.id) ? 4 : 0) + (selected.has(dish.id) ? 2 : 0) + (favorites.has(dish.id) ? 1 : 0),
      };
    }),
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
    const limit = state.quickDinners && meal.type === 'dinner' ? 30 : Infinity;
    const pool = MEAL_CATEGORIES[meal.type]
      .map((group) => group.flatMap((categoryId) => available.get(categoryId) ?? [])
        .filter(({ minutes }) => minutes <= limit))
      .find((group) => group.length);
    const childMeal = meal.type === 'breakfast' ? 'breakfast' : 'main';
    const kids = state.kidsMeals ? (available.get('kids') ?? []).filter((dish) =>
      dish.childMeal === childMeal && dish.minutes <= limit && !uses.has(dish.id)) : [];
    const main = choose(kids) ?? choose(pool);
    if (!main) {
      remaining++;
      continue;
    }
    addToMeal(week, meal.id, main.id, null, null, main.homemade);
    countUse(main.id);
    filled++;

    const categoryId = sideCategory(main);
    const sides = (available.get(categoryId) ?? []).filter(({ minutes }) => limit === Infinity || main.minutes + minutes <= limit);
    const lightSides = sides.filter(({ tags }) => tags.includes('light'));
    const side = categoryId === 'salads' || main.tags.includes('light-side')
      ? choose(lightSides) ?? (categoryId === 'garnishes' ? choose(sides) : null)
      : choose(sides);
    if (side && addToMeal(week, meal.id, side.id, null, null, side.homemade)) countUse(side.id);
  }
  return { filled, remaining };
}
