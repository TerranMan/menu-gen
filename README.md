# menu-gen

Генератор недельного меню для семьи. PWA на Alpine.js + Vite. Деплоится как
GitHub Pages, опционально собирается в Windows exe через Tauri.

Живая версия: https://terranman.github.io/menu-gen/

## Что умеет

- Случайно подбирает блюда из ~90 позиций по 8 категориям (завтраки, супы,
  гарниры, мясо, салаты, выпечка, фрукты/овощи, основные)
- Избранное (★) и блок-лист (✕) — управляют вероятностью попадания в меню
- Перегенерация одного блюда (↻) без сброса остального
- Каталог с поиском, фильтром по категориям и ручным добавлением блюд
- Закреплённые блюда остаются в подборке при перегенерации
- Завтраки, обеды и ужины по дням с повторной подачей из одной партии
- Список покупок с агрегацией ингредиентов и оценочной стоимостью по Москве
- Покупки сгруппированы по отделам, список можно скопировать целиком
- Отметки о покупках сохраняются при перезагрузке, пока количество продукта в списке совпадает
- Состав, выход, время и способ приготовления в каждой карточке
- Stepper персон в шапке (1..12) — масштабирует ингредиенты и сумму покупок
- Меню и список покупок доступны офлайн после первого онлайн-запуска PWA

## Структура

```
app/
├── data/
│   ├── dishes.yml         # источник правды по блюдам
│   ├── recipes.yml        # выход, время и шаги по id блюда
│   ├── dough.yml          # типы теста, составы и способы замеса
│   ├── prices.yml         # цены ингредиентов (₽ за единицу, Москва)
│   ├── dishes.json        # билд-артефакт (gitignored)
│   └── prices.json        # билд-артефакт (gitignored)
├── public/
│   ├── images/            # webp 1024px max, q82
│   ├── icons/             # PWA-иконки
│   └── manifest.webmanifest
├── scripts/
│   ├── build-data.mjs     # yml → json + валидация
│   ├── fetch-images.mjs   # Pexels API → webp
│   └── migrate-legacy.mjs # one-shot: legacy/settings.yml → dishes.yml
└── src/
    ├── app.js             # Alpine root
    ├── generator.js       # выбор блюд с весами
    ├── shopping.js        # агрегация + scaleQty
    ├── store.js           # транзакционное сохранение в IndexedDB
    ├── styles.css
    └── sw.js              # service worker получает список файлов при сборке

tauri/                     # Windows exe (Phase 5)
legacy/                    # старая PySimpleGUI версия
.github/workflows/         # Pages deploy + Tauri release
```

## Планирование недели

В «Каталоге» можно открыть рецепт и добавить блюдо в подборку. Кнопка
«Закрепить» сохраняет выбранное блюдо при перегенерации подборки.

В разделе «По дням» кнопка «Разложить подборку» добавляет в расписание блюда,
которых там ещё нет. Можно также выбрать блюдо для конкретного завтрака,
обеда или ужина. «Заполнить пустые приёмы» подбирает блюда для оставшихся
мест с учётом блокировок и старается уменьшить повторы. К рыбе в первую очередь
подбирается простой гарнир вроде булгура или брокколи. К таким блюдам, как плов,
подбирается лёгкий салат. Для второй подачи
выберите блюдо в списке «Повторить блюдо…» и нажмите «Добавить подачу».
Выход первой готовки и покупки учитывают порции для всех связанных приёмов.
При переносе первой подачи связанные приёмы сдвигаются вместе с ней.
При замене первой подачи меняется блюдо во всех связанных приёмах.

«Новая неделя» сохраняет текущий план в истории этого браузера. Выберите
понедельник и начните с пустого плана или с копии. У новой недели текущее
число персон и свежие отметки покупок и готовки. При первом открытии старого
плана без дат приложение привязывает его к текущей неделе.

