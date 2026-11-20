# menu-gen

Генератор недельного меню для семьи. PWA на Alpine.js + Vite. Деплоится как
GitHub Pages, опционально собирается в Windows exe через Tauri.

Живая версия: https://terranman.github.io/menu-gen/

## Что умеет

- Случайно подбирает блюда из ~90 позиций по 8 категориям (завтраки, супы,
  гарниры, мясо, салаты, выпечка, фрукты/овощи, основные)
- Избранное (★) и блок-лист (✕) — управляют вероятностью попадания в меню
- Перегенерация одного блюда (↻) без сброса остального
- Список покупок с агрегацией ингредиентов и оценочной стоимостью по Москве
- Отметки о покупках сохраняются при перезагрузке, пока количество продукта в списке совпадает
- Раскрывающийся состав каждого блюда прямо в карточке
- Stepper персон в шапке (1..12) — масштабирует ингредиенты и сумму покупок
- Меню и список покупок доступны офлайн после первого онлайн-запуска PWA

## Структура

```
app/
├── data/
│   ├── dishes.yml         # источник правды по блюдам
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
    ├── store.js           # localStorage с санитацией
    ├── styles.css
    └── sw.js              # service worker получает список файлов при сборке

tauri/                     # Windows exe (Phase 5)
legacy/                    # старая PySimpleGUI версия
.github/workflows/         # Pages deploy + Tauri release
```

## Разработка

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

Правится `app/data/dishes.yml`. Схема:

```yaml
version: 1
portions: 2          # базовая раскладка ингредиентов
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

**Разрешённые единицы:** `г, мл, шт, ст.л., ч.л., зубчик, пучок, по вкусу`.

После правки → `npm run build:data` для валидации.

## Расчёт порций

Количества в `ingredients` — на **2 порции**. Stepper в шапке (1..12) меняет
масштаб через `factor = persons / 2`. Штучные/зубчики/пучки округляются
вверх до целого. Граммы/мл/ложки — до 1 знака после запятой.

В списке покупок скейлинг применяется **после** агрегации одного и того же
ингредиента из разных блюд (иначе `ceil` накапливается per-блюдо и сумма
систематически завышается).

## Цены

`prices.yml` содержит средние цены по Москве (₽ за единицу). Используются
для оценочной суммы недели. Пользователь может переопределить цену прямо
в UI — переопределение сохраняется в localStorage. Если значение совпадает
с дефолтом — не сохраняется (не засоряет storage).

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

## Лицензия

Семейный проект, использовать как угодно.
