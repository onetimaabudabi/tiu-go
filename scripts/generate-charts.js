/**
 * TIU GO — генерация графиков для документов.
 *
 * Рисует пять PNG размером 1000×600 в папку docs/ через chartjs-node-canvas.
 * Никаких внешних сервисов: всё считается и рисуется локально.
 *
 * Запуск:  npm run docs:charts
 */

const fs = require('fs');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const D = require('./data');

const WIDTH = 1000;
const HEIGHT = 600;

// Палитра — та же, что в самом приложении
const COLOR = {
  accent: '#5B8DEF',
  ok: '#22C55E',
  busy: '#F59E0B',
  full: '#EF4444',
  grey: '#9CA3AF',
  greyLight: '#D1D5DB',
  text: '#0B0D12',
  grid: 'rgba(11, 13, 18, 0.08)'
};

const canvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: '#FFFFFF',
  chartCallback: (ChartJS) => {
    // Минималистичный стиль без засечек — один раз на все графики
    ChartJS.defaults.font.family = 'Helvetica, Arial, sans-serif';
    ChartJS.defaults.font.size = 15;
    ChartJS.defaults.color = COLOR.text;
  }
});

/** Общие настройки заголовка и легенды. */
function base(title, extra = {}) {
  return Object.assign({
    responsive: false,
    plugins: {
      title: {
        display: true,
        text: title,
        font: { size: 22, weight: 'bold' },
        padding: { top: 8, bottom: 24 }
      },
      legend: { display: false }
    }
  }, extra);
}

/** Подпись на денежной оси: 100000 -> «100 000». */
function moneyTicks() {
  return { callback: (value) => Number(value).toLocaleString('ru-RU') };
}

/** Ось без лишней сетки. */
function axis(titleText, opts = {}) {
  return Object.assign({
    title: titleText ? { display: true, text: titleText, font: { size: 14 } } : undefined,
    grid: { color: COLOR.grid, drawTicks: false, drawBorder: false },
    border: { display: false },
    ticks: { padding: 8 }
  }, opts);
}

const c = D.calc();

// ---------- График 1: экономия времени ----------
function chartTime() {
  return {
    type: 'bar',
    data: {
      labels: ['Без системы', 'С системой TIU GO'],
      datasets: [{
        data: [D.INPUT.waitBefore, D.INPUT.waitAfter],
        backgroundColor: [COLOR.grey, COLOR.ok],
        borderRadius: 8,
        barPercentage: 0.5
      }]
    },
    options: base('Среднее время ожидания лифта в пик', {
      scales: {
        y: axis('секунды', { beginAtZero: true, suggestedMax: 100 }),
        x: axis(null, { grid: { display: false }, border: { display: false } })
      },
      plugins: {
        title: base('Среднее время ожидания лифта в пик').plugins.title,
        legend: { display: false },
        tooltip: { enabled: false }
      }
    })
  };
}

// ---------- График 2: причины опозданий ----------
function chartLateness() {
  return {
    type: 'pie',
    data: {
      labels: D.LATENESS.map((x) => `${x.name} — ${x.value}%`),
      datasets: [{
        data: D.LATENESS.map((x) => x.value),
        // Красным выделена только та доля, на которую влияет проект
        backgroundColor: [COLOR.full, COLOR.greyLight, COLOR.grey, '#E5E7EB'],
        borderColor: '#FFFFFF',
        borderWidth: 3
      }]
    },
    options: base('Почему студенты опаздывают на пары', {
      plugins: {
        title: base('Почему студенты опаздывают на пары').plugins.title,
        legend: { display: true, position: 'right', labels: { boxWidth: 18, padding: 16 } }
      }
    })
  };
}

// ---------- График 3: структура затрат ----------
function chartCosts() {
  const items = D.COSTS.map((x) => ({
    label: x.qty > 1 ? `${x.name} (${x.qty} шт.)` : x.name,
    value: x.qty * x.price
  }));

  return {
    type: 'bar',
    data: {
      labels: items.map((x) => x.label),
      datasets: [{
        data: items.map((x) => x.value),
        backgroundColor: items.map((x) => (x.value === 0 ? COLOR.greyLight : COLOR.accent)),
        borderRadius: 6,
        barPercentage: 0.7
      }]
    },
    options: base(`Структура затрат на внедрение — ${D.rub(c.totalCosts)}`, {
      indexAxis: 'y',
      scales: {
        x: axis('рублей', { beginAtZero: true, ticks: Object.assign({ padding: 8 }, moneyTicks()) }),
        y: axis(null, { grid: { display: false }, border: { display: false } })
      },
      plugins: {
        title: base(`Структура затрат на внедрение — ${D.rub(c.totalCosts)}`).plugins.title,
        legend: { display: false }
      }
    })
  };
}

