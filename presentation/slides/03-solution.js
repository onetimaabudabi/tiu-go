/**
 * Слайд 3 — решение.
 *
 * Три карточки отвечают на три вопроса подряд: что человек видит,
 * что получает и что при этом делает лифт.
 */

const { textCard, card, text, bullets, colors, grid, type } = require('../lib/layout');

module.exports = function solutionSlide(pres, deck, content) {
  const c = content.slides.solution;
  const slide = deck.slide(c.title, c.lede);

  const w = (grid.contentWidth - grid.gap * 2) / 3;
  c.cards.forEach((item, i) => {
    textCard(pres, slide, {
      x: grid.left + i * (w + grid.gap), y: grid.bodyY, w, h: 2.68,
      kicker: item.icon, title: item.title, body: item.text, tone: item.tone
    });
  });

  // Почему это выигрывает у вендорских систем
  const y = grid.bodyY + 2.94;
  card(pres, slide, { x: grid.left, y, w: grid.contentWidth, h: 1.62, fill: colors.cardSoft });

  text(slide, 'ПОЧЕМУ ЭТО РАБОТАЕТ ТАМ, ГДЕ ДОРОГИЕ СИСТЕМЫ НЕ СТАВЯТ', {
    x: grid.left + 0.34, y: y + 0.24, w: grid.contentWidth - 0.68, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.ok, charSpacing: 1.2
  });

  bullets(slide, c.edge, {
    x: grid.left + 0.34, y: y + 0.6, w: grid.contentWidth - 0.68,
    h: 1.0, size: type.body, color: colors.label2
  });
};
