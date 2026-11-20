import {
  addToMeal, cookingBatches, DAYS, distributeMenu, earlierBatches,
  fillEmptyMeals, formatWeekSchedule, localDayId, MEALS, removeFromMeal, sanitizeWeek,
} from './week.js';
import { shoppingText } from './shopping.js';
import { save } from './store.js';

const historyDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const todayDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

function searchable(text) {
  return text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function planner() {
  return {
    view: 'menu',
    days: DAYS,
    dayId: DAYS[0].id,
    todayTimestamp: Date.now(),
    todayTimer: null,
    catalogQuery: '',
    catalogCategory: '',
    catalogTarget: null,
    recipePreview: null,
    plannerMessage: '',
    weekStorageError: '',
    archiveName: '',
    shareText: '',
    shareMessage: '',

    showView(view) {
      this.catalogTarget = null;
      this.view = view;
      if (view === 'catalog') return;
      if (view === 'today') this.refreshToday();
      this.state.view = view;
      this.copyMessage = '';
      this.copyText = '';
      save(this.state);
    },

    openShopping() {
      const shopping = this.$refs.shopping;
      if (this.view === 'catalog') this.showView(this.state.view);
      shopping.open = true;
      this.$nextTick(() => shopping.scrollIntoView({ block: 'start' }));
    },

    openCatalog(mealId) {
      const nav = this.$refs.viewNav;
      this.showView('catalog');
      this.catalogTarget = mealId;
      this.catalogQuery = '';
      this.catalogCategory = '';
      this.$nextTick(() => nav.scrollIntoView({ block: 'start' }));
    },

    catalogEntries() {
      const words = searchable(this.catalogQuery).trim().split(/\s+/);
      return this.data.categories
        .filter((category) => !this.catalogCategory || category.id === this.catalogCategory)
        .flatMap((category) => category.dishes
          .filter((dish) => words.every((word) => searchable(dish.name).includes(word)))
          .map((dish) => ({ dish, categoryId: category.id, categoryName: category.name })));
    },

    catalogHasDish(entry) {
      if (this.catalogTarget) {
        return this.state.week[this.catalogTarget]?.some((item) => item.dishId === entry.dish.id) ?? false;
      }
      return this.menu.find((slot) => slot.categoryId === entry.categoryId)
        ?.dishes.some((dish) => dish.id === entry.dish.id) ?? false;
    },

    chooseCatalogDish(entry) {
      if (this.isBlocked(entry.dish.id) || this.catalogHasDish(entry)) return;
      if (this.catalogTarget) {
        if (addToMeal(this.state.week, this.catalogTarget, entry.dish.id)) {
          this.persistWeek();
          this.showView('week');
        }
      } else {
        this.addToSelection(entry.categoryId, entry.dish);
      }
    },

    activeDay() {
      return this.days.find((day) => day.id === this.dayId);
    },

    currentMeals(dayId = this.dayId) {
      return MEALS.filter((meal) => meal.dayId === dayId);
    },

    refreshToday() {
      const now = new Date();
      if (now.toDateString() !== new Date(this.todayTimestamp).toDateString()) {
        this.todayTimestamp = now.getTime();
      }
    },

    todayMeals() {
      return this.currentMeals(localDayId(new Date(this.todayTimestamp)));
    },

    todayLabel() {
      return todayDate.format(this.todayTimestamp);
    },

    openTodayInWeek() {
      this.dayId = localDayId(new Date(this.todayTimestamp));
      this.showView('week');
    },

    mealLabel(id) {
      return MEALS.find((meal) => meal.id === id)?.label ?? '';
    },

    mealEntries(mealId) {
      return (this.state.week[mealId] ?? []).map((entry) => ({
        ...entry,
        dish: this.dishById(entry.dishId),
      }));
    },

    plannedBatches() {
      return cookingBatches(this.state.week).map((batch) => ({
        ...batch,
        dish: this.dishById(batch.dishId),
        servings: this.state.persons * batch.mealCount,
      }));
    },

    portionCount(mealId, dishId) {
      return this.plannedBatches().find((batch) => batch.mealId === mealId && batch.dishId === dishId)
        ?.servings ?? this.state.persons;
    },

    mealDishNote(mealId, entry) {
      if (entry.from) return `Из готовой партии · ${this.mealLabel(entry.from)}`;
      const servings = this.portionCount(mealId, entry.dishId);
      return `Готовим · ${this.formatPortions(this.recipeYield(entry.dish, servings))}`;
    },

    reusableBatches(mealId) {
      return earlierBatches(this.state.week, mealId).map((batch) => ({
        key: `${batch.mealId}/${batch.dishId}`,
        label: `${this.dishById(batch.dishId).name} · ${this.mealLabel(batch.mealId)}`,
      }));
    },

    reuseBatch(mealId, value) {
      if (!value) return;
      const [from, dishId] = value.split('/');
      if (addToMeal(this.state.week, mealId, dishId, from)) this.persistWeek();
    },

    removeMealDish(mealId, dishId) {
      removeFromMeal(this.state.week, mealId, dishId);
      this.persistWeek();
    },

    distributeSelection() {
      const added = distributeMenu(this.state.week, this.menu);
      this.persistWeek();
      this.plannerMessage = added ? `Добавлено в расписание — ${added}` : 'Все блюда из подборки уже в расписании.';
    },

    fillSchedule() {
      const { filled, remaining } = fillEmptyMeals(this.state.week, this.data, this.state, this.menu);
      if (filled) this.persistWeek();
      if (remaining) {
        this.plannerMessage = `Заполнено — ${filled}. Без подходящего блюда — ${remaining}.`;
      } else {
        this.plannerMessage = filled ? `Заполнено приёмов — ${filled}. Расписание готово.` : 'Все приёмы уже заполнены.';
      }
    },

    openNewWeek() {
      this.archiveName = '';
      this.weekStorageError = '';
      this.$refs.newWeekDialog.showModal();
    },

    openHistory() {
      this.weekStorageError = '';
      this.$refs.historyDialog.showModal();
    },

    hasWeekPlan() {
      return Object.keys(this.state.week).length > 0;
    },

    openWeekShare() {
      if (!this.hasWeekPlan()) return;
      const schedule = formatWeekSchedule(this.state.week, (id) => this.dishById(id)?.name);
      const shopping = shoppingText(this.shoppingGroups('week'));
      this.shareText = `Меню на неделю · ${this.state.persons} чел.\n\n${schedule}\n\nПокупки\n${shopping || 'Всё нужное есть дома.'}`;
      this.shareMessage = '';
      this.$refs.shareDialog.showModal();
    },

    canShareWeek() {
      return typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({ text: this.shareText }));
    },

    async shareWeek() {
      this.shareMessage = '';
      try {
        await navigator.share({ text: this.shareText });
      } catch (error) {
        if (error.name !== 'AbortError') this.shareMessage = 'Системное меню недоступно. Скопируйте текст кнопкой ниже.';
      }
    },

    async copyWeek() {
      try {
        await navigator.clipboard.writeText(this.shareText);
        this.shareMessage = 'Меню и покупки скопированы.';
      } catch {
        this.$refs.shareField.focus();
        this.$refs.shareField.select();
        this.shareMessage = 'Текст выделен. Его можно скопировать вручную.';
      }
    },

    historyLabel(entry) {
      return entry.name || historyDate.format(entry.id);
    },

    historyDate(entry) {
      return historyDate.format(entry.id);
    },

    historyLines(entry) {
      const lines = [];
      for (const meal of MEALS) {
        const ids = entry.week[meal.id] ?? [];
        const names = ids.map(({ dishId }) => this.dishById(dishId)?.name).filter(Boolean);
        if (names.length) lines.push({ id: meal.id, label: meal.label, dishes: names.join(', ') });
      }
      return lines;
    },

    replaceWeek(source, name = '') {
      const existing = this.state.weekHistory;
      const weekHistory = this.hasWeekPlan() ? [{
        id: Math.max(Date.now(), (existing[0]?.id ?? 0) + 1),
        name: name.trim().slice(0, 60),
        persons: this.state.persons,
        week: sanitizeWeek(this.state.week),
      }, ...existing] : existing;
      const next = {
        ...this.state,
        week: sanitizeWeek(source, (id) => Boolean(this.dishById(id))),
        weekHistory,
        weekChecked: {},
      };
      if (!save(next)) {
        this.weekStorageError = 'Сохранить неделю не удалось. Текущий план остался на месте.';
        return false;
      }
      this.state = next;
      this.dayId = DAYS[0].id;
      this.copyText = '';
      this.copyMessage = '';
      this.plannerMessage = 'Новая неделя начата.';
      return true;
    },

    startNewWeek(copyCurrent) {
      if (this.replaceWeek(copyCurrent ? this.state.week : {}, this.archiveName)) {
        this.$refs.newWeekDialog.close();
      }
    },

    copyHistoryWeek(entry) {
      if (this.replaceWeek(entry.week)) this.$refs.historyDialog.close();
    },

    persistWeek() {
      this.plannerMessage = '';
      this.pruneShoppingChecks('week');
      save(this.state);
    },

    openRecipe(dish, servings = this.state.persons) {
      this.recipePreview = { dish, servings };
      this.$nextTick(() => this.$refs.recipeDialog.showModal());
    },
  };
}
