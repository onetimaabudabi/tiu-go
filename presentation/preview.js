/**
 * TIU GO — предпросмотр презентации без PowerPoint.
 *
 *   node presentation/preview.js
 *
 * Скрипт подменяет pptxgenjs записывающей заглушкой, прогоняет те же
 * модули из slides/ и рисует результат в PNG через node-canvas. Это не
 * пиксель в пиксель PowerPoint, но этого хватает, чтобы поймать главное:
 * текст, вылезший за карточку, и наложения блоков.
 *
 * Вывод: presentation/output/preview/slide-NN.png и список замечаний.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const content = require('./content');
const theme = require('./theme');

const DPI = 144;                         // 13.333 × 7.5 дюйма → 1920 × 1080
const OUT = path.join(__dirname, 'output', 'preview');

const warnings = [];

// ---------- Запись вызовов pptxgenjs ----------

class FakeSlide {
  constructor(master) {
    this.ops = [];
    this.master = master;
    (master.objects || []).forEach((obj) => {
      if (obj.text) this.addText(obj.text.text, obj.text.options);
      if (obj.image) this.addImage(obj.image);
      if (obj.placeholder) this.addText(obj.placeholder.text, obj.placeholder.options);
    });
  }
  addText(text, options) { this.ops.push({ kind: 'text', text, options: options || {} }); }
  addShape(type, options) { this.ops.push({ kind: 'shape', type, options: options || {} }); }
  addImage(options) { this.ops.push({ kind: 'image', options: options || {} }); }
  addChart(type, data, options) { this.ops.push({ kind: 'chart', type, data, options: options || {} }); }
}

class FakePres {
  constructor() {
    this.ShapeType = { roundRect: 'roundRect', rect: 'rect', ellipse: 'ellipse' };
    this.ChartType = { bar: 'bar', line: 'line', pie: 'pie' };
    this.masters = {};
    this.slides = [];
  }
  defineLayout(layout) { this.layoutDef = layout; }
  defineSlideMaster(master) { this.masters[master.title] = master; }
  addSlide({ masterName } = {}) {
    const master = this.masters[masterName] || { objects: [] };
    const slide = new FakeSlide(master);
    slide.number = this.slides.length + 1;
    this.slides.push(slide);
    return slide;
  }
  async writeFile() { /* предпросмотру файл не нужен */ }
}

// ---------- Рисование ----------

const px = (inches) => inches * DPI;
const hex = (color) => `#${String(color).replace('#', '')}`;

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Разбиваем прогоны текста на строки по ширине блока. */
function layoutRuns(ctx, runs, maxWidth) {
  const lines = [];
  let line = { parts: [], width: 0, size: 0 };

  const push = () => { lines.push(line); line = { parts: [], width: 0, size: 0 }; };

  runs.forEach((run) => {
    const size = px(run.size / 72);
    ctx.font = `${run.bold ? 'bold ' : ''}${size}px Helvetica, Arial`;
    const chunks = String(run.text).split(/(\n)/);

    chunks.forEach((chunk) => {
      if (chunk === '\n') { push(); return; }
      chunk.split(/(\s+)/).forEach((word) => {
        if (!word) return;
        // Запас 4%: Segoe UI в PowerPoint чуть шире Helvetica здесь
        const w = ctx.measureText(word).width * 1.04;
        if (line.width + w > maxWidth && line.parts.length && word.trim()) push();
        line.parts.push({ text: word, run, width: w, size });
        line.width += w;
        line.size = Math.max(line.size, size);
      });
    });

    if (run.breakLine) push();
  });

  if (line.parts.length) push();
  return lines.filter((l, i) => l.parts.length || i < lines.length - 1);
}

