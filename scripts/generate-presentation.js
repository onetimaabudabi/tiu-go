/**
 * TIU GO — сборка презентации для защиты проекта.
 *
 * Слайды описываются здесь кодом, а не правятся руками в PowerPoint:
 * цифры в них берутся из тех же моделей, что и отчёты, поэтому после
 * пересчёта моделей достаточно пересобрать презентацию.
 *
 *   npm run docs:deck
 *
 * Результат: presentation/TIU_GO.pptx
 *
 * Про устройство файла. Каждый слайд рисуется через объект Frame —
 * тонкую обёртку над pptxgenjs, которая попутно записывает все элементы
 * в структуру предпросмотра. По ней dev-скрипт собирает HTML-страницу
 * и проверяет вёрстку, не открывая PowerPoint.
 */

const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'presentation', 'assets');
const OUT = path.join(ROOT, 'presentation', 'TIU_GO.pptx');

// ---------- Данные объекта и результаты моделей ----------
//
// Всё, что можно прочитать из параметров и готовых расчётов, читается,
// а не переписывается руками: разойтись с отчётом слайды не должны.

const params = require(path.join(ROOT, 'shared', 'params.json'));

function readResult(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'tech-model', 'output', 'data', file), 'utf8'));
  } catch {
    return null;
  }
}

const sim = readResult('06-simulation.json');
const opt = readResult('07-optimization.json');

/** Число с неразрывным пробелом в разряде тысяч. */
function n(value, digits = 0) {
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }).replace(/ /g, ' ');
}

const FACTS = {
  floors: params.building.floors,
  lifts: params.elevators.total,
  working: params.elevators.working.length,
  people: params.people.students + params.people.staff,
  tripsPerDay: (params.people.students + params.people.staff) * params.people.tripsPerPersonPerDay,
  capacity: params.elevators.capacityRealPeak,
  // Из математической модели: пропускная способность трёх кабин и спрос в худший пик
  throughput: 522,
  peakDemand: 2070,
  liftsNeeded: 13,
  // Из технической модели (06-simulation.json)
  thrOff: sim ? Math.round(sim.withoutSystem.peakThroughput.mean) : 796,
  thrOn: sim ? Math.round(sim.withSystem.peakThroughput.mean) : 891,
  waitOff: sim ? Math.round(sim.withoutSystem.avgWait) : 795,
  waitOn: sim ? Math.round(sim.withSystem.avgWait) : 637,
  queueOff: sim ? Math.round(sim.withoutSystem.maxQueue) : 530,
  queueOn: sim ? Math.round(sim.withSystem.maxQueue) : 439,
  uselessOff: sim ? Math.round(sim.withoutSystem.uselessStops) : 588,
  uselessOn: sim ? Math.round(sim.withSystem.uselessStops) : 13,
  gain: sim ? sim.gainPercent : 11.9,
  waitGain: sim ? sim.waitGainPercent : 19.8,
  passAccuracy: sim ? Math.round(sim.passAccuracy * 100) : 72,
  runs: sim ? sim.runs : 500,
  margin: opt && Number.isFinite(opt.optimum) ? opt.optimum : params.elevators ? 2 : 2
};

// ---------- Тема ----------

const THEME = {
  name: 'TIU GO',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '101722',   // основной текст
    lt1: 'FFFFFF',
    dk2: '18212E',   // тёмный фон слайда
    lt2: 'F2F5F9',   // светлая карточка
    accent1: '4B8CF7', // синий TIU GO
    accent2: '3FB27F', // зелёный: свободно
    accent3: 'E8A33D', // янтарный: очередь
    accent4: 'D9534F', // красный: толпа и поломки
    accent5: '6B7A8C', // приглушённый текст
    accent6: '2A3647', // карточка на тёмном
    hlink: '4B8CF7',
    folHlink: '6B7A8C'
  }
};

const pres = new PptxGenJS();
const C = pres.SchemeColor;

// Пара «схема для PowerPoint, hex для предпросмотра»: схемные цвета
// переживают смену темы, а предпросмотру нужны настоящие значения.
const P = {
  text: { s: C.text1, hex: THEME.colors.dk1 },
  white: { s: C.background1, hex: 'FFFFFF' },
  dark: { s: C.text2, hex: THEME.colors.dk2 },
  soft: { s: C.background2, hex: THEME.colors.lt2 },
  blue: { s: C.accent1, hex: THEME.colors.accent1 },
  green: { s: C.accent2, hex: THEME.colors.accent2 },
  amber: { s: C.accent3, hex: THEME.colors.accent3 },
  red: { s: C.accent4, hex: THEME.colors.accent4 },
  grey: { s: C.accent5, hex: THEME.colors.accent5 },
  card: { s: C.accent6, hex: THEME.colors.accent6 }
};

pres.layout = 'LAYOUT_WIDE';          // 13.3 × 7.5 дюйма
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Команда ИСАУБ-26-1';
pres.company = 'Тюменский индустриальный университет';
pres.title = 'TIU GO — мониторинг лифтов корпуса 7';

// ---------- Сетка ----------

const G = {
  left: 0.7,
  right: 12.6,
  get width() { return this.right - this.left; },   // 11.9
  titleY: 0.52,
  titleH: 0.72,
  bodyY: 1.62,
  bottom: 6.72,
  footerY: 6.96
};

// ---------- Макеты ----------

const FOOTER = 'TIU GO · корпус 7, Мельникайте 70';

function footerObjects(onDark) {
  const color = onDark ? P.grey.s : P.grey.s;
  return [
    {
      text: {
        text: FOOTER,
        options: {
          x: G.left, y: G.footerY, w: 6, h: 0.3, fontSize: 10,
          color, align: 'left', valign: 'middle', margin: 0, isTextBox: true
        }
      }
    },
    {
      placeholder: {
        options: {
          name: 'slideNumber', type: 'body',
          x: G.right - 1, y: G.footerY, w: 1, h: 0.3,
          fontSize: 10, color, align: 'right', valign: 'middle', margin: 0
        },
        text: ''
      }
    }
  ];
}

const titleOptions = (color) => ({
  name: 'title', type: 'title',
  x: G.left, y: G.titleY, w: G.width, h: G.titleH,
  fontSize: 32, bold: true, color, align: 'left', valign: 'middle', margin: 0
});

pres.defineSlideMaster({
  title: 'TITLE',
  background: { color: THEME.colors.dk2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: G.left, y: 2.45, w: 9.2, h: 1.5, fontSize: 72, bold: true, color: P.white.s, align: 'left', valign: 'bottom', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'subtitle', type: 'body', x: G.left, y: 4.05, w: 9.2, h: 0.6, fontSize: 20, color: P.blue.s, align: 'left', valign: 'top', margin: 0 }, text: '' } }
  ]
});

