/**
 * Слайд 11 — запрос инвестиций.
 *
 * Смета пилота посчитана по бизнес-расчётам и стоит слева целиком.
 * Строки, которые зависят от программы финансирования, честно помечены
 * как [УТОЧНИТЬ] — пустое поле лучше выдуманной суммы.
 */

const { card, text, bullets, colors, fonts, grid, type } = require('../lib/layout');
const { n: num } = require('../content');

module.exports = function investmentSlide(pres, deck, content) {
  const c = content.slides.investment;
  const slide = deck.slide(c.title, c.lede);

  // Смета железа
  const leftW = 5.3;
  card(pres, slide, { x: grid.left, y: grid.bodyY, w: leftW, h: 3.1 });

  text(slide, c.hardware.title, {
    x: grid.left + 0.32, y: grid.bodyY + 0.24, w: leftW - 0.64, h: 0.3,
    fontSize: type.cardTitle, bold: true, color: colors.label
  });

  c.hardware.items.forEach((item, i) => {
    const y = grid.bodyY + 0.66 + i * 0.38;
    const [name, count, price, sum] = item;

    text(slide, name, {
      x: grid.left + 0.32, y, w: leftW - 2.6, h: 0.3,
      fontSize: type.small, color: colors.label2, valign: 'middle'
    });
    text(slide, `${count} × ${num(price)}`, {
      x: grid.left + leftW - 2.3, y, w: 1.1, h: 0.3,
      fontSize: type.caption, color: colors.label3, align: 'right', valign: 'middle'
    });
    text(slide, `${num(sum)} ₽`, {
      x: grid.left + leftW - 1.14, y, w: 0.82, h: 0.3,
      fontSize: type.small, bold: true, color: colors.label, align: 'right', valign: 'middle'
    });
  });

  const totalY = grid.bodyY + 0.66 + c.hardware.items.length * 0.38 + 0.06;
  slide.addShape(pres.ShapeType.rect, {
    x: grid.left + 0.32, y: totalY, w: leftW - 0.64, h: 0.01,
    fill: { color: colors.line }, line: { type: 'none' }
  });
  text(slide, 'Итого на корпус', {
    x: grid.left + 0.32, y: totalY + 0.14, w: leftW - 2.3, h: 0.3,
    fontSize: type.body, bold: true, color: colors.label, valign: 'middle'
  });
  text(slide, `${num(c.hardware.total)} ₽`, {
    x: grid.left + leftW - 1.9, y: totalY + 0.14, w: 1.58, h: 0.3,
    fontSize: type.cardTitle, bold: true, color: colors.ok, align: 'right', valign: 'middle'
  });

  // На что идут деньги
  const useX = grid.left + leftW + grid.gap;
  const useW = grid.right - useX;
  const useH = 0.66;

  text(slide, 'НА ЧТО НУЖНЫ ДЕНЬГИ', {
    x: useX, y: grid.bodyY, w: useW, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.accent, charSpacing: 1.2
  });

  c.uses.forEach((use, i) => {
    const y = grid.bodyY + 0.34 + i * (useH + 0.06);
    card(pres, slide, { x: useX, y, w: useW, h: useH, fill: colors.cardSoft });

    text(slide, use.title, {
      x: useX + 0.28, y: y + 0.08, w: useW - 1.9, h: 0.26,
      fontSize: type.body, bold: true, color: colors.label
    });
    text(slide, use.text, {
      x: useX + 0.28, y: y + 0.34, w: useW - 1.9, h: 0.28,
      fontSize: type.caption, color: colors.label3
    });
    text(slide, use.value, {
      x: useX + useW - 1.58, y: y + 0.18, w: 1.3, h: 0.3,
      fontSize: type.body, bold: true,
      color: use.value.includes('УТОЧНИТЬ') ? colors.busy : colors.ok,
      align: 'right', valign: 'middle'
    });
  });

  // Запрашиваемая сумма
  const askY = grid.bodyY + 3.22;
  card(pres, slide, { x: grid.left, y: askY, w: leftW, h: 1.32, fill: colors.cardSoft, line: colors.busy });

  text(slide, c.ask.value, {
    x: grid.left + 0.32, y: askY + 0.18, w: leftW - 0.64, h: 0.42,
    fontSize: 26, bold: true, color: colors.busy, valign: 'middle'
  });
  text(slide, c.ask.label, {
    x: grid.left + 0.32, y: askY + 0.6, w: leftW - 0.64, h: 0.24,
    fontSize: type.small, bold: true, color: colors.label
  });
  text(slide, c.ask.caption, {
    x: grid.left + 0.32, y: askY + 0.84, w: leftW - 0.64, h: 0.42,
    fontSize: type.caption, color: colors.label3, lineSpacingMultiple: 1.15
  });

  // Что получает вложившийся
  text(slide, 'ЧТО ЭТО ДАЁТ', {
    x: useX, y: askY + 0.02, w: useW, h: 0.24,
    fontSize: type.caption, bold: true, color: colors.ok, charSpacing: 1.2
  });
  bullets(slide, c.returns, {
    x: useX, y: askY + 0.3, w: useW, h: 1.06, size: type.small, color: colors.label2
  });

  text(slide, c.sources, {
    x: grid.left, y: grid.bodyBottom - 0.06, w: grid.contentWidth, h: 0.3,
    fontSize: type.caption, color: colors.label3
  });
};