function drawText(ctx, op, label) {
  const o = op.options;
  const x = px(o.x || 0);
  const y = px(o.y || 0);
  const w = px(o.w || 1);
  const h = px(o.h || 0.4);

  const runs = Array.isArray(op.text)
    ? op.text.map((r) => ({
        text: r.text,
        size: (r.options && r.options.fontSize) || o.fontSize || 14,
        bold: (r.options && r.options.bold) || o.bold,
        color: (r.options && r.options.color) || o.color || 'FFFFFF',
        breakLine: r.options && r.options.breakLine,
        spaceAfter: (r.options && r.options.paraSpaceAfter) || 0
      }))
    : [{ text: op.text, size: o.fontSize || 14, bold: o.bold, color: o.color || 'FFFFFF' }];

  const lines = layoutRuns(ctx, runs, w);
  const spacing = o.lineSpacingMultiple || 1.15;
  const lineHeights = lines.map((l, i) => {
    const base = (l.size || px((o.fontSize || 14) / 72)) * spacing;
    // Отступ после абзаца: он есть только у последней строки абзаца
    const run = l.parts.length ? l.parts[l.parts.length - 1].run : null;
    const after = run && run.spaceAfter && (i === lines.length - 1 || run.breakLine) ? px(run.spaceAfter / 72) : 0;
    return base + after;
  });
  const total = lineHeights.reduce((a, b) => a + b, 0);

  // Контроль переполнения — главное, ради чего всё это писалось
  if (total > h + 2) {
    warnings.push(`${label}: нужно h ${(total / DPI).toFixed(2)}" вместо ${(h / DPI).toFixed(2)}" (${lines.length} стр.) — «${String(runs[0].text).slice(0, 44)}…»`);
  }

  const used = { x, y, w, h: Math.max(total, h), text: String(runs[0].text).slice(0, 40) };

  let cursor = y;
  if (o.valign === 'middle') cursor = y + (h - total) / 2;
  if (o.valign === 'bottom') cursor = y + h - total;

  lines.forEach((line, i) => {
    cursor += lineHeights[i];
    let lx = x;
    if (o.align === 'center') lx = x + (w - line.width) / 2;
    if (o.align === 'right') lx = x + w - line.width;

    line.parts.forEach((part) => {
      ctx.font = `${part.run.bold ? 'bold ' : ''}${part.size}px Helvetica, Arial`;
      ctx.fillStyle = hex(part.run.color);
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(part.text, lx, cursor - part.size * 0.25);
      lx += part.width;
    });
  });

  return used;
}

function drawShape(ctx, op) {
  const o = op.options;
  const x = px(o.x); const y = px(o.y); const w = px(o.w); const h = px(o.h);
  const r = op.type === 'roundRect' ? px(o.rectRadius || 0.1) : 0;

  if (op.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, x, y, w, h, r);
  }

  if (o.fill && o.fill.color) { ctx.fillStyle = hex(o.fill.color); ctx.fill(); }
  if (o.line && o.line.color && o.line.type !== 'none') {
    ctx.strokeStyle = hex(o.line.color);
    ctx.lineWidth = Math.max(1, o.line.width || 1);
    ctx.stroke();
  }
}

/** Диаграмма рисуется приблизительно: важны габариты, а не точные столбики. */
function drawChart(ctx, op) {
  const o = op.options;
  const x = px(o.x); const y = px(o.y); const w = px(o.w); const h = px(o.h);
  const series = op.data;
  const labels = series[0].labels;
  const stacked = o.barGrouping === 'stacked';

  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = hex(o.plotArea && o.plotArea.fill ? o.plotArea.fill.color : theme.colors.card);
  ctx.fill();

  const plotH = h - 46;
  const max = stacked
    ? Math.max(...labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0)))
    : Math.max(...series.flatMap((s) => s.values));

  const groupW = w / labels.length;
  const colors = o.chartColors || [theme.colors.accent, theme.colors.ok];

  labels.forEach((label, i) => {
    const gx = x + i * groupW;
    if (stacked) {
      let base = y + plotH;
      series.forEach((s, si) => {
        const bh = (s.values[i] / max) * plotH * 0.84;
        ctx.fillStyle = hex(colors[si % colors.length]);
        ctx.fillRect(gx + groupW * 0.25, base - bh, groupW * 0.5, bh);
        base -= bh;
      });
    } else {
      const barW = (groupW * 0.6) / series.length;
      series.forEach((s, si) => {
        const bh = (s.values[i] / max) * plotH * 0.8;
        ctx.fillStyle = hex(colors[si % colors.length]);
        ctx.fillRect(gx + groupW * 0.2 + si * barW, y + plotH - bh, barW * 0.86, bh);
        if (o.showValue) {
          ctx.fillStyle = hex(o.dataLabelColor || theme.colors.label2);
          ctx.font = '15px Helvetica';
          ctx.textAlign = 'center';
          ctx.fillText(String(s.values[i]), gx + groupW * 0.2 + si * barW + barW * 0.43, y + plotH - bh - 6);
          ctx.textAlign = 'left';
        }
      });
    }
    ctx.fillStyle = hex(theme.colors.label2);
    ctx.font = '15px Helvetica';
    ctx.textAlign = 'center';
    ctx.fillText(label, gx + groupW / 2, y + plotH + 20);
    ctx.textAlign = 'left';
  });

  // Легенда
  let lx = x + 16;
  ctx.font = '14px Helvetica';
  series.forEach((s, si) => {
    ctx.fillStyle = hex(colors[si % colors.length]);
    ctx.fillRect(lx, y + h - 22, 12, 12);
    ctx.fillStyle = hex(theme.colors.label2);
    ctx.fillText(s.name, lx + 18, y + h - 12);
    lx += 30 + ctx.measureText(s.name).width;
  });
}

