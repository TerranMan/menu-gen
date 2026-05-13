import Alpine from 'alpinejs';
import dishesData from '../data/dishes.json';
import { generateMenu, regenerateSlot } from './generator.js';
import { load, save, toggle } from './store.js';
import './styles.css';

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
    showFavorites: false,
    showBlocks: false,

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

    regenerateAll() {
      this.menu = generateMenu(this.data, this.state);
      this.persistMenu();
    },

    regenerateOne(catId, currentDishId) {
      const slot = this.menu.find((s) => s.categoryId === catId);
      if (!slot) return;
      const replacement = regenerateSlot(this.data, this.state, catId, currentDishId);
      if (!replacement) return;
      const idx = slot.dishes.findIndex((d) => d.id === currentDishId);
      if (idx !== -1) slot.dishes.splice(idx, 1, replacement);
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
  }));
});

Alpine.start();
