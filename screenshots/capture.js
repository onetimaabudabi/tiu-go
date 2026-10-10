/**
 * TIU GO — автоматические скриншоты и мокапы для презентации.
 *
 * Что получается в папке screenshots/:
 *
 *   main-dark.png        — главный экран, тёмная тема   (390×844 @2x)
 *   main-light.png       — главный экран, светлая тема
 *   detail-dark.png      — экран лифта, тёмная тема
 *
 *   mockup.png           — готовый слайд 1920×1080: три «айфона» на светлом фоне
 *   mockup-dark.png      — тот же слайд на тёмном фоне
 *
 *   phone-main-dark.png  — один телефон с прозрачным фоном (для своих слайдов)
 *   phone-main-light.png
 *   phone-detail-dark.png
 *
 * Запуск (сервер должен быть поднят: npm run start:server):
 *   npm run screenshots
 *
 * Перерисовать только мокапы из уже снятых кадров — сервер не нужен:
 *   npm run mockup
 *
 * Адрес приложения можно переопределить:
 *   TIU_GO_URL=http://localhost:3005 npm run screenshots
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = process.env.TIU_GO_URL || 'http://localhost:3000';
const OUT_DIR = __dirname;
const MOCKUP = 'file://' + path.join(OUT_DIR, 'mockup.html');

// iPhone 14: 390×844, снимаем в двойном разрешении
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true };

// Слайд под презентацию 16:9
const SLIDE = { width: 1920, height: 1080, deviceScaleFactor: 2 };

const SHOTS = ['main-dark', 'main-light', 'detail-dark'];

/** Небольшая пауза — чтобы успели отработать CSS-переходы. */
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shot(page, name, options) {
  await page.screenshot(Object.assign({ path: path.join(OUT_DIR, name) }, options));
  console.log('  ✓', name);
}

/** Ждём, пока все картинки на странице реально декодируются. */
function waitImages(page) {
  return page.evaluate(function () {
    var list = Array.prototype.slice.call(document.images);
    return Promise.all(list.map(function (img) {
      return img.decode ? img.decode().catch(function () {}) : null;
    }));
  });
}

/** Текущая тема документа — по атрибуту data-theme. */
function readTheme(page) {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

// ---------- Шаг 1: кадры самого приложения ----------
async function captureApp(browser) {
  console.log('Снимаем приложение:', URL);

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // Стартуем гарантированно с тёмной темы, не полагаясь на настройки системы
  await page.evaluateOnNewDocument(() => {
    try { window.localStorage.setItem('tiu-go-theme', 'dark'); } catch (e) {}
  });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (err) {
    throw new Error(
      'Не удалось открыть ' + URL + '. Сервер запущен? (npm run start:server)'
    );
  }

  // Ждём, пока приедут данные и появятся карточки лифтов
  await page.waitForSelector('.tile', { timeout: 15000 });

  // Эмулируем безопасную зону iPhone. В браузере env(safe-area-inset-top)
  // равен нулю, и контент начинается у самой кромки экрана — в рамке мокапа
  // его перекрыл бы «остров». На реальном телефоне отступ есть всегда.
  await page.addStyleTag({
    content: [
      '.hero   { padding-top: 69px !important; }',
      '.navbar { padding-top: 57px !important; }',
      '.topbar { padding-top: 47px !important; }',
      // плашка офлайна прижата к самой кромке — её тоже опускаем под «остров»
      '.offline { margin-top: 57px !important; }',
      // снизу оставляем место под системную полоску «домой»
      '.toolbar { padding-bottom: 26px !important; }',
      '.content { padding-bottom: 136px !important; }',
      '.foot    { padding-bottom: 46px !important; }'
    ].join('\n')
  });

  await pause(800);

  // ── Главный экран, тёмная тема ──
  await shot(page, 'main-dark.png');

  // ── Тумблер темы → светлая ──
  await page.click('#theme-toggle');
  await pause(700); // переход темы 0.3s + запас
  if ((await readTheme(page)) !== 'light') {
    throw new Error('Тема не переключилась на светлую — проверьте тумблер #theme-toggle');
  }
  await shot(page, 'main-light.png');

  // ── Возвращаем тёмную и открываем первый лифт ──
  await page.click('#theme-toggle');
  await pause(700);

  await page.click('.tile');
  await page.waitForSelector('#screen-detail:not([hidden])', { timeout: 5000 });
  await pause(900); // ждём анимацию перехода и кадр камеры
  await shot(page, 'detail-dark.png');

  await page.close();
}

// ---------- Шаг 2: мокапы для презентации ----------
async function captureMockups(browser) {
  const missing = SHOTS.filter(function (name) {
    return !fs.existsSync(path.join(OUT_DIR, name + '.png'));
  });

  if (missing.length) {
    throw new Error(
      'Нет кадров приложения: ' + missing.join(', ') +
      '. Сначала запустите npm run screenshots при поднятом сервере.'
    );
  }

  console.log('Собираем мокапы для презентации');

  const page = await browser.newPage();

  // ── Слайды 1920×1080 ──
  await page.setViewport(SLIDE);

  const slides = [
    { query: '', file: 'mockup.png' },
    { query: '?theme=dark', file: 'mockup-dark.png' }
  ];

  for (const slide of slides) {
    await page.goto(MOCKUP + slide.query, { waitUntil: 'load' });
    await waitImages(page);
    await pause(300);
    await shot(page, slide.file);
  }

  // ── Отдельные телефоны с прозрачным фоном ──
  // Корпус 414×868 в масштабе 1:1, поэтому берём окно с запасом
  await page.setViewport({ width: 640, height: 1000, deviceScaleFactor: 2 });

  for (const name of SHOTS) {
    await page.goto(MOCKUP + '?bare=' + name, { waitUntil: 'load' });
    await waitImages(page);
    await pause(200);

    const phone = await page.$('.phone');
    await phone.screenshot({
      path: path.join(OUT_DIR, 'phone-' + name + '.png'),
      omitBackground: true // прозрачный фон — телефон можно класть на любой слайд
    });
    console.log('  ✓ phone-' + name + '.png');
  }

  await page.close();
}

// ---------- Точка входа ----------
async function main() {
  const mockupOnly = process.argv.includes('--mockup-only');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    if (!mockupOnly) await captureApp(browser);
    await captureMockups(browser);

    console.log('');
    console.log('Готово. Для презентации берите mockup.png или mockup-dark.png,');
    console.log('для своих слайдов — phone-*.png с прозрачным фоном.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
