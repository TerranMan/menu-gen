import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

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

async function openMenu(t, savedState) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  t.after(async () => {
    await context.close();
    assert.deepEqual(pageErrors, []);
  });
  await context.addInitScript((state) => {
    Math.random = () => 0;
    if (state && !localStorage.getItem('menu_gen_v1')) {
      localStorage.setItem('menu_gen_v1', JSON.stringify(state));
    }
  }, savedState);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url);
  await page.getByRole('heading', { name: '🍽️ Меню на неделю' }).waitFor();
  return { context, page };
}

function breakfasts(page) {
  return page.locator('.category').filter({ has: page.getByRole('heading', { name: /^Завтраки/ }) });
}

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

  await slot.getByRole('button', { name: 'Не показывать' }).first().click();
  const afterBlock = await names();
  assert.equal(afterBlock.length, 7);
  assert.equal(new Set(afterBlock).size, 7);
  assert.ok(!afterBlock.includes(replaced[0]));
  await page.reload();
  assert.deepEqual(await names(), afterBlock);
});

test('first online visit is enough to reopen and use the shopping list offline', async (t) => {
  const { context, page } = await openMenu(t);
  const milk = page.getByRole('checkbox', { name: /^молоко —/ });
  await milk.check();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload();
  assert.equal(await breakfasts(page).locator('.dish-row').count(), 7);
  assert.equal(await milk.isChecked(), true);
  await breakfasts(page).getByRole('button', { name: /^Блины/ }).click();
  const blini = page.locator('#recipe-blini');
  assert.equal(await blini.locator(':scope > .recipe-steps li').count(), 2);
  const dough = blini.locator('.dough-details');
  await dough.getByText('Тесто · Жидкое блинное на молоке', { exact: true }).click();
  await dough.getByText('мука — 100 г', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Больше персон' }).click();
  assert.equal(await milk.isChecked(), false);
  await milk.check();
  await page.reload();
  assert.equal(await milk.isChecked(), true);
  assert.equal(await page.locator('.persons-count').textContent(), '3');
  await page.getByRole('button', { name: 'Сгенерировать заново' }).click();
  assert.equal(await milk.isChecked(), false);
  assert.equal(await breakfasts(page).locator('.dish-row').count(), 7);
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
  assert.equal(await page.getByRole('checkbox', { name: 'утка — 1 шт', exact: true }).count(), 1);
  assert.equal(await page.getByRole('checkbox', { name: 'яблоко — 6 шт', exact: true }).count(), 1);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Больше персон' }).click();
  assert.match(await card.locator('.recipe-meta').textContent(), /12 порций/);
  assert.equal(await page.getByRole('checkbox', { name: 'утка — 2 шт', exact: true }).count(), 1);
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
    ],
  });
  const slot = breakfasts(page);
  assert.equal(await page.locator('.category').count(), 8);
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
  for (const dish of [
    { name: 'Творожная запеканка', id: 'tvorozhnaya-zapekanka', ingredient: 'творог — 500 г' },
    { name: 'Гороховая каша с мясом', id: 'gorokhovaya-kasha-s-myasom', ingredient: 'горох — 120 г' },
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${dish.name}`) }).click();
    const card = page.locator(`#recipe-${dish.id}`);
    assert.equal(await card.getByText(dish.ingredient, { exact: true }).isVisible(), true);
    assert.equal(await card.locator('.recipe-steps li').count(), 3);
    const photo = page.getByRole('img', { name: dish.name, exact: true });
    await photo.scrollIntoViewIfNeeded();
    assert.match(await photo.getAttribute('src'), new RegExp(`/images/${dish.id}\\.webp$`));
    await page.waitForFunction((name) => Array.from(document.images)
      .some((image) => image.alt === name && image.naturalWidth > 0), dish.name);
  }
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
  await page.getByRole('button', { name: 'Добавить в меню' }).click();
  await page.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await page.getByRole('button', { name: 'Подборка', exact: true }).click();

  const sides = page.locator('.category').filter({ has: page.getByRole('heading', { name: /^Гарниры/ }) });
  await sides.getByRole('button', { name: 'Меньше блюд' }).click();
  await page.getByRole('button', { name: 'Сгенерировать заново' }).click();
  await page.reload();
  assert.deepEqual(await sides.locator('.dish-name').allTextContents(), ['Гречка']);
  assert.equal(await sides.getByRole('button', { name: 'Открепить блюдо' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await sides.getByRole('button', { name: 'Заменить это блюдо' }).isDisabled(), true);
});

test('a weekly recipe can be served twice and copied with grouped shopping and the shared yield', async (t) => {
  const { context, page } = await openMenu(t);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'По дням' }).click();
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await lunch.getByRole('button', { name: 'Добавить блюдо' }).click();
  await page.getByRole('searchbox').fill('борщ');
  await page.getByRole('button', { name: 'Добавить в меню' }).click();
  await lunch.getByText('Готовим · 2 порции', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Вторник' }).click();
  await lunch.getByRole('combobox', { name: 'Из готовой партии' }).selectOption('mon-lunch/borshch');
  assert.equal(await lunch.getByText('Из готовой партии · Пн · обед', { exact: true }).isVisible(), true);
  await lunch.getByRole('button', { name: 'Борщ', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Борщ' });
  assert.match(await recipe.locator('.recipe-meta').textContent(), /4 порции/);
  await recipe.getByRole('img', { name: 'Борщ' }).evaluate((image) => image.decode());
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).click();

  const beef = page.getByRole('checkbox', { name: /^мясо говядина — 266,7 г$/ });
  await beef.check();
  await page.getByRole('button', { name: 'Копировать список' }).click();
  await page.getByText('Список скопирован.', { exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /Мясо, птица и колбаса\r?\n✓ мясо говядина — 266,7 г/);

  await page.reload();
  assert.equal(await lunch.getByText('Готовим · 4 порции', { exact: true }).isVisible(), true);
  assert.equal(await beef.isChecked(), true);
  await lunch.getByRole('button', { name: 'Убрать Борщ из приёма' }).click();
  await page.getByRole('button', { name: 'Вторник' }).click();
  assert.equal(await lunch.getByText('Готовим · 2 порции', { exact: true }).isVisible(), true);
});

test('autofill preserves a manual meal and history copies the saved week with a fresh shopping checklist', async (t) => {
  const cooked = [{ dishId: 'borshch', from: null }];
  const repeated = [{ dishId: 'borshch', from: 'mon-lunch' }];
  const { page } = await openMenu(t, {
    version: 1,
    view: 'week',
    week: { 'mon-lunch': cooked, 'tue-lunch': repeated },
  });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('menu_gen_v1')));
  await page.getByRole('button', { name: 'Заполнить пустые приёмы' }).click();
  await page.getByText('Заполнено приёмов — 19. Расписание готово.').waitFor();
  const week = (await stored()).week;
  assert.equal(Object.keys(week).length, 21);
  assert.deepEqual(week['mon-lunch'], cooked);
  assert.deepEqual(week['tue-lunch'], repeated);
  await page.locator('#shopping input[type=checkbox]').first().check();
  assert.equal(Object.keys((await stored()).weekChecked).length, 1);

  await page.getByRole('button', { name: 'Новая неделя' }).click();
  const next = page.getByRole('dialog', { name: 'Новая неделя' });
  await next.getByRole('textbox', { name: 'Название сохраняемого плана' }).fill('План с борщом');
  await next.getByRole('button', { name: 'Начать с пустого плана' }).click();
  await next.waitFor({ state: 'hidden' });
  assert.deepEqual((await stored()).week, {});
  assert.deepEqual((await stored()).weekChecked, {});

  await page.reload();
  await page.getByRole('button', { name: 'История недель' }).click();
  const history = page.getByRole('dialog', { name: 'История недель' });
  await history.getByText('План с борщом', { exact: true }).click();
  assert.ok(await history.getByText('Борщ', { exact: true }).count() >= 2);
  await history.getByRole('button', { name: 'Скопировать в новую неделю' }).click();
  await history.waitFor({ state: 'hidden' });
  assert.deepEqual((await stored()).week, week);
  const mondayLunch = page.getByRole('region', { name: 'Обед', exact: true });
  await mondayLunch.getByRole('button', { name: 'Убрать Борщ из приёма' }).click();
  const changed = await stored();
  assert.deepEqual(changed.week['tue-lunch'], cooked);
  assert.deepEqual(changed.weekHistory[0].week, week);

  await page.getByRole('button', { name: 'Новая неделя' }).click();
  await next.getByRole('button', { name: 'Скопировать текущий план' }).click();
  assert.deepEqual((await stored()).week, changed.week);
  assert.equal((await stored()).weekHistory.length, 2);
});

