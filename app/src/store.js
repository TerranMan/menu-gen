// localStorage с версионированием схемы и санитацией на чтении.
// Один ключ, один JSON. Любая дрянь в parsed → дефолты.

const KEY = 'menu_gen_v1';
const DEFAULT_PERSONS = 2;
const MIN_PERSONS = 1;
const MAX_PERSONS = 12;

const empty = () => ({
  version: 1,
  persons: DEFAULT_PERSONS,
  picks: {}, // categoryId → integer ≥ 0 (override default cat.pick)
  favorites: [],
  blocks: [],
  lastMenu: null,
  checked: {}, // ключ списка покупок → количество на момент отметки
  prices: {}, // ключ "name__unit" → число (₽ за 1 единицу)
});

function sanitizePersons(v) {
  if (!Number.isInteger(v)) return DEFAULT_PERSONS;
  return Math.min(MAX_PERSONS, Math.max(MIN_PERSONS, v));
}

function sanitizeIds(arr) {
  if (!Array.isArray(arr)) return [];
  const ids = arr.filter((id) => typeof id === 'string').map((id) =>
    id === 'zapekanka-gorokhovaya-kasha-s-myasom' ? 'gorokhovaya-kasha-s-myasom' : id);
  return [...new Set(ids)];
}

function sanitizePrices(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const prices = Object.fromEntries(
    Object.entries(p).filter(
      ([k, v]) => typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v > 0
    )
  );
  for (const [oldKey, newKey, amount] of [
    ['картофель__шт', 'картофель__г', 100],
    ['квас__шт', 'квас__мл', 1000],
  ]) {
    if (Object.hasOwn(prices, oldKey)) {
      prices[newKey] ??= prices[oldKey] / amount;
      delete prices[oldKey];
    }
  }
  return prices;
}

function sanitizePicks(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  return Object.fromEntries(
    Object.entries(p).filter(
      ([k, v]) => typeof k === 'string' && Number.isInteger(v) && v >= 0 && v <= 100
    )
  );
}

function sanitizeMenu(menu) {
  if (!Array.isArray(menu)) return null;
  return menu
    .filter((slot) => typeof slot?.categoryId === 'string' && Array.isArray(slot.dishIds))
    .map((slot) => ({ categoryId: slot.categoryId, dishIds: sanitizeIds(slot.dishIds) }));
}

function sanitizeChecked(checked) {
  if (!checked || typeof checked !== 'object' || Array.isArray(checked)) return {};
  return Object.fromEntries(Object.entries(checked).filter(([, qty]) => Number.isFinite(qty) && qty >= 0));
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return empty();
    const blocks = sanitizeIds(parsed.blocks);
    return {
      version: 1,
      persons: sanitizePersons(parsed.persons),
      picks: sanitizePicks(parsed.picks),
      favorites: sanitizeIds(parsed.favorites).filter((id) => !blocks.includes(id)),
      blocks,
      lastMenu: sanitizeMenu(parsed.lastMenu),
      checked: sanitizeChecked(parsed.checked),
      prices: sanitizePrices(parsed.prices),
    };
  } catch {
    return empty();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Не удалось сохранить state:', e);
  }
}

export function toggle(arr, id) {
  const i = arr.indexOf(id);
  if (i === -1) arr.push(id);
  else arr.splice(i, 1);
  return arr;
}

export { MIN_PERSONS, MAX_PERSONS };
