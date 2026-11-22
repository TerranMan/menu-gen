// Меню сохраняется транзакционно, а старые записи localStorage импортируются один раз.

import { isWeekStart, localWeekStart, sanitizeWeek } from './week.js';
import { sanitizeBatchRecords } from './batch-storage.js';
import { stockQuantity } from './shopping.js';

const DATABASE = 'menu-gen';
const STORE = 'menu';
const RECORD = 'current';
const PREVIOUS_RECORD = 'before-restore';
const BACKUP_FORMAT = 'menu-gen-backup';
const DEFAULT_PERSONS = 2;
const MIN_PERSONS = 1;
const MAX_PERSONS = 12;

const empty = () => ({
  version: 2,
  persons: DEFAULT_PERSONS,
  picks: {}, // categoryId → integer ≥ 0 (override default cat.pick)
  favorites: [],
  blocks: [],
  pins: [],
  lastMenu: null,
  homemade: {},
  quickDinners: false,
  checked: {}, // ключ списка покупок → количество на момент отметки
  week: {},
  weekStart: null,
  batchRecords: {},
  weekChecked: {},
  weekHistory: [],
  stock: {},
  view: 'menu',
  shoppingMode: 'menu',
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
      ([k, v]) => typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v >= 0
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

function sanitizeStock(stock) {
  if (!stock || typeof stock !== 'object' || Array.isArray(stock)) return {};
  const entries = [];
  for (const [key, value] of Object.entries(stock)) {
    const split = key.lastIndexOf('__');
    if (split < 1) continue;
    const amount = stockQuantity(value, key.slice(split + 2));
    if (amount > 0) entries.push([key, amount]);
  }
  return Object.fromEntries(entries);
}

function sanitizeWeekHistory(history) {
  if (!Array.isArray(history)) return [];
  const entries = new Map();
  for (const entry of history) {
    if (!Number.isSafeInteger(entry?.id) || entry.id <= 0 || entry.id > 8.64e15 || entries.has(entry.id)) continue;
    const week = sanitizeWeek(entry.week);
    if (!Object.keys(week).length) continue;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '';
    const weekStart = isWeekStart(entry.weekStart) ? entry.weekStart : null;
    entries.set(entry.id, { id: entry.id, name, persons: sanitizePersons(entry.persons), week, ...(weekStart && { weekStart }) });
  }
  return [...entries.values()].sort((a, b) => b.id - a.id);
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storedShoppingMode(state) {
  if (state.shoppingMode === 'week' || state.shoppingMode === 'menu') return state.shoppingMode;
  return state.view === 'week' || state.view === 'today' ? 'week' : 'menu';
}

function read(parsed) {
  if (![1, 2].includes(parsed?.version)) return empty();
  const blocks = sanitizeIds(parsed.blocks);
  const week = sanitizeWeek(parsed.week);
  return {
    version: 2,
    persons: sanitizePersons(parsed.persons),
    picks: sanitizePicks(parsed.picks),
    favorites: sanitizeIds(parsed.favorites).filter((id) => !blocks.includes(id)),
    blocks,
    pins: sanitizeIds(parsed.pins).filter((id) => !blocks.includes(id)),
    lastMenu: sanitizeMenu(parsed.lastMenu),
    homemade: Object.fromEntries(Object.entries(parsed.homemade ?? {}).filter(([, value]) => value === true)),
    quickDinners: parsed.quickDinners === true,
    checked: sanitizeChecked(parsed.checked),
    week,
    weekStart: isWeekStart(parsed.weekStart) ? parsed.weekStart : (Object.keys(week).length ? localWeekStart() : null),
    batchRecords: sanitizeBatchRecords(parsed.batchRecords, week),
    weekChecked: sanitizeChecked(parsed.weekChecked),
    weekHistory: sanitizeWeekHistory(parsed.weekHistory),
    stock: sanitizeStock(parsed.stock),
    view: ['week', 'today', 'shopping'].includes(parsed.view) ? parsed.view : 'menu',
    shoppingMode: storedShoppingMode(parsed),
    prices: sanitizePrices(parsed.prices),
  };
}

export function loadLegacyState() {
  try {
    return read(parse(localStorage.getItem('menu_gen_v2') ?? localStorage.getItem('menu_gen_v1')));
  } catch {
    return empty();
  }
}

let connection;

function openDatabase() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      database.onclose = () => { connection = undefined; };
      database.onversionchange = () => {
        database.close();
        connection = undefined;
      };
      resolve(database);
    };
  }).catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

