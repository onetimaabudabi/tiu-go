/**
 * TIU GO — слой рисования поверх pptxgenjs.
 *
 * Слайды в slides/ оперируют карточками, метриками и списками, а не
 * координатами прямоугольников. Вся геометрия и все цвета живут здесь
 * и в theme.js, поэтому поправить отступ во всей колоде — одна правка.
 */

const fs = require('fs');
const { colors, fonts, grid, type, shape, footerText } = require('../theme');

/** Цвет по имени тона: tone: 'ok' | 'full' | 'accent' | … */
function toneColor(tone) {
  return colors[tone] || colors[`${tone}`] || colors.accent;
}

/**
 * Обёртка над презентацией: мастера, сетка, вспомогательные фигуры.
 */
class Deck {
  constructor(pres, options = {}) {
    this.pres = pres;
    this.logo = options.logo && fs.existsSync(options.logo) ? options.logo : null;
    this.total = options.total || 12;
    this.index = 0;

    pres.defineLayout({ name: 'TIU16x9', width: grid.width, height: grid.height });
    pres.layout = 'TIU16x9';
    pres.theme = { headFontFace: fonts.head, bodyFontFace: fonts.body };

    this.#defineMasters();
  }

  #logoObject() {
    if (!this.logo) return [];
    const h = 0.46;
    const w = h * 1.249;   // пропорции эмблемы из исходного файла
    return [{ image: { path: this.logo, x: grid.right - w, y: 0.4, w, h } }];
  }

  #defineMasters() {
    const { pres } = this;

    // Титульный: без подвала и без номера — он там лишний.
    pres.defineSlideMaster({
      title: 'COVER',
      background: { color: colors.bg },
      objects: []
    });

    // Рабочий слайд: заголовок, подпись внизу, номер, логотип.
    pres.defineSlideMaster({
      title: 'MAIN',
      background: { color: colors.bg },
      objects: [
        ...this.#logoObject(),
        {
          text: {
            text: footerText,
            options: {
              x: grid.left, y: grid.footerY, w: 7, h: grid.footerH,
              fontSize: type.caption, color: colors.label3, fontFace: fonts.body,
              align: 'left', valign: 'middle', margin: 0, isTextBox: true
            }
          }
        }
      ],
      slideNumber: {
        x: grid.right - 1, y: grid.footerY, w: 1, h: grid.footerH,
        fontSize: type.caption, color: colors.label3, fontFace: fonts.body, align: 'right'
      }
    });
  }

  /** Новый рабочий слайд с заголовком и подзаголовком. */
  slide(title, lede) {
    this.index += 1;
    const slide = this.pres.addSlide({ masterName: 'MAIN' });

    if (title) {
      slide.addText(title, {
        x: grid.left, y: grid.titleY, w: grid.contentWidth - 1, h: grid.titleH,
        fontSize: type.title, bold: true, color: colors.label, fontFace: fonts.head,
        align: 'left', valign: 'middle', margin: 0, isTextBox: true
      });
    }

    if (lede) {
      slide.addText(lede, {
        x: grid.left, y: grid.ledeY, w: grid.contentWidth - 1.2, h: grid.ledeH + 0.2,
        fontSize: type.lede, color: colors.label2, fontFace: fonts.body,
        align: 'left', valign: 'top', margin: 0, isTextBox: true, lineSpacingMultiple: 1.2
      });
    }

    return slide;
  }

  /** Титульный слайд: отдельный мастер, свои правила. */
  cover() {
    this.index += 1;
    return this.pres.addSlide({ masterName: 'COVER' });
  }
}

// ---------- Фигуры ----------

/** Карточка: скруглённый прямоугольник с тонкой рамкой. */
function card(pres, slide, { x, y, w, h, fill = colors.card, line = colors.line, radius = 0.14 }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: fill },
    line: line ? { color: line, width: shape.lineWidth } : { type: 'none' },
    rectRadius: radius
  });
}

/** Полоска-акцент слева от карточки: цветом показываем тон блока. */
function accentBar(pres, slide, { x, y, h, color, w = 0.045 }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, fill: { color }, line: { type: 'none' }, rectRadius: 0.03
  });
}

/** Текст с настройками по умолчанию из темы. */
function text(slide, content, options = {}) {
  slide.addText(content, {
    fontFace: fonts.body, color: colors.label, margin: 0, isTextBox: true,
    align: 'left', valign: 'top', ...options
  });
}

/**
 * Карточка-метрика: крупное число, подпись и пояснение.
 * Это основной кирпич колоды — им собраны слайды 2, 7 и 11.
 */
