/**
 * Слайд 5 — демонстрация.
 *
 * Три экрана приложения, список возможностей и QR на канал проекта:
 * с этого слайда инвестор может открыть продукт прямо в зале.
 */

const { card, text, bullets, image, colors, grid, type } = require('../lib/layout');

module.exports = function demoSlide(pres, deck, content, assets) {
  const c = content.slides.demo;
  const slide = deck.slide(c.title, c.lede);

  // Три телефона слева
  const shotW = 1.72;
  const shotH = 3.6;
  const gap = 0.3;

  c.screens.forEach((screen, i) => {
    const x = grid.left + i * (shotW + gap);
    image(pres, slide, {
      file: assets.path(`screenshots/${screen.file}`),
      x, y: grid.bodyY, w: shotW, h: shotH,
      placeholder: screen.caption
    });

    text(slide, screen.caption, {
      x: x - 0.12, y: grid.bodyY + shotH + 0.14, w: shotW + 0.24, h: 0.26,
      fontSize: type.small, bold: true, color: colors.label, align: 'center'
    });

    text(slide, screen.text, {
      x: x - 0.12, y: grid.bodyY + shotH + 0.42, w: shotW + 0.24, h: 0.6,
      fontSize: type.caption, color: colors.label3, align: 'center', lineSpacingMultiple: 1.18
    });
  });

  // Возможности справа
  const rightX = grid.left + 3 * shotW + 2 * gap + 0.46;
  const rightW = grid.right - rightX;

  card(pres, slide, { x: rightX, y: grid.bodyY, w: rightW, h: 2.8 });

  text(slide, 'ЧТО УЖЕ РАБОТАЕТ', {
    x: rightX + 0.34, y: grid.bodyY + 0.28, w: rightW - 0.68, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.accent, charSpacing: 1.2
  });

  bullets(slide, c.features, {
    x: rightX + 0.34, y: grid.bodyY + 0.64, w: rightW - 0.68,
    h: 1.9, size: type.small, color: colors.label2
  });

  // QR на канал
  const qrY = grid.bodyY + 3.02;
  card(pres, slide, { x: rightX, y: qrY, w: rightW, h: 1.46, fill: colors.cardSoft });

  image(pres, slide, {
    file: assets.qr, x: rightX + 0.26, y: qrY + 0.2, w: 1.06, h: 1.06,
    placeholder: 'QR'
  });

  text(slide, c.qrCaption, {
    x: rightX + 1.5, y: qrY + 0.28, w: rightW - 1.78, h: 0.3,
    fontSize: type.cardTitle, bold: true, color: colors.label
  });

  text(slide, content.links.channelUrl, {
    x: rightX + 1.5, y: qrY + 0.62, w: rightW - 1.78, h: 0.3,
    fontSize: type.body, color: colors.accent2
  });

  text(slide, content.links.repoUrl, {
    x: rightX + 1.5, y: qrY + 0.94, w: rightW - 1.78, h: 0.3,
    fontSize: type.small, color: colors.label3
  });
};
