/**
 * Слайд 1 — титульный.
 *
 * Слева название и обещание, справа — живой экран приложения:
 * инвестор видит продукт раньше, чем первую цифру.
 */

const { card, text, pill, image, colors, fonts, grid, type } = require('../lib/layout');

module.exports = function titleSlide(pres, deck, content, assets) {
  const c = content.slides.title;
  const slide = deck.cover();

  // Тёплая подложка справа: отделяет снимок от фона, не прибивая его рамкой.
  slide.addShape(pres.ShapeType.roundRect, {
    x: 8.55, y: 0, w: 4.78, h: grid.height,
    fill: { color: colors.card }, line: { type: 'none' }, rectRadius: 0.4
  });

  // Эмблема
  image(pres, slide, {
    file: assets.logo, x: grid.left, y: 0.78, w: 1.06, h: 0.85,
    placeholder: 'логотип'
  });

  text(slide, c.name, {
    x: grid.left, y: 1.84, w: 7.4, h: 1.3,
    fontSize: type.hero, bold: true, color: colors.label, fontFace: fonts.head,
    valign: 'middle', charSpacing: -1
  });

  text(slide, c.tagline, {
    x: grid.left, y: 3.12, w: 7.1, h: 0.9,
    fontSize: 23, bold: true, color: colors.accent, lineSpacingMultiple: 1.2
  });

  text(slide, c.description, {
    x: grid.left, y: 4.08, w: 7.0, h: 0.6,
    fontSize: type.lede, color: colors.label2, lineSpacingMultiple: 1.25
  });

  // Три факта о площадке — короткими плашками
  let x = grid.left;
  c.badges.forEach((badge) => {
    // Ширина под текст: примерно 0,105" на символ плюс поля
    const w = 0.105 * badge.length + 0.5;
    pill(pres, slide, { x, y: 4.84, w, h: 0.42, label: badge, color: colors.label2 });
    x += w + 0.18;
  });

  // Разделитель и выходные данные
  slide.addShape(pres.ShapeType.rect, {
    x: grid.left, y: 5.72, w: 7.1, h: 0.012,
    fill: { color: colors.line }, line: { type: 'none' }
  });

  text(slide, c.team, {
    x: grid.left, y: 5.94, w: 7.1, h: 0.3,
    fontSize: type.body, bold: true, color: colors.label
  });

  text(slide, `${c.place}  ·  ${c.year}`, {
    x: grid.left, y: 6.32, w: 7.1, h: 0.3,
    fontSize: type.small, color: colors.label3
  });

  text(slide, c.stage, {
    x: grid.left, y: 6.66, w: 7.1, h: 0.3,
    fontSize: type.small, color: colors.ok
  });

  // Экран приложения
  image(pres, slide, {
    file: assets.path('screenshots/phone-main.png'),
    x: 9.42, y: 0.52, w: 3.04, h: 6.46,
    placeholder: 'скриншот приложения'
  });
};