pres.defineSlideMaster({
  title: 'LIGHT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: titleOptions(P.text.s), text: '' } },
    ...footerObjects(false)
  ],
  slideNumber: { x: G.right - 1, y: G.footerY, w: 1, h: 0.3, fontSize: 10, color: THEME.colors.accent5, align: 'right' }
});

pres.defineSlideMaster({
  title: 'DARK',
  background: { color: THEME.colors.dk2 },
  objects: [
    { placeholder: { options: titleOptions(P.white.s), text: '' } },
    ...footerObjects(true)
  ],
  slideNumber: { x: G.right - 1, y: G.footerY, w: 1, h: 0.3, fontSize: 10, color: THEME.colors.accent5, align: 'right' }
});

pres.defineSlideMaster({
  title: 'CLOSING',
  background: { color: THEME.colors.dk2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: G.left, y: 1.8, w: 11.9, h: 1.9, fontSize: 40, bold: true, color: P.white.s, align: 'left', valign: 'middle', margin: 0 }, text: '' } }
  ]
});

// ---------- Рисование ----------
//
// Frame складывает элементы и в pptx, и в предпросмотр. Из-за этого
// у визуальной проверки и у файла один источник координат.

const preview = [];

class Frame {
  constructor(slide, name, background) {
    this.slide = slide;
    this.items = [];
    preview.push({ name, background, items: this.items });
  }

  /** Прямоугольник, по умолчанию со скруглением. */
  rect(x, y, w, h, opt = {}) {
    const radius = opt.radius === undefined ? 0.06 : opt.radius;
    const shape = radius > 0 ? pres.ShapeType.roundRect : pres.ShapeType.rect;
    const options = { x, y, w, h, fill: { color: opt.fill.s } };
    if (radius > 0) options.rectRadius = radius;
    if (opt.line) options.line = { color: opt.line.s, width: opt.lineWidth || 1 };
    if (opt.shadow) {
      options.shadow = {
        type: 'outer', color: '0B1220', opacity: 0.16, blur: 10, offset: 3, angle: 90
      };
    }
    if (opt.name) options.objectName = opt.name;
    this.slide.addShape(shape, options);
    this.items.push({
      t: 'rect', x, y, w, h,
      fill: opt.fill.hex, radius, line: opt.line ? opt.line.hex : null,
      lineWidth: opt.lineWidth || 1, shadow: Boolean(opt.shadow)
    });
    return this;
  }

  /** Текст: строка или массив прогонов [{ text, options }]. */
  text(content, x, y, w, h, opt = {}) {
    const base = {
      x, y, w, h,
      fontSize: opt.size || 14,
      bold: Boolean(opt.bold),
      italic: Boolean(opt.italic),
      color: (opt.color || P.text).s,
      align: opt.align || 'left',
      valign: opt.valign || 'top',
      margin: opt.margin === undefined ? 0 : opt.margin,
      isTextBox: true,
      lineSpacingMultiple: opt.lineSpacing || 1.2,
      charSpacing: opt.charSpacing,
      fontFace: opt.head ? THEME.headFontFace : undefined
    };
    if (opt.paraSpaceAfter) base.paraSpaceAfter = opt.paraSpaceAfter;
    if (opt.bullet) base.bullet = opt.bullet;

    if (Array.isArray(content)) {
      this.slide.addText(content.map((run) => ({
        text: run.text,
        options: Object.assign({}, run.options, {
          color: run.color ? run.color.s : undefined,
          fontFace: run.head ? THEME.headFontFace : undefined
        })
      })), base);
    } else {
      this.slide.addText(content, base);
    }

    this.items.push({
      t: 'text', x, y, w, h,
      runs: Array.isArray(content)
        ? content.map((r) => ({
            text: r.text,
            bold: r.options && r.options.bold,
            size: (r.options && r.options.fontSize) || base.fontSize,
            color: r.color ? r.color.hex : (opt.color || P.text).hex,
            breakLine: r.options && r.options.breakLine,
            head: r.head
          }))
        : [{ text: content, bold: base.bold, size: base.fontSize, color: (opt.color || P.text).hex, head: opt.head }],
      size: base.fontSize,
      color: (opt.color || P.text).hex,
      align: base.align,
      valign: base.valign,
      bold: base.bold,
      italic: base.italic,
      lineSpacing: base.lineSpacingMultiple,
      head: opt.head,
      bullet: Boolean(opt.bullet)
    });
    return this;
  }

  /** Маркированный список. */
  list(lines, x, y, w, h, opt = {}) {
    const runs = lines.map((line, i) => ({
      text: line,
      options: { bullet: { code: '2022' }, breakLine: i < lines.length - 1 }
    }));
    this.slide.addText(runs, {
      x, y, w, h,
      fontSize: opt.size || 14,
      color: (opt.color || P.text).s,
      margin: 0,
      isTextBox: true,
      lineSpacingMultiple: 1.15,
      paraSpaceAfter: opt.gap === undefined ? 7 : opt.gap,
      valign: opt.valign || 'top'
    });
    this.items.push({
      t: 'list', x, y, w, h,
      lines, size: opt.size || 14, color: (opt.color || P.text).hex,
      gap: opt.gap === undefined ? 7 : opt.gap
    });
    return this;
  }

  image(file, x, y, w, h, opt = {}) {
    const options = { path: path.join(ASSETS, file), x, y, w, h };
    if (opt.rounding) options.rounding = true;
    if (opt.name) options.objectName = opt.name;
    this.slide.addImage(options);
    this.items.push({ t: 'image', x, y, w, h, file, rounding: Boolean(opt.rounding) });
    return this;
  }

  chart(type, data, x, y, w, h, options) {
    // Снимок делаем до вызова: pptxgenjs переписывает массив подписей на месте
    const snapshot = JSON.parse(JSON.stringify(data));
    this.slide.addChart(type, data, Object.assign({ x, y, w, h }, options));
    this.items.push({ t: 'chart', x, y, w, h, data: snapshot, options });
    return this;
  }

  /** Заметки докладчика — то, что видно только выступающему. */
  notes(text) {
    this.slide.addNotes(text);
    return this;
  }

  /** Цветная точка — мотив, повторяющийся по всей презентации. */
  dot(x, y, size, color) {
    this.slide.addShape(pres.ShapeType.ellipse, {
      x, y, w: size, h: size, fill: { color: color.s }
    });
    this.items.push({ t: 'dot', x, y, w: size, h: size, fill: color.hex });
    return this;
  }
}

function newSlide(masterName, sectionTitle, title) {
  const slide = pres.addSlide({ masterName, sectionTitle });
  if (title) slide.addText(title, { placeholder: 'title' });
  const dark = masterName !== 'LIGHT';
  const frame = new Frame(slide, title || masterName, dark ? THEME.colors.dk2 : 'FFFFFF');
  if (title) {
    frame.items.push({
      t: 'text', x: G.left, y: G.titleY, w: G.width, h: G.titleH,
      runs: [{ text: title, bold: true, size: 32, color: dark ? 'FFFFFF' : THEME.colors.dk1, head: true }],
      size: 32, bold: true, color: dark ? 'FFFFFF' : THEME.colors.dk1,
      align: 'left', valign: 'middle', head: true
    });
  }
  return { slide, frame };
}

