import {
  addToMeal, cookingBatches, dateAfter, DAYS, dishAndServings, distributeMenu, earlierBatches,
  fillEmptyMeals, formatWeekSchedule, isWeekStart, localDateKey, localDayId, localWeekStart,
  mealDayIndex, MEALS, moveMealDish, parseLocalDate, removeFromMeal, replaceMealDish, sanitizeWeek,
} from './week.js';
import { shoppingText } from './shopping.js';
import {
  availablePortions, batchKey, fridgeDeadline, fridgeHours, needsFreezer,
  sanitizeBatchRecords, servingDayEnd, servingDayStart, storageCounts,
} from './batch-storage.js';

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
    batchServings: [],
    batchReserve: { mealId: 'reserve', label: 'Свободные порции', fridge: 0, freezer: 0 },
    batchConfirmed: false,
    batchMessage: '',
    shareText: '',
    shareMessage: '',

    showView(view, { remember = true } = {}) {
      const previousView = this.view;
      this.catalogTarget = null;
      this.catalogWeek = null;
      this.replacement = null;
      this.view = view;
      if (previousView === 'shopping' && view !== 'shopping') this.clearShoppingControls();
      if (view === 'catalog') return;
      if (view === 'today') this.refreshToday();
      if (!remember) {
        this.shoppingMode = this.state.shoppingMode;
        return;
      }
      if (view !== 'shopping') this.shoppingMode = view === 'menu' ? 'menu' : 'week';
      if (this.state.view === view && this.state.shoppingMode === this.shoppingMode) return;
      this.state.view = view;
      this.state.shoppingMode = this.shoppingMode;
      this.saveState();
    },

    navigateTo(view) {
      this.showView(view);
      const heading = this.$refs.shoppingHeading;
      this.$nextTick(() => {
        window.scrollTo(0, 0);
        if (view === 'shopping') heading.focus({ preventScroll: true });
      });
    },

    closeOptions(button) {
      const options = button.closest('details');
      options.querySelector('summary').focus();
      options.open = false;
    },

    clearShoppingControls() {
      this.copyMessage = '';
      this.copyText = '';
      this.editingPrices = false;
    },

    async setShoppingMode(mode) {
      if (this.shoppingMode === mode) return;
      this.shoppingMode = this.state.shoppingMode = mode;
      this.state.view = 'shopping';
      this.clearShoppingControls();
      if (!await this.saveState() && this.shoppingMode === mode) this.shoppingMode = this.state.shoppingMode;
    },

    openCatalog(mealId, dishId = null) {
      this.navigateTo('catalog');
      this.catalogTarget = mealId;
      this.catalogWeek = this.activeWeekStart();
      this.replacement = dishId;
      this.plannerMessage = '';
      this.catalogQuery = '';
      this.catalogCategory = '';
      this.$nextTick(() => {
        if (this.view !== 'catalog') return;
        const target = window.matchMedia('(pointer: coarse)').matches ? this.$refs.catalogHeading : this.$refs.catalogSearch;
        target.focus({ preventScroll: true });
      });
    },

    returnToMeal() {
      const mealId = this.catalogTarget;
      this.showView('week');
      this.$nextTick(() => {
        const heading = document.getElementById(`meal-${mealId}`);
        heading?.scrollIntoView({ block: 'start' });
        heading?.focus({ preventScroll: true });
      });
    },

    catalogEntries() {
      const words = searchable(this.catalogQuery).trim().split(/\s+/);
      const family = this.catalogCategory === 'family';
      return this.visibleCategories()
        .filter((category) => family || !this.catalogCategory || category.id === this.catalogCategory)
        .flatMap((category) => category.dishes
          .filter((dish) => (!family || dish.familyRecipe) && words.every((word) => searchable(dish.name).includes(word)))
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
          if (this.isHomemade(entry.dish)) {
            next[target].find(({ dishId }) => dishId === entry.dish.id).homemade = true;
          }
          this.state.week = next;
        } else if (!addToMeal(this.state.week, target, entry.dish.id, null, null, this.isHomemade(entry.dish))) {
          return;
        }
        if (await this.persistWeek()) {
          if (this.view === 'catalog' && this.catalogTarget === target) this.returnToMeal();
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

    hasMealsToday() {
      return this.todayMeals().some(({ id }) => this.state.week[id]?.length);
    },

    todayLabel() {
      return todayDate.format(this.todayTimestamp);
    },

    openTodayInWeek() {
      this.dayId = this.isCurrentWeek() ? localDayId(new Date(this.todayTimestamp)) : DAYS[0].id;
      this.navigateTo('week');
    },

    openPlanning() {
      this.openTodayInWeek();
      this.$nextTick(() => document.getElementById('fill-schedule')?.focus({ preventScroll: true }));
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
        servings: this.batchRecord(batch.mealId, batch.dishId)?.servings ?? this.state.persons * batch.mealCount,
      }));
    },

    portionCount(mealId, dishId) {
      return this.plannedBatches().find((batch) => batch.mealId === mealId && batch.dishId === dishId)
        ?.servings ?? this.state.persons;
    },

    mealDishNote(mealId, entry) {
      const variant = this.isHomemade(entry.dish, entry.from ?? mealId) ? ' · домашний вариант' : '';
      if (entry.from) return `Повторная подача · ${this.mealLabel(entry.from)}${variant}`;
      const servings = this.portionCount(mealId, entry.dishId);
      return `На всю готовку · ${this.formatPortions(this.recipeYield(entry.dish, servings))}${variant}`;
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
      const weekStart = this.activeWeekStart();
      if (record.cookedAt > servingDayEnd(weekStart, mealId)) {
        return { text: `${cooked} · позже запланированной подачи`, warning: true };
      }
      const counts = storageCounts(record.portions[mealId]);
      const total = counts.fridge + counts.freezer;
      const deadline = fridgeDeadline(entry.dish, record);
      const expired = this.todayTimestamp >= deadline;
      if (!total) {
        const legacy = record.legacyStorage === 'fridge' ? 'холодильник'
          : record.legacyStorage === 'freezer' ? 'морозилка' : '';
        if (legacy) {
          const oldFridgeExpired = record.legacyStorage === 'fridge'
            && Math.max(this.todayTimestamp, servingDayStart(weekStart, mealId)) >= fridgeDeadline(entry.dish, record);
          return { text: oldFridgeExpired
            ? 'По прежней отметке срок хранения в холодильнике истёк · приготовьте свежие порции'
            : `${cooked} · прежняя отметка: ${legacy}. Укажите число порций.`, warning: true };
        }
        if (entry.from) return { text: `${cooked} · хранение этой подачи не указано`, warning: true };
        const reserve = (expired ? 0 : record.reserve.fridge) + record.reserve.freezer;
        const expiredReserve = expired && record.reserve.fridge > 0;
        const remaining = reserve ? ` · свободно ${this.formatPortions(reserve)} по отметкам` : '';
        return {
          text: `${cooked}${remaining}${expiredReserve ? ' · срок свободных порций в холодильнике истёк' : ''}`,
          warning: expiredReserve,
        };
      }
      const tooLate = servingDayStart(weekStart, mealId) >= deadline;
      const checkTime = servingDayEnd(weekStart, mealId) >= deadline;
      const text = [];
      if (counts.fridge) {
        const status = expired ? 'срок истёк, приготовьте свежие'
          : tooLate ? 'срок истечёт к подаче, приготовьте свежие'
          : `до ${historyDate.format(deadline)}${checkTime ? ', проверьте время подачи' : ''}`;
        text.push(`Холодильник — ${this.formatPortions(counts.fridge)}, ${status}`);
      }
      if (counts.freezer) text.push(`Морозилка — ${this.formatPortions(counts.freezer)}, разморозьте в холодильнике`);
      if (entry.from && total < this.state.persons) {
        text.push(`Хранение ещё ${this.state.persons - total} порц. не указано`);
      }
      return { text: text.join(' · '), warning: Boolean((counts.fridge && checkTime) || (counts.fridge && expired) || (entry.from && total < this.state.persons)) };
    },

    reusableBatches(mealId) {
      return earlierBatches(this.state.week, mealId).flatMap(({ mealId: source, dishId }) => {
        const dish = this.dishById(dishId);
        const record = this.batchRecord(source, dishId);
        const portions = record && availablePortions(record, dish, this.activeWeekStart(), mealId, this.state.persons, this.todayTimestamp);
        if (record && !portions) return [];
        const freezer = needsFreezer(dish, source, mealId);
        return [{
          key: batchKey(source, dishId),
          freezer: freezer && !record,
          portions,
          label: `${dish.name} · ${this.mealLabel(source)}`,
        }];
      });
    },

    reuseBatch(mealId, value, freeze) {
      const option = this.reusableBatches(mealId).find(({ key }) => key === value);
      if (!option || (option.freezer && !freeze)) return false;
      const [from, dishId] = value.split('/');
      const storage = freeze ? 'freezer' : null;
      if (!addToMeal(this.state.week, mealId, dishId, from, storage)) return false;
      if (option.portions) {
        const record = this.batchRecord(from, dishId);
        record.portions[mealId] = option.portions;
        record.reserve.fridge -= option.portions.fridge;
        record.reserve.freezer -= option.portions.freezer;
      }
      return this.persistWeek();
    },

    prepareSeparately(mealId, dishId) {
      const entry = this.state.week[mealId]?.find((item) => item.dishId === dishId);
      if (!entry?.from) return;
      if (this.isHomemade(this.dishById(dishId), entry.from)) entry.homemade = true;
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
      const offset = MEALS.findIndex(({ id }) => id === destination) - MEALS.findIndex(({ id }) => id === mealId);
      const remapped = {};
      if (record) {
        for (const [id, portion] of Object.entries(record.portions)) {
          const index = MEALS.findIndex((meal) => meal.id === id);
          const moved = from ? (id === mealId ? destination : id) : MEALS[index + offset]?.id;
          if (moved) remapped[moved] = portion;
        }
      }
      const servings = dishAndServings(next, source, dishId);
      const shifted = from ? servings.filter(({ mealId: id }) => id === destination) : servings;
      for (const { mealId: id, entry } of shifted) {
        if (remapped[id]?.fridge && servingDayEnd(weekStart, id) >= fridgeDeadline(dish, record)) {
          this.moveMessage = 'К этой дате может истечь срок в холодильнике. Запланируйте свежую порцию.';
          return;
        }
        if (!record && entry.from && needsFreezer(dish, source, id) && entry.storage !== 'freezer') {
          this.moveMessage = 'Для переноса повтора на эту дату нужна заморозка. Добавьте повтор на новом месте с отметкой о заморозке.';
          return;
        }
      }
      const records = { ...this.state.batchRecords };
      if (record) {
        delete records[batchKey(from ?? mealId, dishId)];
        records[batchKey(source, dishId)] = { ...record, portions: remapped };
      }
      if (await this.persistWeek({ ...this.state, week: next, batchRecords: records })) {
        this.dayId = MEALS.find(({ id }) => id === destination).dayId;
        this.$refs.moveDialog.close();
        this.plannerMessage = 'Блюдо перенесено.';
      } else {
        this.moveMessage = 'Перенос не сохранился. Проверьте текущий план и повторите действие.';
      }
    },

    openBatch(mealId, dishId, selectedMeal = mealId) {
      const dish = this.dishById(dishId);
      const record = this.batchRecord(mealId, dishId);
      this.batchServings = dishAndServings(this.state.week, mealId, dishId).map(({ mealId: id, entry }) => ({
        mealId: id, label: this.mealLabel(id), plannedFreezer: entry.storage === 'freezer',
        ...storageCounts(record?.portions[id]),
      }));
      this.batchTarget = { mealId, dish, weekStart: this.state.weekStart, record, selectedMeal };
      this.batchDateTime = dateTimeInput(record?.cookedAt ?? Date.now());
      this.batchReserve = { mealId: 'reserve', label: 'Свободные порции', ...storageCounts(record?.reserve) };
      this.batchConfirmed = this.hasStoredPortions();
      this.batchMessage = '';
      this.$refs.batchDialog.showModal();
    },

    coolingHours() {
      return this.batchTarget && fridgeHours(this.batchTarget.dish) === 24 ? '1 часа' : '2 часов';
    },

    hasStoredPortions() {
      return [this.batchReserve, ...this.batchServings].some(({ fridge, freezer }) => fridge > 0 || freezer > 0);
    },

    async recordBatch(clear = false) {
      const { mealId, dish, weekStart, record } = this.batchTarget;
      const key = batchKey(mealId, dish.id);
      const latest = this.state.batchRecords[key];
      const servings = dishAndServings(this.state.week, mealId, dish.id).map((item) => item.mealId);
      if (weekStart !== this.state.weekStart || JSON.stringify(latest) !== JSON.stringify(record)
          || JSON.stringify(servings) !== JSON.stringify(this.batchServings.map((item) => item.mealId))
          || !this.state.week[mealId]?.some((entry) => entry.dishId === dish.id && !entry.from)) {
        this.batchMessage = 'Эта запись изменилась. Откройте отметку о готовке снова.';
        return;
      }
      const cookedAt = new Date(this.batchDateTime).getTime();
      if (!clear && (!Number.isFinite(cookedAt) || cookedAt <= 0 || cookedAt > Date.now())) {
        this.batchMessage = 'Укажите дату и время, когда блюдо уже было приготовлено.';
        return;
      }
      if (!clear && this.hasStoredPortions() && !this.batchConfirmed) {
        this.batchMessage = 'Подтвердите, что убрали порции вскоре после готовки.';
        return;
      }
      const records = { ...this.state.batchRecords };
      if (clear) delete records[key];
      else {
        records[key] = {
          cookedAt,
          servings: record?.servings ?? this.portionCount(mealId, dish.id),
          portions: Object.fromEntries(this.batchServings.map((row) => [row.mealId, storageCounts(row)])),
          reserve: storageCounts(this.batchReserve),
        };
      }
      if (await this.persistWeek({ ...this.state, batchRecords: records })) this.$refs.batchDialog.close();
      else this.batchMessage = 'Отметка не сохранилась. Проверьте текущий план и повторите действие.';
    },

    removeMealDish(mealId, dishId) {
      const record = this.batchRecord(mealId, dishId);
      const next = removeFromMeal(this.state.week, mealId, dishId);
      if (record && next) {
        this.state.batchRecords[batchKey(next, dishId)] = record;
        delete this.state.batchRecords[batchKey(mealId, dishId)];
      }
      this.persistWeek();
    },

    async distributeSelection() {
      const added = distributeMenu(this.state.week, this.menu, this.data, this.state.homemade);
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

    hasEmptyMeals() {
      return MEALS.some(({ id }) => !this.state.week[id]?.length);
    },

    async setQuickDinners(input) {
      this.state.quickDinners = input.checked;
      if (!await this.saveState()) input.checked = this.state.quickDinners;
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

    openRecipe(dish, servings = this.state.persons, mealId = null) {
      this.recipePreview = { dish, servings, mealId, weekStart: this.state.weekStart };
      this.$nextTick(() => this.$refs.recipeDialog.showModal());
    },
  };
}
