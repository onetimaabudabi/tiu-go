/**
 * Слайд 10 — конкуренты.
 *
 * Таблица «кто — для кого — чего не делает» и четыре наших отличия.
 * Последняя строка таблицы — мы, и она подсвечена.
 */

const { card, text, colors, fonts, grid, type } = require('../lib/layout');

module.exports = function competitorsSlide(pres, deck, content) {
  const c = content.slides.competitors;
  const slide = deck.slide(c.title, c.lede);

  const tableW = 7.4;
  const cols = [3.0, 1.5, tableW - 4.5];
  const rowH = 0.56;

  // Шапка
  let y = grid.bodyY;
  c.table.head.forEach((head, i) => {
    const x = grid.left + cols.slice(0, i).reduce((a, b) => a + b, 0);
    text(slide, head.toUpperCase(), {
      x, y, w: cols[i] - 0.14, h: 0.28,
      fontSize: type.caption, bold: true, color: colors.label3, charSpacing: 1.1
    });
  });
  y += 0.36;

  // Строки
  c.table.rows.forEach((row, r) => {
    const own = r === c.table.rows.length - 1;
    if (own) {
      card(pres, slide, {
        x: grid.left - 0.16, y: y - 0.08, w: tableW + 0.16, h: rowH + 0.16,
        fill: colors.cardSoft, line: colors.accent, radius: 0.1
      });
    }

    row.forEach((cell, i) => {
      const x = grid.left + cols.slice(0, i).reduce((a, b) => a + b, 0);
      text(slide, cell, {
        x, y, w: cols[i] - 0.18, h: rowH,
        fontSize: type.small,
        bold: own && i === 0,
        color: own ? (i === 0 ? colors.accent : colors.label) : (i === 0 ? colors.label : colors.label2),
        valign: 'middle', lineSpacingMultiple: 1.1
      });
    });

    if (!own) {
      slide.addShape(pres.ShapeType.rect, {
        x: grid.left, y: y + rowH, w: tableW, h: 0.008,
        fill: { color: colors.line }, line: { type: 'none' }
      });
    }
    y += rowH + 0.16;
  });

  // Наши отличия
  const advX = grid.left + tableW + 0.42;
  const advW = grid.right - advX;
  const advH = 1.0;

  text(slide, 'ЧЕМ МЫ ОТЛИЧАЕМСЯ', {
    x: advX, y: grid.bodyY, w: advW, h: 0.28,
    fontSize: type.caption, bold: true, color: colors.ok, charSpacing: 1.1
  });

  c.advantages.forEach((adv, i) => {
    const ay = grid.bodyY + 0.36 + i * (advH + 0.1);
    card(pres, slide, { x: advX, y: ay, w: advW, h: advH, fill: colors.card });

    text(slide, adv.title, {
      x: advX + 0.28, y: ay + 0.14, w: advW - 0.56, h: 0.28,
      fontSize: type.body, bold: true, color: colors.label
    });

    text(slide, adv.text, {
      x: advX + 0.28, y: ay + 0.42, w: advW - 0.56, h: 0.54,
      fontSize: type.caption, color: colors.label2, lineSpacingMultiple: 1.18
    });
  });
};