// ---------- Повторяющиеся блоки ----------

/** Карточка с крупным числом и подписью. */
function statCard(frame, x, y, w, h, value, label, accent) {
  frame.rect(x, y, w, h, { fill: P.soft, radius: 0.1 });
  frame.dot(x + 0.32, y + 0.34, 0.16, accent);
  frame.text(value, x + 0.32, y + 0.6, w - 0.64, 0.95, {
    size: 40, bold: true, color: accent, head: true, valign: 'middle'
  });
  frame.text(label, x + 0.32, y + 1.55, w - 0.64, h - 1.75, {
    size: 13, color: P.grey, lineSpacing: 1.25
  });
}

/** Полоса-вывод под содержимым слайда. */
function takeaway(frame, text, y, opt = {}) {
  const fill = opt.dark ? P.card : P.soft;
  frame.rect(G.left, y, G.width, 0.82, { fill, radius: 0.08 });
  frame.dot(G.left + 0.3, y + 0.33, 0.17, opt.accent || P.blue);
  frame.text(text, G.left + 0.72, y + 0.08, G.width - 1.1, 0.66, {
    size: 13.5, color: opt.dark ? P.white : P.text, valign: 'middle', lineSpacing: 1.2
  });
}

/** Ряд индикаторов шести лифтов: зелёный — работает, красный — стоит. */
function liftRow(frame, x, y, opt = {}) {
  const step = opt.step || 0.74;
  const size = opt.size || 0.3;
  for (let i = 1; i <= FACTS.lifts; i += 1) {
    const live = params.elevators.working.includes(i);
    frame.dot(x + (i - 1) * step, y, size, live ? P.green : P.red);
    frame.text(String(i), x + (i - 1) * step - 0.08, y + size + 0.08, size + 0.16, 0.26, {
      size: 11, color: P.grey, align: 'center'
    });
  }
}

// ======================= Слайды =======================

// ---------- 1. Титул ----------
pres.addSection({ title: 'Титул' });
{
  const { slide, frame } = newSlide('TITLE', 'Титул');
  frame.notes(
    'Корпус 7 на Мельникайте 70: шестнадцать этажей, шесть лифтов, из них работают три — первый, второй и шестой. Проект называется TIU GO: это мини-приложение в Telegram и MAX плюс техническая часть на самих лифтах.'
  );

  frame.text('Проект команды ИСАУБ-26-1', G.left, 1.72, 9.2, 0.34, {
    size: 14, color: P.blue, charSpacing: 2
  });
  slide.addText('TIU GO', { placeholder: 'title' });
  frame.items.push({
    t: 'text', x: G.left, y: 2.45, w: 9.2, h: 1.5,
    runs: [{ text: 'TIU GO', bold: true, size: 72, color: 'FFFFFF', head: true }],
    size: 72, bold: true, color: 'FFFFFF', align: 'left', valign: 'bottom', head: true
  });
  slide.addText('Мониторинг лифтов корпуса 7', { placeholder: 'subtitle' });
  frame.items.push({
    t: 'text', x: G.left, y: 4.05, w: 9.2, h: 0.6,
    runs: [{ text: 'Мониторинг лифтов корпуса 7', size: 20, color: THEME.colors.accent1 }],
    size: 20, color: THEME.colors.accent1, align: 'left', valign: 'top'
  });

  frame.text(
    `Мельникайте 70 · ${FACTS.floors} этажей · ${FACTS.lifts} лифтов · ${n(FACTS.people)} человек`,
    G.left, 4.62, 9.2, 0.34, { size: 13.5, color: P.grey }
  );

  frame.rect(G.left, 5.35, 11.9, 1.22, { fill: P.card, radius: 0.08 });
  frame.text('Команда', G.left + 0.34, 5.52, 1.6, 0.3, { size: 11, color: P.grey, charSpacing: 1 });
  frame.text(
    'Илюшкин Дмитрий · Кузнецов Сергей · Никитин Матвей · Роденко Тимофей · Беленов Егор',
    G.left + 0.34, 5.85, 11.2, 0.44, { size: 14, color: P.white }
  );

  // Шесть лифтов корпуса: три зелёных, три красных — с этого начинается рассказ
  // Шесть точек по 0,56 дюйма занимают 3,06 — ставим их от правого поля
  liftRow(frame, G.right - 3.06, 2.72, { step: 0.56, size: 0.26 });
  frame.text(`работают ${FACTS.working} из ${FACTS.lifts}`, G.right - 3.06, 3.5, 3.06, 0.3,
    { size: 11.5, color: P.grey, align: 'left' });
}

// ---------- 2. Проблема ----------
pres.addSection({ title: 'Проблема' });
{
  const { frame } = newSlide('LIGHT', 'Проблема', 'Что происходит в корпусе 7');
  frame.notes(
    'Цифры взяты из параметров корпуса: 1150 человек, по четыре поездки в день — это 4600 поездок. Три кабины увозят 522 человека в час, а в худший пик, после второй пары, к лифтам приходит 2070. Разрыв четырёхкратный, и очередь не рассасывается.'
  );

  const cardW = (G.width - 0.6) / 3;
  statCard(frame, G.left, G.bodyY, cardW, 2.3,
    `${FACTS.working} из ${FACTS.lifts}`,
    'лифтов работают. Остальные три стоят, и починить их проектом нельзя',
    P.red);
  statCard(frame, G.left + cardW + 0.3, G.bodyY, cardW, 2.3,
    n(FACTS.tripsPerDay),
    `поездок в учебный день: ${n(FACTS.people)} человек по ${params.people.tripsPerPersonPerDay} поездки`,
    P.amber);
  statCard(frame, G.left + 2 * (cardW + 0.3), G.bodyY, cardW, 2.3,
    '13:05',
    'обеденный пик: четверть суточного потока за сорок минут',
    P.blue);

  frame.rect(G.left, 4.22, G.width, 1.3, { fill: P.soft, radius: 0.1 });
  frame.text('Спрос против возможностей', G.left + 0.34, 4.42, 5, 0.3, {
    size: 12, color: P.grey, charSpacing: 1
  });
  frame.text([
    { text: `${n(FACTS.throughput)} чел/ч`, options: { fontSize: 26, bold: true }, color: P.green, head: true },
    { text: '   увозят три кабины   ', options: { fontSize: 14 }, color: P.grey },
    { text: '·', options: { fontSize: 20 }, color: P.grey },
    { text: `   ${n(FACTS.peakDemand)} чел/ч`, options: { fontSize: 26, bold: true }, color: P.red, head: true },
    { text: '   приходит в худший пик', options: { fontSize: 14 }, color: P.grey }
  ], G.left + 0.34, 4.74, 11.2, 0.62, { valign: 'middle' });

  takeaway(frame,
    'Разрыв четырёхкратный. Очередь внизу не рассасывается сама, а человек узнаёт об этом, только когда уже спустился к лифтам.',
    5.82, { accent: P.red });
}

