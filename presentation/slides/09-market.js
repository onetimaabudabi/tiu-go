/**
 * Слайд 9 — рынок и масштабирование.
 *
 * Слева рынки НТИ и сегменты, справа — накопительная диаграмма плана
 * по годам. Оценку объёма рынка сознательно оставляем пустой.
 */

const { card, text, bullets, chartBase, colors, grid, type } = require('../lib/layout');

module.exports = function marketSlide(pres, deck, content) {
  const c = content.slides.market;
  const slide = deck.slide(c.title, c.lede);

  // Рынки НТИ — три узкие плашки
  const mW = (6.5 - grid.gap * 2) / 3;
  c.markets.forEach((m, i) => {
    const x = grid.left + i * (mW + grid.gap);
    card(pres, slide, { x, y: grid.bodyY, w: mW, h: 1.62, fill: colors.cardSoft });

    text(slide, m.title, {
      x: x + 0.26, y: grid.bodyY + 0.22, w: mW - 0.52, h: 0.3,
      fontSize: type.cardTitle, bold: true, color: colors[m.tone]
    });

    text(slide, m.text, {
      x: x + 0.26, y: grid.bodyY + 0.58, w: mW - 0.52, h: 0.92,
      fontSize: type.caption, color: colors.label2, lineSpacingMultiple: 1.2
    });
  });

  // Сегменты
  const segY = grid.bodyY + 1.86;
  card(pres, slide, { x: grid.left, y: segY, w: 6.5, h: 2.28 });

  text(slide, 'КУДА ЭТО ПЕРЕНОСИТСЯ', {
    x: grid.left + 0.34, y: segY + 0.24, w: 6.5 - 0.68, h: 0.26,
    fontSize: type.caption, bold: true, color: colors.accent, charSpacing: 1.2
  });

  bullets(slide, c.segments, {
    x: grid.left + 0.34, y: segY + 0.6, w: 6.5 - 0.68,
    h: 1.24, size: type.small, color: colors.label2
  });

  text(slide, c.note, {
    x: grid.left + 0.34, y: segY + 1.88, w: 6.5 - 0.68, h: 0.34,
    fontSize: type.caption, color: colors.busy
  });

  // Диаграмма масштабирования
  const chartX = grid.left + 6.82;
  const chartW = grid.right - chartX;
  const chartH = 4.14;

  card(pres, slide, { x: chartX, y: grid.bodyY, w: chartW, h: chartH });

  text(slide, c.chart.title, {
    x: chartX + 0.34, y: grid.bodyY + 0.24, w: chartW - 0.68, h: 0.26,
    fontSize: type.small, bold: true, color: colors.label2
  });

  slide.addChart(
    pres.ChartType.bar,
    c.chart.series.map((s) => ({ name: s.name, labels: c.chart.years, values: s.values })),
    {
      ...chartBase(),
      x: chartX + 0.1, y: grid.bodyY + 0.5, w: chartW - 0.2, h: chartH - 0.68,
      barDir: 'col',
      barGrouping: 'stacked',
      barGapWidthPct: 55,
      chartColors: [colors.accent, colors.accent2, colors.ok],
      showValue: false,
      valAxisHidden: false,
      legendPos: 'b'
    }
  );
};
