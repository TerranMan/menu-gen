import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { encodeBackup } from '../src/store.js';

let server;
let browser;
let url;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  url = `http://127.0.0.1:${server.httpServer.address().port}${server.config.base}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
});

async function openMenu(t, savedState, { withoutNativeShare = false, legacyKey = 'menu_gen_v1', mobile = false } = {}) {
  const viewport = mobile ? { width: 320, height: 640 } : { width: 390, height: 844 };
  const context = await browser.newContext({ viewport, timezoneId: 'UTC', hasTouch: mobile, isMobile: mobile });
  const pageErrors = [];
  context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
  t.after(async () => {
    await context.close();
    assert.deepEqual(pageErrors, []);
  });
  await context.addInitScript(({ state, withoutNativeShare, legacyKey }) => {
    if (!['http:', 'https:'].includes(location.protocol)) return;
    Math.random = () => 0;
    if (withoutNativeShare) {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    }
    if (state && !localStorage.getItem(legacyKey)) {
      localStorage.setItem(legacyKey, JSON.stringify(state));
    }
    window.readStoredMenu = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('menu-gen');
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('menu').objectStore('menu').get('current');
        read.onerror = () => reject(read.error);
        read.onsuccess = () => resolve(read.result);
        database.close();
      };
    });
  }, { state: savedState, withoutNativeShare, legacyKey });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('heading', { name: '🍽️ Меню на неделю' }).waitFor();
  return { context, page };
}

function storedState(page) {
  return page.evaluate(() => window.readStoredMenu());
}

async function reopenMenu(page) {
  await page.locator('.app[aria-busy="false"]').waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '🍽️ Меню на неделю' }).waitFor();
}

async function weekAction(page, name) {
  await page.getByLabel('Управление неделей', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function dishAction(meal, dish, name) {
  await meal.locator('.dish-options summary').filter({ visible: true }).and(meal.getByLabel(`Действия · ${dish}`)).click();
  await meal.getByRole('button', { name, exact: true }).click();
}

function breakfasts(page) {
  return page.locator('.category').filter({ has: page.getByRole('heading', { name: /^Завтраки/ }) });
}

async function openShopping(page) {
  await page.getByRole('button', { name: 'Покупки', exact: true }).click();
  await page.getByRole('heading', { name: 'Покупки', exact: true }).waitFor();
}

async function openBackup(page) {
  await page.locator('footer').getByRole('button', { name: 'Резервная копия' }).click();
  return page.getByRole('dialog', { name: 'Резервная копия' });
}

test('backup exports and restores across browsers offline, with preview, cancel and undo', async (t) => {
  const { context: sourceContext, page: source } = await openMenu(t, {
    version: 2, view: 'week', shoppingMode: 'menu', persons: 4, quickDinners: true, kidsMeals: true, weekStart: '2026-11-23',
    week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
    batchRecords: { 'mon-lunch/borshch': { cookedAt: Date.UTC(2025, 0, 6), reserve: { fridge: 0, freezer: 2 } } },
    weekHistory: [{ id: Date.UTC(2025, 0, 6), name: 'Зимнее меню', persons: 2,
      week: { 'mon-breakfast': [{ dishId: 'blini', from: null }] } }],
    stock: { 'мука__г': 800 }, prices: { 'мука__г': 0.15 }, favorites: ['blini'],
  });
  await source.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await sourceContext.setOffline(true);
  const from = await openBackup(source);
  const [download] = await Promise.all([
    source.waitForEvent('download'),
    from.getByRole('button', { name: 'Скачать копию' }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^menu-gen-\d{4}-\d{2}-\d{2}\.json$/);
  const buffer = await readFile(await download.path());
  const exported = JSON.parse(buffer);
  assert.deepEqual(exported.state, await storedState(source));

  const { context, page } = await openMenu(t, { version: 2, persons: 7, stock: { 'мука__г': 100 } });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  const backup = await openBackup(page);
  const input = backup.getByLabel('Файл для восстановления');
  const chooseFile = () => input.setInputFiles({
    name: 'семейное-меню.json', mimeType: 'application/json', buffer,
  });
  const preview = backup.getByRole('region', { name: 'Предпросмотр копии' });

  await chooseFile();
  await preview.getByText('семейное-меню.json').waitFor();
  assert.match(await preview.innerText(), /приёмов 1/);
  assert.equal((await storedState(page)).persons, 7);
  assert.equal(await backup.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await preview.getByRole('button', { name: 'Отмена' }).click();
  assert.equal(await preview.isVisible(), false);
  assert.equal((await storedState(page)).persons, 7);

  await chooseFile();
  await preview.getByRole('button', { name: 'Заменить данные' }).click();
  await backup.getByText(/Копия восстановлена/).waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector('dialog[open] [role="status"]'));
  assert.deepEqual(await storedState(page), exported.state);
  await backup.getByRole('button', { name: 'Закрыть резервную копию' }).click();
  await reopenMenu(page);
  await page.getByRole('heading', { name: 'План на неделю' }).waitFor();
  assert.equal(await page.locator('.persons-count').textContent(), '4');
  assert.deepEqual(await storedState(page), exported.state);

  await openBackup(page);
  await backup.getByRole('button', { name: 'Выбрать предыдущие данные' }).click();
  await preview.getByText('Данные перед последним восстановлением').waitFor();
  await preview.getByRole('button', { name: 'Заменить данные' }).click();
  await backup.getByText(/Копия восстановлена/).waitFor();
  const restored = await storedState(page);
  assert.equal(restored.persons, 7);
  assert.equal(restored.stock['мука__г'], 100);
});

test('invalid files, concurrent edits and a failed backup write preserve current data', async (t) => {
  const { context, page } = await openMenu(t, { version: 2, persons: 3 });
  const second = await context.newPage();
  await second.goto(url);
  await second.getByRole('heading', { name: '🍽️ Меню на неделю' }).waitFor();
  const state = await storedState(page);
  const backup = await openBackup(page);
  const input = backup.getByLabel('Файл для восстановления');
  const choose = (buffer) => input.setInputFiles({ name: 'menu.json', mimeType: 'application/json', buffer });
  const replacement = Buffer.from(encodeBackup({ ...state, persons: 8 }));
  await choose(Buffer.from('{'));
  await backup.getByText(/Копия повреждена/).waitFor();
  assert.equal(await backup.getByRole('button', { name: 'Заменить данные' }).isVisible(), false);
  assert.equal((await storedState(page)).persons, 3);

  await choose(replacement);
  const confirm = backup.getByRole('button', { name: 'Заменить данные' });
  await confirm.waitFor();
  await second.getByRole('button', { name: 'Больше персон' }).click();
  await second.locator('.app[aria-busy="false"]').waitFor();
  assert.equal((await storedState(second)).persons, 4);
  await confirm.click();
  await backup.getByText(/Данные изменились в другой вкладке/).waitFor();
  assert.equal((await storedState(page)).persons, 4);

  await choose(replacement);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'menu' && key === 'current') throw new DOMException('Storage full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await confirm.click();
  await backup.getByText(/Не удалось восстановить копию/).waitFor();
  assert.equal((await storedState(page)).persons, 4);
  await backup.getByRole('button', { name: 'Закрыть резервную копию' }).click();
  await openBackup(page);
  await backup.getByRole('button', { name: 'Скачать копию' }).waitFor();
  assert.equal(await backup.getByRole('button', { name: 'Выбрать предыдущие данные' }).isVisible(), false);
});

test('replacing and blocking a breakfast keeps seven unique dishes', async (t) => {
  const { page } = await openMenu(t);
  const slot = breakfasts(page);
  const names = () => slot.locator('.dish-name').allTextContents();
  const initial = await names();
  assert.equal(initial.length, 7);

  await slot.getByRole('button', { name: 'Заменить это блюдо' }).nth(1).click();
  const replaced = await names();
  assert.equal(replaced.length, 7);
  assert.equal(new Set(replaced).size, 7);
  assert.ok(!replaced.includes(initial[1]));
  assert.deepEqual(replaced.filter((_, index) => index !== 1), initial.filter((_, index) => index !== 1));

  await slot.getByLabel(`Действия · ${replaced[0]}`, { exact: true }).click();
  await slot.getByRole('button', { name: 'Не показывать' }).click();
  const afterBlock = await names();
  assert.equal(afterBlock.length, 7);
  assert.equal(new Set(afterBlock).size, 7);
  assert.ok(!afterBlock.includes(replaced[0]));
  await reopenMenu(page);
  assert.deepEqual(await names(), afterBlock);
});

test('first online visit is enough to reopen and use the shopping list offline', async (t) => {
  const { context, page } = await openMenu(t);
  const milk = page.getByRole('checkbox', { name: /^молоко —/ });
  await openShopping(page);
  await milk.check();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await reopenMenu(page);
  assert.equal(await milk.isChecked(), true);
  await page.getByRole('button', { name: 'Подборка', exact: true }).click();
  const slot = breakfasts(page);
  await slot.waitFor();
  assert.equal(await slot.locator('.dish-row').count(), 7);
  await slot.getByRole('button', { name: /^Блины/ }).click();
  const blini = page.locator('#recipe-blini');
  await blini.getByText('Тесто · Жидкое блинное на молоке', { exact: true }).waitFor();
  assert.equal(await blini.locator(':scope > .recipe-steps li').count(), 2);
  await blini.getByText('мука — 100 г', { exact: true }).waitFor();
  await blini.getByText('сахар — 0,5 ст.л. (6,2 г)', { exact: true }).waitFor();
  assert.equal(await blini.locator('.dough-details').count(), 0);
  assert.equal(await blini.getByText('мука — 100 г', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Больше персон' }).click();
  await openShopping(page);
  assert.equal(await milk.isChecked(), false);
  await milk.check();
  await reopenMenu(page);
  assert.equal(await milk.isChecked(), true);
  assert.equal(await page.locator('.persons-count').textContent(), '3');
  await page.getByRole('button', { name: 'Подборка', exact: true }).click();
  await page.getByRole('button', { name: 'Сгенерировать заново' }).click();
  assert.equal(await slot.locator('.dish-row').count(), 7);
  await openShopping(page);
  assert.equal(await milk.isChecked(), false);
});

test('whole duck batches show the same yield and quantities on the card and shopping list', async (t) => {
  const { page } = await openMenu(t, {
    version: 1,
    persons: 3,
    picks: { bakery: 0, breakfasts: 0, dishes: 0, fruits_vegetables: 0, garnishes: 0, salads: 0, soups: 0 },
    lastMenu: [{ categoryId: 'meat', dishIds: ['utka'] }],
  });
  const card = page.locator('#recipe-utka');
  await page.getByRole('button', { name: /^Утка/ }).click();
  assert.match(await card.locator('.recipe-meta').textContent(), /6 порций/);
  assert.equal(await card.locator('.recipe-steps li').count(), 3);
  assert.equal(await card.getByText('утка — 1 шт', { exact: true }).isVisible(), true);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Больше персон' }).click();
  assert.match(await card.locator('.recipe-meta').textContent(), /12 порций/);
  await openShopping(page);
  assert.equal(await page.getByRole('checkbox', { name: 'утка — 2 шт', exact: true }).count(), 1);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Меньше персон' }).click();
  await page.getByRole('checkbox', { name: 'утка — 1 шт', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'яблоко — 6 шт', exact: true }).count(), 1);
});

test('old saved menus recover malformed entries and show category shortages', async (t) => {
  const { page } = await openMenu(t, {
    version: 1,
    persons: 4,
    lastMenu: [{ categoryId: 'bakery' }, { categoryId: 'breakfasts', dishIds: ['omlet', 'omlet', 'unknown'] }],
    blocks: [
      'blini', 'oladi', 'sirniki', 'mannaya-kasha', 'ovsyanaya-kasha', 'yogurt', 'glazunya',
      'skrembl-s-pomidorami', 'pshenichnaya-kasha', 'grenki', 'goryachie-tosti-s-dzhemom',
      'khlopya-s-molokom', 'tvorog', 'tvorozhnaya-massa',
      'babushkiny-bliny-na-kefire', 'sdobnye-grechnevye-bliny',
    ],
  });
  const slot = breakfasts(page);
  assert.equal(await page.locator('.category').count(), 9);
  assert.equal(await page.locator('.persons-count').textContent(), '4');
  assert.deepEqual(await slot.locator('.dish-name').allTextContents(), ['Омлет']);
  assert.equal(await slot.getByText('Подобрано 1 из 7.', { exact: false }).isVisible(), true);
  assert.equal(await slot.getByRole('button', { name: 'Больше блюд' }).isDisabled(), true);
  assert.equal(await slot.getByRole('button', { name: 'Заменить это блюдо' }).isDisabled(), true);
  const blocked = page.locator('details').filter({ hasText: 'Заблокировано' });
  await blocked.locator('summary').click();
  await blocked.getByRole('listitem').filter({ hasText: 'Оладьи' }).getByRole('button', { name: 'Вернуть' }).click();
  assert.deepEqual(await slot.locator('.dish-name').allTextContents(), ['Омлет', 'Оладьи']);
});

test('cottage cheese casserole and pea porridge are separate cards with recipes and images', async (t) => {
  const { context, page } = await openMenu(t, {
    version: 1,
    lastMenu: [
      { categoryId: 'bakery', dishIds: ['tvorozhnaya-zapekanka'] },
      { categoryId: 'dishes', dishIds: ['zapekanka-gorokhovaya-kasha-s-myasom', 'pelmeni'] },
    ],
  });
  await page.setViewportSize({ width: 320, height: 720 });
  for (const dish of [
    { name: 'Творожная запеканка', id: 'tvorozhnaya-zapekanka', ingredient: 'творог — 500 г' },
    { name: 'Гороховая каша с мясом', id: 'gorokhovaya-kasha-s-myasom', ingredient: 'горох — 120 г' },
  ]) {
    const photo = page.getByRole('button', { name: dish.name, exact: true }).locator('img');
    await photo.scrollIntoViewIfNeeded();
    assert.match(await photo.getAttribute('src'), new RegExp(`/images/${dish.id}\\.webp$`));
    await photo.evaluate((image) => image.decode());
    await photo.click();
    const card = page.locator(`#recipe-${dish.id}`);
    assert.equal(await card.getByText(dish.ingredient, { exact: true }).isVisible(), true);
    assert.equal(await card.locator('.recipe-steps li').count(), 3);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const photoTab = await context.newPage();
  const response = await photoTab.goto(`${url}images/grechka.webp`);
  assert.match(response.headers()['content-type'], /^image\/webp/);
});

