/**
 * Второй заход за кадрами приложения — для версии ролика без 3D.
 *
 * Нужны: главный экран целиком (под прокрутку), экран лифта с прогнозом
 * и сравнением с лестницей, и отдельные элементы крупным планом.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'http://localhost:3000';
const OUT = process.argv[2];
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Час пик: три лифта не работают, внизу очередь
const SCENE = [
  { id: 1, status: 'working', currentFloor: 12, occupancy: 4, waitingAtFirstFloor: 7 },
  { id: 2, status: 'working', currentFloor: 2, occupancy: 5, waitingAtFirstFloor: 6 },
  { id: 3, status: 'broken', currentFloor: 9, occupancy: 0, waitingAtFirstFloor: 0 },
  { id: 4, status: 'broken', currentFloor: 1, occupancy: 0, waitingAtFirstFloor: 0 },
  { id: 5, status: 'maintenance', currentFloor: 5, occupancy: 0, waitingAtFirstFloor: 0 },
  { id: 6, status: 'working', currentFloor: 1, occupancy: 6, waitingAtFirstFloor: 9 }
];

async function applyScene() {
  for (const lift of SCENE) {
    const res = await fetch(`${URL}/api/admin/elevator/${lift.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lift)
    });
    if (!res.ok) throw new Error(`админка: ${res.status}`);
  }
  console.log('  ✓ сцена выставлена');
}

async function shotElement(page, selector, name) {
  const el = await page.$(selector);
  if (!el) { console.log('  — нет элемента', selector); return false; }
  await el.screenshot({ path: path.join(OUT, name) });
  console.log('  ✓', name);
  return true;
}

async function main() {
  await applyScene();

  const browser = await puppeteer.launch({ headless: 'new', args: ['--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await pause(1500);

  // Главный экран целиком — под прокрутку в ролике
  await page.screenshot({ path: path.join(OUT, 'app-main-full.png'), fullPage: true });
  const full = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight
  }));
  console.log('  ✓ app-main-full.png', full.w + '×' + full.h, 'CSS-пикселей');

  await page.screenshot({ path: path.join(OUT, 'app-main.png') });
  await shotElement(page, '#floorbar', 'app-floorbar.png');
  await shotElement(page, '.notice', 'app-notice.png');
  await shotElement(page, '.tile', 'app-tile.png');

  // Экран лифта: выбираем этаж назначения повыше, чтобы было что сравнивать
  await page.evaluate(() => {
    const tiles = document.querySelectorAll('.tile');
    if (tiles.length) tiles[tiles.length - 1].click();
  });
  await pause(1200);

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, .floor-chip, [data-floor]'));
    const target = buttons.find((b) => b.textContent.trim() === '12');
    if (target) target.click();
  });
  await pause(1400);

  await page.screenshot({ path: path.join(OUT, 'app-detail.png') });
  await page.screenshot({ path: path.join(OUT, 'app-detail-full.png'), fullPage: true });
  await shotElement(page, '#camera-scene', 'app-camera.png');
  await shotElement(page, '#detail-camera', 'app-camera-card.png');
  await shotElement(page, '#d-rec-panel', 'app-rec.png');
  await shotElement(page, '#d-occupancy-card', 'app-occ.png');

  // Что на экране лифта вообще есть — пригодится для выбора кадра
  const blocks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[id]'))
      .filter((el) => el.offsetHeight > 40)
      .map((el) => ({ id: el.id, h: el.offsetHeight, t: (el.textContent || '').trim().slice(0, 70) }))
  );
  console.log('  блоки экрана лифта:');
  for (const b of blocks) console.log('   ', b.id, '·', b.h + 'px', '·', b.t.replace(/\s+/g, ' '));

  await browser.close();
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
