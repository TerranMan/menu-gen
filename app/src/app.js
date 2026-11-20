import Alpine from 'alpinejs';
import dishesData from '../data/dishes.json';
import pricesData from '../data/prices.json';
import { generateMenu, regenerateSlot, pickMore } from './generator.js';
import {
  aggregate, formatLine, priceKey, lineCost, totalCost, formatMoney,
  recipeFactor, scaleQty, formatCardIngredient, groupShopping, shoppingText, subtractStock,
} from './shopping.js';
import { loadLegacyState, loadSavedState, saveChanges, snapshot, toggle, MIN_PERSONS, MAX_PERSONS } from './store.js';
import { planner } from './planner.js';
import { pantry } from './pantry.js';
import { sanitizeWeek } from './week.js';
import { sanitizeBatchRecords } from './batch-storage.js';
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
    ...pantry(dishesData, DEPARTMENTS),
    data: dishesData,
    state: loadLegacyState(),
    ready: false,
    menu: [],
    base: import.meta.env.BASE_URL,
    expanded: {},
    copyMessage: '',
    copyText: '',
    priceDate: pricesData.updated_at?.split('-').reverse().join('.'),
    storageMessage: '',
    savePending: 0,
    storageChanged: false,
    syncPending: false,
    editRevision: 0,
    minPersons: MIN_PERSONS,
    maxPersons: MAX_PERSONS,

    imageUrl(path) {
      if (!path) return null;
      return this.base + path;
    },

    async init() {
      if (typeof BroadcastChannel === 'function') {
        try {
          this.storageChannel = new BroadcastChannel('menu-gen-saved-state');
          this.storageChannel.onmessage = () => this.syncStorage();
        } catch {
          // Если канал отключён, перечитаем сохранение при возвращении во вкладку.
        }
      }
      this.state = await loadSavedState() ?? loadLegacyState();
      this.savedState = snapshot(this.state);
      this.draftBase = this.savedState;
      this.view = this.shoppingMode = this.state.view;
      this.todayTimer = setInterval(() => this.refreshToday(), 60_000);
      this.state.week = sanitizeWeek(this.state.week, (id) => Boolean(this.dishById(id)));
      this.pruneShoppingChecks('week');
      if (!this.state.lastMenu) {
        await this.regenerateAll();
      } else {
        this.menu = this.hydrate(this.state.lastMenu);
        await this.persistMenu();
      }
      this.ready = true;
      if (this.storageChanged) this.syncStorage();
    },

    destroy() {
      clearInterval(this.todayTimer);
      this.storageChannel?.close();
      this.storageChannel = null;
    },

    async syncStorage() {
      this.storageChanged = true;
      if (!this.ready || this.savePending || this.syncPending) return;
      this.syncPending = true;
      while (this.storageChanged && !this.savePending) {
        this.storageChanged = false;
        const revision = this.editRevision;
        const latest = await loadSavedState();
        if (revision !== this.editRevision) this.storageChanged = true;
        else if (latest) this.applySavedState(latest);
      }
      this.syncPending = false;
    },

    applySavedState(state) {
      this.savedState = snapshot(state);
      this.draftBase = this.savedState;
      const refreshMenu = ['lastMenu', 'pins', 'picks', 'blocks'].some(
        (key) => JSON.stringify(this.state[key]) !== JSON.stringify(state[key])
      );
      this.state = state;
      this.state.week = sanitizeWeek(state.week, (id) => Boolean(this.dishById(id)));
      this.state.batchRecords = sanitizeBatchRecords(state.batchRecords, this.state.week);
      if (refreshMenu) {
        this.menu = state.lastMenu ? this.hydrate(state.lastMenu) : generateMenu(this.data, state);
      }
    },

    saveState(next = this.state) {
      const base = this.draftBase;
      const draft = snapshot(next);
      if (!this.savePending) this.storageMessage = '';
      this.draftBase = draft;
      this.state = next;
      this.savePending++;
      this.editRevision++;
      this.saveQueue = Promise.resolve(this.saveQueue).then(async () => {
        const { state, error, changed } = await saveChanges(base, draft);
        if (changed) this.storageChannel?.postMessage('saved');
        if (state) this.savedState = snapshot(state);
        if (error) {
          this.storageMessage = error === 'conflict'
            ? 'Эти данные уже изменились в другой вкладке. Показана сохранённая версия. Повторите действие.'
            : 'Изменение не сохранилось. Проверьте доступ к хранилищу браузера и повторите действие.';
        }
        if (--this.savePending === 0) {
          this.applySavedState(snapshot(this.savedState));
          if (this.storageChanged) this.syncStorage();
        }
        return !error;
      });
      return this.saveQueue;
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
      return `Выход — ${this.formatPortions(this.recipeYield(dish, persons))} · около ${this.recipeTime(dish)}`;
    },

    recipeTime(dish) {
      const { minutes, timeNote } = dish.recipe;
      return `${minutes} мин${timeNote ? ` ${timeNote}` : ''}`;
    },

    doughHeading(dough) {
      return `${dough.title ?? 'Тесто'} · ${dough.type}`;
    },

    scaledIngredients(dish, persons = this.state.persons, ingredients = dish.ingredients) {
      const factor = recipeFactor(dish.recipe, persons);
      return (ingredients ?? []).map((ing) => ({
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
      this.saveState();
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
      this.saveState();
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
      return this.persistMenu();
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
      this.saveState();
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

    requiredIngredients(mode) {
      if (mode === 'week' || mode === 'today') {
        const batches = this.plannedBatches().map(({ dish, servings }) => ({ ...dish, servings }));
        return aggregate(batches, (batch) => recipeFactor(batch.recipe, batch.servings));
      }
      return aggregate(this.menu.flatMap((s) => s.dishes), (dish) => recipeFactor(dish.recipe, this.state.persons));
    },

    shoppingIngredients(mode = this.shoppingMode, stock = this.state.stock) {
      return subtractStock(this.requiredIngredients(mode), stock);
    },

    shoppingChecks(mode = this.shoppingMode) {
      return mode === 'menu' ? this.state.checked : this.state.weekChecked;
    },

    shoppingList(mode = this.shoppingMode) {
      const prices = this.effectivePrices();
      const checks = this.shoppingChecks(mode);
      return this.shoppingIngredients(mode).map((ing) => {
        const key = priceKey(ing);
        const userValue = this.state.prices[key];
        const defaultValue = DEFAULT_PRICES[key];
        return {
          ...ing,
          key,
          text: formatLine(ing),
          stockText: ing.inStock > 0 ? formatLine({ name: 'Дома', qty: ing.inStock, unit: ing.unit }) : '',
          checked: checks[key] === ing.qty,
          cost: lineCost(ing, prices),
          isDefault: typeof userValue !== 'number' && typeof defaultValue === 'number',
        };
      });
    },

    shoppingGroups(mode = this.shoppingMode) {
      return groupShopping(this.shoppingList(mode), DEPARTMENTS);
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

    async setChecked(ingredient, input) {
      const checks = this.shoppingChecks();
      if (input.checked) checks[ingredient.key] = ingredient.qty;
      else delete checks[ingredient.key];
      if (!await this.saveState()) input.checked = this.shoppingChecks()[ingredient.key] === ingredient.qty;
    },

    validShoppingChecks(mode, stock = this.state.stock) {
      const quantities = new Map(this.shoppingIngredients(mode, stock).map((ing) => [priceKey(ing), ing.qty]));
      return Object.fromEntries(Object.entries(this.shoppingChecks(mode)).filter(([key, qty]) => quantities.get(key) === qty));
    },

    pruneShoppingChecks(mode) {
      this.state[mode === 'menu' ? 'checked' : 'weekChecked'] = this.validShoppingChecks(mode);
    },

    priceUnit(unit) {
      return { г: 'кг', мл: 'л' }[unit] ?? unit;
    },

    priceFactor(unit) {
      return this.priceUnit(unit) === unit ? 1 : 1000;
    },

    priceFor({ key, unit }) {
      const price = this.state.prices[key] ?? DEFAULT_PRICES[key];
      return typeof price === 'number' ? Number((price * this.priceFactor(unit)).toPrecision(15)) : '';
    },

    async setPrice(ingredient, input) {
      const value = input.valueAsNumber;
      const valid = !input.validity.badInput && (input.value === '' || (Number.isFinite(value) && value >= 0));
      const saved = valid && await this.updatePrice(ingredient, input.value === '' ? null : value);
      if (!saved || input.value === '') input.value = this.priceFor(ingredient);
    },

    updatePrice({ key, unit }, value) {
      const price = value === null ? null : value / this.priceFactor(unit);
      if (price === null || price === DEFAULT_PRICES[key]) delete this.state.prices[key];
      else this.state.prices[key] = price;
      return this.saveState();
    },

    persistMenu() {
      this.state.lastMenu = this.menu.map((s) => ({
        categoryId: s.categoryId,
        dishIds: s.dishes.map((d) => d.id),
      }));
      this.pruneShoppingChecks('menu');
      return this.saveState();
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