test('catalog finds a recipe and a pinned manual choice survives regeneration and reload', async (t) => {
  const { page } = await openMenu(t);
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('ГРЕЧ');
  const filter = page.getByRole('combobox', { name: 'Категория' });
  await filter.selectOption('soups');
  await page.getByText('По этим условиям блюд нет.').waitFor();
  await filter.selectOption('garnishes');
  await page.getByRole('button', { name: /^Гречка/ }).click();
  const recipe = page.getByRole('dialog', { name: 'Гречка' });
  await recipe.waitFor();
  assert.equal(await recipe.locator('.recipe-steps li').count(), 2);
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).click();
  await page.getByRole('button', { name: 'Добавить · Гречка', exact: true }).click();
  await page.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await page.getByRole('button', { name: 'Подборка', exact: true }).click();

  const sides = page.locator('.category').filter({ has: page.getByRole('heading', { name: /^Гарниры/ }) });
  await sides.getByRole('button', { name: 'Меньше блюд' }).click();
  await page.getByRole('button', { name: 'Сгенерировать заново' }).click();
  await reopenMenu(page);
  assert.deepEqual(await sides.locator('.dish-name').allTextContents(), ['Гречка']);
  await sides.getByLabel('Действия · Гречка', { exact: true }).click();
  assert.equal(await sides.getByRole('button', { name: 'Открепить блюдо' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await sides.getByRole('button', { name: 'Заменить это блюдо' }).isDisabled(), true);
});

test('mobile catalog returns to the selected meal and a long recipe can be closed after scrolling', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week', week: { 'mon-dinner': [{ dishId: 'pelmeni', from: null }] },
  }, { mobile: true });
  const dinner = page.getByRole('region', { name: 'Ужин', exact: true });
  const add = dinner.getByRole('button', { name: 'Добавить блюдо' });
  await add.tap();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Выбрать блюдо · Пн · ужин');
  await page.getByRole('button', { name: 'К расписанию' }).tap();
  await page.waitForFunction(() => document.activeElement?.id === 'meal-mon-dinner');

  await add.tap();
  await page.getByRole('searchbox').fill('гречка');
  await page.getByRole('button', { name: 'Добавить · Гречка', exact: true }).tap();
  await dinner.getByRole('button', { name: 'Гречка', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'meal-mon-dinner');

  const opener = dinner.getByRole('button', { name: 'Пельмени', exact: true });
  await opener.tap();
  const dialog = page.getByRole('dialog', { name: 'Пельмени' });
  const close = dialog.getByRole('button', { name: 'Закрыть рецепт' });
  await dialog.getByRole('heading', { name: 'Как приготовить' }).waitFor();
  assert.ok(await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; }) > 0);
  const closeAtBottom = await close.boundingBox();
  assert.ok(closeAtBottom.y >= 0 && closeAtBottom.height >= 44);
  await close.tap();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === 'Пельмени');
});

