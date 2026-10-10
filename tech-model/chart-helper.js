/**
 * TIU GO — общая обёртка над chartjs-node-canvas для технической модели.
 *
 * Вынесена отдельно, чтобы девять скриптов не содержали девять копий
 * настройки холста и стиля. Сохраняет PNG в tech-model/output/charts/.
 */

const fs = require('fs');
const path = require('path');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const CHARTS_DIR = path.join(__dirname, 'output', 'charts');

const COLOR = {
  accent: '#5B8DEF',
  ok: '#22C55E',
  busy: '#F59E0B',
  full: '#EF4444',
  violet: '#8B5CF6',
  teal: '#14B8A6',
  grey: '#9CA3AF',
  greyLight: '#D1D5DB',
  text: '#0B0D12',
  grid: 'rgba(11, 13, 18, 0.08)'
};

const canvas = new ChartJSNodeCanvas({
  width: 1000,
  height: 600,
  backgroundColour: '#FFFFFF',
  chartCallback: (ChartJS) => {
    ChartJS.defaults.font.family = 'Helvetica, Arial, sans-serif';
    ChartJS.defaults.font.size = 14;
    ChartJS.defaults.color = COLOR.text;
  }
});

/** Ось без лишней сетки. */
function axis(titleText, opts = {}) {
  return Object.assign({
    title: titleText ? { display: true, text: titleText, font: { size: 14 } } : undefined,
    grid: { color: COLOR.grid, drawTicks: false },
    border: { display: false },
    ticks: { padding: 6 }
  }, opts);
}

/**
 * Базовые настройки с заголовком. Легенда включается флагом:
 * на графиках с одним рядом она только занимает место.
 */
function options(title, extra = {}, legend = false) {
  const base = {
    responsive: false,
    plugins: {
      title: {
        display: true,
        text: title,
        font: { size: 20, weight: 'bold' },
        padding: { top: 6, bottom: 20 }
      },
      legend: legend ? { display: true, position: 'top' } : { display: false }
    }
  };

  // Если вызывающий код передал свои plugins, не затираем заголовок
  const merged = Object.assign({}, base, extra);
  if (extra.plugins) merged.plugins = Object.assign({}, base.plugins, extra.plugins);
  return merged;
}

/** Рисует график и сохраняет PNG. Ошибка одного графика не роняет расчёт. */
async function save(config, fileName) {
  try {
    fs.mkdirSync(CHARTS_DIR, { recursive: true });
    const png = await canvas.renderToBuffer(config);
    fs.writeFileSync(path.join(CHARTS_DIR, fileName), png);
    return fileName;
  } catch (err) {
    console.warn(`[chart] Не удалось сохранить ${fileName}: ${err.message}`);
    return null;
  }
}

module.exports = { COLOR, CHARTS_DIR, axis, options, save };
