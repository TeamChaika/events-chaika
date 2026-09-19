# Визуальное направление

Кинематографическая афиша: чёрный фон, красная луна, белая узкая типографика Oswald, нейтральный Manrope для формы и админки. Мягкое дыхание фона, свечение луны, два слоя тумана и отдельные SVG-мыши с движением крыльев. Анимации отключаются кнопкой и через prefers-reduced-motion. Звук не включается.

Мобильная композиция сделана отдельно: сцена сверху, большой заголовок и покупка ниже. Форма — модальный dialog с клавиатурной навигацией, видимыми labels и общей ценой. Админка спокойная и плотная, в той же палитре.

По уточнению 19 сентября публичная страница сокращена до афиши, бегущей строки и подвала. Обратный отсчёт с секундами находится на афише; на телефоне — в верхней левой части сцены. Разделы под бегущей строкой, ссылки на них и ссылка контролёра в подвале удалены. Логотип — предоставленный пользователем `chaikateam.png`; белые поля скрыты CSS-кадрированием, исходные пиксели сохранены.

Партнёр совместной вечеринки — «Мрия». Предоставленные SVG-контуры сохранены в `partner-mriya.svg`; шапка, подвал и заставка объединяют логотипы знаком ×. Служебные панели используют логотип ChaikaTeam.

Заставка (`MoonLoader.tsx`, `moon-loader.css`) показывает насыщенную красную луну, свечение и два слоя тёмных облаков с разной скоростью. Луна медленно приближается через CSS scale. Облака — статическая процедурная SVG-текстура, движется её готовый слой, не фильтр шума. Минимальная длительность вступления — 2.2 секунды, выход — 550 мс; при reduced motion задержка и движение отключены. Афиша загружается под заставкой; ошибка изображения или ограничение ожидания не оставляет сайт заблокированным. Ошибка API показывает повтор загрузки.

Исходный референс: `public/assets/poster.png` (пользовательская афиша). Сгенерированный инструментом **image_gen** фон: `public/assets/red-moon.png`. Текст и летучие мыши сделаны кодом поверх фона.

Луна — отдельная WebGL-сфера на Three.js (`src/MoonScene.tsx`, `src/moonRenderer.ts`), один оборот за 240 секунд. Карты цвета и рельефа дают кратеры и объёмное освещение, красная корона дышит циклами 8 и 13 секунд. Маска `moon-scene-mask.svg` оставляет девушку на переднем плане. Сфера и фотография используют одинаковое кадрирование и общее мягкое масштабирование, поэтому слои не расходятся на телефонах. Эффект применяется только к стандартному фону `/assets/red-moon.png`.

Рендер ограничен 30 кадрами/с, останавливается кнопкой, при уходе сцены за экран, скрытии вкладки и `prefers-reduced-motion`. При недоступности WebGL/текстур остаётся исходная афиша. Three.js подгружается отдельно от основного приложения.

Текстуры: [NASA's Scientific Visualization Studio — CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), Ernie Wright (USRA), Noah Petro (NASA/GSFC), LRO/LROC и LOLA. Цвет: `lroc_color_2k.jpg`; рельеф: `ldem_3_8bit.jpg`. Локальные копии `moon-color.jpg` (2048 × 1024) и `moon-height.jpg` (1024 × 512) получены из [зеркала с описанием происхождения](https://github.com/MaxwellLee/physics-lab/blob/main/assets/textures/SOURCES.md): цвет повторно сжат в JPEG, рельеф сохранён без изменений. В работе сайта внешних запросов за текстурами нет.

## Видео перед персональным билетом

На странице отдельного билета используется ролик Seedance 2.5: героиня поворачивается к гостю и протягивает закрытый старинный конверт к камере. В кадре видна только её рука с хватом за верхний край. На конверте — следы времени, старинная марка, выцветшие чернила и красная сургучная печать с цветком из логотипа «Мрии». Данные мероприятия, время и рабочий персональный QR появляются на странице после интро. Наложения QR средствами страницы нет.

Текущий ролик — `public/assets/ticket-intro-mriya-envelope.mp4`, постер — `public/assets/ticket-intro-mriya-envelope.jpg`. Длительность 8 секунд, 720 × 1280, H.264, без звука. Первые 2 секунды сохранены из исходного ролика; продолжение Seedance 2.5 сгенерировано по его кадру на второй секунде и утверждённому финальному кадру. Источник финального кадра сохранён локально как `output/imagegen/ticket-handoff-mriya-antique-envelope-v8.png`. Видео вписывается в ширину экрана целиком, чтобы конверт не обрезался на высоких телефонах. Интро главной страницы с луной остаётся отдельным.

По просьбе пользователя обе ранее опубликованные версии сохранены: `public/assets/ticket-intro-printed-qr.mp4` с постером `ticket-intro-printed-qr.jpg` и `public/assets/ticket-intro-seedance25.mp4` с постером `ticket-intro-poster.jpg`. Неопубликованные альтернативы с печатным русским билетом сохранены локально в `output/video/` и `.deployment/`. Для отката поменять только `src` и `poster` в `src/VideoCinematicIntro.tsx` на нужную сохранённую пару; не удалять старые версии при обновлении видео.

## Финальный промпт генерации

Create a premium cinematic website hero asset inspired by a gothic Halloween masquerade fashion poster. Landscape 1536x1024. Pure near-black background (#080808), a huge detailed blood red full moon occupying the CENTER-RIGHT of the image, fiery soft red corona glow, real crater texture, photoreal astronomical surface. In front of the moon on the RIGHT half stands a mysterious high-fashion woman in an elegant black voluminous Victorian gothic dress with structured puff sleeves, white sharp collar, black futuristic eye mask, slick black hair. Monochrome silver-black fashion photography lit with subtle crimson rim lighting. Cropped at hips at the bottom. Dramatic fashion editorial, delicate photographic grain, extremely striking. Keep LEFT 40 percent almost pure black empty negative space with just faint red atmospheric light for website typography to be added in code. The moon must be fully visible at the top, not cropped, woman's head at 25% height. The bottom gracefully fades to pure black. NO TEXT, NO LOGOS, NO LETTERING, NO BATS (bats will be animated separately in code). Output is a finished raster website background, not a website mockup.
