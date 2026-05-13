// localStorage с версионированием схемы. Один ключ, один JSON.

const KEY = 'menu_gen_v1';

const empty = () => ({
  version: 1,
  favorites: [],
  blocks: [],
  lastMenu: null,
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) return empty();
    return { ...empty(), ...parsed };
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
