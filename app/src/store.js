// localStorage с версионированием схемы и санитацией на чтении.
// Один ключ, один JSON. Любая дрянь в parsed → дефолты.

const KEY = 'menu_gen_v1';
const BASE_PORTIONS = 2;
const MIN_PERSONS = 1;
const MAX_PERSONS = 12;

const empty = () => ({
  version: 1,
  persons: BASE_PORTIONS,
  picks: {}, // categoryId → integer ≥ 0 (override default cat.pick)
  favorites: [],
  blocks: [],
  lastMenu: null,
  prices: {}, // ключ "name__unit" → число (₽ за 1 единицу)
});

function sanitizePersons(v) {
  if (!Number.isInteger(v)) return BASE_PORTIONS;
  return Math.min(MAX_PERSONS, Math.max(MIN_PERSONS, v));
}

function sanitizeIds(arr) {
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
}

function sanitizePrices(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  return Object.fromEntries(
    Object.entries(p).filter(
      ([k, v]) => typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v > 0
    )
  );
}

function sanitizePicks(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  return Object.fromEntries(
    Object.entries(p).filter(
      ([k, v]) => typeof k === 'string' && Number.isInteger(v) && v >= 0 && v <= 100
    )
  );
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return empty();
    return {
      version: 1,
      persons: sanitizePersons(parsed.persons),
      picks: sanitizePicks(parsed.picks),
      favorites: sanitizeIds(parsed.favorites),
      blocks: sanitizeIds(parsed.blocks),
      lastMenu: Array.isArray(parsed.lastMenu) ? parsed.lastMenu : null,
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

export { MIN_PERSONS, MAX_PERSONS, BASE_PORTIONS };
