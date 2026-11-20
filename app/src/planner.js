import { addToMeal, cookingBatches, DAYS, distributeMenu, earlierBatches, MEALS, removeFromMeal } from './week.js';
import { save } from './store.js';

function searchable(text) {
  return text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function planner() {
  return {
    view: 'menu',
    days: DAYS,
    dayId: DAYS[0].id,
    catalogQuery: '',
    catalogCategory: '',
    catalogTarget: null,
    recipePreview: null,
    plannerMessage: '',

    showView(view) {
      this.catalogTarget = null;
      this.view = view;
      if (view === 'catalog') return;
      this.state.view = view;
      this.copyMessage = '';
      this.copyText = '';
      save(this.state);
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

    currentMeals() {
      return MEALS.filter((meal) => meal.dayId === this.dayId);
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
