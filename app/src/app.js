import Alpine from 'alpinejs';
import dishesData from '../data/dishes.json';
import pricesData from '../data/prices.json';
import { generateMenu, regenerateSlot } from './generator.js';
import { aggregate, formatLine, priceKey, lineCost, totalCost, formatMoney, scaleQty } from './shopping.js';
import { load, save, toggle, MIN_PERSONS, MAX_PERSONS, BASE_PORTIONS } from './store.js';
import './styles.css';

const DEFAULT_PRICES = pricesData.prices ?? {};

const EMOJI = {
  bakery: '🥐',
  breakfasts: '🍳',
  dishes: '🍲',
  fruits_vegetables: '🍎',
  garnishes: '🍚',
  meat: '🥩',
  salads: '🥗',
  soups: '🍜',
};

document.addEventListener('alpine:init', () => {
  Alpine.data('menuApp', () => ({
    data: dishesData,
    state: load(),
    menu: [],
    base: import.meta.env.BASE_URL,
    expanded: {},
    minPersons: MIN_PERSONS,
    maxPersons: MAX_PERSONS,

    imageUrl(path) {
      if (!path) return null;
      return this.base + path;
    },

    init() {
      if (this.state.lastMenu) {
        this.menu = this.hydrate(this.state.lastMenu);
        if (this.menu.length === 0) this.regenerateAll();
      } else {
        this.regenerateAll();
      }
    },

    emojiFor(catId) {
      return EMOJI[catId] ?? '🍽️';
    },

    dishEmoji(dish, catId) {
      return dish.emoji || EMOJI[catId] || '🍽️';
    },

    get factor() {
      return this.state.persons / BASE_PORTIONS;
    },

    scaledIngredients(dish) {
      const f = this.factor;
      return (dish.ingredients ?? []).map((ing) => ({
        ...ing,
        qty: scaleQty(ing.qty, ing.unit, f),
      }));
    },

    isExpanded(id) {
      return !!this.expanded[id];
    },

    toggleExpanded(id) {
      if (this.expanded[id]) delete this.expanded[id];
      else this.expanded[id] = true;
    },

    incPersons() {
      this.setPersons(this.state.persons + 1);
    },

    decPersons() {
      this.setPersons(this.state.persons - 1);
    },

    setPersons(n) {
      const clamped = Math.min(MAX_PERSONS, Math.max(MIN_PERSONS, n | 0));
      if (clamped === this.state.persons) return;
      this.state.persons = clamped;
      save(this.state);
    },

    regenerateAll() {
      this.menu = generateMenu(this.data, this.state);
      this.expanded = {};
      this.persistMenu();
    },

    regenerateOne(catId, currentDishId) {
      const slot = this.menu.find((s) => s.categoryId === catId);
      if (!slot) return;
      const replacement = regenerateSlot(this.data, this.state, catId, currentDishId);
      if (!replacement) return;
      const idx = slot.dishes.findIndex((d) => d.id === currentDishId);
      if (idx !== -1) slot.dishes.splice(idx, 1, replacement);
      delete this.expanded[currentDishId];
      this.persistMenu();
    },

    isFavorite(id) {
      return this.state.favorites.includes(id);
    },
    isBlocked(id) {
      return this.state.blocks.includes(id);
    },

    toggleFavorite(id) {
      toggle(this.state.favorites, id);
      // если блюдо одновременно было в blocks — убираем оттуда
      const bi = this.state.blocks.indexOf(id);
      if (bi !== -1) this.state.blocks.splice(bi, 1);
      save(this.state);
    },

    toggleBlock(id) {
      toggle(this.state.blocks, id);
      const fi = this.state.favorites.indexOf(id);
      if (fi !== -1) this.state.favorites.splice(fi, 1);
      save(this.state);
      // если забанили блюдо что в меню — заменить
      for (const slot of this.menu) {
        const idx = slot.dishes.findIndex((d) => d.id === id);
        if (idx !== -1) {
          const replacement = regenerateSlot(this.data, this.state, slot.categoryId, id);
          if (replacement) slot.dishes.splice(idx, 1, replacement);
          else slot.dishes.splice(idx, 1);
          delete this.expanded[id];
        }
      }
      this.persistMenu();
    },

    dishById(id) {
      for (const c of this.data.categories) {
        const d = c.dishes.find((x) => x.id === id);
        if (d) return d;
      }
      return null;
    },

    favoriteDishes() {
      return this.state.favorites.map((id) => this.dishById(id)).filter(Boolean);
    },
    blockedDishes() {
      return this.state.blocks.map((id) => this.dishById(id)).filter(Boolean);
    },

    effectivePrices() {
      return { ...DEFAULT_PRICES, ...this.state.prices };
    },

    shoppingList() {
      const list = aggregate(this.menu.flatMap((s) => s.dishes), this.factor);
      const prices = this.effectivePrices();
      return list.map((ing) => {
        const key = priceKey(ing);
        const userValue = this.state.prices[key];
        const defaultValue = DEFAULT_PRICES[key];
        return {
          ...ing,
          key,
          text: formatLine(ing),
          cost: lineCost(ing, prices),
          isDefault: typeof userValue !== 'number' && typeof defaultValue === 'number',
        };
      });
    },

    weekTotal() {
      const list = aggregate(this.menu.flatMap((s) => s.dishes), this.factor);
      const { sum, missing } = totalCost(list, this.effectivePrices());
      return { text: formatMoney(sum), missing };
    },

    priceFor(key) {
      const v = this.state.prices[key];
      if (typeof v === 'number') return v;
      const d = DEFAULT_PRICES[key];
      return typeof d === 'number' ? d : '';
    },

    setPrice(key, value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        delete this.state.prices[key];
      } else if (n === DEFAULT_PRICES[key]) {
        // совпадает с дефолтом — не засоряем localStorage
        delete this.state.prices[key];
      } else {
        this.state.prices[key] = n;
      }
      save(this.state);
    },

    persistMenu() {
      this.state.lastMenu = this.menu.map((s) => ({
        categoryId: s.categoryId,
        dishIds: s.dishes.map((d) => d.id),
      }));
      save(this.state);
    },

    hydrate(saved) {
      return saved
        .map((s) => {
          const cat = this.data.categories.find((c) => c.id === s.categoryId);
          if (!cat) return null;
          const dishes = s.dishIds
            .map((id) => cat.dishes.find((d) => d.id === id))
            .filter(Boolean);
          return { categoryId: cat.id, categoryName: cat.name, dishes };
        })
        .filter(Boolean);
    },

    formatIngredient(ing) {
      return ing.unit === 'по вкусу'
        ? `${ing.name} — по вкусу`
        : `${ing.name} — ${ing.qty} ${ing.unit}`;
    },
  }));
});

Alpine.start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}
