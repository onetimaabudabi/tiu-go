/**
 * Перезапись кадра холла: первый дубль вышел на восьми кадрах в секунду —
 * сцена ещё не успела подстроить детализацию после прокрутки модели.
 * Здесь даём ей отстояться и ведём камеру медленным наездом.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUT = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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

    // Медленный наезд: ведём камеру сами, кадр за кадром
    const t0 = performance.now();
    const t = window.tiu;
    const from = { x: 4.8, y: 1.95, z: 4.8 };
    const to = { x: 2.3, y: 1.68, z: 1.2 };

    let raf = 0;
    const dolly = () => {
      const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      t.camera.position.set(
        from.x + (to.x - from.x) * e,
        from.y + (to.y - from.y) * e,
        from.z + (to.z - from.z) * e
      );
      t.controls.target.set(-2.2, 1.25, -3.6);
      raf = requestAnimationFrame(dolly);
    };
    raf = requestAnimationFrame(dolly);

    rec.start();
    await new Promise((r) => setTimeout(r, secs * 1000));
    rec.stop();
    cancelAnimationFrame(raf);
    await done;

    const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }, seconds);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1920,1200', '--force-color-profile=srgb', '--hide-scrollbars']
  });

  const page = (await browser.pages())[0];
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForFunction('window.tiu && window.tiu.sim', { timeout: 180000 });

  await page.evaluate(() => {
    for (const id of ['panel-left', 'panel-right', 'panel-bottom', 'loader', 'toast']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    window.tiu.sim.jumpTo('13:05');
  });

  // Даём толпе набраться и дать системе подобрать детализацию
  console.log('  … набираем очередь и ждём, пока устаканится FPS');
  await pause(45000);

  const fps = await page.evaluate(() => ({
    fps: window.tiu.fps, level: window.tiu.qualityName, crowd: window.tiu.crowd.count
  }));
  console.log('  …', JSON.stringify(fps));

  // Фиксируем детализацию: автоподбор уводит её в «минимум», и в кадре
  // вместо персонажей остаются силуэты. Для записи важнее картинка,
  // чем частота кадров, — 25 кадров в секунду здесь достаточно.
  await page.evaluate(() => {
    const t = window.tiu;
    t.quality.setLevel(2);
    t.renderer.setPixelRatio(1);
    t.crowd.setBudget(40, 26, 10);
    t.setSpeed(10);
  });
  await pause(6000);

  const locked = await page.evaluate(() => ({ fps: window.tiu.fps, level: window.tiu.qualityName }));
  console.log('  … после фиксации:', JSON.stringify(locked));

  const b64 = await record(page, 7);
  fs.writeFileSync(path.join(OUT, 'sim-hall.webm'), Buffer.from(b64, 'base64'));
  console.log('  ✓ sim-hall.webm переснят');

  await page.screenshot({ path: path.join(OUT, 'sim-hall.png') });
  await browser.close();
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