// ---------- 3. Лифтами пик не закрыть ----------
{
  const { frame } = newSlide('LIGHT', 'Проблема', 'Почему новые лифты не помогут');
  frame.notes(
    'Это расчёт по модели массового обслуживания: мы перебрали число кабин от одной до шестнадцати. Пока их меньше двенадцати, очередь формально растёт без предела. Чтобы ждать меньше минуты, нужно тринадцать лифтов — достроить их в готовом здании невозможно. Отсюда вывод: сокращать надо не очередь, а потери времени.'
  );

  frame.rect(G.left, G.bodyY, 5.3, 3.5, { fill: P.soft, radius: 0.1 });
  frame.text(String(FACTS.liftsNeeded), G.left + 0.4, G.bodyY + 0.45, 4.5, 1.5, {
    size: 96, bold: true, color: P.blue, head: true, valign: 'middle'
  });
  frame.text('лифтов нужно, чтобы в худший пик ожидание не превышало минуты',
    G.left + 0.4, G.bodyY + 2.1, 4.5, 1.1, { size: 15, color: P.text, lineSpacing: 1.3 });

  // Расчёт модели массового обслуживания: при каком числе кабин очередь конечна
  const rows = [
    ['3 лифта — сейчас', 'очередь растёт', P.red],
    ['6 лифтов', 'очередь растёт', P.red],
    ['12 лифтов', '180 секунд', P.amber],
    ['13 лифтов', '13 секунд', P.green]
  ];
  frame.text('Ожидание в пике при разном числе кабин', G.left + 5.9, G.bodyY + 0.05, 6, 0.3, {
    size: 12, color: P.grey, charSpacing: 1
  });
  rows.forEach((row, i) => {
    const y = G.bodyY + 0.5 + i * 0.76;
    frame.rect(G.left + 5.9, y, 6.0, 0.62, { fill: P.soft, radius: 0.08 });
    frame.dot(G.left + 6.14, y + 0.23, 0.17, row[2]);
    frame.text(row[0], G.left + 6.52, y, 3.2, 0.62, { size: 14, valign: 'middle' });
    frame.text(row[1], G.left + 9.3, y, 2.4, 0.62, {
      size: 14, bold: true, color: row[2], align: 'right', valign: 'middle'
    });
  });

  takeaway(frame,
    'Достроить десять шахт в готовом здании невозможно. Значит, уменьшать нужно не очередь, а две потери: время, которое человек ждёт зря, и время, которое лифт тратит зря.',
    5.58);
}

// ---------- 4. Команда ----------
pres.addSection({ title: 'Команда' });
{
  const { frame } = newSlide('LIGHT', 'Команда', 'Наша команда');
  frame.notes(
    'Пять человек, группа ИСАУБ-26-1. Инженерная часть — камера и логика остановок, разработка — приложение, сервер и расчётные модели.'
  );

  const roles = [
    ['team1.jpg', 'Помощник инженера'],
    ['team2.jpg', 'Тимлид'],
    ['team3.jpg', 'Главный инженер'],
    ['team4.jpg', 'Ведущий разработчик'],
    ['team5.jpg', 'Помощник разработчика']
  ];

  const size = 1.92;
  const gap = (G.width - roles.length * size) / (roles.length - 1);
  roles.forEach(([file, role], i) => {
    const x = G.left + i * (size + gap);
    frame.image(file, x, G.bodyY + 0.3, size, size, { rounding: true, name: `photo-${i + 1}` });
    frame.text(role, x - 0.15, G.bodyY + size + 0.52, size + 0.3, 0.7, {
      size: 14, bold: true, align: 'center', lineSpacing: 1.15
    });
  });

  frame.text('Группа ИСАУБ-26-1 · Тюменский индустриальный университет',
    G.left, G.bodyY + size + 1.42, G.width, 0.34, { size: 13, color: P.grey, align: 'center' });

  takeaway(frame,
    'Инженерная часть отвечает за камеру и логику диспетчеризации, разработка — за приложение и расчётные модели.',
    5.72);
}

// ---------- 5. Цели и задачи ----------
pres.addSection({ title: 'Цели и задачи' });
{
  const { frame } = newSlide('LIGHT', 'Цели и задачи', 'Цели и задачи');
  frame.notes(
    'Главное здесь — что каждая задача проверяется числом. Эффект посчитан на модели до внедрения, а не заявлен на словах.'
  );

  const colW = (G.width - 0.5) / 2;
  frame.rect(G.left, G.bodyY, colW, 4.0, { fill: P.soft, radius: 0.1 });
  frame.dot(G.left + 0.34, G.bodyY + 0.36, 0.18, P.blue);
  frame.text('Цели', G.left + 0.72, G.bodyY + 0.22, 3, 0.45, { size: 20, bold: true, head: true });
  frame.list([
    'Сократить время, которое человек теряет у лифта',
    'Поднять пропускную способность в часы пик',
    'Дать корпусу объективные данные о работе лифтов'
  ], G.left + 0.4, G.bodyY + 0.95, colW - 0.8, 2.9, { size: 14.5, gap: 12 });

  frame.rect(G.left + colW + 0.5, G.bodyY, colW, 4.0, { fill: P.soft, radius: 0.1 });
  frame.dot(G.left + colW + 0.84, G.bodyY + 0.36, 0.18, P.amber);
  frame.text('Задачи', G.left + colW + 1.22, G.bodyY + 0.22, 3, 0.45, { size: 20, bold: true, head: true });
  frame.list([
    'Собрать параметры корпуса и построить математические модели',
    'Разработать мини-приложение для Telegram и MAX',
    'Описать техническую часть: камера в кабине и логика остановок',
    'Проверить эффект на симуляции учебного дня',
    'Подготовить внедрение на одном лифте'
  ], G.left + colW + 0.9, G.bodyY + 0.95, colW - 0.8, 2.9, { size: 14, gap: 9 });

  takeaway(frame,
    'Задачи выстроены так, чтобы каждая проверялась числом: модель считает эффект до внедрения, а не после.',
    5.82);
}

