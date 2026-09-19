# Визуальное направление

Кинематографическая афиша: чёрный фон, красная луна, белая узкая типографика Oswald, нейтральный Manrope для формы и админки. Мягкое дыхание фона, свечение луны, два слоя тумана и отдельные SVG-мыши с движением крыльев. Анимации отключаются кнопкой и через prefers-reduced-motion. Звук не включается.

Мобильная композиция сделана отдельно: сцена сверху, большой заголовок и покупка ниже. Форма — модальный dialog с клавиатурной навигацией, видимыми labels и общей ценой. Админка спокойная и плотная, в той же палитре.

Исходный референс: `public/assets/poster.png` (пользовательская афиша). Сгенерированный инструментом **image_gen** фон: `public/assets/red-moon.png`. Текст и летучие мыши сделаны кодом поверх фона.

Луна — отдельная WebGL-сфера на Three.js (`src/MoonScene.tsx`, `src/moonRenderer.ts`), один оборот за 240 секунд. Карты цвета и рельефа дают кратеры и объёмное освещение, красная корона дышит циклами 8 и 13 секунд. Маска `moon-scene-mask.svg` оставляет девушку на переднем плане. Сфера и фотография используют одинаковое кадрирование и общее мягкое масштабирование, поэтому слои не расходятся на телефонах. Эффект применяется только к стандартному фону `/assets/red-moon.png`.

Рендер ограничен 30 кадрами/с, останавливается кнопкой, при уходе сцены за экран, скрытии вкладки и `prefers-reduced-motion`. При недоступности WebGL/текстур остаётся исходная афиша. Three.js подгружается отдельно от основного приложения.

Текстуры: [NASA's Scientific Visualization Studio — CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), Ernie Wright (USRA), Noah Petro (NASA/GSFC), LRO/LROC и LOLA. Цвет: `lroc_color_2k.jpg`; рельеф: `ldem_3_8bit.jpg`. Локальные копии `moon-color.jpg` (2048 × 1024) и `moon-height.jpg` (1024 × 512) получены из [зеркала с описанием происхождения](https://github.com/MaxwellLee/physics-lab/blob/main/assets/textures/SOURCES.md): цвет повторно сжат в JPEG, рельеф сохранён без изменений. В работе сайта внешних запросов за текстурами нет.

## Финальный промпт генерации

Create a premium cinematic website hero asset inspired by a gothic Halloween masquerade fashion poster. Landscape 1536x1024. Pure near-black background (#080808), a huge detailed blood red full moon occupying the CENTER-RIGHT of the image, fiery soft red corona glow, real crater texture, photoreal astronomical surface. In front of the moon on the RIGHT half stands a mysterious high-fashion woman in an elegant black voluminous Victorian gothic dress with structured puff sleeves, white sharp collar, black futuristic eye mask, slick black hair. Monochrome silver-black fashion photography lit with subtle crimson rim lighting. Cropped at hips at the bottom. Dramatic fashion editorial, delicate photographic grain, extremely striking. Keep LEFT 40 percent almost pure black empty negative space with just faint red atmospheric light for website typography to be added in code. The moon must be fully visible at the top, not cropped, woman's head at 25% height. The bottom gracefully fades to pure black. NO TEXT, NO LOGOS, NO LETTERING, NO BATS (bats will be animated separately in code). Output is a finished raster website background, not a website mockup.
