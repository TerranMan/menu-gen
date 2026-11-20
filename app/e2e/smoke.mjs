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
  assert.equal(await page.locator('#recipe-blini .recipe-steps li').count(), 2);
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