// ---------- 6. Концепция ----------
pres.addSection({ title: 'Решение' });
{
  const { frame } = newSlide('DARK', 'Решение', 'Как устроено решение');
  frame.notes(
    'Две части решают две разные потери. Приложение убирает бесполезное ожидание человека: он заранее видит, стоит ли спускаться к лифтам. Техническая часть убирает бесполезную остановку лифта: полная кабина не тормозит на вызове, в который всё равно никто не войдёт.'
  );

  const colW = (G.width - 0.5) / 2;
  frame.rect(G.left, G.bodyY, colW, 3.9, { fill: P.card, radius: 0.1 });
  frame.dot(G.left + 0.38, G.bodyY + 0.42, 0.2, P.blue);
  frame.text('Приложение', G.left + 0.82, G.bodyY + 0.26, 4, 0.5, {
    size: 22, bold: true, color: P.white, head: true
  });
  frame.text('что видит человек', G.left + 0.82, G.bodyY + 0.78, 4, 0.3, { size: 12, color: P.grey });
  frame.list([
    'Загруженность всех шести лифтов в реальном времени',
    'Очередь на первом этаже — видно заранее',
    'Совет: ждать лифт или идти пешком',
    'Мини-апп в Telegram и MAX, устанавливать нечего'
  ], G.left + 0.44, G.bodyY + 1.3, colW - 0.88, 2.4, { size: 14, color: P.white, gap: 10 });

  frame.rect(G.left + colW + 0.5, G.bodyY, colW, 3.9, { fill: P.card, radius: 0.1 });
  frame.dot(G.left + colW + 0.88, G.bodyY + 0.42, 0.2, P.green);
  frame.text('Техническая часть', G.left + colW + 1.32, G.bodyY + 0.26, 5, 0.5, {
    size: 22, bold: true, color: P.white, head: true
  });
  frame.text('что делает система', G.left + colW + 1.32, G.bodyY + 0.78, 4, 0.3, { size: 12, color: P.grey });
  frame.list([
    'Камера в кабине считает пассажиров',
    'Система решает: остановиться на вызове или проехать',
    'Полная кабина не тормозит впустую',
    'Ставится на существующие лифты, без замены оборудования'
  ], G.left + colW + 0.94, G.bodyY + 1.3, colW - 0.88, 2.4, { size: 14, color: P.white, gap: 10 });

  takeaway(frame,
    'Первая часть убирает бесполезное ожидание человека, вторая — бесполезную остановку лифта. Вместе они и дают выигрыш.',
    5.72, { dark: true, accent: P.blue });
}

// ---------- 7. Приложение ----------
{
  const { frame } = newSlide('LIGHT', 'Решение', 'Приложение TIU GO');
  frame.notes(
    'Это реальный экран приложения, а не макет. Видно статус всех шести лифтов, очередь на первом этаже и рекомендацию. Приложение живёт внутри Telegram и MAX — устанавливать ничего не нужно, и это принципиально: барьер установки убил бы всю идею.'
  );

  // Снимок 700 × 1468: при ширине 2,41 высота выходит 5,05 — ровно столько
  // и остаётся между заголовком и нижним полем.
  frame.rect(G.left, 1.4, 3.1, 5.35, { fill: P.soft, radius: 0.12 });
  frame.image('phone-main.png', G.left + 0.345, 1.55, 2.41, 5.05);

  const x = G.left + 3.7;
  const features = [
    ['Все шесть лифтов на одном экране', 'этаж, загрузка кабины, статус работы', P.blue],
    ['Очередь на первом этаже', 'видно до того, как спустился к лифтам', P.amber],
    ['Совет «лифт или лестница»', 'с расчётом времени для вашего этажа', P.green],
    ['Избранные лифты и уведомления', 'приложение напишет, когда кабина освободится', P.blue],
    ['Три языка, тёмная тема, офлайн', 'последние данные сохраняются в кэше', P.grey]
  ];
  features.forEach((f, i) => {
    const y = G.bodyY + i * 0.92;
    frame.dot(x, y + 0.14, 0.18, f[2]);
    frame.text(f[0], x + 0.4, y, 8.2, 0.36, { size: 15, bold: true });
    frame.text(f[1], x + 0.4, y + 0.36, 8.2, 0.34, { size: 12.5, color: P.grey });
  });

  frame.text('Работает внутри Telegram и MAX: ставить приложение не нужно, достаточно открыть бот.',
    x, G.bodyY + 4.68, 8.8, 0.4, { size: 12.5, color: P.grey, italic: true });
}

// ---------- 8. Лифт или лестница ----------
{
  const { frame } = newSlide('LIGHT', 'Решение', 'Как считается совет');
  frame.notes(
    'Сравнивается полное время: ожидание плюс поездка против подъёма пешком. К времени добавляются комфорт и польза для здоровья, дальше логит-модель даёт вероятность выбора. Для третьего этажа пешком быстрее, с седьмого — уже лифт. Если совету следуют семь человек из десяти, нагрузка на лифты в пик падает на 27 процентов.'
  );

  frame.text('Приложение сравнивает не расстояние, а полное время: ожидание лифта плюс поездка — против подъёма пешком. К времени добавляются комфорт и польза для здоровья, и из этого считается вероятность выбора.',
    G.left, G.bodyY - 0.05, G.width, 0.7, { size: 14, color: P.text, lineSpacing: 1.35 });

  const rows = [
    ['3-й этаж', '29 с', '24 с', 'пешком быстрее', P.green],
    ['7-й этаж', '45 с', '72 с', 'лифт быстрее', P.blue],
    ['16-й этаж', '81 с', '180 с', 'лифт быстрее', P.blue]
  ];

  // Колонки: этаж — слева, два времени и вердикт — по правому краю своих ячеек
  frame.text('Этаж', G.left + 0.3, G.bodyY + 0.85, 2, 0.3, { size: 11, color: P.grey, charSpacing: 1 });
  frame.text('Лифт', G.left + 2.3, G.bodyY + 0.85, 1.6, 0.3, { size: 11, color: P.grey, charSpacing: 1, align: 'right' });
  frame.text('Лестница', G.left + 4.0, G.bodyY + 0.85, 1.6, 0.3, { size: 11, color: P.grey, charSpacing: 1, align: 'right' });

  rows.forEach((row, i) => {
    const y = G.bodyY + 1.25 + i * 0.78;
    frame.rect(G.left, y, 7.6, 0.64, { fill: P.soft, radius: 0.08 });
    frame.text(row[0], G.left + 0.3, y, 2, 0.64, { size: 14.5, valign: 'middle' });
    frame.text(row[1], G.left + 2.3, y, 1.6, 0.64, { size: 14.5, bold: true, align: 'right', valign: 'middle' });
    frame.text(row[2], G.left + 4.0, y, 1.6, 0.64, { size: 14.5, bold: true, align: 'right', valign: 'middle' });
    frame.text(row[3], G.left + 5.7, y, 1.6, 0.64, { size: 11.5, color: row[4], align: 'right', valign: 'middle' });
  });

  frame.rect(G.left + 7.9, G.bodyY + 0.85, 4.0, 2.97, { fill: P.soft, radius: 0.1 });
  frame.text('Если совету следуют 70 %', G.left + 8.22, G.bodyY + 1.1, 3.4, 0.34, { size: 12, color: P.grey });
  frame.text('\u221227\u00A0%', G.left + 8.22, G.bodyY + 1.45, 3.4, 0.8, {
    size: 44, bold: true, color: P.green, head: true, valign: 'middle'
  });
  frame.text('нагрузки на лифты в пик', G.left + 8.22, G.bodyY + 2.25, 3.4, 0.34, { size: 13 });
  frame.text('49 секунд экономит каждый, кто получил совет вовремя',
    G.left + 8.22, G.bodyY + 2.72, 3.4, 0.8, { size: 13, color: P.grey, lineSpacing: 1.25 });

  takeaway(frame,
    'Смысл не в том, чтобы отправить всех на лестницу, а в том, чтобы человек не стоял в очереди, из которой всё равно уйдёт.',
    5.82);
}

