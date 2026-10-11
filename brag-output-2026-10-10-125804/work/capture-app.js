/**
 * Кадры мини-приложения для brag-ролика.
 *
 * Отличие от screenshots/capture.js: там снимается состояние «как есть»,
 * а здесь через админку выставляется осмысленная сцена — очередь внизу,
 * переполненные кабины, сломанные лифты, — чтобы в кадре было видно то,
 * ради чего приложение и сделано.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'http://localhost:3000';
const OUT = process.argv[2];
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Сцена: час пик, очередь внизу, три лифта не работают. */
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
    if (!res.ok) throw new Error(`админка ответила ${res.status} по лифту ${lift.id}`);
  }
  console.log('  ✓ сцена выставлена через админку');
}

async function main() {
  await applyScene();

  const browser = await puppeteer.launch({ headless: 'new', args: ['--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await pause(1200);

  // Главный экран
  await page.screenshot({ path: path.join(OUT, 'app-main.png') });
  console.log('  ✓ app-main.png');

  // Плашка первого этажа крупно
  const bar = await page.$('#floorbar');
  if (bar) {
    await bar.screenshot({ path: path.join(OUT, 'app-floorbar.png') });
    console.log('  ✓ app-floorbar.png');
  }

  // Карточка лифта крупно
  const tile = await page.$('.tile');
  if (tile) {
    await tile.screenshot({ path: path.join(OUT, 'app-tile.png') });
    console.log('  ✓ app-tile.png');
  }

  // Экран лифта: открываем лифт 6 — у него самая длинная очередь
  await page.evaluate(() => {
    const tiles = document.querySelectorAll('.tile');
    const last = tiles[tiles.length - 1];
    if (last) last.click();
  });
  await pause(1400);
  await page.screenshot({ path: path.join(OUT, 'app-detail.png') });
  console.log('  ✓ app-detail.png');

  // Камера крупным планом
  const cam = await page.$('#camera-frame') || await page.$('.camera');
  if (cam) {
    await cam.screenshot({ path: path.join(OUT, 'app-camera.png') });
    console.log('  ✓ app-camera.png');
  }

  await browser.close();
}

main().catch((err) => { console.error('Ошибка:', err.message); process.exit(1); });