В разделе «Сегодня» видны блюда на текущую дату по местному времени устройства.
После приготовления укажите фактическое время и место хранения остатков.
Для холодильника приложение показывает ориентир до 24 часов для блюд с рисом
и до 48 часов для остальных остатков. Для подачи за пределами этого окна
запланируйте заморозку вскоре после приготовления или свежую порцию.
Правила хранения приведены в рекомендациях британского Агентства по
пищевым стандартам. [Остатки и разогрев](https://www.food.gov.uk/safety-hygiene/cooking-your-food#eating-leftovers-cold),
[хранение риса](https://www.gov.uk/government/publications/home-food-fact-checker/home-food-fact-checker#rice).

Открытый раздел определяет, для чего показан список покупок. У подборки и
расписания свои отметки. Кнопка «Копировать список» переносит названия
отделов, количества и отметки в буфер обмена.

В «Запасах дома» укажите количество в единицах списка покупок. Запасы
ведутся вручную в этом браузере. Они уменьшают количества и стоимость покупок.
«Поделиться неделей» собирает расписание и покупки в один текст для отправки
из системного меню или копирования.

## Разработка

Для локальной сборки и CI используем Node.js 24.

```powershell
cd app
npm ci
npm run dev               # http://localhost:5173
```

При запуске dev-сервера JSON генерируется из YAML автоматически.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | Vite dev-server с HMR |
| `npm run build` | Сборка PWA в `app/dist/` |
| `npm run build:data` | yml → json + валидация id/единиц/картинок |
| `npm test` | Тесты генератора, покупок и восстановления данных |
| `npm run test:e2e` | Проверка собранного приложения в Chromium |
| `npm run fetch:images` | Скачать недостающие картинки с Pexels (нужен `PEXELS_API_KEY` в `app/.env`) |
| `npm run migrate` | One-shot миграция `legacy/settings.yml` → `dishes.yml` |

Для первого прогона браузерных тестов выполните `npx playwright install chromium`,
потом `npm run build` и `npm run test:e2e` из каталога `app`.

## Редактирование блюд

В `app/data/dishes.yml` хранятся карточки и ингредиенты.

```yaml
version: 1
categories:
  - id: breakfasts
    name: Завтраки
    pick: 1          # сколько блюд генерировать в этой категории
    dishes:
      - id: blini    # стабильный slug, не переиспользовать
        name: Блины
        image: images/blini.webp     # путь к webp или null
        emoji: "🥞"                  # обязателен если image: null
        tags: [classic]
        ingredients:
          - { name: мука, qty: 200, unit: г }
          - { name: молоко, qty: 500, unit: мл }
          - { name: яйцо, qty: 2, unit: шт }
```

В `app/data/recipes.yml` каждой карточке соответствует запись с тем же id.

```yaml
blini:
  portions: 4
  minutes: 35
  steps:
    - Замесите блинное тесто.
    - Испеките тонкие блины на сковороде.
```

**Разрешённые единицы:** `г, мл, шт, ст.л., ч.л., зубчик, пучок, по вкусу`.

После правки → `npm run build:data` для валидации.

## Тесто

Когда тесто входит в рецепт, карточка показывает его тип рядом с обычными
шагами. В `dough.yml` для такого блюда достаточно `type`. Домашняя замена
покупного продукта задаётся через `replaces`, отдельные ингредиенты и шаги.
Так показаны слоёное тесто, домашние пельмени и разные виды лапши. Количества
в обоих вариантах масштабируются с порциями. Список покупок рассчитан на
готовый продукт.

При подготовке использованы техники из [урока по слоёному тесту King Arthur Baking](https://shop.kingarthurbaking.com/content/class-pdfs/Hasty-Pastry-2.22.pdf),
[руководства по свежей пасте](https://www.kingarthurbaking.com/learn/pasta) и
[рецепта вытяжной лапши шеф-повара Юрия Ковальчука](https://www.gastronom.ru/text/amp/1016390).

## Расчёт порций

Количества в `ingredients` соответствуют выходу `portions` из рецепта.
Счётчик персон масштабирует каждый рецепт отдельно. Для утки и части выпечки
`wholeBatch: true` сохраняет целую закладку и показывает её выход. Время
приготовления приблизительное. Если в составе указана доля яйца, разболтайте
его и отмерьте нужную часть.

В списке покупок сначала складываются количества из всех рецептов. Штуки,
зубчики и пучки округляются вверх один раз на общую строку. Картофель задан в
граммах (раньше одна штука в справочнике соответствовала примерно 100 г).
Кукуруза в початках и консервированная кукуруза учитываются отдельно.
Пересчёт ровных ложек в граммы для муки, сахара, соды, разрыхлителя и крахмала
основан на [таблице мер King Arthur Baking](https://www.kingarthurbaking.com/learn/ingredient-weight-chart).

Температуры внутри мяса, птицы и рыбы сверены с [таблицей FoodSafety.gov](https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures).

## Фото новых салатов и гарниров

Картинки сгенерированы встроенным ImageGen и сохранены в `app/public/images/`.

<details>
<summary>Промпты для восьми картинок</summary>

Общее начало промпта

> Photorealistic editorial food photography for a home recipe card.

- `rukola-s-cherri-i-fetoy.webp` — Fresh arugula salad with cherry tomato halves and small ivory feta cubes, very lightly glossy lemon dressing. The distinctive lobed arugula leaves fill much of the bowl.
- `rukola-s-grushey-i-orekhami.webp` — Fresh arugula salad with slices of skin-on pear, visible whole and broken walnut pieces, a drizzle of lemon oil dressing. Distinctive lobed arugula leaves, no cheese or tomatoes.
- `salat-s-redisom-i-ogurtsom.webp` — Fresh sliced red radishes and cucumber with dill, thinly dressed in sour cream. The bright red edges and green cucumber skin remain clear.
- `salat-s-nutom.webp` — Fresh chickpea salad with tender whole beige chickpeas, diced cucumber and ripe red tomatoes, chopped parsley. A light lemon and oil dressing, no feta or lettuce.
- `bulgur.webp` — Plain fluffy cooked bulgur, recognizable coarse cracked wheat grains, warm tan color with separated grains, in a small ceramic side bowl. No rice, no couscous beads, no mix-ins or herbs.
- `brokkoli-v-dukhovke.webp` — Oven-roasted broccoli florets with lightly browned crisp tips, some fine garlic pieces and a small visible lemon wedge at the rim. Broccoli only, no other vegetables.
- `tsvetnaya-kapusta-s-paprikoy.webp` — Oven-roasted cauliflower florets, white creamy stems and golden reddish paprika-coated tops with restrained roasted edges. No broccoli or red pepper pieces.
- `kartofel-dolkami.webp` — Home oven-baked skin-on potato wedges sliced lengthwise, crisp golden browned edges and visible soft cut surfaces, a light dusting of paprika, no ketchup or other ingredients.

Общее продолжение

> One dish only on plain light ceramic, neutral tabletop, natural side daylight, 3/4 overhead close-up, centered food with room around the bowl for cropping into a square recipe thumbnail, realistic homemade portions and textures, square composition, no people, no text, no graphics, no watermark.

</details>

## Цены

`prices.yml` содержит ориентировочные цены по Москве на указанную дату.
В списке покупок цена показывается за килограмм, литр или штуку.
Свои цены можно ввести прямо в списке. Они сохраняются в браузере вместе
с планом, запасами и отметками. Старые сохранения из localStorage
автоматически импортируются в IndexedDB при первом запуске.

## Установка как Android PWA

Открыть https://terranman.github.io/menu-gen/ в Chrome → меню → «Установить
приложение». Иконка появится на домашнем экране, работает офлайн.

## Сборка Windows exe

Локально Rust не нужен. Сборка идёт в GitHub Actions:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Готовый .msi/.exe появится в Releases через ~5 минут.

## Иллюстрации блюд

Новые файлы в `app/public/images/` созданы встроенным ImageGen.
Общий промпт просил естественную фуд-фотографию для миниатюры рецепта,
по центру в квадратном кадре, с мягким дневным светом, нейтральным фоном
и без текста, графики, рук или водяных знаков.

| Файл | Сюжет промпта |
|---|---|
| `pyure.webp` | Гладкое картофельное пюре с узором от ложки и тающим маслом, без кусочков |
| `tvorozhnaya-zapekanka.webp` | Кусок творожной запеканки с румяным верхом и ложкой сметаны |
| `olive.webp` | Оливье с картофелем, морковью, горошком, солёным огурцом и колбасой кубиками |
| `selyodka-pod-shuboi.webp` | Срез слоёного салата с селёдкой, картофелем, морковью, яйцом и свёклой |
| `pshenichnaya-kasha.webp` | Молочная каша из дроблёной пшеницы с тающим маслом |
| `pirozhki-s-yablokom.webp` | Печёные дрожжевые пирожки, один раскрыт и показывает яблочную начинку |
| `kapusta-tushyonaya.webp` | Тушёная нашинкованная капуста с морковью и томатной пастой |
| `nektarini.webp` | Гладкие красно-жёлтые нектарины, один показывает мякоть и косточку |
| `gorokhovaya-kasha-s-myasom.webp` | Густая гороховая каша в миске с кубиками свинины и луком |
| `tvorozhnaya-massa.webp` | Мягкая сладкая творожная масса со сметаной и изюмом в миске |
| `mannaya-kasha.webp` | Гладкая манная каша на молоке со сливочным маслом |
| `ovsyanaya-kasha.webp` | Молочная овсянка с видимыми расплющенными хлопьями и маслом |
| `yachnevaya.webp` | Ячневая каша на воде из дроблёного ячменя с маслом |
| `grechka.webp` | Рассыпчатая коричневая гречка с различимыми зёрнами и маслом |
| `borshch.webp` | Одна миска рубинового свекольного борща с капустой, картофелем, сметаной и укропом, крупный квадратный план |
| `okroshka.webp` | Одна миска холодной окрошки на хлебном квасе с редисом, огурцом, картофелем, яйцом, колбасой и зеленью, крупный квадратный план |
| `grenki.webp` | Два подрумяненных на сковороде ломтика хлеба с тонкой яично-молочной корочкой |
| `khlopya-s-molokom.webp` | Тонкие золотистые кукурузные хлопья в белом молоке |
| `tvorog.webp` | Белый зернистый творог со сметаной, без добавок в кадре |
| `kartoshka-zharenaya.webp` | Румяные ломтики картошки и полоски лука на сковороде |
| `goroshek.webp` | Миска варёного очищенного зелёного горошка с маслом |
| `riba-krasnaya.webp` | Запечённое филе лосося с видимыми слоями мякоти и лимоном |
| `befstroganov.webp` | Тонкие полоски говядины и лук в светлом сметанном соусе |
| `utka.webp` | Целая запечённая утка на блюде с печёными яблоками |
| `kapustnii-salat-vitaminnii-s-morkovkoi-y.webp` | Салат из белокочанной капусты, моркови и яблока в миске |
| `s-kartoshkoi-i-yaitsom.webp` | Варёный картофель и яйцо кубиками, зелёный лук и лёгкая заправка майонезом |
| `vinegret.webp` | Винегрет из нарезанных кубиками свёклы, картофеля, моркови, солёного огурца и горошка |
| `shchi.webp` | Миска светлых щей с капустой, картофелем, морковью и говядиной |
| `solyanka.webp` | Мясная солянка с колбасой, солёным огурцом, маслинами и лимоном |
| `gorokhovii.webp` | Густой жёлтый гороховый суп с кусочками свинины, картофеля и моркови |

## Лицензия

Семейный проект, использовать как угодно.