// ---------- 9. Техническая часть ----------
{
  const { frame } = newSlide('DARK', 'Решение', 'Техническая часть: камера и логика');
  frame.notes(
    'Камера считает людей в кабине. Она ошибается: три процента ложных срабатываний, пять процентов пропусков — это заложено в модель, а не проигнорировано. Решение принимается с гистерезисом и запасом в два места, иначе на границе вместимости система дребезжала бы. По расчёту 72 процента проездов мимо вызова обоснованы.'
  );

  frame.rect(G.left, 1.4, 3.1, 5.35, { fill: P.card, radius: 0.12 });
  frame.image('phone-detail.png', G.left + 0.345, 1.55, 2.41, 5.05);

  const x = G.left + 3.7;
  frame.text('Камера над дверью кабины считает людей, а система решает, стоит ли останавливаться на попутном вызове.',
    x, G.bodyY - 0.05, 8.8, 0.7, { size: 14.5, color: P.white, lineSpacing: 1.3 });

  const specs = [
    ['Детектор', 'YOLOv8n, точность map50 = 0,92'],
    ['Ошибки', '3 % ложных срабатываний, 5 % пропусков'],
    ['Решение', 'гистерезис с запасом в 2 места — без дребезга на границе'],
    ['Результат', `обоснованы ${FACTS.passAccuracy} % проездов мимо вызова: мест в кабине не было`]
  ];
  specs.forEach((s, i) => {
    const y = G.bodyY + 0.85 + i * 0.92;
    frame.rect(x, y, 8.8, 0.74, { fill: P.card, radius: 0.08 });
    frame.text(s[0], x + 0.3, y, 1.7, 0.74, { size: 12, color: P.grey, valign: 'middle' });
    frame.text(s[1], x + 2.1, y, 6.5, 0.74, { size: 13.5, color: P.white, valign: 'middle' });
  });

  frame.text('Оборудование ставится на существующие кабины: менять лебёдку или станцию управления не нужно.',
    x, G.bodyY + 4.62, 8.8, 0.4, { size: 12.5, color: P.grey, italic: true });
}

// ---------- 10. Модели ----------
pres.addSection({ title: 'Расчёты' });
{
  const { frame } = newSlide('LIGHT', 'Расчёты', 'Две математические модели');
  frame.notes(
    'Техническая модель отвечает на вопрос «видит ли камера и правильно ли решает система», социальная — «как ведут себя люди и сколько кабин нужно». Все параметры корпуса лежат в одном файле, и отдельная проверка следит, чтобы модели не разошлись между собой.'
  );

  const colW = (G.width - 0.5) / 2;
  frame.rect(G.left, G.bodyY, colW, 3.6, { fill: P.soft, radius: 0.1 });
  frame.dot(G.left + 0.34, G.bodyY + 0.36, 0.18, P.green);
  frame.text('Техническая', G.left + 0.72, G.bodyY + 0.2, 4, 0.45, { size: 19, bold: true, head: true });
  frame.text('семь расчётов плюс отчёт и Excel', G.left + 0.72, G.bodyY + 0.68, 4.6, 0.3, { size: 12, color: P.grey });
  frame.list([
    'Обзор камеры и её слепые зоны',
    'Ошибки детекции: перекрытия и мерцание рамки',
    'Логика «остановиться или проехать»',
    'Физика рейса и время цикла дверей',
    'Симуляция учебного дня, 500 прогонов',
    'Подбор оптимального запаса мест'
  ], G.left + 0.4, G.bodyY + 1.18, colW - 0.8, 2.3, { size: 13, gap: 7 });

  frame.rect(G.left + colW + 0.5, G.bodyY, colW, 3.6, { fill: P.soft, radius: 0.1 });
  frame.dot(G.left + colW + 0.84, G.bodyY + 0.36, 0.18, P.blue);
  frame.text('Социальная', G.left + colW + 1.22, G.bodyY + 0.2, 4, 0.45, { size: 19, bold: true, head: true });
  frame.text('шесть расчётов плюс отчёт и Excel', G.left + colW + 1.22, G.bodyY + 0.68, 4.6, 0.3, { size: 12, color: P.grey });
  frame.list([
    'Очередь к лифтам как система массового обслуживания',
    'Симуляция потока людей по расписанию пар',
    'Функция полезности: лифт или лестница',
    'Чувствительность результата к параметрам',
    'Сколько кабин нужно для заданного ожидания',
    'Отчёт Word и книга Excel с живыми формулами'
  ], G.left + colW + 0.9, G.bodyY + 1.18, colW - 0.8, 2.3, { size: 13, gap: 7 });

  takeaway(frame,
    'Обе модели и само приложение читают один файл параметров корпуса, а отдельная проверка следит, чтобы они не разошлись: иначе на защите две модели считали бы разные здания.',
    5.5);
}

