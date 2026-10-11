# Hyperframes Composition Brief: TIU GO

## Objective
Короткий ролик-визитка проекта TIU GO: от проблемы (шестнадцать этажей,
очередь в обед) к продукту и к цифрам, которые его оправдывают.

## Output
- Composition directory: `composition/`
- Rendered video: `brag.mp4`
- Format: landscape — 1920×1080, 30 кадров в секунду
- Duration: 22.4 секунды

## Source Material
- Project root: `/Users/a1111/Desktop/TIU GO`
- Primary files read: `README.md`, `shared/public/i18n.js`, `shared/public/style.css`,
  `tech-model/params.js`, `tech-model/output/data/06-simulation.json`
- Product name: TIU GO
- Tagline / strongest claim: «На 1 этаже большая очередь · 22 человека ждут лифт»
- Key UI or visual moment to recreate: ничего не воссоздавалось — все пять
  изображений в ролике сняты puppeteer'ом с работающего приложения
  (`app-main-full`, `app-floorbar`, `app-wait`, `app-camera`, `app-compare`).
  3D-визуализация в ролик не входит по решению заказчика.
- Copy that must appear verbatim:
  - «На 1 этаже большая очередь · 22 человека ждут лифт» (`floor.bigQueue`)
  - «Онлайн-камера · Холл, 1 этаж» (`detail.camera`)
  - «Ждать лифт» (`rec.wait`) и «Иди по лестнице» (`rec.stairs`)
  - «Корпус 7, Мельникайте 70» (адрес с сервера, не переводится)

## Creative Direction
- Tone preset: `default`
- Creative direction: инженерный отчёт, который хочется досмотреть
- Interpretation: короткие строки, настоящие числа, ритм задаёт перкуссия.
  Смены сцен посажены на удары, юмор не подаётся отдельно — ситуация
  сама по себе достаточная.
- Angle: не дашборд, а ответ на вопрос «ждать или идти пешком», который
  в этом корпусе задают каждый день.
- Hook: «Шестнадцать этажей» → удар → «И очередь внизу»
- Outro / punchline: лок-ап TIU GO и строка «Ждать или идти по лестнице»
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
- Background: `#0B0D12` (`--color-bg`)
- Card: `#161A22`, линия `#232833`
- Text: `#FFFFFF` / `#9CA3AF` / `#6B7280`
- Accent: `#5B8DEF`; статусы `#22C55E` / `#F59E0B` / `#EF4444`
- Display font: системный (`system-ui`) — приложение тоже не тянет внешних
- Body font: тот же
- Visual references: плашка первого этажа, кадр камеры с рамками детекции,
  ряд из шести дверей с тремя табличками «НЕ РАБОТАЕТ»

## Storyboard
Контракт — `brag-plan.md`. Границы сцен подвинуты на удары трека.

1. Факт — 0 → 3.52 — «Шестнадцать этажей», «И очередь внизу»
2. Главный экран — 3.52 → 7.54 — телефон с самопрокруткой, «TIU GO»
3. Что видно — 7.54 → 11.56 — плашка очереди, «9 человек», «~23–38 сек»
4. Откуда данные — 11.56 → 15.29 — кадр камеры, рекомендации
5. Ответ — 15.29 → 19.89 — «Ждать лифт» и сравнение, три числа модели
6. Лок-ап — 19.89 → 22.40 — «TIU GO · Ждать или идти по лестнице»

## Audio
- Audio role: плотный ритмический слой, перкуссия ведёт монтаж
- Audio arc: ровная громкость весь ролик, затухание последние 0.8 с
- Music: `assets/music/stomp.mp3` — файл пользователя
  (`energysound-stomp-drum-percussion-513744.mp3`), подрезан с 1.40 с,
  приведён к −16 LUFS / −5.2 dBTP
- Music treatment: вход с первого удара, `data-volume="1"`, фейд-аут в конце
- Music cue guidance: сетка снята `npx hyperframes beats` →
  `beats/assets/music/stomp.mp3.json` (251 удар). Все таймкоды композиции —
  это времена из того файла минус 1.40 с подрезки.
- Audio-reactive treatment: subtle — прозрачность двух радиальных подсветок
  (сцены 3 и 6) считается покадрово из RMS и баса
  (`assets/music/audio-rms.js`). Никаких осциллограмм и эквалайзеров.
- Audio-coupled moments:
  - 1.51 — «И очередь внизу» (beat-locked, `impactSoft_medium`)
  - 3.52 — приезд телефона (`drop_002`)
  - 7.54 — появление плашки очереди (`drop_002`)
  - 11.85 / 12.13 / 12.42 — открытие кадра камеры (`impactGlass_light` ×3)
  - 13.86 — подсветка рекомендации (`switch_004`)
  - 15.87 / 16.73 / 17.59 — три числа (`impactPlate_light`)
  - 19.89 — лок-ап (beat-locked, `impactBell_heavy`)
- SFX selection guidance: только мягкие семейства, громкость 0.12–0.3
- SFX analysis guidance: `~/.claude/skills/brag/assets/sfx/sfx-analysis.md`
- Audio files: скопированы в `composition/assets/`

## Hyperframes Instructions
- Композиция монолитная: для двадцати двух секунд и шести сцен
  дробление на под-композиции даёт только лишние файлы. `check` оставляет
  на это семь предупреждений организационного характера, ошибок нет.
- Видео в композиции нет вовсе: все шесть сцен — текст и снимки экранов.
  Прокрутка главного экрана сделана окном с обрезкой и одним твином `y`
  по снимку страницы (1639 px в окне 985 px → ход ровно 654 px).
- Beat-locks: 1.51 с, 15.29 с, 19.89 с — три, как и рекомендовано.
- Beat-grid: выноса в сцене 3 и три числа в сцене 5.
- Рендер локальный, публикация не запускалась.