// ---------- Прогон ----------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Подменяем pptxgenjs в кеше модулей: slides/ и lib/ ничего не заметят
  const pptxPath = require.resolve('pptxgenjs');
  require.cache[pptxPath] = { id: pptxPath, filename: pptxPath, loaded: true, exports: FakePres };

  const { Deck } = require('./lib/layout');
  const { ASSETS, buildLogo } = require('./lib/assets');

  const logo = await buildLogo();
  const assets = { logo, qr: path.join(ASSETS, 'qr-telegram.png'), path: (p) => path.join(ASSETS, p) };

  const pres = new FakePres();
  const modules = [
    '01-title', '02-problem', '03-solution', '04-how-it-works',
    '05-demo', '06-math-model', '07-impact', '08-survey',
    '09-market', '10-competitors', '11-investment', '12-team'
  ];

  const deck = new Deck(pres, { logo, total: modules.length });
  modules.forEach((name) => require(`./slides/${name}`)(pres, deck, content, assets));

  for (let i = 0; i < pres.slides.length; i++) {
    const slide = pres.slides[i];
    const canvas = createCanvas(px(theme.grid.width), px(theme.grid.height));
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = hex((slide.master.background && slide.master.background.color) || theme.colors.bg);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const boxes = [];
    const hasFooter = Boolean(slide.master.slideNumber);
    for (const op of slide.ops) {
      // Контент не должен заезжать в полосу подвала
      const o = op.options || {};
      if (hasFooter && op.kind !== 'text' && o.y >= theme.grid.bodyY - 0.5 && o.y + (o.h || 0) > theme.grid.footerY) {
        warnings.push(`слайд ${i + 1}: блок заходит в подвал, низ ${(o.y + o.h).toFixed(2)}" при пределе ${theme.grid.footerY}"`);
      }
      if (op.kind === 'shape') drawShape(ctx, op);
      else if (op.kind === 'text') {
        const box = drawText(ctx, op, `слайд ${i + 1}`);
        if (box && String(box.text).trim()) {
          boxes.push(box);
          if (hasFooter && box.y / DPI >= theme.grid.bodyY && box.y / DPI < theme.grid.footerY &&
              (box.y + box.h) / DPI > theme.grid.footerY) {
            warnings.push(`слайд ${i + 1}: текст заходит в подвал — «${box.text}…»`);
          }
        }
      }
      else if (op.kind === 'chart') drawChart(ctx, op);
      else if (op.kind === 'image') {
        const o = op.options;
        if (o.path && fs.existsSync(o.path)) {
          const img = await loadImage(o.path);
          const bw = px(o.w); const bh = px(o.h);
          const scale = Math.min(bw / img.width, bh / img.height);
          const iw = img.width * scale; const ih = img.height * scale;
          ctx.drawImage(img, px(o.x) + (bw - iw) / 2, px(o.y) + (bh - ih) / 2, iw, ih);
        } else {
          warnings.push(`слайд ${i + 1}: нет картинки ${o.path}`);
        }
      }
    }

    // Номер слайда из мастера
    if (slide.master.slideNumber) {
      const sn = slide.master.slideNumber;
      ctx.fillStyle = hex(sn.color);
      ctx.font = `${px(sn.fontSize / 72)}px Helvetica`;
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), px(sn.x + sn.w), px(sn.y + sn.h * 0.72));
      ctx.textAlign = 'left';
    }

    // Наложения текстовых блоков: карточка под текстом — это нормально,
    // а два текста друг на друге — всегда ошибка вёрстки.
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a]; const B = boxes[b];
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        if (ox > 6 && oy > 6) {
          warnings.push(`слайд ${i + 1}: наложение ${Math.round(oy)} px — «${A.text}…» и «${B.text}…»`);
        }
      }
    }

    const file = path.join(OUT, `slide-${String(i + 1).padStart(2, '0')}.png`);
    fs.writeFileSync(file, canvas.toBuffer('image/png'));
  }

  console.log(`[preview] ${pres.slides.length} слайдов → output/preview/`);
  if (!warnings.length) {
    console.log('[preview] замечаний нет');
  } else {
    console.log(`[preview] замечаний: ${warnings.length}`);
    warnings.forEach((w) => console.log('  • ' + w));
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