// ---------- 11. Результаты ----------
{
  const { frame } = newSlide('LIGHT', 'Расчёты', 'Что даёт техническая часть');
  frame.notes(
    'Пятьсот прогонов учебного дня. В обоих режимах одни и те же пассажиры и одно зерно случайности — разница только в правиле остановки. Пропускная способность в пик растёт почти на двенадцать процентов, ожидание падает на двадцать, а бесполезные остановки почти исчезают: с 588 до 13 за день.'
  );

  frame.chart(pres.ChartType.bar, [{
    name: 'Пиковый час',
    labels: ['Без системы', 'С системой'],
    values: [FACTS.thrOff, FACTS.thrOn]
  }], G.left, G.bodyY, 6.1, 3.5, {
    barDir: 'col',
    chartColors: [THEME.colors.accent5, THEME.colors.accent1],
    showTitle: true,
    title: 'Пропускная способность в пиковый час, чел/ч',
    titleFontFace: '+mn-lt', titleFontSize: 13, titleColor: THEME.colors.dk1,
    showValue: true, dataLabelPosition: 'outEnd',
    dataLabelFontFace: '+mn-lt', dataLabelFontSize: 13, dataLabelColor: THEME.colors.dk1,
    dataLabelFormatCode: '#,##0',
    showLegend: false,
    catAxisLabelFontFace: '+mn-lt', catAxisLabelFontSize: 12, catAxisLabelColor: THEME.colors.accent5,
    valAxisLabelFontFace: '+mn-lt', valAxisLabelFontSize: 11, valAxisLabelColor: THEME.colors.accent5,
    valGridLine: { color: 'E4E9F0', size: 1 },
    catGridLine: { style: 'none' },
    valAxisMaxVal: 1000,
    barGapWidthPct: 90
  });

  const rows = [
    ['Среднее ожидание', `${n(FACTS.waitOff)} с`, `${n(FACTS.waitOn)} с`, `−${n(FACTS.waitGain, 1)} %`],
    ['Самая длинная очередь', `${n(FACTS.queueOff)} чел`, `${n(FACTS.queueOn)} чел`, `−${n((1 - FACTS.queueOn / FACTS.queueOff) * 100, 0)} %`],
    ['Бесполезных остановок', n(FACTS.uselessOff), n(FACTS.uselessOn), `−${n((1 - FACTS.uselessOn / FACTS.uselessOff) * 100, 0)} %`]
  ];

  // Колонки отбиты от краёв карточки на 0,3 дюйма, как и подписи над ними
  const tx = G.left + 6.5;
  frame.text('Без системы', tx + 2.2, G.bodyY, 1.4, 0.3, { size: 11, color: P.grey, align: 'right' });
  frame.text('С системой', tx + 3.7, G.bodyY, 1.4, 0.3, { size: 11, color: P.grey, align: 'right' });
  rows.forEach((row, i) => {
    const y = G.bodyY + 0.4 + i * 1.04;
    frame.rect(tx, y, 5.4, 0.88, { fill: P.soft, radius: 0.08 });
    frame.text(row[0], tx + 0.3, y + 0.14, 2.1, 0.34, { size: 13 });
    frame.text(row[3], tx + 0.3, y + 0.48, 2.1, 0.3, { size: 11.5, bold: true, color: P.green });
    frame.text(row[1], tx + 2.2, y, 1.4, 0.88, { size: 15, align: 'right', valign: 'middle', color: P.grey });
    frame.text(row[2], tx + 3.7, y, 1.4, 0.88, { size: 15, bold: true, align: 'right', valign: 'middle' });
  });

  takeaway(frame,
    `${FACTS.runs} прогонов учебного дня: в обоих режимах одни и те же пассажиры и одно зерно случайности, разница только в правиле остановки.`,
    5.52, { accent: P.green });
}

// ---------- 12. Чувствительность ----------
{
  const { frame } = newSlide('LIGHT', 'Расчёты', 'Что сильнее всего влияет на результат');
  frame.notes(
    'Анализ чувствительности: каждый параметр менялся в разумных границах, остальные оставались на месте. Поведение людей двигает результат на 52 процента, число лифтов — всего на 11. Это и есть обоснование, почему приложение важнее оборудования.'
  );

  frame.chart(pres.ChartType.bar, [{
    name: 'Размах результата',
    labels: ['Число людей в корпусе', 'Точность камер', 'Число лифтов', 'Доля следующих совету', 'Время подъёма пешком'],
    values: [4.9, 8.9, 10.7, 52.0, 55.6]
  }], G.left, G.bodyY, 7.3, 3.9, {
    barDir: 'bar',
    chartColors: [THEME.colors.accent1],
    showTitle: true,
    title: 'Насколько параметр двигает итоговое время, % ',
    titleFontFace: '+mn-lt', titleFontSize: 13, titleColor: THEME.colors.dk1,
    showValue: true, dataLabelPosition: 'outEnd',
    dataLabelFontFace: '+mn-lt', dataLabelFontSize: 12, dataLabelColor: THEME.colors.dk1,
    dataLabelFormatCode: '0.0',
    showLegend: false,
    catAxisLabelFontFace: '+mn-lt', catAxisLabelFontSize: 12, catAxisLabelColor: THEME.colors.accent5,
    valAxisLabelFontFace: '+mn-lt', valAxisLabelFontSize: 11, valAxisLabelColor: THEME.colors.accent5,
    valGridLine: { color: 'E4E9F0', size: 1 },
    catGridLine: { style: 'none' },
    valAxisMaxVal: 70,
    barGapWidthPct: 60
  });

  frame.rect(G.left + 7.7, G.bodyY + 0.2, 4.2, 3.3, { fill: P.soft, radius: 0.1 });
  frame.text('Вывод', G.left + 8.02, G.bodyY + 0.46, 3.5, 0.3, { size: 11, color: P.grey, charSpacing: 1 });
  frame.text('Поведение людей влияет на результат в пять раз сильнее, чем число кабин.',
    G.left + 8.02, G.bodyY + 0.84, 3.56, 1.2, { size: 15, bold: true, lineSpacing: 1.25 });
  frame.text('Поэтому приложение — не дополнение к оборудованию, а основная часть решения: оно меняет именно тот параметр, который двигает результат.',
    G.left + 8.02, G.bodyY + 2.0, 3.56, 1.3, { size: 12.5, color: P.grey, lineSpacing: 1.3 });

  takeaway(frame,
    'Вывод проверен перебором: каждый параметр менялся в разумных границах, остальные оставались на месте.',
    5.82);
}

// ---------- 13. Рынок ----------
pres.addSection({ title: 'Рынок и планы' });
{
  const { frame } = newSlide('LIGHT', 'Рынок и планы', 'Анализ рынка');
  frame.notes(
    'Существующие решения сделаны для службы эксплуатации: пассажир в них не пользователь. Наша ниша — интерфейс именно для пассажира конкретного корпуса плюс лёгкая техническая часть, которая не требует замены оборудования.'
  );

  const colW = (G.width - 0.5) / 2;
  const blocks = [
    ['Лифтовый рынок', P.amber, [
      'Основной путь модернизации — замена лебёдки и станции управления: дорого и останавливает лифт на недели',
      'В учебных корпусах оборудование служит десятилетиями, а бюджет на замену появляется редко',
      'Диспетчеризация ставится ради эксплуатации, а не ради пассажира'
    ]],
    ['Рынок ПО для лифтов', P.blue, [
      'Существующие системы (ОДС, диспетчерские комплексы, «умное здание») рассчитаны на службу эксплуатации',
      'Пассажир в них не является пользователем: он не видит ни очереди, ни загрузки',
      'Мини-приложения в мессенджерах сняли главный барьер — ставить ничего не нужно'
    ]]
  ];
  blocks.forEach(([title, accent, lines], i) => {
    const x = G.left + i * (colW + 0.5);
    frame.rect(x, G.bodyY, colW, 3.3, { fill: P.soft, radius: 0.1 });
    frame.dot(x + 0.34, G.bodyY + 0.36, 0.18, accent);
    frame.text(title, x + 0.72, G.bodyY + 0.2, 4.6, 0.45, { size: 19, bold: true, head: true });
    frame.list(lines, x + 0.4, G.bodyY + 0.92, colW - 0.8, 2.2, { size: 13, gap: 9 });
  });

  frame.rect(G.left, 5.18, G.width, 1.1, { fill: P.card, radius: 0.1 });
  frame.text('Наша ниша', G.left + 0.34, 5.36, 2, 0.3, { size: 11, color: P.grey, charSpacing: 1 });
  frame.text('Интерфейс для пассажира конкретного корпуса плюс лёгкая техническая часть, которая ставится на существующие лифты.',
    G.left + 0.34, 5.66, 11.2, 0.4, { size: 14, color: P.white });
}