test('the 2+ switch adds child recipes to the selection and empty meals without removing planned dishes', async (t) => {
  const { page } = await openMenu(t, undefined, { mobile: true });
  const mode = page.getByRole('checkbox', { name: 'Добавлять детские блюда 2+', exact: true });
  const heading = page.getByRole('heading', { name: 'Детские блюда 2+', exact: false });
  assert.equal(await mode.isChecked(), false);
  assert.equal(await heading.count(), 0);
  const original = await breakfasts(page).locator('.dish-name').allTextContents();

  await mode.check();
  await heading.waitFor();
  assert.deepEqual(await breakfasts(page).locator('.dish-name').allTextContents(), original);
  await page.getByRole('button', { name: 'Мягкая овсянка с грушей', exact: true }).click();
  await page.getByText(/очистите грушу, сварите до мягкости/).waitFor();
  await reopenMenu(page);
  assert.equal(await mode.isChecked(), true);

  await page.getByRole('button', { name: 'По дням', exact: true }).click();
  await page.getByRole('button', { name: 'Заполнить пустые приёмы' }).click();
  await page.getByText(/Расписание готово/).waitFor();
  const childMeal = page.getByRole('region', { name: 'Завтрак', exact: true })
    .getByRole('button', { name: 'Мягкая овсянка с грушей', exact: true });
  await childMeal.waitFor();
  await mode.uncheck();
  await reopenMenu(page);
  assert.equal(await mode.isChecked(), false);
  await childMeal.waitFor();
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  assert.equal(await page.getByRole('option', { name: 'Детские блюда 2+', exact: true }).count(), 0);
});

