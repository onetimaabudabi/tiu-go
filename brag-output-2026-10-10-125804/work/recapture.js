/**
 * Пересъёмка кадров приложения для роликов: все шесть лифтов на ходу.
 * Сцена уже выставлена через админку, здесь только снимаем.
 */
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'http://localhost:3000';
const OUT = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function el(page, selector, name) {
  const node = await page.$(selector);
  if (!node) { console.log('  — нет', selector); return; }
  await node.screenshot({ path: path.join(OUT, name) });
  console.log('  ✓', name);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await pause(1500);

  await page.screenshot({ path: path.join(OUT, 'app-main.png') });
  console.log('  ✓ app-main.png');
  await page.screenshot({ path: path.join(OUT, 'app-main-full.png'), fullPage: true });
  const size = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight
  }));
  console.log('  ✓ app-main-full.png', size.w + '×' + size.h, 'CSS');

  await el(page, '#floorbar', 'app-floorbar.png');

  // Экран лифта 6 — у него самая длинная очередь
  await page.evaluate(() => {
    const tiles = document.querySelectorAll('.tile');
    if (tiles.length) tiles[tiles.length - 1].click();
  });
  await pause(1200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, [data-floor]'))
      .find((x) => x.textContent.trim() === '12');
    if (b) b.click();
  });
  await pause(1400);

  await page.screenshot({ path: path.join(OUT, 'app-detail-full.png'), fullPage: true });
  console.log('  ✓ app-detail-full.png');
  await el(page, '#camera-scene', 'app-camera.png');

  await browser.close();
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