// ---------- График 4: срок окупаемости ----------
function chartPayback() {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const saved = months.map((m) => Math.round(c.cashPerMonth * m));
  const costs = months.map(() => c.totalCosts);

  return {
    type: 'line',
    data: {
      labels: months.map((m) => `${m} мес`),
      datasets: [
        {
          label: 'Накопленная экономия',
          data: saved,
          borderColor: COLOR.ok,
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          fill: true,
          tension: 0.1,
          pointRadius: 4
        },
        {
          label: 'Затраты на внедрение',
          data: costs,
          borderColor: COLOR.full,
          borderDash: [8, 6],
          fill: false,
          pointRadius: 0
        }
      ]
    },
    options: base(`Срок окупаемости — ${c.paybackMonths.toFixed(1)} мес.`, {
      scales: {
        y: axis('рублей', { beginAtZero: true, ticks: Object.assign({ padding: 8 }, moneyTicks()) }),
        x: axis(null, { grid: { display: false }, border: { display: false } })
      },
      plugins: {
        title: base(`Срок окупаемости — ${c.paybackMonths.toFixed(1)} мес.`).plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 18, padding: 16 } }
      }
    })
  };
}

// ---------- График 5: масштабирование ----------
function chartScaling() {
  return {
    type: 'line',
    data: {
      labels: D.SCALING.years,
      datasets: [
        {
          label: 'Корпуса ТИУ',
          data: D.SCALING.tiu,
          borderColor: COLOR.accent,
          backgroundColor: COLOR.accent,
          tension: 0.25,
          pointRadius: 5
        },
        {
          label: 'Другие вузы',
          data: D.SCALING.universities,
          borderColor: COLOR.ok,
          backgroundColor: COLOR.ok,
          tension: 0.25,
          pointRadius: 5
        },
        {
          label: 'Коммерческие объекты',
          data: D.SCALING.commercial,
          borderColor: COLOR.busy,
          backgroundColor: COLOR.busy,
          tension: 0.25,
          pointRadius: 5
        }
      ]
    },
    options: base('Прогноз масштабирования по годам', {
      scales: {
        y: axis('объектов', { beginAtZero: true }),
        x: axis(null, { grid: { display: false }, border: { display: false } })
      },
      plugins: {
        title: base('Прогноз масштабирования по годам').plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 18, padding: 16 } }
      }
    })
  };
}

// ---------- Запуск ----------
const JOBS = [
  { file: D.CHARTS.time,     build: chartTime,     name: 'экономия времени' },
  { file: D.CHARTS.lateness, build: chartLateness, name: 'причины опозданий' },
  { file: D.CHARTS.costs,    build: chartCosts,    name: 'затраты' },
  { file: D.CHARTS.payback,  build: chartPayback,  name: 'окупаемость' },
  { file: D.CHARTS.scaling,  build: chartScaling,  name: 'масштабирование' }
];

async function main() {
  D.ensureDocsDir();

  for (let i = 0; i < JOBS.length; i += 1) {
    const job = JOBS[i];
    console.log(`[charts] Генерирую график ${i + 1}/${JOBS.length}: ${job.name}…`);

    try {
      const png = await canvas.renderToBuffer(job.build());
      fs.writeFileSync(D.docsPath(job.file), png);
      console.log(`[charts] Сохранил ${job.file} (${Math.round(png.length / 1024)} КБ)`);
    } catch (err) {
      // Один неудачный график не должен ронять остальные
      console.warn(`[charts] Не удалось построить «${job.name}»: ${err.message}`);
    }
  }

  console.log('✅ Готово! Файлы в папке docs/');
}

main().catch((err) => {
  console.error('[charts] Ошибка:', err.message);
  process.exit(1);
});