export async function loadSavedState() {
  const state = await loadRecord(RECORD);
  return state ? read(state) : null;
}

async function loadRecord(key) {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  } catch {
    return null;
  }
}

const groups = [
  ['persons'], ['quickDinners'], ['picks', 'blocks', 'favorites', 'pins', 'lastMenu'],
  ['week', 'weekStart', 'batchRecords', 'weekHistory'],
];
const maps = ['checked', 'weekChecked', 'stock', 'prices', 'homemade'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const snapshot = (value) => JSON.parse(JSON.stringify(value));

export function encodeBackup(state) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  });
}

export function decodeBackup(text) {
  const data = parse(text);
  const original = data?.state;
  if (data?.format !== BACKUP_FORMAT || data.version !== 1 || original?.version !== 2
      || typeof data.savedAt !== 'string' || !Number.isFinite(Date.parse(data.savedAt))) return null;
  const state = Object.hasOwn(original, 'shoppingMode') ? original
    : { ...original, shoppingMode: storedShoppingMode(original) };
  const normalized = read(state);
  // Резервная копия содержит полный снимок. Не заменяем повреждённые поля значениями по умолчанию.
  if (Object.entries(normalized).some(([key, value]) => !same(value, state[key]))) return null;
  return { savedAt: data.savedAt, state: normalized };
}

export async function loadPreviousBackup() {
  const previous = await loadRecord(PREVIOUS_RECORD);
  return previous ? { savedAt: previous.savedAt, state: read(previous.state) } : null;
}

export function mergeChanges(base, draft, latest) {
  const next = { ...latest };
  if (draft.view !== base.view) next.view = draft.view;
  if (draft.shoppingMode !== base.shoppingMode) next.shoppingMode = draft.shoppingMode;
  for (const group of groups) {
    if (!group.some((key) => !same(base[key], draft[key]))) continue;
    if (group.some((key) => !same(base[key], latest[key]) && !same(draft[key], latest[key]))) {
      return { state: latest, error: 'conflict' };
    }
    for (const key of group) next[key] = draft[key];
  }
  for (const field of maps) {
    next[field] = { ...latest[field] };
    for (const key of new Set([...Object.keys(base[field]), ...Object.keys(draft[field])])) {
      if (base[field][key] === draft[field][key]) continue;
      if (base[field][key] !== latest[field][key] && draft[field][key] !== latest[field][key]) {
        return { state: latest, error: 'conflict' };
      }
      if (Object.hasOwn(draft[field], key)) next[field][key] = draft[field][key];
      else delete next[field][key];
    }
  }
  return { state: next, error: '' };
}

async function updateStoredState(update, keepPrevious = false) {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.onabort = () => reject(transaction.error);
      const store = transaction.objectStore(STORE);
      const request = store.get(RECORD);
      let result;
      let changed = false;
      transaction.oncomplete = () => resolve({ ...result, changed });
      request.onsuccess = () => {
        try {
          const latest = request.result ? read(request.result) : loadLegacyState();
          result = update(latest);
          if (!result.error && (!request.result || !same(latest, result.state))) {
            if (keepPrevious) store.put({ savedAt: new Date().toISOString(), state: latest }, PREVIOUS_RECORD);
            store.put(result.state, RECORD);
            changed = true;
          }
        } catch {
          transaction.abort();
        }
      };
    });
  } catch {
    return { state: null, error: 'unavailable' };
  }
}

export function saveChanges(base, draft) {
  return updateStoredState((latest) => mergeChanges(base, draft, latest));
}

export function restoreBackup(expected, replacement) {
  return updateStoredState((latest) => same(latest, expected)
    ? { state: read(replacement), error: '' }
    : { state: latest, error: 'conflict' }, true);
}

export function toggle(arr, id) {
  const i = arr.indexOf(id);
  if (i === -1) arr.push(id);
  else arr.splice(i, 1);
  return arr;
}

export { MIN_PERSONS, MAX_PERSONS };
