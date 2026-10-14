/**
 * Слайд 12 — команда и контакты.
 *
 * Пять портретов с ролями, контакты с QR и финальная строка —
 * та же, что стоит на обложке.
 */

const { card, text, image, colors, fonts, grid, type } = require('../lib/layout');

module.exports = function teamSlide(pres, deck, content, assets) {
  const c = content.slides.team;
  const slide = deck.slide(c.title, c.lede);

  // Портреты
  const count = c.members.length;
  const gap = 0.24;
  const w = (grid.contentWidth - gap * (count - 1)) / count;
  const photoH = 1.5;

  c.members.forEach((member, i) => {
    const x = grid.left + i * (w + gap);
    card(pres, slide, { x, y: grid.bodyY, w, h: 2.94 });

    image(pres, slide, {
      file: assets.path(`team/${member.file}`),
      x: x + 0.22, y: grid.bodyY + 0.22, w: w - 0.44, h: photoH,
      placeholder: 'фото'
    });

    text(slide, member.role, {
      x: x + 0.16, y: grid.bodyY + photoH + 0.36, w: w - 0.32, h: 0.3,
      fontSize: type.small, bold: true, color: colors.accent, align: 'center'
    });

    text(slide, member.name, {
      x: x + 0.16, y: grid.bodyY + photoH + 0.66, w: w - 0.32, h: 0.28,
      fontSize: type.caption, color: colors.label, align: 'center'
    });

    text(slide, member.text, {
      x: x + 0.12, y: grid.bodyY + photoH + 0.94, w: w - 0.24, h: 0.46,
      fontSize: type.caption, color: colors.label3, align: 'center', lineSpacingMultiple: 1.15
    });
  });

  // Контакты
  const y = grid.bodyY + 3.2;
  const contactsW = 7.4;
  card(pres, slide, { x: grid.left, y, w: contactsW, h: 1.4, fill: colors.cardSoft });

  const colW = contactsW / 2;
  c.contacts.forEach((contact, i) => {
    const cx = grid.left + 0.34 + (i % 2) * colW;
    const cy = y + 0.26 + Math.floor(i / 2) * 0.56;

    text(slide, contact.label, {
      x: cx, y: cy, w: colW - 0.5, h: 0.22,
      fontSize: type.caption, color: colors.label3
    });
    text(slide, contact.value, {
      x: cx, y: cy + 0.22, w: colW - 0.5, h: 0.26,
      fontSize: type.small, bold: true,
      color: contact.value.includes('УТОЧНИТЬ') ? colors.busy : colors.accent2
    });
  });

  // QR и финальная строка
  const qrX = grid.left + contactsW + grid.gap;
  const qrW = grid.right - qrX;
  card(pres, slide, { x: qrX, y, w: qrW, h: 1.4, fill: colors.card });

  image(pres, slide, {
    file: assets.qr, x: qrX + 0.22, y: y + 0.18, w: 1.04, h: 1.04,
    placeholder: 'QR'
  });

  text(slide, c.closing, {
    x: qrX + 1.42, y: y + 0.18, w: qrW - 1.64, h: 1.04,
    fontSize: type.body, bold: true, color: colors.label,
    valign: 'middle', lineSpacingMultiple: 1.25
  });
};
