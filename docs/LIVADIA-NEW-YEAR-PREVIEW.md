# Богемные истории — локальный макет

Дата: 16 ноября 2026. Страница подготовлена для согласования, не опубликована.

## Запуск и адрес

Проект перенесён пользователем из Downloads в:
`/Users/user/Downloads/_Сортировано/Код_скрипты/Чайка меропрития`.

Запуск из проекта: `./node_modules/.bin/vite --host 127.0.0.1 --port 8803 --strictPort`.

Адрес: http://localhost:8803/e/livadiya-novogodnyaya-noch
Альтернативный адрес: http://localhost:8803/preview/new-year

Оба маршрута включены только при `import.meta.env.DEV`. В production JS/CSS этот компонент не попадает. Остальные маршруты приложения работают по прежней схеме. Сервер API и база для предпросмотра не нужны.

## Содержание

- Богемные истории — новогодняя ночь в «Ливадии».
- 31 декабря 2026, начало 21:00.
- Взрослый билет: 20 000 ₽, детский: 12 000 ₽.
- Программа и оба меню перенесены из материалов пользователя.
- Детская возрастная граница пока не указана: пользователь уточнит позже.
- Адрес и телефон ресторана взяты из прежних материалов «Ливадии».
- Свободное количество мест и правила продажи в макете не объявляются.

Кнопки билетов открывают локальный расчёт взрослых/детских билетов. Это UI-макет: расчёт не резервирует места и не вызывает API. Он не является реализацией смешанного заказа на сервере.

После согласования потребуется подключить страницу к существующему событию `c47f935e-bc63-4b0a-b1e0-1334596a0ce2`, сохранив `livadiya-novogodnyaya-noch`, настроить подтверждённые категории и время на сервере, согласовать возрастную границу/лимит мест и проверить реальный checkout. В этом шаге production, цены в БД, платёжные настройки, продажи и другие события не менялись.

## Исходники

- `src/NewYearLanding.tsx`: страница и локальный расчёт.
- `src/new-year-menu.ts`: меню и категории билетов; суммы в копейках.
- `src/new-year.css`: изолированные стили и responsive версии.
- `src/App.tsx`: только DEV-маршрут.
- `src/vite-env.d.ts`: типы Vite.

## Иллюстрации

Сделаны встроенным Imagegen по мотивам предоставленной пользователем афиши. Для сайта PNG преобразованы в WebP; исходники не удалены.

Конечные файлы:
- `public/assets/livadia-new-year/theatre-hero.webp`
- `public/assets/livadia-new-year/theatre-hero-mobile.webp`
- `public/assets/livadia-new-year/adult-menu.jpg`: оригинал взрослого меню пользователя.
- `public/assets/livadia-new-year/child-menu.jpg`: оригинал детского меню пользователя.

Промпт desktop (reference: оригинал взрослого меню):

> Create a photorealistic editorial hero background for a luxurious Greek restaurant New Year's Eve theatre evening called Bohemian Stories. Use the attached poster as visual style reference only: ivory chiffon stage curtains, pale classical columns, champagne gold, black velvet gloves, pearl jewellery. NEW landscape 1536x1024 composition: on far left a black velvet gloved woman's hand emerging from parted ivory curtains holds an elegant champagne coupe; on far right a hand with ivory lace sleeve holds a long pearl necklace. Keep these hands and props mostly at the outer 20 percent of image. Broad luminous ivory empty negative space across the middle 60 percent for real HTML lettering, no lettering in image. Soft tactile draped silk and subtle warm theatrical lighting, beautiful premium fashion editorial photography, restrained gold reflections, realistic hands, fine fabric detail. No faces, no people in centre, no dark room, no orange cast, no confetti, no cigarette, no lettering whatsoever, no logos, no watermark, no frames. Bottom fades naturally into warm ivory fabric. This is a background asset, not a finished webpage or menu.

Промпт mobile (reference: сгенерированная desktop-иллюстрация):

> Recompose this exact elegant ivory theatre artwork as a PORTRAIT 1024x1536 mobile website background. Preserve soft cream/gold palette, realistic ivory curtains, classical columns, champagne in black velvet gloved hand on left, pearl necklace in ivory lace sleeve hand on right. Fit the hands and objects visibly inside the PORTRAIT frame: left glove and coupe at far left around 25% down from top, pearl hand at far right around 20% down from top with necklace hanging at right edge. They should be accent elements confined to outer 20% strips, not cross centre. Middle 65% of image must remain plain softly lit ivory cloth negative space for HTML title and date. Keep lower central part open for booking button. Graceful curved curtains in corners. NO TEXT or lettering, no logos, no cigarette, no watermark. A luxurious restrained bohemian Greek New Year's Eve theatrical atmosphere, not a room or faces. This must be a genuinely portrait composition, no montage, no borders.

## Проверки

- `npm run build` — успешно; прежнее предупреждение о размере moonRenderer.
- `git diff --check` — успешно.
- Playwright: ширины 320, 390, 768, 1024, 1920; без горизонтального overflow.
- Переключение меню, оба файла афиш, изображения и mobile source.
- Расчёт детского билета 12 000 → взрослый + ребёнок 32 000 → взрослый + 2 ребёнка 44 000 ₽.
- Закрытие диалога Escape; `prefers-reduced-motion` отключает анимацию.
- Ни одного API-запроса при проверке макета; нет JS-ошибок.
- Desktop/mobile скриншоты визуально проверены.
- Новогодний компонент и его стили отсутствуют в production JS/CSS.

Скрипт проверки и снимки сохранены в `.deployment/livadia-newyear-preview-20261116/` (в git не включаются).