test('new desserts have their own catalog category and reach the shopping list', async (t) => {
  const { page } = await openMenu(t);
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('combobox', { name: 'Категория' }).selectOption('desserts');
  const pudding = page.getByRole('listitem').filter({ hasText: 'Шоколадный пудинг на молоке' });
  await pudding.getByText(/Американская кухня/).waitFor();
  await pudding.getByRole('button', { name: 'Добавить · Шоколадный пудинг на молоке', exact: true }).click();
  await openShopping(page);
  await page.getByRole('checkbox', { name: 'какао-порошок — 10 г', exact: true }).waitFor();
});

test('family recipes can be found in the catalog and add their full cake batch to shopping', async (t) => {
  const { page } = await openMenu(t, undefined, { mobile: true });
  await page.getByRole('button', { name: 'Каталог', exact: true }).tap();
  const category = page.getByRole('combobox', { name: 'Категория' });
  await category.selectOption({ label: 'Бабушкины рецепты' });
  await page.getByText('Сдобные гречневые блины', { exact: true }).waitFor();
  assert.equal(await page.locator('.catalog-dishes li').count(), 8);
  await page.getByRole('searchbox').fill('трухлявый');

  const name = 'Торт «Трухлявый пень» с сухофруктами';
  await page.getByRole('button', { name: /^Торт «Трухлявый пень» с сухофруктами/ }).tap();
  const recipe = page.getByRole('dialog', { name, exact: true });
  await recipe.getByText(/поперёк на кусочки шириной около 3 см/).waitFor();
  await recipe.getByRole('img', { name }).evaluate((img) => img.decode());
  assert.equal(await recipe.getByText(/орехи/).count(), 0);
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).tap();
  await page.getByRole('button', { name: `Добавить · ${name}`, exact: true }).tap();

  await openShopping(page);
  await page.getByRole('checkbox', { name: 'чернослив — 100 г', exact: true }).waitFor();
});

