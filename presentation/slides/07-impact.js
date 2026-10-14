/**
 * Слайд 7 — эффект от внедрения.
 *
 * Самый важный слайд колоды: четыре процента сверху, диаграмма
 * «до и после» слева и деньги справа.
 */

const { metric, card, text, chartBase, colors, grid, type } = require('../lib/layout');

module.exports = function impactSlide(pres, deck, content) {
  const c = content.slides.impact;
  const slide = deck.slide(c.title, c.lede);

  // Четыре метрики в ряд
  const w = (grid.contentWidth - grid.gap * 3) / 4;
  c.metrics.forEach((m, i) => {
    metric(pres, slide, {
      x: grid.left + i * (w + grid.gap), y: grid.bodyY, w, h: 1.82,
      value: m.value, label: m.label, caption: m.caption, tone: m.tone,
      size: 34, labelSize: type.body + 1
    });
  });

  // Диаграмма «до и после»
  const y = grid.bodyY + 1.96;
  const chartW = 7.0;

  card(pres, slide, { x: grid.left, y, w: chartW, h: 2.56 });

  text(slide, c.chart.title, {
    x: grid.left + 0.34, y: y + 0.22, w: chartW - 0.68, h: 0.26,
    fontSize: type.small, bold: true, color: colors.label2
  });

  slide.addChart(
    pres.ChartType.bar,
    [
      { name: 'Без системы', labels: c.chart.labels, values: c.chart.before },
      { name: 'С системой', labels: c.chart.labels, values: c.chart.after }
    ],
    {
      ...chartBase(),
      x: grid.left + 0.1, y: y + 0.46, w: chartW - 0.2, h: 1.96,
      barDir: 'col',
      barGapWidthPct: 55,
      chartColors: [colors.full, colors.ok],
      showValue: true,
      dataLabelPosition: 'outEnd',
      dataLabelColor: colors.label2,
      valAxisHidden: true
    }
  );

  // Деньги
  const moneyX = grid.left + chartW + 0.32;
  const moneyW = grid.right - moneyX;
  const cellH = 0.7;

  c.money.forEach((item, i) => {
    const cy = y + i * (cellH + 0.12);
    card(pres, slide, { x: moneyX, y: cy, w: moneyW, h: cellH, fill: colors.cardSoft });

    text(slide, item.value, {
      x: moneyX + 0.28, y: cy + 0.12, w: 1.9, h: 0.56,
      fontSize: 22, bold: true, color: colors.ok, valign: 'middle'
    });

    text(slide, item.label, {
      x: moneyX + 2.22, y: cy + 0.14, w: moneyW - 2.5, h: 0.26,
      fontSize: type.small, bold: true, color: colors.label
    });

    text(slide, item.caption, {
      x: moneyX + 2.22, y: cy + 0.4, w: moneyW - 2.5, h: 0.32,
      fontSize: type.caption, color: colors.label3, lineSpacingMultiple: 1.1
    });
  });

  text(slide, c.footnote, {
    x: moneyX, y: y + 3 * (cellH + 0.12) - 0.06, w: moneyW, h: 0.56,
    fontSize: type.caption, color: colors.label3, lineSpacingMultiple: 1.2
  });
};
