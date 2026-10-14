/**
 * Слайд 8 — обратная связь.
 *
 * Результатов опроса пока нет, и слайд это прямо говорит: показан
 * инструмент, план сбора и пустые поля под цифры. Придумывать проценты
 * на слайде для инвестора — худшее, что можно сделать.
 */

const { card, text, bullets, colors, grid, type } = require('../lib/layout');

module.exports = function surveySlide(pres, deck, content) {
  const c = content.slides.survey;
  const slide = deck.slide(c.title, c.lede);

  const colW = (grid.contentWidth - grid.gap * 2) / 3;
  const colH = 3.12;

  // Инструмент
  card(pres, slide, { x: grid.left, y: grid.bodyY, w: colW, h: colH });
  text(slide, c.instrument.title.toUpperCase(), {
    x: grid.left + 0.32, y: grid.bodyY + 0.26, w: colW - 0.64, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.accent, charSpacing: 1.2
  });
  bullets(slide, c.instrument.items, {
    x: grid.left + 0.32, y: grid.bodyY + 0.64, w: colW - 0.64,
    h: colH - 1.14, size: 11, color: colors.label2
  });
  text(slide, c.instrument.file, {
    x: grid.left + 0.32, y: grid.bodyY + colH - 0.44, w: colW - 0.64, h: 0.26,
    fontSize: type.caption, color: colors.label3
  });

  // План сбора
  const planX = grid.left + colW + grid.gap;
  card(pres, slide, { x: planX, y: grid.bodyY, w: colW, h: colH });
  text(slide, c.plan.title.toUpperCase(), {
    x: planX + 0.32, y: grid.bodyY + 0.26, w: colW - 0.64, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.busy, charSpacing: 1.2
  });
  bullets(slide, c.plan.items, {
    x: planX + 0.32, y: grid.bodyY + 0.64, w: colW - 0.64,
    h: colH - 1.0, size: 11, color: colors.label2
  });

  // Поля под результаты
  const resX = planX + colW + grid.gap;
  card(pres, slide, { x: resX, y: grid.bodyY, w: colW, h: colH, fill: colors.cardSoft });
  text(slide, 'РЕЗУЛЬТАТЫ', {
    x: resX + 0.32, y: grid.bodyY + 0.26, w: colW - 0.64, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.label3, charSpacing: 1.2
  });

  c.results.forEach((row, i) => {
    const ry = grid.bodyY + 0.66 + i * 0.58;
    text(slide, row.metric, {
      x: resX + 0.32, y: ry, w: colW - 1.92, h: 0.42,
      fontSize: type.small, color: colors.label2, lineSpacingMultiple: 1.1
    });
    text(slide, row.value, {
      x: resX + colW - 1.3, y: ry, w: 0.98, h: 0.3,
      fontSize: type.small, bold: true, color: colors.busy, align: 'right'
    });
    slide.addShape(pres.ShapeType.rect, {
      x: resX + 0.32, y: ry + 0.44, w: colW - 0.64, h: 0.008,
      fill: { color: colors.line }, line: { type: 'none' }
    });
  });

  // Почему слайд всё равно что-то значит
  const y = grid.bodyY + colH + 0.28;
  card(pres, slide, { x: grid.left, y, w: grid.contentWidth, h: 1.12, fill: colors.card });
  text(slide, 'ЧТО УЖЕ ПОДТВЕРЖДЕНО', {
    x: grid.left + 0.34, y: y + 0.22, w: grid.contentWidth - 0.68, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.ok, charSpacing: 1.2
  });
  text(slide, c.note, {
    x: grid.left + 0.34, y: y + 0.54, w: grid.contentWidth - 0.68, h: 0.5,
    fontSize: type.body, color: colors.label2, lineSpacingMultiple: 1.2
  });
};
