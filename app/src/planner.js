import {
  addToMeal, cookingBatches, dateAfter, DAYS, distributeMenu, earlierBatches,
  fillEmptyMeals, formatWeekSchedule, isWeekStart, localDateKey, localDayId, localWeekStart,
  mealDayIndex, MEALS, moveMealDish, parseLocalDate, removeFromMeal, replaceMealDish, sanitizeWeek,
} from './week.js';
import { shoppingText } from './shopping.js';
import { batchKey, fridgeDeadline, fridgeHours, needsFreezer, sanitizeBatchRecords, servingDayEnd, servingDayStart } from './batch-storage.js';

const historyDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const todayDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const weekDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

function dateTimeInput(timestamp) {
  const date = new Date(timestamp);
  const time = [date.getHours(), date.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':');
  return `${localDateKey(date)}T${time}`;
}

function searchable(text) {
  return text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function planner() {
  return {
    view: 'menu',
    shoppingMode: 'menu',
    days: DAYS,
    meals: MEALS,
    dayId: DAYS[0].id,
    todayTimestamp: Date.now(),
    todayTimer: null,
    catalogQuery: '',
    catalogCategory: '',
    catalogTarget: null,
    catalogWeek: null,
    recipePreview: null,
    plannerMessage: '',
    weekStorageError: '',
    archiveName: '',
    nextWeekStart: '',
    replacement: null,
    moveTarget: null,
    moveDestination: '',
    moveMessage: '',
    batchTarget: null,
    batchDateTime: '',
    batchStorage: 'unknown',
    batchConfirmed: false,
    batchMessage: '',
    shareText: '',
    shareMessage: '',

    showView(view) {
      this.catalogTarget = null;
      this.catalogWeek = null;
      this.replacement = null;
      this.view = view;
      if (view === 'catalog') return;
      if (view === 'today') this.refreshToday();
      if (this.shoppingMode !== view) {
        this.copyMessage = '';
        this.copyText = '';
      }
      this.shoppingMode = view;
      if (this.state.view === view) return;
      this.state.view = view;
      this.saveState();
    },

    openShopping() {
      const shopping = this.$refs.shopping;
      if (this.view === 'catalog') this.showView(this.shoppingMode);
      shopping.open = true;
      this.$nextTick(() => {
        this.$refs.shoppingSummary.focus({ preventScroll: true });
        shopping.scrollIntoView({ block: 'start' });
      });
    },

    openCatalog(mealId, dishId = null) {
      const nav = this.$refs.viewNav;
      this.showView('catalog');
      this.catalogTarget = mealId;
      this.catalogWeek = this.activeWeekStart();
      this.replacement = dishId;
      this.plannerMessage = '';
      this.catalogQuery = '';
      this.catalogCategory = '';
      this.$nextTick(() => {
        this.$refs.catalogSearch.focus({ preventScroll: true });
        nav.scrollIntoView({ block: 'start' });
      });
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

    async chooseCatalogDish(entry) {
      if (this.isBlocked(entry.dish.id) || this.catalogHasDish(entry)) return;
      if (this.catalogTarget) {
        if (this.catalogWeek !== this.activeWeekStart()) {
          this.plannerMessage = 'Неделя изменилась в другой вкладке. Вернитесь к расписанию и выберите приём снова.';
          return;
        }
        const target = this.catalogTarget;
        if (this.replacement) {
          const next = replaceMealDish(this.state.week, target, this.replacement, entry.dish.id);
          if (!next) {
            this.plannerMessage = 'Это блюдо уже есть в одном из связанных приёмов. Выберите другое.';
            return;
          }
          this.state.week = next;
        } else if (!addToMeal(this.state.week, target, entry.dish.id)) {
          return;
        }
        if (await this.persistWeek()) {
          if (this.view === 'catalog' && this.catalogTarget === target) this.showView('week');
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
      this.todayTimestamp = Date.now();
    },

    isCurrentWeek() {
      return this.activeWeekStart() === localWeekStart(new Date(this.todayTimestamp));
    },

    activeWeekStart() {
      return this.state.weekStart ?? localWeekStart(new Date(this.todayTimestamp));
    },

    weekLabel(start = this.activeWeekStart()) {
      return weekDate.formatRange(parseLocalDate(start), parseLocalDate(dateAfter(start, 6)));
    },

    dayLabel(day) {
      return shortDate.format(parseLocalDate(dateAfter(this.activeWeekStart(), DAYS.findIndex(({ id }) => id === day.id))));
    },

    todayMeals() {
      return this.isCurrentWeek() ? this.currentMeals(localDayId(new Date(this.todayTimestamp))) : [];
    },

    todayLabel() {
      return todayDate.format(this.todayTimestamp);
    },

    openTodayInWeek() {
      this.dayId = this.isCurrentWeek() ? localDayId(new Date(this.todayTimestamp)) : DAYS[0].id;
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
      if (entry.from) return `Повторная подача · ${this.mealLabel(entry.from)}`;
      const servings = this.portionCount(mealId, entry.dishId);
      return `На всю готовку · ${this.formatPortions(this.recipeYield(entry.dish, servings))}`;
    },

    batchRecord(mealId, dishId) {
      return this.state.batchRecords[batchKey(mealId, dishId)];
    },

    storageNote(mealId, entry) {
      const source = entry.from ?? mealId;
      const record = this.batchRecord(source, entry.dishId);
      if (!record) {
        if (!entry.from) return { text: 'Приготовление запланировано' };
        if (entry.storage === 'freezer') return { text: 'Запланировано · порцию нужно заморозить после готовки' };
        if (needsFreezer(entry.dish, source, mealId)) {
          return { text: 'Для этой подачи нужна заморозка после готовки или свежее блюдо', warning: true };
        }
        return { text: 'Приготовление и хранение ещё не отмечены' };
      }

      const cooked = `Приготовлено ${historyDate.format(record.cookedAt)}`;
      if (record.storage === 'unknown') {
        return { text: `${cooked} · хранение не указано`, warning: Boolean(entry.from) };
      }
      if (record.storage === 'freezer') {
        return { text: entry.from ? 'Отмечена заморозка · разморозьте порцию в холодильнике' : `${cooked} · отмечена заморозка` };
      }

      const deadline = fridgeDeadline(entry.dish, record);
      const now = this.todayTimestamp;
      if (now >= deadline) return { text: 'Срок хранения в холодильнике истёк · приготовьте свежую порцию', warning: true };
      if (entry.from && servingDayStart(this.activeWeekStart(), mealId) >= deadline) {
        return { text: 'К этому дню срок хранения в холодильнике истечёт · приготовьте свежую порцию', warning: true };
      }
      if (entry.from && servingDayEnd(this.activeWeekStart(), mealId) >= deadline) {
        return { text: `Холодильник до ${historyDate.format(deadline)} · проверьте время подачи`, warning: true };
      }
      return { text: `${cooked} · холодильник до ${historyDate.format(deadline)}` };
    },

    reusableBatches(mealId) {
      return earlierBatches(this.state.week, mealId).flatMap(({ mealId: source, dishId }) => {
        const dish = this.dishById(dishId);
        const record = this.batchRecord(source, dishId);
        const deadline = record?.storage === 'fridge' ? fridgeDeadline(dish, record) : Infinity;
        if (deadline <= this.todayTimestamp || deadline <= servingDayEnd(this.activeWeekStart(), mealId)) return [];
        const freezer = needsFreezer(dish, source, mealId);
        if (freezer && record?.storage === 'unknown') return [];
        return [{
          key: batchKey(source, dishId),
          freezer: freezer && !record,
          frozen: record?.storage === 'freezer',
          label: `${dish.name} · ${this.mealLabel(source)}`,
        }];
      });
    },

    reuseBatch(mealId, value, freeze) {
      const option = this.reusableBatches(mealId).find(({ key }) => key === value);
      if (!option || (option.freezer && !freeze)) return false;
      const [from, dishId] = value.split('/');
      const storage = freeze || option.frozen ? 'freezer' : null;
      if (!addToMeal(this.state.week, mealId, dishId, from, storage)) return false;
      return this.persistWeek();
    },

    prepareSeparately(mealId, dishId) {
      const entry = this.state.week[mealId]?.find((item) => item.dishId === dishId);
      if (!entry?.from) return;
      entry.from = null;
      delete entry.storage;
      this.persistWeek();
    },

    canPlanFreezer(mealId, entry) {
      return entry.from && entry.storage !== 'freezer' && !this.batchRecord(entry.from, entry.dishId)
        && needsFreezer(entry.dish, entry.from, mealId);
    },

    planFreezer(mealId, dishId) {
      const entry = this.state.week[mealId]?.find((item) => item.dishId === dishId);
      if (!entry) return;
      entry.storage = 'freezer';
      this.persistWeek();
    },

    datedMealLabel(meal) {
      const date = parseLocalDate(dateAfter(this.activeWeekStart(), mealDayIndex(meal.id)));
      return `${shortDate.format(date)} · ${meal.label}`;
    },

    openMove(mealId, entry) {
      this.moveTarget = { mealId, dishId: entry.dishId, from: entry.from, weekStart: this.state.weekStart };
      this.moveDestination = '';
      this.moveMessage = '';
      this.$refs.moveDialog.showModal();
    },

    async moveDish() {
      const { mealId, dishId, from, weekStart } = this.moveTarget;
      const destination = this.moveDestination;
      const current = this.state.week[mealId]?.find((entry) => entry.dishId === dishId);
      const next = weekStart === this.state.weekStart && current?.from === from
        ? moveMealDish(this.state.week, mealId, destination, dishId) : null;
      if (!next) {
        this.moveMessage = 'Перенос невозможен. Проверьте границы недели, порядок подач и повторяющиеся блюда.';
        return;
      }
      const dish = this.dishById(dishId);
      const record = this.batchRecord(from ?? mealId, dishId);
      const source = from ?? destination;
      const repeats = MEALS.filter(({ id }) => next[id]?.some((entry) => entry.dishId === dishId && entry.from === source));
      const shifted = from ? repeats.filter(({ id }) => id === destination) : repeats;
      for (const { id } of shifted) {
        const entry = next[id].find((item) => item.dishId === dishId && item.from === source);
        if (record?.storage === 'fridge' && servingDayEnd(weekStart, id) >= fridgeDeadline(dish, record)) {
          this.moveMessage = 'К этой дате может истечь срок в холодильнике. Запланируйте свежую порцию.';
          return;
        }
        if (!record && needsFreezer(dish, source, id) && entry.storage !== 'freezer') {
          this.moveMessage = 'Для переноса повтора на эту дату нужна заморозка. Добавьте повтор на новом месте с отметкой о заморозке.';
          return;
        }
      }
      const records = { ...this.state.batchRecords };
      if (!from && record) {
        delete records[batchKey(mealId, dishId)];
        records[batchKey(destination, dishId)] = record;
      }
      if (await this.persistWeek({ ...this.state, week: next, batchRecords: records })) {
        this.dayId = MEALS.find(({ id }) => id === destination).dayId;
        this.$refs.moveDialog.close();
        this.plannerMessage = 'Блюдо перенесено.';
      } else {
        this.moveMessage = 'Перенос не сохранился. Проверьте текущий план и повторите действие.';
      }
    },

    openBatch(mealId, dishId) {
      const dish = this.dishById(dishId);
      const record = this.batchRecord(mealId, dishId);
      this.batchTarget = { mealId, dish, weekStart: this.state.weekStart, record };
      this.batchDateTime = dateTimeInput(record?.cookedAt ?? Date.now());
      this.batchStorage = record?.storage ?? 'unknown';
      this.batchConfirmed = Boolean(record && record.storage !== 'unknown');
      this.batchMessage = '';
      this.$refs.batchDialog.showModal();
    },

    coolingHours() {
      return this.batchTarget && fridgeHours(this.batchTarget.dish) === 24 ? '1 часа' : '2 часов';
    },

    async recordBatch(clear = false) {
      const { mealId, dish, weekStart, record } = this.batchTarget;
      const key = batchKey(mealId, dish.id);
      const latest = this.state.batchRecords[key];
      if (weekStart !== this.state.weekStart || (latest?.cookedAt !== record?.cookedAt || latest?.storage !== record?.storage)
          || !this.state.week[mealId]?.some((entry) => entry.dishId === dish.id && !entry.from)) {
        this.batchMessage = 'Эта запись изменилась. Откройте отметку о готовке снова.';
        return;
      }
      const cookedAt = new Date(this.batchDateTime).getTime();
      if (!clear && (!Number.isFinite(cookedAt) || cookedAt <= 0 || cookedAt > Date.now())) {
        this.batchMessage = 'Укажите дату и время, когда блюдо уже было приготовлено.';
        return;
      }
      if (!clear && this.batchStorage !== 'unknown' && !this.batchConfirmed) {
        this.batchMessage = 'Подтвердите, что убрали остатки вскоре после готовки, или выберите «Хранение не указано».';
        return;
      }
      const records = { ...this.state.batchRecords };
      if (clear) delete records[key];
      else records[key] = { cookedAt, storage: this.batchStorage };
      if (await this.persistWeek({ ...this.state, batchRecords: records })) this.$refs.batchDialog.close();
      else this.batchMessage = 'Отметка не сохранилась. Проверьте текущий план и повторите действие.';
    },

    removeMealDish(mealId, dishId) {
      removeFromMeal(this.state.week, mealId, dishId);
      this.persistWeek();
    },

    async distributeSelection() {
      const added = distributeMenu(this.state.week, this.menu, this.data);
      if (added && !await this.persistWeek()) return;
      this.plannerMessage = added ? `Добавлено в расписание — ${added}` : 'Расписание осталось прежним.';
    },

    async fillSchedule() {
      const { filled, remaining } = fillEmptyMeals(this.state.week, this.data, this.state, this.menu);
      if (filled && !await this.persistWeek()) return;
      if (remaining) {
        this.plannerMessage = `Заполнено — ${filled}. Без подходящего блюда — ${remaining}.`;
      } else {
        this.plannerMessage = filled ? `Заполнено приёмов — ${filled}. Расписание готово.` : 'Все приёмы уже заполнены.';
      }
    },

    openNewWeek() {
      this.archiveName = '';
      this.nextWeekStart = this.defaultNextWeek();
      this.weekStorageError = '';
      this.$refs.newWeekDialog.showModal();
    },

    openHistory() {
      this.nextWeekStart = this.defaultNextWeek();
      this.weekStorageError = '';
      this.$refs.historyDialog.showModal();
    },

    hasWeekPlan() {
      return Object.keys(this.state.week).length > 0;
    },

    defaultNextWeek() {
      const current = localWeekStart();
      const next = dateAfter(this.activeWeekStart(), 7);
      return next <= current || !isWeekStart(next) ? current : next;
    },

    openWeekShare() {
      if (!this.hasWeekPlan()) return;
      const schedule = formatWeekSchedule(this.state.week, (id) => this.dishById(id)?.name);
      const shopping = shoppingText(this.shoppingGroups('week'));
      this.shareText = `Меню на неделю · ${this.state.persons} чел.\n${this.weekLabel()}\n\n${schedule}\n\nПокупки\n${shopping || 'Всё нужное есть дома.'}`;
      this.shareMessage = '';
      this.$refs.shareDialog.showModal();
    },

    canShareWeek() {
      const text = this.shareText;
      return Boolean(text) && typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({ text }));
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

    async replaceWeek(source, name = '') {
      if (!isWeekStart(this.nextWeekStart)) {
        this.weekStorageError = 'Выберите понедельник, с которого начнётся новая неделя.';
        return false;
      }
      const existing = this.state.weekHistory;
      const weekHistory = this.hasWeekPlan() ? [{
        id: Math.max(Date.now(), (existing[0]?.id ?? 0) + 1),
        name: name.trim().slice(0, 60),
        persons: this.state.persons,
        week: sanitizeWeek(this.state.week),
        weekStart: this.state.weekStart,
      }, ...existing] : existing;
      const next = {
        ...this.state,
        week: sanitizeWeek(source, (id) => Boolean(this.dishById(id))),
        weekStart: this.nextWeekStart,
        batchRecords: {},
        weekHistory,
        weekChecked: {},
      };
      if (!await this.saveState(next)) {
        this.weekStorageError = 'Новую неделю сохранить не удалось. Проверьте текущий план и повторите действие.';
        return false;
      }
      this.dayId = DAYS[0].id;
      this.copyText = '';
      this.copyMessage = '';
      this.plannerMessage = 'Новая неделя начата.';
      return true;
    },

    async startNewWeek(copyCurrent) {
      if (await this.replaceWeek(copyCurrent ? this.state.week : {}, this.archiveName)) {
        this.$refs.newWeekDialog.close();
      }
    },

    async copyHistoryWeek(entry) {
      if (await this.replaceWeek(entry.week)) this.$refs.historyDialog.close();
    },

    persistWeek(next = this.state) {
      this.plannerMessage = '';
      this.state = next;
      this.state.week = sanitizeWeek(next.week);
      if (this.hasWeekPlan()) this.state.weekStart = this.activeWeekStart();
      this.state.batchRecords = sanitizeBatchRecords(next.batchRecords, this.state.week);
      this.pruneShoppingChecks('week');
      return this.saveState();
    },

    openRecipe(dish, servings = this.state.persons) {
      this.recipePreview = { dish, servings };
      this.$nextTick(() => this.$refs.recipeDialog.showModal());
    },
  };
}
