/**
 * Слайд 6 — математическая модель.
 *
 * Две колонки с перечнем расчётов и три вывода внизу. Вывод важнее
 * перечня, поэтому он набран крупнее и вынесен на отдельные карточки.
 */

const { card, text, bullets, colors, grid, type } = require('../lib/layout');

module.exports = function mathSlide(pres, deck, content) {
  const c = content.slides.math;
  const slide = deck.slide(c.title, c.lede);

  // Две колонки с составом моделей
  const colW = (grid.contentWidth - grid.gap) / 2;
  const colH = 3.1;

  c.columns.forEach((column, i) => {
    const x = grid.left + i * (colW + grid.gap);
    card(pres, slide, { x, y: grid.bodyY, w: colW, h: colH });

    text(slide, column.title, {
      x: x + 0.34, y: grid.bodyY + 0.26, w: colW - 0.68, h: 0.32,
      fontSize: type.cardTitle + 1, bold: true, color: colors.label
    });

    text(slide, column.subtitle, {
      x: x + 0.34, y: grid.bodyY + 0.6, w: colW - 0.68, h: 0.26,
      fontSize: type.caption, color: colors.accent
    });

    bullets(slide, column.items, {
      x: x + 0.34, y: grid.bodyY + 0.94, w: colW - 0.68,
      h: colH - 1.14, size: type.small, color: colors.label2
    });
  });

  // Три вывода
  const y = grid.bodyY + colH + 0.16;
  const w = (grid.contentWidth - grid.gap * 2) / 3;
  const tones = ['full', 'accent', 'busy'];

  c.findings.forEach((finding, i) => {
    const x = grid.left + i * (w + grid.gap);
    card(pres, slide, { x, y, w, h: 1.4, fill: colors.cardSoft });

    text(slide, finding.title, {
      x: x + 0.3, y: y + 0.16, w: w - 0.6, h: 0.48,
      fontSize: type.body + 1, bold: true, color: colors[tones[i]], lineSpacingMultiple: 1.1
    });

    text(slide, finding.text, {
      x: x + 0.3, y: y + 0.64, w: w - 0.6, h: 0.6,
      fontSize: type.small, color: colors.label2, lineSpacingMultiple: 1.2
    });
  });
};
