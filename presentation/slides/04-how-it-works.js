/**
 * Слайд 4 — как это работает.
 *
 * Четыре шага конвейера в ряд со стрелками между ними и отдельный блок
 * про персональные данные: на защите это первый вопрос из зала.
 */

const { card, text, colors, fonts, grid, type } = require('../lib/layout');

module.exports = function howItWorksSlide(pres, deck, content) {
  const c = content.slides.howItWorks;
  const slide = deck.slide(c.title, c.lede);

  const count = c.pipeline.length;
  const arrow = 0.42;
  const w = (grid.contentWidth - arrow * (count - 1)) / count;
  const h = 2.2;

  c.pipeline.forEach((step, i) => {
    const x = grid.left + i * (w + arrow);
    card(pres, slide, { x, y: grid.bodyY, w, h });

    // Номер шага — крупной полупрозрачной цифрой в углу
    text(slide, step.step, {
      x: x + w - 0.86, y: grid.bodyY + 0.16, w: 0.62, h: 0.42,
      fontSize: 26, bold: true, color: colors.line, align: 'right', fontFace: fonts.head
    });

    text(slide, step.title, {
      x: x + 0.28, y: grid.bodyY + 0.3, w: w - 1.1, h: 0.36,
      fontSize: type.cardTitle + 2, bold: true, color: colors.label
    });

    text(slide, step.text, {
      x: x + 0.28, y: grid.bodyY + 0.78, w: w - 0.56, h: 0.52,
      fontSize: type.body, color: colors.accent, lineSpacingMultiple: 1.2
    });

    text(slide, step.note, {
      x: x + 0.28, y: grid.bodyY + 1.34, w: w - 0.56, h: h - 1.6,
      fontSize: type.small, color: colors.label3, lineSpacingMultiple: 1.2
    });

    // Стрелка к следующему шагу
    if (i < count - 1) {
      text(slide, '→', {
        x: x + w, y: grid.bodyY + h / 2 - 0.22, w: arrow, h: 0.44,
        fontSize: 20, bold: true, color: colors.label3, align: 'center', valign: 'middle'
      });
    }
  });

  // Персональные данные
  const y = grid.bodyY + h + 0.3;
  card(pres, slide, { x: grid.left, y, w: 7.9, h: 1.46, fill: colors.cardSoft });

  text(slide, c.privacy.title.toUpperCase(), {
    x: grid.left + 0.34, y: y + 0.24, w: 7.2, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.ok, charSpacing: 1.2
  });

  text(slide, c.privacy.text, {
    x: grid.left + 0.34, y: y + 0.58, w: 7.22, h: 0.78,
    fontSize: type.body, color: colors.label2, lineSpacingMultiple: 1.22
  });

  // Стек
  card(pres, slide, { x: grid.left + 8.2, y, w: grid.contentWidth - 8.2, h: 1.46, fill: colors.cardSoft });

  text(slide, 'СТЕК', {
    x: grid.left + 8.54, y: y + 0.24, w: 3, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.accent, charSpacing: 1.2
  });

  text(slide, c.stack, {
    x: grid.left + 8.54, y: y + 0.58, w: grid.contentWidth - 8.88, h: 0.78,
    fontSize: type.small, color: colors.label2, lineSpacingMultiple: 1.25
  });
};