test('a weekly recipe can be served twice and copied with grouped shopping and the shared yield', async (t) => {
  const { context, page } = await openMenu(t);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'По дням' }).click();
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await lunch.getByRole('button', { name: 'Добавить блюдо' }).click();
  await page.getByRole('searchbox').fill('борщ');
  await page.getByRole('button', { name: 'Добавить · Борщ', exact: true }).click();
  await lunch.getByText('На всю готовку · 2 порции', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Вторник' }).click();
  await lunch.getByRole('combobox', { name: 'Блюдо для повторной подачи' }).selectOption('mon-lunch/borshch');
  assert.equal(await lunch.getByRole('button', { name: 'Борщ', exact: true }).count(), 0);
  await lunch.getByRole('button', { name: 'Добавить подачу' }).click();
  assert.equal(await lunch.getByText('Повторная подача · Пн · обед', { exact: true }).isVisible(), true);
  await lunch.getByRole('button', { name: 'Борщ', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Борщ' });
  assert.match(await recipe.locator('.recipe-meta').textContent(), /4 порции/);
  await recipe.getByRole('img', { name: 'Борщ' }).evaluate((image) => image.decode());
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).click();

  await openShopping(page);
  const beef = page.getByRole('checkbox', { name: /^мясо говядина — 266,7 г$/ });
  await beef.check();
  await page.waitForFunction(async () => Object.keys((await window.readStoredMenu()).weekChecked).length === 1);
  await page.getByRole('button', { name: 'Копировать список' }).click();
  await page.getByText('Список скопирован.', { exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /Мясо, птица и колбаса\r?\n✓ мясо говядина — 266,7 г/);

  await reopenMenu(page);
  assert.equal(await beef.isChecked(), true);
  await page.getByRole('button', { name: 'По дням' }).click();
  assert.equal(await lunch.getByText('На всю готовку · 4 порции', { exact: true }).isVisible(), true);
  await dishAction(lunch, 'Борщ', 'Убрать Борщ из приёма');
  await page.getByRole('button', { name: 'Вторник' }).click();
  assert.equal(await lunch.getByText('На всю готовку · 2 порции', { exact: true }).isVisible(), true);
});

test('autofill preserves a manual meal and history copies the saved week with a fresh shopping checklist', async (t) => {
  const cooked = [{ dishId: 'borshch', from: null }];
  const repeated = [{ dishId: 'borshch', from: 'mon-lunch' }];
  const { page } = await openMenu(t, {
    version: 1,
    view: 'week',
    week: { 'mon-lunch': cooked, 'tue-lunch': repeated },
  });
  const stored = () => storedState(page);
  await page.getByRole('button', { name: 'Заполнить пустые приёмы' }).click();
  await page.getByText('Заполнено приёмов — 19. Расписание готово.').waitFor();
  const week = (await stored()).week;
  assert.equal(Object.keys(week).length, 21);
  assert.deepEqual(week['mon-lunch'], cooked);
  assert.deepEqual(week['tue-lunch'], repeated);
  await openShopping(page);
  await page.locator('#shopping input[type=checkbox]').first().check();
  await page.waitForFunction(async () => Object.keys((await window.readStoredMenu()).weekChecked).length === 1);

  await page.getByRole('button', { name: 'По дням' }).click();
  await weekAction(page, 'Новая неделя');
  const next = page.getByRole('dialog', { name: 'Новая неделя' });
  await next.getByRole('textbox', { name: 'Название сохраняемого плана' }).fill('План с борщом');
  await next.getByRole('button', { name: 'Начать с пустого плана' }).click();
  await next.waitFor({ state: 'hidden' });
  assert.deepEqual((await stored()).week, {});
  assert.deepEqual((await stored()).weekChecked, {});

  await reopenMenu(page);
  await weekAction(page, 'История недель');
  const history = page.getByRole('dialog', { name: 'История недель' });
  await history.getByText('План с борщом', { exact: true }).click();
  assert.ok(await history.getByText('Борщ', { exact: true }).count() >= 2);
  await history.getByRole('button', { name: 'Скопировать в новую неделю' }).click();
  await history.waitFor({ state: 'hidden' });
  assert.deepEqual((await stored()).week, week);
  const mondayLunch = page.getByRole('region', { name: 'Обед', exact: true });
  await dishAction(mondayLunch, 'Борщ', 'Убрать Борщ из приёма');
  await page.waitForFunction(async () => (await window.readStoredMenu()).week['tue-lunch'][0].from === null);
  const changed = await stored();
  assert.deepEqual(changed.week['tue-lunch'], cooked);
  assert.deepEqual(changed.weekHistory[0].week, week);

  await weekAction(page, 'Новая неделя');
  await next.getByRole('button', { name: 'Скопировать текущий план' }).click();
  await next.waitFor({ state: 'hidden' });
  assert.deepEqual((await stored()).week, changed.week);
  assert.equal((await stored()).weekHistory.length, 2);
});

test('Today shows the current local weekday, portions to serve and the original cooking batch', async (t) => {
  const { page } = await openMenu(t, {
    version: 1,
    weekStart: '2026-11-23',
    week: {
      'mon-lunch': [{ dishId: 'borshch', from: null }],
      'tue-lunch': [{ dishId: 'borshch', from: 'mon-lunch' }],
      'tue-dinner': [{ dishId: 'utka', from: null }],
    },
  });
  await page.clock.setFixedTime(new Date('2026-11-24T12:00:00Z'));
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  const today = page.getByRole('region', { name: 'Сегодня', exact: true });
  await today.getByText(/вторник, 24 ноября/i).waitFor();
  const lunch = today.getByRole('region', { name: 'Обед', exact: true });
  assert.equal(await lunch.getByText('Повторная подача · Пн · обед').isVisible(), true);
  assert.equal(await lunch.getByText('Подать сегодня · 2 порции').isVisible(), true);
  assert.equal(await today.getByText('На всю готовку · 6 порций').isVisible(), true);
  await lunch.getByRole('button', { name: 'Борщ', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Борщ' });
  await recipe.getByText(/Выход — 4 порции/).waitFor();
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).click();
  await page.getByRole('button', { name: 'Открыть день в плане' }).click();
  assert.equal(await page.getByRole('button', { name: 'Вторник' }).getAttribute('aria-pressed'), 'true');
});

test('an empty Today screen takes the user directly to weekly planning', async (t) => {
  const { page } = await openMenu(t);
  await page.clock.setFixedTime(new Date('2026-11-24T12:00:00Z'));
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  const today = page.getByRole('region', { name: 'Сегодня', exact: true });
  await today.getByText('На сегодня пока ничего не запланировано.').waitFor();
  assert.equal(await today.locator('.meal-block h3').count(), 0);
  await today.getByRole('button', { name: 'Запланировать неделю' }).click();
  const fill = page.getByRole('button', { name: 'Заполнить пустые приёмы' });
  await fill.waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'fill-schedule');
  assert.equal(await page.getByRole('button', { name: 'Вторник' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual((await storedState(page)).week, {});
});

test('pantry reduces shopping quantities and cost, persists, and supports removing a stock entry', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week', week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
  });
  await openShopping(page);
  const previous = page.getByRole('checkbox', { name: 'мясо говядина — 133,3 г', exact: true });
  await previous.check();
  const previousTotal = await page.locator('.shopping-total').innerText();
  await page.getByRole('button', { name: 'Запасы дома' }).click();
  const stock = page.getByRole('dialog', { name: 'Запасы дома' });
  await stock.getByRole('combobox', { name: 'Продукт' }).selectOption('мясо говядина__г');
  await stock.getByRole('spinbutton').fill('100');
  await stock.getByRole('button', { name: 'Сохранить остаток' }).click();
  await stock.getByText('Остаток сохранён.').waitFor();
  await stock.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const remaining = page.getByRole('checkbox', { name: 'мясо говядина — 33,3 г', exact: true });
  assert.equal(await remaining.isChecked(), false);
  assert.notEqual(await page.locator('.shopping-total').innerText(), previousTotal);
  await reopenMenu(page);
  await remaining.waitFor();
  await page.getByRole('button', { name: 'Запасы дома' }).click();
  await stock.getByRole('button', { name: 'Убрать из запасов · мясо говядина' }).click();
  await stock.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await previous.waitFor();
});

test('sharing a week sends the same schedule and pantry-adjusted shopping text shown in the preview', async (t) => {
  const { page } = await openMenu(t, {
    version: 1,
    view: 'week',
    week: {
      'mon-lunch': [{ dishId: 'borshch', from: null }],
      'tue-lunch': [{ dishId: 'borshch', from: 'mon-lunch' }],
    },
    stock: { 'картофель__г': 200, 'мясо говядина__г': 100 },
  }, { withoutNativeShare: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => { window.copiedWeek = text; } },
    });
    Object.defineProperty(navigator, 'share', {
      value: async ({ text }) => { window.sharedWeek = text; },
    });
    Object.defineProperty(navigator, 'canShare', { value: () => true });
  });
  await weekAction(page, 'Поделиться неделей');
  const share = page.getByRole('dialog', { name: 'Поделиться неделей' });
  const preview = await share.getByRole('textbox', { name: 'Расписание и список покупок' }).inputValue();
  assert.match(preview, /Вторник\nОбед — Борщ \(повторная подача · Пн · обед\)/);
  assert.match(preview, /Покупки\n[\s\S]+мясо говядина — 166,7 г/);
  assert.ok(!preview.includes('картофель'));
  await share.getByRole('button', { name: 'Копировать неделю' }).click();
  await share.getByText('Меню и покупки скопированы.').waitFor();
  await share.getByRole('button', { name: 'Отправить…' }).click();
  assert.deepEqual(await page.evaluate(() => [window.copiedWeek, window.sharedWeek]), [preview, preview]);
});

