/**
 * Слайд 2 — проблема.
 *
 * Три числа сверху и диаграмма «спрос против пропускной способности»:
 * разрыв видно до того, как прочитан текст.
 */

const { metric, text, bullets, chartBase, colors, fonts, grid, type } = require('../lib/layout');

module.exports = function problemSlide(pres, deck, content) {
  const c = content.slides.problem;
  const slide = deck.slide(c.title, c.lede);

  // Три метрики в ряд
  const w = (grid.contentWidth - grid.gap * 2) / 3;
  c.metrics.forEach((m, i) => {
    metric(pres, slide, {
      x: grid.left + i * (w + grid.gap), y: grid.bodyY, w, h: 1.78,
      value: m.value, unit: m.unit, label: m.label, caption: m.caption,
      tone: m.tone, size: 40
    });
  });

  // Диаграмма слева, выводы справа
  const chartY = grid.bodyY + 2.02;
  const chartW = 6.5;

  text(slide, c.chart.title, {
    x: grid.left, y: chartY, w: chartW, h: 0.28,
    fontSize: type.small, bold: true, color: colors.label2
  });

  slide.addChart(
    pres.ChartType.bar,
    [
      { name: 'Приходит людей', labels: c.chart.labels, values: c.chart.demand },
      { name: 'Увозят лифты', labels: c.chart.labels, values: c.chart.labels.map(() => c.chart.capacity) }
    ],
    {
      ...chartBase(),
      x: grid.left - 0.1, y: chartY + 0.3, w: chartW + 0.2, h: 2.3,
      barDir: 'col',
      barGapWidthPct: 60,
      chartColors: [colors.full, colors.accent],
      showValue: true,
      dataLabelPosition: 'outEnd',
      dataLabelColor: colors.label2,
      valAxisHidden: true,
      legendPos: 'b'
    }
  );

  bullets(slide, c.points, {
    x: grid.left + chartW + 0.55, y: chartY + 0.26,
    w: grid.contentWidth - chartW - 0.55,
    h: grid.bodyBottom - chartY - 0.26, size: type.body - 1
  });
};
