/**
 * Кадры и клипы 3D-визуализации для brag-ролика.
 *
 * Пишем не скриншотами, а через MediaRecorder прямо из canvas: скриншот
 * WebGL-полотна на этой машине занимает сотни миллисекунд, и склейка
 * получилась бы рваной. Браузер же отдаёт поток в реальном времени.
 *
 * Запускаем headful — в headless macOS отдаёт программный WebGL,
 * и сцена из сорока скелетных персонажей идёт по кадру в секунду.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'http://localhost:5173/';
const OUT = process.argv[2];
const W = 1920;
const H = 1080;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запись холста в webm средствами самого браузера. */
async function record(page, seconds) {
  return page.evaluate(async (secs) => {
    const canvas = document.getElementById('scene');
    const stream = canvas.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start();
    await new Promise((r) => setTimeout(r, secs * 1000));
    rec.stop();
    await done;

    const blob = new Blob(chunks, { type });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);

    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }, seconds);
}

async function save(page, name, seconds) {
  const b64 = await record(page, seconds);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ✓ ${name} — ${seconds}с, ${kb} КБ`);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--window-size=${W},${H + 120}`,
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const page = (await browser.pages())[0];
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });

  // Ждём, пока загрузятся FBX и соберётся сцена
  await page.waitForFunction('window.tiu && window.tiu.sim', { timeout: 180000 });
  console.log('  ✓ сцена готова');

  // Прячем панели — в ролике нужен чистый кадр
  await page.evaluate(() => {
    for (const id of ['panel-left', 'panel-right', 'panel-bottom', 'loader', 'toast']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  });

  // Обеденный пик и толпа: прокручиваем модель без отрисовки
  await page.evaluate(() => {
    const t = window.tiu;
    t.sim.jumpTo('13:05');
    for (let i = 0; i < 1400; i += 1) {
      t.sim.beginStep();
      t.sim.update(1 / 6);
      for (const l of t.elevators) { l.beginStep(); l.update(1 / 6); }
    }
  });
  await pause(2500);

  // ---- Клип 1: холл изнутри ----
  await page.evaluate(() => {
    const t = window.tiu;
    t.setSpeed(10);
    t.camera.position.set(5.4, 1.85, 4.2);
    t.controls.target.set(-2.2, 1.25, -3.6);
    t.controls.update();
  });
  await pause(2000);
  await save(page, 'sim-hall.webm', 7);
  await page.screenshot({ path: path.join(OUT, 'sim-hall.png') });

  // ---- Клип 2: разрез здания ----
  await page.evaluate(() => window.tiu.setView('section'));
  await pause(2500);
  await save(page, 'sim-section.webm', 6);
  await page.screenshot({ path: path.join(OUT, 'sim-section.png') });

  // ---- Клип 3: слежение за кабиной ----
  await page.evaluate(() => window.tiu.setFollow(2));
  await pause(2500);
  await save(page, 'sim-follow.webm', 6);
  await page.screenshot({ path: path.join(OUT, 'sim-follow.png') });

  // ---- Клип 4: вид сверху на холл ----
  await page.evaluate(() => window.tiu.setView('top'));
  await pause(2500);
  await save(page, 'sim-top.webm', 5);
  await page.screenshot({ path: path.join(OUT, 'sim-top.png') });

  await browser.close();
}

main().catch((err) => { console.error('Ошибка:', err.message, err.stack); process.exit(1); });