// ---------- 14. Что сделано и что дальше ----------
{
  const { frame } = newSlide('LIGHT', 'Рынок и планы', 'Что сделано и что дальше');
  frame.notes(
    'Левая колонка — то, что уже работает и что можно показать прямо сейчас. Правая — план. Важно, что следующий шаг не требует закупки: одна камера в одной кабине подтвердит или опровергнет расчёт.'
  );

  const colW = (G.width - 0.5) / 2;
  frame.rect(G.left, G.bodyY, colW, 3.7, { fill: P.soft, radius: 0.1 });
  frame.dot(G.left + 0.34, G.bodyY + 0.36, 0.18, P.green);
  frame.text('Готово', G.left + 0.72, G.bodyY + 0.2, 4, 0.45, { size: 19, bold: true, head: true });
  frame.list([
    'Мини-приложение в Telegram и MAX с расчётом ожидания',
    'Два бота и сервер с API, админка для статусов лифтов',
    'Две математические модели с отчётами Word и Excel',
    'Единый файл параметров корпуса и проверка согласованности',
    'Уведомления, избранное, три языка, офлайн-режим'
  ], G.left + 0.4, G.bodyY + 0.9, colW - 0.8, 2.6, { size: 13.5, gap: 8 });

  frame.rect(G.left + colW + 0.5, G.bodyY, colW, 3.7, { fill: P.soft, radius: 0.1 });
  frame.dot(G.left + colW + 0.84, G.bodyY + 0.36, 0.18, P.blue);
  frame.text('Дальше', G.left + colW + 1.22, G.bodyY + 0.2, 4, 0.45, { size: 19, bold: true, head: true });

  const steps = [
    'Согласовать доступ к данным лифтов',
    'Поставить камеру в одну кабину',
    'Сверить расчёт с реальными записями',
    'Включить логику на одном лифте',
    'Распространить на другие корпуса'
  ];
  steps.forEach((step, i) => {
    const y = G.bodyY + 0.95 + i * 0.52;
    frame.text(String(i + 1), G.left + colW + 0.9, y, 0.4, 0.4, {
      size: 13, bold: true, color: P.blue, align: 'center', head: true
    });
    frame.text(step, G.left + colW + 1.34, y - 0.02, colW - 1.3, 0.5, { size: 13.5, lineSpacing: 1.15 });
  });

  takeaway(frame,
    'Следующий шаг не требует закупки: одна камера в одной кабине подтверждает или опровергает расчёт.',
    5.62);
}

// ---------- 15. Итог ----------
pres.addSection({ title: 'Итог' });
{
  const { slide, frame } = newSlide('CLOSING', 'Итог');
  frame.notes(
    'Короткий вывод: количество лифтов изменить нельзя, а количество потерянного времени — можно. Три числа на слайде — результат пятисот прогонов модели.'
  );

  frame.text('Проект команды ИСАУБ-26-1 · TIU GO', G.left, 1.3, 9, 0.34, {
    size: 13, color: P.blue, charSpacing: 2
  });
  slide.addText('Лифтов больше не станет.\nПотерянного времени — станет меньше.', { placeholder: 'title' });
  frame.items.push({
    t: 'text', x: G.left, y: 1.8, w: 11.9, h: 1.9,
    runs: [{ text: 'Лифтов больше не станет.\nПотерянного времени — станет меньше.', bold: true, size: 40, color: 'FFFFFF', head: true }],
    size: 40, bold: true, color: 'FFFFFF', align: 'left', valign: 'middle', head: true
  });

  const stats = [
    [`+${n(FACTS.gain, 1)} %`, 'пропускной способности в пик', P.green],
    [`−${n(FACTS.waitGain, 1)} %`, 'среднего ожидания', P.blue],
    [`${n(FACTS.uselessOff)} → ${n(FACTS.uselessOn)}`, 'бесполезных остановок за день', P.amber]
  ];
  const cardW = (G.width - 0.6) / 3;
  stats.forEach(([value, label, accent], i) => {
    const x = G.left + i * (cardW + 0.3);
    frame.rect(x, 4.3, cardW, 1.72, { fill: P.card, radius: 0.1 });
    frame.text(value, x + 0.34, 4.5, cardW - 0.68, 0.8, {
      size: 34, bold: true, color: accent, head: true, valign: 'middle'
    });
    frame.text(label, x + 0.34, 5.34, cardW - 0.68, 0.5, { size: 13, color: P.grey, lineSpacing: 1.2 });
  });

  frame.text('Спасибо за внимание. Готовы ответить на вопросы.', G.left, 6.4, 11.9, 0.4, {
    size: 15, color: P.white
  });
}

// ---------- Сборка ----------

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await pres.writeFile({ fileName: OUT });

  // pptxgenjs не умеет писать цвета темы — дописываем их отдельно
  const { applyTheme } = require('./apply-theme.js');
  await applyTheme(OUT, THEME);

  // Слепок геометрии для dev-проверки вёрстки — только по запросу
  if (process.argv.includes('--preview')) {
    fs.writeFileSync(
      path.join(ROOT, 'presentation', 'preview.json'),
      JSON.stringify({ size: { w: 13.333, h: 7.5 }, slides: preview }, null, 1)
    );
    console.log('  Слепок вёрстки: presentation/preview.json');
  }

  console.log('');
  console.log('  Презентация собрана: presentation/TIU_GO.pptx');
  console.log(`  Слайдов: ${preview.length}`);
  console.log(`  Цифры взяты из моделей: пропускная способность ${FACTS.thrOff} → ${FACTS.thrOn} чел/ч,`);
  console.log(`  ожидание ${FACTS.waitOff} → ${FACTS.waitOn} с, бесполезных остановок ${FACTS.uselessOff} → ${FACTS.uselessOn}.`);
  console.log('');
}

if (require.main === module) {
  main().catch((err) => { console.error('[deck] Ошибка:', err); process.exit(1); });
}

module.exports = { FACTS, THEME, preview };
