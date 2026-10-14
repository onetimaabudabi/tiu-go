/**
 * TIU GO — подготовка картинок для презентации.
 *
 * Всё, что нужно слайдам, собирается здесь и кладётся в presentation/assets:
 * логотип без белой подложки, QR-код на канал и копии скриншотов приложения.
 * Ничего из этого не падает: не нашли исходник — вернули null, слайд
 * нарисует заглушку.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(__dirname, '..', 'assets');

/** Пишем в assets/, попутно создавая папку. */
function assetPath(...parts) {
  const file = path.join(ASSETS, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/**
 * Снимаем фон у логотипа.
 *
 * Простой порог по яркости выел бы и белые штрихи внутри эмблемы, поэтому
 * фон ищется заливкой от краёв: прозрачным становится только тот светлый
 * цвет, который связан с рамкой кадра. Внутренние блики остаются на месте.
 */
function keyOutBackground(ctx, width, height, threshold = 215) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const outside = new Uint8Array(width * height);
  const stack = [];

  const light = (p) => (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3 >= threshold;

  for (let x = 0; x < width; x++) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }

  while (stack.length) {
    const p = stack.pop();
    if (outside[p] || !light(p)) continue;
    outside[p] = 1;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }

  for (let p = 0; p < width * height; p++) {
    if (outside[p]) data[p * 4 + 3] = 0;
  }

  // Один проход сглаживания по краю: соседи прозрачного пикселя получают
  // половинную прозрачность, иначе на тёмном фоне виден светлый контур.
  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) alpha[p] = data[p * 4 + 3];
  for (let p = 0; p < width * height; p++) {
    if (!alpha[p]) continue;
    const x = p % width;
    const y = (p - x) / width;
    const near = (x > 0 && !alpha[p - 1]) || (x < width - 1 && !alpha[p + 1]) ||
                 (y > 0 && !alpha[p - width]) || (y < height - 1 && !alpha[p + width]);
    const lum = (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3;
    if (near && lum > 190) data[p * 4 + 3] = 90;
  }

  ctx.putImageData(image, 0, 0);
}

/** Границы содержимого: всё, что темнее порога. */
function contentBox(ctx, width, height, threshold = 225) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const box = { x0: width, y0: height, x1: -1, y1: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 >= threshold) continue;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  }
  return box.x1 < 0 ? null : box;
}

/**
 * Логотип проекта.
 *
 * В исходнике эмблема нарисована синим, а подпись «TIU GO» — тёмно-синим,
 * почти чёрным: на тёмном слайде она пропадает. Поэтому в презентацию идёт
 * только эмблема, а слово набирается шрифтом. Возвращаем путь к PNG или null.
 */
async function buildLogo() {
  const source = path.join(ROOT, 'screenshots', 'ЛОГОТИП.jpg');
  if (!fs.existsSync(source)) return null;

  let canvasLib;
  try {
    canvasLib = require('canvas');
  } catch {
    return null;
  }

  const { createCanvas, loadImage } = canvasLib;
  const image = await loadImage(source);
  const full = createCanvas(image.width, image.height);
  const ctx = full.getContext('2d');
  ctx.drawImage(image, 0, 0);

  // Эмблема занимает верх картинки; ищем её отдельно от подписи,
  // чтобы обрезать точно по краю, а не по глазомеру.
  const top = contentBox(ctx, image.width, Math.round(image.height * 0.55));
  if (!top) return null;

  const pad = 12;
  const x0 = Math.max(0, top.x0 - pad);
  const y0 = Math.max(0, top.y0 - pad);
  const w = Math.min(image.width - x0, top.x1 - top.x0 + pad * 2);
  const h = Math.min(image.height - y0, top.y1 - top.y0 + pad * 2);

  const mark = createCanvas(w, h);
  const markCtx = mark.getContext('2d');
  markCtx.drawImage(image, x0, y0, w, h, 0, 0, w, h);
  keyOutBackground(markCtx, w, h);

  const out = assetPath('logo.png');
  fs.writeFileSync(out, mark.toBuffer('image/png'));
  return out;
}

module.exports = { ASSETS, assetPath, buildLogo, keyOutBackground, contentBox };