function metric(pres, slide, { x, y, w, h, value, unit, label, caption, tone = 'accent', size = type.metric, labelSize = type.cardTitle }) {
  const color = toneColor(tone);
  card(pres, slide, { x, y, w, h });
  accentBar(pres, slide, { x: x + 0.001, y: y + 0.18, h: h - 0.36, color });

  const padX = x + 0.28;
  const innerW = w - 0.52;
  const valueH = size / 72 + 0.1;

  const runs = [{ text: String(value), options: { fontSize: size, bold: true, color, fontFace: fonts.head } }];
  if (unit) {
    runs.push({ text: ` ${unit}`, options: { fontSize: Math.round(size * 0.42), bold: true, color: colors.label2, fontFace: fonts.head } });
  }

  text(slide, runs, { x: padX, y: y + 0.14, w: innerW, h: valueH, valign: 'middle' });

  const labelY = y + 0.14 + valueH + 0.1;
  text(slide, label, {
    x: padX, y: labelY, w: innerW, h: 0.3,
    fontSize: labelSize, bold: true, color: colors.label
  });

  if (caption) {
    text(slide, caption, {
      x: padX, y: labelY + 0.32, w: innerW, h: y + h - labelY - 0.44,
      fontSize: type.small, color: colors.label3, lineSpacingMultiple: 1.18
    });
  }
}

/**
 * Карточка с заголовком и абзацем. Над заголовком — мелкая надпись-ярлык.
 */
function textCard(pres, slide, { x, y, w, h, kicker, title, body, tone = 'accent', bodySize = type.body }) {
  const color = toneColor(tone);
  card(pres, slide, { x, y, w, h });

  const padX = x + 0.32;
  const innerW = w - 0.64;
  let cursor = y + 0.3;

  if (kicker) {
    text(slide, kicker.toUpperCase(), {
      x: padX, y: cursor, w: innerW, h: 0.24,
      fontSize: type.caption, bold: true, color, charSpacing: 1.2
    });
    cursor += 0.34;
  }

  if (title) {
    text(slide, title, {
      x: padX, y: cursor, w: innerW, h: 0.34,
      fontSize: type.cardTitle + 1, bold: true, color: colors.label
    });
    cursor += 0.46;
  }

  if (body) {
    text(slide, body, {
      x: padX, y: cursor, w: innerW, h: y + h - cursor - 0.26,
      fontSize: bodySize, color: colors.label2, lineSpacingMultiple: 1.26
    });
  }
}

/**
 * Список с маркерами-точками. Маркер рисуем символом, а не bullet:true —
 * так одинаково выглядит и в PowerPoint, и в просмотрщиках попроще.
 */
function bullets(slide, items, { x, y, w, h, size = type.body, color = colors.label2, marker = '\u00B7' }) {
  const runs = items.map((item, i) => ({
    text: `${marker}\u2003${item}`,
    options: {
      fontSize: size, color, fontFace: fonts.body,
      breakLine: i < items.length - 1, paraSpaceAfter: size * 0.45
    }
  }));
  // Высоту блока задаёт слайд: только он знает, сколько места осталось.
  // Запасной расчёт исходит из полутора строк на пункт — для коротких списков.
  const fallback = items.length * (size / 72) * 1.9 + 0.2;
  text(slide, runs, { x, y, w, h: h || fallback, lineSpacingMultiple: 1.22 });
}

/** Ярлык-пилюля: короткий текст в скруглённой плашке. */
function pill(pres, slide, { x, y, w, h, label, color = colors.accent, fill }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: fill || colors.cardSoft },
    line: { color, width: 1 },
    rectRadius: h / 2
  });
  text(slide, label, {
    x, y, w, h, fontSize: type.small, bold: true, color,
    align: 'center', valign: 'middle'
  });
}

/**
 * Картинка с запасным вариантом: нет файла — рисуем заглушку,
 * чтобы сборка не падала и было видно, чего не хватает.
 */
function image(pres, slide, { file, x, y, w, h, placeholder = 'нет файла', radius = 0.14 }) {
  if (file && fs.existsSync(file)) {
    slide.addImage({ path: file, x, y, w, h, sizing: { type: 'contain', w, h } });
    return true;
  }
  card(pres, slide, { x, y, w, h, fill: colors.cardSoft, line: colors.line, radius });
  text(slide, placeholder, {
    x, y, w, h, fontSize: type.small, color: colors.label3,
    align: 'center', valign: 'middle'
  });
  return false;
}

/** Общие настройки диаграмм: тёмный фон, светлые подписи. */
function chartBase() {
  return {
    chartColors: [colors.full, colors.ok],
    showLegend: true,
    legendPos: 'b',
    legendColor: colors.label2,
    legendFontSize: type.small,
    legendFontFace: fonts.body,
    catAxisLabelColor: colors.label2,
    catAxisLabelFontSize: type.small,
    catAxisLabelFontFace: fonts.body,
    catAxisLineShow: false,
    valAxisLabelColor: colors.label3,
    valAxisLabelFontSize: type.caption,
    valAxisLabelFontFace: fonts.body,
    valAxisLineShow: false,
    valGridLine: { color: colors.line, style: 'solid', size: 1 },
    dataLabelColor: colors.label,
    dataLabelFontSize: type.caption,
    dataLabelFontFace: fonts.body,
    border: { pt: 0, color: colors.bg },
    fill: colors.card,
    plotArea: { fill: { color: colors.card } },
    chartArea: { fill: { color: colors.card }, border: { pt: 0, color: colors.card } }
  };
}

module.exports = {
  Deck, card, accentBar, text, metric, textCard, bullets, pill, image,
  chartBase, toneColor, colors, fonts, grid, type
};
