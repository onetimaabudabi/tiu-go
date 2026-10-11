/**
 * Кадр для сцены с цифрами: кабина с пассажирами идёт вверх по шахте.
 *
 * Первый дубль слежения почти весь простоял на первом этаже — лифт грузился.
 * Здесь ждём, пока кабина реально поедет вверх с людьми внутри, и только
 * тогда включаем запись.
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

    rec.start();
    await new Promise((r) => setTimeout(r, secs * 1000));
    rec.stop();
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

  console.log('  … набираем пассажиров');
  await pause(30000);

  await page.evaluate(() => {
    const t = window.tiu;
    t.quality.setLevel(2);
    t.renderer.setPixelRatio(1);
    t.crowd.setBudget(40, 30, 10);
    t.setSpeed(10);
    t.setFollow(2);
  });
  await pause(4000);

  // Ждём момента, когда кабина пошла вверх и внутри кто-то есть
  console.log('  … ждём подъёма кабины с людьми');
  await page.waitForFunction(() => {
    const l = window.tiu.elevators[1];
    return l.state === 'moving' && l.velocity > 0.2 && l.occupancy >= 3 && l.floor <= 3;
  }, { timeout: 180000, polling: 120 });

  const info = await page.evaluate(() => {
    const l = window.tiu.elevators[1];
    return { floor: l.floor, target: l.targetFloor, occ: l.occupancy, fps: window.tiu.fps };
  });
  console.log('  …', JSON.stringify(info));

  const b64 = await record(page, 5.5);
  fs.writeFileSync(path.join(OUT, 'sim-shaft.webm'), Buffer.from(b64, 'base64'));
  await page.screenshot({ path: path.join(OUT, 'sim-shaft.png') });
  console.log('  ✓ sim-shaft.webm');

  await browser.close();
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