test('shopping is a separate view with sticky navigation and independent sources', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week',
    week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('блины');
  await openShopping(page);
  await page.waitForFunction(() => document.activeElement?.id === 'shopping-title');
  const weekSource = page.getByRole('button', { name: 'По плану недели', exact: true });
  const menuSource = page.getByRole('button', { name: 'По подборке', exact: true });
  assert.equal(await weekSource.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('heading', { name: 'План на неделю' }).isVisible(), false);
  const beef = page.getByRole('checkbox', { name: 'мясо говядина — 133,3 г', exact: true });
  const summary = page.locator('.shopping-total');
  const [, total] = (await summary.textContent()).match(/Осталось (\d+) из \1/);
  assert.ok((await beef.locator('..').boundingBox()).height >= 44);
  await beef.check();
  await summary.filter({ hasText: `Осталось ${Number(total) - 1} из ${total}` }).waitFor();
  await menuSource.click();
  const milk = page.getByRole('checkbox', { name: /^молоко —/ });
  assert.equal(await milk.isChecked(), false);
  await milk.check();
  await page.locator('#shopping li').last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.view-nav').evaluate((el) => el.getBoundingClientRect().top >= 0), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await reopenMenu(page);
  assert.equal(await menuSource.getAttribute('aria-pressed'), 'true');
  assert.equal(await milk.isChecked(), true);
  await weekSource.click();
  assert.equal(await beef.isChecked(), true);
});

test('two tabs keep independent edits after importing the previous version', async (t) => {
  const { context, page } = await openMenu(t, {
    version: 2, view: 'week',
    stock: { 'булгур__г': 300 },
    prices: { 'булгур__г': 0.3 },
  }, { legacyKey: 'menu_gen_v2' });
  const second = await context.newPage();
  await second.goto(url);
  await second.getByRole('button', { name: 'Сегодня', exact: true }).waitFor();
  await page.evaluate(() => {
    const open = indexedDB.open('menu-gen');
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('menu', 'readwrite');
      const store = transaction.objectStore('menu');
      const keepActive = () => {
        const read = store.get('current');
        read.onsuccess = () => {
          if (!window.releaseMenuWrite) keepActive();
        };
      };
      keepActive();
      database.close();
      window.holdsMenuTransaction = true;
    };
  });
  await page.waitForFunction(() => window.holdsMenuTransaction);
  await page.getByRole('button', { name: 'Заполнить пустые приёмы' }).click();
  await second.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await second.getByRole('button', { name: 'Больше персон' }).click();
  await page.evaluate(() => { window.releaseMenuWrite = true; });
  await page.getByText('Заполнено приёмов — 21. Расписание готово.').waitFor();
  await page.waitForFunction(() => document.querySelector('.persons-count').textContent === '3');
  await second.waitForFunction(async () => {
    const state = await window.readStoredMenu();
    return state && state.persons === 3 && Object.keys(state.week).length === 21;
  }, null, { timeout: 5000 });
  const state = await storedState(second);
  assert.equal(Object.keys(state.week).length, 21);
  assert.equal(state.persons, 3);
  assert.equal(await page.getByRole('button', { name: 'По дням' }).getAttribute('aria-pressed'), 'true');
  await second.evaluate(() => localStorage.setItem('menu_gen_v2', JSON.stringify({ version: 2, persons: 12 })));
  await reopenMenu(page);
  assert.equal(await page.locator('.persons-count').textContent(), '3');
  const migrated = await storedState(page);
  assert.equal(Object.keys(migrated.week).length, 21);
  assert.equal(migrated.stock['булгур__г'], 300);
  assert.equal(migrated.prices['булгур__г'], 0.3);
});

test('failed storage updates show an error and restore saved settings', async (t) => {
  const { page } = await openMenu(t, { version: 1, persons: 3 });
  await page.waitForFunction(async () => Boolean((await window.readStoredMenu())?.lastMenu));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'menu') throw new DOMException('Storage full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Больше персон' }).click();
  await page.getByRole('alert').filter({ hasText: 'Изменение не сохранилось' }).waitFor();
  assert.equal(await page.locator('.persons-count').textContent(), '3');
  assert.equal((await storedState(page)).persons, 3);
});

test('a rice repeat needs freezer intent and a dated plan stops showing up the following week', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week', weekStart: '2026-11-23',
    week: { 'mon-lunch': [{ dishId: 'plov', from: null }] },
  });
  await page.clock.setFixedTime(new Date('2026-11-23T13:00:00Z'));
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await lunch.getByRole('button', { name: 'Отметить готовку' }).click();
  const batch = page.getByRole('dialog', { name: 'Готовка и хранение' });
  await batch.getByLabel('Когда приготовили').fill('2026-11-23T12:00');
  await batch.getByRole('group', { name: 'Свободные порции' }).getByRole('spinbutton', { name: 'Холодильник' }).fill('2');
  await batch.getByRole('button', { name: 'Сохранить отметку' }).click();
  await batch.getByRole('alert').filter({ hasText: 'Подтвердите' }).waitFor();
  await batch.getByRole('checkbox').check();
  await batch.getByRole('button', { name: 'Сохранить отметку' }).click();
  await batch.waitFor({ state: 'hidden' });
  assert.equal((await storedState(page)).batchRecords['mon-lunch/plov'].reserve.fridge, 2);
  await page.getByRole('button', { name: 'Воскресенье' }).click();
  assert.equal(await lunch.getByRole('combobox', { name: 'Блюдо для повторной подачи' }).count(), 0);
  await page.getByRole('button', { name: 'Понедельник' }).click();
  await lunch.getByRole('button', { name: 'Хранение' }).click();
  await batch.getByRole('button', { name: 'Убрать отметку' }).click();
  await batch.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Воскресенье' }).click();
  await lunch.getByRole('combobox', { name: 'Блюдо для повторной подачи' }).selectOption('mon-lunch/plov');
  const repeat = lunch.getByRole('button', { name: 'Добавить подачу' });
  assert.equal(await repeat.isDisabled(), true);
  await lunch.getByRole('checkbox', { name: 'Заморожу порцию после готовки' }).check();
  await repeat.click();
  await lunch.getByText('Запланировано · порцию нужно заморозить после готовки').waitFor();
  await page.clock.setFixedTime(new Date('2026-11-30T13:00:00Z'));
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  const today = page.getByRole('region', { name: 'Сегодня', exact: true });
  await today.getByText(/На сегодня плана нет/).waitFor();
  assert.equal(await today.getByRole('button', { name: 'Плов', exact: true }).count(), 0);
});