test('Today shows the current local weekday, portions to serve and the original cooking batch', async (t) => {
  const { page } = await openMenu(t, {
    version: 1,
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
  assert.equal(await lunch.getByText('Из готовой партии · Пн · обед').isVisible(), true);
  assert.equal(await lunch.getByText('Подать сегодня · 2 порции').isVisible(), true);
  assert.equal(await today.getByText('Готовим · 6 порций').isVisible(), true);
  await lunch.getByRole('button', { name: 'Борщ', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Борщ' });
  await recipe.getByText(/Выход — 4 порции/).waitFor();
  await recipe.getByRole('button', { name: 'Закрыть рецепт' }).click();
  await page.getByRole('button', { name: 'Открыть день в плане' }).click();
  assert.equal(await page.getByRole('button', { name: 'Вторник' }).getAttribute('aria-pressed'), 'true');
});

test('pantry reduces shopping quantities and cost, persists, and supports removing a stock entry', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week', week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
  });
  const previous = page.getByRole('checkbox', { name: 'мясо говядина — 133,3 г', exact: true });
  await previous.check();
  const previousTotal = await page.locator('#shopping summary').innerText();
  await page.getByRole('button', { name: 'Запасы дома' }).click();
  const stock = page.getByRole('dialog', { name: 'Запасы дома' });
  await stock.getByRole('combobox', { name: 'Продукт' }).selectOption('мясо говядина__г');
  await stock.getByRole('spinbutton').fill('100');
  await stock.getByRole('button', { name: 'Сохранить остаток' }).click();
  await stock.getByText('Остаток сохранён.').waitFor();
  await stock.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const remaining = page.getByRole('checkbox', { name: 'мясо говядина — 33,3 г', exact: true });
  assert.equal(await remaining.isChecked(), false);
  assert.notEqual(await page.locator('#shopping summary').innerText(), previousTotal);
  await page.reload();
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
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => { window.copiedWeek = text; } },
    });
    Object.defineProperty(navigator, 'share', {
      value: async ({ text }) => { window.sharedWeek = text; },
    });
    Object.defineProperty(navigator, 'canShare', { value: () => true });
  });
  await page.getByRole('button', { name: 'Поделиться неделей' }).click();
  const share = page.getByRole('dialog', { name: 'Поделиться неделей' });
  const preview = await share.getByRole('textbox', { name: 'Расписание и список покупок' }).inputValue();
  assert.match(preview, /Вторник\nОбед — Борщ \(из готовой партии · Пн · обед\)/);
  assert.match(preview, /Покупки\n[\s\S]+мясо говядина — 166,7 г/);
  assert.ok(!preview.includes('картофель'));
  await share.getByRole('button', { name: 'Копировать неделю' }).click();
  await share.getByText('Меню и покупки скопированы.').waitFor();
  await share.getByRole('button', { name: 'Отправить…' }).click();
  assert.deepEqual(await page.evaluate(() => [window.copiedWeek, window.sharedWeek]), [preview, preview]);
});

