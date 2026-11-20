import Alpine from 'alpinejs';
import dishesData from '../data/dishes.json';
import pricesData from '../data/prices.json';
import { generateMenu, regenerateSlot, pickMore } from './generator.js';
import {
  aggregate, formatLine, priceKey, lineCost, totalCost, formatMoney,
  recipeFactor, scaleQty, formatCardIngredient, groupShopping, shoppingText,
} from './shopping.js';
import { load, save, toggle, MIN_PERSONS, MAX_PERSONS } from './store.js';
import { planner } from './planner.js';
import { sanitizeWeek } from './week.js';
import './styles.css';

const DEFAULT_PRICES = pricesData.prices ?? {};
const DEPARTMENTS = pricesData.departments ?? [];
const portionRules = new Intl.PluralRules('ru');
const portionWords = { one: 'порция', few: 'порции', many: 'порций' };

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
    ...planner(),
    data: dishesData,
    state: load(),
    menu: [],
    base: import.meta.env.BASE_URL,
    expanded: {},
    copyMessage: '',
    copyText: '',
    minPersons: MIN_PERSONS,
    maxPersons: MAX_PERSONS,

    imageUrl(path) {
      if (!path) return null;
      return this.base + path;
    },

    init() {
      this.view = this.state.view;
      this.state.week = sanitizeWeek(this.state.week, (id) => Boolean(this.dishById(id)));
      this.pruneShoppingChecks('week');
      if (!this.state.lastMenu) {
        this.regenerateAll();
        return;
      }
      this.menu = this.hydrate(this.state.lastMenu);
      this.persistMenu();
    },

    emojiFor(catId) {
      return EMOJI[catId] ?? '🍽️';
    },

    dishEmoji(dish, catId) {
      return dish.emoji || EMOJI[catId] || '🍽️';
    },

    formatPortions(portions) {
      return `${portions} ${portionWords[portionRules.select(portions)]}`;
    },

    recipeYield(dish, persons = this.state.persons) {
      const { recipe } = dish;
      return recipe.wholeBatch
        ? recipe.portions * recipeFactor(recipe, persons)
        : persons;
    },

    recipeSummary(dish, persons = this.state.persons) {
      return `Выход — ${this.formatPortions(this.recipeYield(dish, persons))} · около ${dish.recipe.minutes} мин`;
    },

    scaledIngredients(dish, persons = this.state.persons) {
      const factor = recipeFactor(dish.recipe, persons);
      return (dish.ingredients ?? []).map((ing) => ({
        ...ing,
        qty: scaleQty(ing.qty, ing.unit, factor, { roundPieces: false }),
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
      this.pruneShoppingChecks('menu');
      this.pruneShoppingChecks('week');
      save(this.state);
    },

    availableCount(catId) {
      const cat = this.data.categories.find((c) => c.id === catId);
      return cat?.dishes.filter((dish) => !this.isBlocked(dish.id)).length ?? 0;
    },

    defaultPickFor(catId) {
      const cat = this.data.categories.find((c) => c.id === catId);
      return cat ? cat.pick : 0;
    },

    effectivePick(catId) {
      const cat = this.data.categories.find((category) => category.id === catId);
      if (!cat) return 0;
      const v = this.state.picks[catId];
      const requested = Number.isInteger(v) ? Math.min(v, cat.dishes.length) : cat.pick;
      return Math.max(requested, this.pinnedCount(catId));
    },

    isPinned(id) {
      return this.state.pins.includes(id);
    },

    pinnedCount(catId) {
      const cat = this.data.categories.find((category) => category.id === catId);
      return cat?.dishes.filter((dish) => this.isPinned(dish.id)).length ?? 0;
    },

    togglePin(id) {
      toggle(this.state.pins, id);
      save(this.state);
    },

    resizeSlot(slot, count) {
      for (let i = slot.dishes.length - 1; i >= 0 && slot.dishes.length > count; i--) {
        const dish = slot.dishes[i];
        if (this.isPinned(dish.id)) continue;
        slot.dishes.splice(i, 1);
        delete this.expanded[dish.id];
      }
      const selectedIds = slot.dishes.map((dish) => dish.id);
      const added = pickMore(this.data, this.state, slot.categoryId, selectedIds, count - selectedIds.length);
      slot.dishes.push(...added);
    },

    rememberPick(catId, count) {
      if (count === this.defaultPickFor(catId)) {
        delete this.state.picks[catId];
      } else {
        this.state.picks[catId] = count;
      }
    },

    addToSelection(catId, dish) {
      const slot = this.menu.find((s) => s.categoryId === catId);
      if (!slot || slot.dishes.some((item) => item.id === dish.id)) return;
      slot.dishes.push(dish);
      this.rememberPick(catId, Math.max(slot.dishes.length, this.effectivePick(catId)));
      this.persistMenu();
    },

    setPick(catId, count) {
      const slot = this.menu.find((s) => s.categoryId === catId);
      if (!slot || count < this.pinnedCount(catId) || count === this.effectivePick(catId)) return;

      this.rememberPick(catId, count);
      this.resizeSlot(slot, count);
      this.persistMenu();
    },

    incPick(catId) {
      const count = this.effectivePick(catId);
      if (count < this.availableCount(catId)) this.setPick(catId, count + 1);
    },

    decPick(catId) {
      this.setPick(catId, this.effectivePick(catId) - 1);
    },

    regenerateAll() {
      this.menu = generateMenu(this.data, this.state);
      this.expanded = {};
      this.state.checked = {};
      this.persistMenu();
    },

    replacementFor(slot, currentDishId) {
      const selectedIds = slot.dishes.map((dish) => dish.id);
      return regenerateSlot(this.data, this.state, slot.categoryId, currentDishId, selectedIds);
    },

    regenerateOne(catId, currentDishId) {
      if (this.isPinned(currentDishId)) return;
      const slot = this.menu.find((s) => s.categoryId === catId);
      const idx = slot?.dishes.findIndex((d) => d.id === currentDishId) ?? -1;
      if (idx === -1) return;
      const replacement = this.replacementFor(slot, currentDishId);
      if (!replacement) return;
      slot.dishes.splice(idx, 1, replacement);
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
      this.state.pins = this.state.pins.filter((pinnedId) => pinnedId !== id);
      const fi = this.state.favorites.indexOf(id);
      if (fi !== -1) this.state.favorites.splice(fi, 1);
      const cat = this.data.categories.find((category) => category.dishes.some((dish) => dish.id === id));
      const slot = this.menu.find((s) => s.categoryId === cat?.id);
      if (slot && this.isBlocked(id)) {
        const idx = slot.dishes.findIndex((d) => d.id === id);
        if (idx !== -1) {
          const replacement = this.replacementFor(slot, id);
          if (replacement) slot.dishes.splice(idx, 1, replacement);
          else slot.dishes.splice(idx, 1);
          delete this.expanded[id];
        }
      } else if (slot) {
        this.resizeSlot(slot, this.effectivePick(slot.categoryId));
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

    shoppingIngredients(mode = this.state.view) {
      if (mode === 'week') {
        const batches = this.plannedBatches().map(({ dish, servings }) => ({ ...dish, servings }));
        return aggregate(batches, (batch) => recipeFactor(batch.recipe, batch.servings));
      }
      return aggregate(this.menu.flatMap((s) => s.dishes), (dish) => recipeFactor(dish.recipe, this.state.persons));
    },

    shoppingChecks(mode = this.state.view) {
      return mode === 'week' ? this.state.weekChecked : this.state.checked;
    },

    shoppingList() {
      const prices = this.effectivePrices();
      const checks = this.shoppingChecks();
      return this.shoppingIngredients().map((ing) => {
        const key = priceKey(ing);
        const userValue = this.state.prices[key];
        const defaultValue = DEFAULT_PRICES[key];
        return {
          ...ing,
          key,
          text: formatLine(ing),
          checked: checks[key] === ing.qty,
          cost: lineCost(ing, prices),
          isDefault: typeof userValue !== 'number' && typeof defaultValue === 'number',
        };
      });
    },

    shoppingGroups() {
      return groupShopping(this.shoppingList(), DEPARTMENTS);
    },

    async copyShopping() {
      const text = shoppingText(this.shoppingGroups());
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.copyMessage = 'Список скопирован.';
        this.copyText = '';
      } catch {
        this.copyMessage = 'Выделенный список можно скопировать вручную.';
        this.copyText = text;
        this.$nextTick(() => {
          this.$refs.copyField.focus();
          this.$refs.copyField.select();
        });
      }
    },

    weekTotal() {
      const { sum, missing } = totalCost(this.shoppingIngredients(), this.effectivePrices());
      return { text: formatMoney(sum), missing };
    },

    setChecked(ingredient, checked) {
      const checks = this.shoppingChecks();
      if (checked) checks[ingredient.key] = ingredient.qty;
      else delete checks[ingredient.key];
      save(this.state);
    },

    pruneShoppingChecks(mode) {
      const checks = this.shoppingChecks(mode);
      const quantities = new Map(this.shoppingIngredients(mode).map((ing) => [priceKey(ing), ing.qty]));
      for (const [key, qty] of Object.entries(checks)) {
        if (quantities.get(key) !== qty) delete checks[key];
      }
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
      this.pruneShoppingChecks('menu');
      save(this.state);
    },

    hydrate(saved) {
      const savedByCategory = new Map(saved.map((slot) => [slot.categoryId, slot.dishIds]));
      return this.data.categories.map((cat) => {
        const dishIds = new Set([...(savedByCategory.get(cat.id) ?? []), ...this.state.pins]);
        const dishes = [...dishIds]
          .filter((id) => !this.isBlocked(id))
          .map((id) => cat.dishes.find((dish) => dish.id === id))
          .filter(Boolean);
        const slot = { categoryId: cat.id, categoryName: cat.name, dishes };
        this.resizeSlot(slot, this.effectivePick(cat.id));
        return slot;
      });
    },

    formatIngredient(ing) {
      return formatCardIngredient(ing);
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