test('moving and replacing a batch updates linked servings and preserves unrelated purchases', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week',
    week: {
      'mon-lunch': [{ dishId: 'borshch', from: null }],
      'tue-lunch': [{ dishId: 'borshch', from: 'mon-lunch' }],
      'fri-dinner': [{ dishId: 'grechka', from: null }],
    },
  });
  await openShopping(page);
  const check = page.getByRole('checkbox', { name: /^гречка —/ });
  await check.check();
  await page.getByRole('button', { name: 'По дням' }).click();
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await dishAction(lunch, 'Борщ', 'Перенести');
  const move = page.getByRole('dialog', { name: 'Перенести блюдо' });
  await move.getByLabel('Новый день и приём').selectOption('wed-lunch');
  await move.getByRole('button', { name: 'Перенести', exact: true }).click();
  await move.waitFor({ state: 'hidden' });
  assert.equal((await storedState(page)).week['thu-lunch'][0].from, 'wed-lunch');
  await dishAction(lunch, 'Борщ', 'Заменить');
  await page.getByRole('searchbox').fill('щи');
  await page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Щи/ }) })
    .getByRole('button', { name: 'Выбрать · Щи', exact: true }).click();
  await lunch.getByRole('button', { name: /^Щи/ }).waitFor();
  assert.deepEqual((await storedState(page)).week['thu-lunch'], [{ dishId: 'shchi', from: 'wed-lunch' }]);
  await openShopping(page);
  assert.equal(await check.isChecked(), true);
});

test('shopping prices show rubles per kilogram, persist zero and reset to the estimate', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week', week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
  });
  await openShopping(page);
  const price = page.getByRole('spinbutton', { name: 'Цена за 1 кг · мясо говядина' });
  assert.equal(await price.isVisible(), false);
  await page.getByRole('button', { name: 'Редактировать цены' }).click();
  const row = page.locator('#shopping li').filter({ has: price });
  const original = await price.inputValue();
  assert.ok(Number(original) > 100);
  await row.getByText('₽/кг', { exact: true }).waitFor();
  await page.getByText(/Базовые цены — ориентир по Москве на/).waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await price.fill('0');
  await price.press('Tab');
  await row.getByText('= 0 ₽', { exact: true }).waitFor();
  await page.waitForFunction(async () => (await window.readStoredMenu()).prices['мясо говядина__г'] === 0);
  await reopenMenu(page);
  await page.getByRole('button', { name: 'Редактировать цены' }).click();
  assert.equal(await price.inputValue(), '0');
  await row.getByRole('button', { name: 'Сбросить цену · мясо говядина' }).click();
  await page.waitForFunction(async () => !Object.hasOwn((await window.readStoredMenu()).prices, 'мясо говядина__г'));
  assert.equal(await price.inputValue(), original);
});

test('built-in dough appears once and a homemade alternative has its own scaled ingredients', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, persons: 4,
    lastMenu: [{ categoryId: 'bakery', dishIds: ['chebureki'] }],
  });
  await page.getByRole('button', { name: /^Чебуреки/ }).click();
  const chebureki = page.locator('#recipe-chebureki');
  await chebureki.getByText('Тесто · Пресное на воде', { exact: true }).waitFor();
  await chebureki.getByText('мука — 400 г', { exact: true }).waitFor();
  await chebureki.getByText('вода — 260 мл', { exact: true }).waitFor();
  assert.equal(await chebureki.locator('.dough-details').count(), 0);
  assert.equal(await chebureki.getByText(/^яйцо/).count(), 0);

  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('слойки с вишней');
  await page.getByRole('button', { name: /^Слойки с вишней/ }).click();
  const puff = page.getByRole('dialog', { name: 'Слойки с вишней' }).locator('.dough-details');
  await puff.getByText('Тесто · Быстрое слоёное бездрожжевое', { exact: true }).click();
  await puff.getByText('мука — 105 г', { exact: true }).waitFor();
  assert.equal(await puff.getByText(/В покупках указан готовый продукт — тесто слоёное/).isVisible(), true);

  await page.getByRole('button', { name: 'Закрыть рецепт' }).click();
  await page.getByRole('searchbox').fill('блины');
  await page.getByRole('button', { name: /^Блины/ }).click();
  const blini = page.getByRole('dialog', { name: 'Блины' });
  await blini.getByText('Тесто · Жидкое блинное на молоке', { exact: true }).waitFor();
  assert.equal(await blini.locator('.dough-details').count(), 0);
  assert.equal(await blini.getByText('мука — 200 г', { exact: true }).count(), 1);
});