test('the catalog keeps the shopping link and opens the list for the previous view', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, view: 'week',
    week: { 'mon-lunch': [{ dishId: 'borshch', from: null }] },
  });
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('блины');
  await page.getByRole('link', { name: 'Покупки', exact: true }).click();
  await page.getByText('По плану недели', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'мясо говядина — 133,3 г', exact: true }).isVisible(), true);
  assert.equal(await page.locator('#shopping').evaluate((element) => element.open), true);
});

test('dough cards differentiate pastry types and scale the homemade dough ingredients with the recipe', async (t) => {
  const { page } = await openMenu(t, {
    version: 1, persons: 4,
    lastMenu: [{ categoryId: 'bakery', dishIds: ['chebureki'] }],
  });
  await page.getByRole('button', { name: /^Чебуреки/ }).click();
  const chebureki = page.locator('#recipe-chebureki .dough-details');
  await chebureki.getByText('Тесто · Пресное на воде', { exact: true }).click();
  await chebureki.getByText('мука — 400 г', { exact: true }).waitFor();
  assert.equal(await chebureki.getByText(/^яйцо/).count(), 0);

  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByRole('searchbox').fill('слойки с вишней');
  await page.getByRole('button', { name: /^Слойки с вишней/ }).click();
  const puff = page.getByRole('dialog', { name: 'Слойки с вишней' }).locator('.dough-details');
  await puff.getByText('Тесто · Быстрое слоёное бездрожжевое', { exact: true }).click();
  await puff.getByText('мука — 105 г', { exact: true }).waitFor();
  assert.equal(await puff.getByText(/В покупках указан готовый продукт — тесто слоёное/).isVisible(), true);
});