test('new arugula dishes have separate pictures and reach the produce shopping list', async (t) => {
  const { page } = await openMenu(t);
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('руккола');
  const salads = page.locator('.catalog-dishes > li');
  assert.equal(await salads.count(), 2);
  const images = await salads.locator('img').evaluateAll(async (elements) => {
    await Promise.all(elements.map((image) => image.decode()));
    return elements.map((image) => image.currentSrc);
  });
  assert.equal(new Set(images).size, 2);
  const cherry = salads.filter({ hasText: 'Руккола с черри и фетой' });
  await cherry.getByRole('button', { name: 'Добавить · Руккола с черри и фетой', exact: true }).click();
  await openShopping(page);
  const produce = page.locator('.shopping-group').filter({ hasText: 'Овощи, фрукты и зелень' });
  await produce.getByRole('checkbox', { name: 'руккола — 65 г', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Редактировать цены' }).click();
  assert.equal(await produce.getByRole('spinbutton', { name: 'Цена за 1 кг · руккола' }).inputValue(), '1700');
});

test('the kitchen measures are available in both recipe views on a narrow screen', async (t) => {
  const { context, page } = await openMenu(t);
  await page.setViewportSize({ width: 320, height: 720 });
  await breakfasts(page).getByRole('button', { name: /^Блины/ }).click();
  const opener = page.locator('#recipe-blini').getByRole('button', { name: 'Таблица мер' });
  const measures = page.getByRole('dialog', { name: 'Таблица мер' });
  await opener.press('Enter');
  const table = measures.getByRole('table');
  const volumes = table.getByRole('row').filter({ hasText: 'Объём' });
  assert.deepEqual(await volumes.getByRole('cell').allTextContents(), ['250 мл', '15 мл', '5 мл']);
  const sugar = table.getByRole('row').filter({ hasText: 'Сахар' });
  assert.deepEqual(await sugar.getByRole('cell').allTextContents(), ['207 г', '12,4 г', '4,1 г']);
  assert.equal(await measures.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true);
  await page.keyboard.press('Escape');
  await measures.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((button) => document.activeElement === button), true);

  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('блины');
  await page.getByRole('button', { name: /^Блины/ }).click();
  const recipe = page.getByRole('dialog', { name: 'Блины' });
  await recipe.getByRole('button', { name: 'Таблица мер' }).click();
  await measures.getByText('Пшеничная мука', { exact: true }).waitFor();
  await measures.getByRole('button', { name: 'Закрыть таблицу мер' }).click();
  assert.equal(await recipe.isVisible(), true);

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await reopenMenu(page);
  await breakfasts(page).getByRole('button', { name: /^Блины/ }).click();
  await opener.click();
  await volumes.getByRole('cell', { name: '250 мл', exact: true }).waitFor();
});

test('a homemade weekly batch and its repeat update shopping independently of another batch', async (t) => {
  const { page } = await openMenu(t, {
    version: 2, view: 'week',
    week: {
      'mon-lunch': [{ dishId: 'pelmeni', from: null }],
      'tue-lunch': [{ dishId: 'pelmeni', from: 'mon-lunch' }],
      'thu-lunch': [{ dishId: 'pelmeni', from: null }],
    },
  });
  await openShopping(page);
  await page.getByRole('checkbox', { name: /^пельмени — 1\s?500 г$/ }).waitFor();
  await page.getByRole('button', { name: 'По дням' }).click();
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await lunch.getByRole('button', { name: 'Пельмени', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Пельмени' });
  await recipe.getByRole('checkbox', { name: 'Готовить дома' }).check();
  await recipe.getByText('мясо говядина — 300 г', { exact: true }).waitFor();
  await recipe.getByText(/около 75 мин/).waitFor();
  assert.equal(await recipe.getByText(/варите по инструкции на упаковке/).count(), 0);
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).click();
  await openShopping(page);
  await page.getByRole('checkbox', { name: 'пельмени — 500 г', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'мясо говядина — 300 г', exact: true }).waitFor();
  await reopenMenu(page);
  await page.getByRole('button', { name: 'По дням' }).click();
  await page.getByRole('button', { name: 'Вторник' }).click();
  await lunch.getByText(/повторная подача.*домашний вариант/i).waitFor();
  await lunch.getByRole('button', { name: 'Пельмени', exact: true }).click();
  assert.equal(await recipe.getByRole('checkbox', { name: 'Готовить дома' }).isChecked(), true);
});

test('portions from the same batch can use different storage and reserves are deducted', async (t) => {
  const { page } = await openMenu(t, {
    version: 2, view: 'week', weekStart: '2026-11-23',
    week: {
      'mon-lunch': [{ dishId: 'borshch', from: null }],
      'mon-dinner': [{ dishId: 'borshch', from: 'mon-lunch' }],
      'fri-dinner': [{ dishId: 'borshch', from: 'mon-lunch', storage: 'freezer' }],
    },
  });
  await page.clock.setFixedTime(new Date('2026-11-23T13:00:00Z'));
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await lunch.getByRole('button', { name: 'Отметить готовку' }).click();
  const batch = page.getByRole('dialog', { name: 'Готовка и хранение' });
  await batch.getByLabel('Когда приготовили').fill('2026-11-23T12:00');
  await batch.getByRole('group', { name: 'Пн · ужин' }).getByRole('spinbutton', { name: 'Холодильник' }).fill('2');
  await batch.getByRole('group', { name: 'Пт · ужин' }).getByRole('spinbutton', { name: 'Морозилка' }).fill('2');
  const reserve = batch.getByRole('group', { name: 'Свободные порции' });
  await reserve.getByRole('spinbutton', { name: 'Холодильник' }).fill('1');
  await reserve.getByRole('spinbutton', { name: 'Морозилка' }).fill('3');
  await batch.getByRole('checkbox').check();
  await batch.getByRole('button', { name: 'Сохранить отметку' }).click();
  await batch.waitFor({ state: 'hidden' });
  await page.getByRole('region', { name: 'Ужин', exact: true }).getByText(/Холодильник — 2 порции/).waitFor();
  await page.getByRole('button', { name: 'Пятница', exact: true }).click();
  await page.getByRole('region', { name: 'Ужин', exact: true }).getByText(/Морозилка — 2 порции/).waitFor();
  await page.getByRole('button', { name: 'Вторник', exact: true }).click();
  await lunch.getByRole('combobox', { name: 'Блюдо для повторной подачи' }).selectOption('mon-lunch/borshch');
  await lunch.getByRole('button', { name: 'Добавить подачу' }).click();
  await lunch.getByText(/Холодильник — 1 порция.*Морозилка — 1 порция/).waitFor();
  await page.locator('.app[aria-busy="false"]').waitFor();
  assert.deepEqual((await storedState(page)).batchRecords['mon-lunch/borshch'].reserve, { fridge: 0, freezer: 2 });
  await openShopping(page);
  assert.equal(await page.getByRole('checkbox', { name: 'мясо говядина — 400 г', exact: true }).isVisible(), true);
});

test('the mobile weekly menu fills only empty dinners within the optional time limit', async (t) => {
  const { page } = await openMenu(t, {
    version: 2, view: 'week',
    week: { 'mon-dinner': [{ dishId: 'utka', from: null }] },
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByLabel('Управление неделей', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Ужины до 30 минут', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Заполнить пустые приёмы' }).click();
  await page.getByText(/Расписание готово/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Заполнить пустые приёмы' }).isVisible(), false);
  const state = await storedState(page);
  const data = JSON.parse(await readFile(new URL('../data/dishes.json', import.meta.url), 'utf8'));
  const recipes = new Map(data.categories.flatMap(({ dishes }) => dishes.map(({ id, recipe }) => [id, recipe])));
  assert.equal(state.quickDinners, true);
  assert.deepEqual(state.week['mon-dinner'], [{ dishId: 'utka', from: null }]);
  const dinners = Object.entries(state.week).filter(([id]) => id.endsWith('-dinner') && id !== 'mon-dinner');
  assert.equal(dinners.length, 6);
  for (const [, dishes] of dinners) {
    assert.ok(dishes.reduce((sum, { dishId }) => sum + recipes.get(dishId).minutes, 0) <= 30);
  }
  const duck = page.getByRole('region', { name: 'Ужин', exact: true });
  assert.equal(await duck.getByRole('button', { name: 'Перенести', exact: true }).isVisible(), false);
  await duck.getByLabel('Действия · Утка', { exact: true }).click();
  await duck.getByRole('button', { name: 'Перенести', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
});
