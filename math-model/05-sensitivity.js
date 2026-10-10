/**
 * Модель 5. Анализ чувствительности.
 *
 * Проверяет, какие параметры действительно управляют результатом, а какие
 * почти не влияют. Для каждого параметра берётся диапазон значений,
 * прогоняется имитационная модель и измеряется ключевой показатель —
 * среднее полное время подъёма на человека.
 *
 * Прогонов на точку меньше, чем в основной симуляции: разброс среднего
 * по дням составляет доли секунды (центральная предельная теорема), поэтому
 * полусотни дней достаточно, а расчёт укладывается в десяток секунд.
 *
 * Запуск:  npm run math:sensitivity
 */

const { PARAMS } = require('./params');
const simulation = require('./02-simulation');
const chart = require('./chart-helper');

const DAYS_PER_POINT = 50;

/** Копия параметров с заменой одного значения. */
function withParam(key, value, base = PARAMS) {
  return Object.assign({}, base, { [key]: value });
}

/** Прогон модели для одного набора параметров. */
function evaluate(params) {
  const withApp = simulation.runScenario(true, DAYS_PER_POINT, params);
  const without = simulation.runScenario(false, DAYS_PER_POINT, params);

  return {
    totalTime: withApp.avgTotalTime,
    totalTimeNoApp: without.avgTotalTime,
    saving: without.avgTotalTime - withApp.avgTotalTime,
    wait: withApp.avgWait,
    stairsShare: withApp.stairsShare,
    maxQueue: withApp.maxQueue
  };
}

// Что варьируем
const EXPERIMENTS = [
  {
    key: 'studentsInBuilding',
    title: 'Число людей в корпусе',
    unit: 'чел',
    values: [1000, 1500, 2000, 2500],
    file: 'sens_students.png'
  },
  {
    key: 'elevators',
    title: 'Число лифтов',
    unit: 'шт',
    values: [4, 5, 6, 7, 8],
    file: 'sens_elevators.png'
  },
  {
    key: 'cameraAccuracy',
    title: 'Точность детекции камер',
    unit: '',
    values: [0.70, 0.80, 0.92, 0.98],
    file: 'sens_accuracy.png'
  },
  {
    key: 'recommendationFollowRate',
    title: 'Доля следующих рекомендации',
    unit: '',
    values: [0, 0.3, 0.5, 0.7, 0.9],
    file: 'sens_follow.png'
  },
  {
    key: 'stairsTimePerFloor',
    title: 'Время подъёма на этаж пешком',
    unit: 'с',
    values: [10, 12, 15, 20],
    file: 'sens_stairs.png'
  }
];

// ---------- Запуск ----------
async function run(p = PARAMS) {
  console.log(`[sensitivity] Анализ чувствительности, по ${DAYS_PER_POINT} дней на точку…`);

  const baseline = evaluate(p);
  console.log(`[sensitivity] Базовый сценарий: ${baseline.totalTime.toFixed(1)} с на человека, экономия ${baseline.saving.toFixed(1)} с`);
  console.log('');

  const results = [];

  for (let n = 0; n < EXPERIMENTS.length; n += 1) {
    const exp = EXPERIMENTS[n];
    console.log(`[sensitivity] ${n + 1}/${EXPERIMENTS.length}: ${exp.title}…`);

    const points = exp.values.map((value) => {
      const res = evaluate(withParam(exp.key, value, p));
      return Object.assign({ value }, res);
    });

    const times = points.map((x) => x.totalTime);
    const min = Math.min.apply(null, times);
    const max = Math.max.apply(null, times);
    const spread = (max - min) / baseline.totalTime; // размах в долях базового KPI

    results.push(Object.assign({}, exp, { points, min, max, spread }));

    points.forEach((pt) => {
      console.log(
        `    ${exp.key} = ${String(pt.value).padStart(6)} → полное время ${pt.totalTime.toFixed(1).padStart(6)} с, ` +
        `ожидание ${pt.wait.toFixed(1).padStart(5)} с, на лестницу ${(pt.stairsShare * 100).toFixed(0).padStart(3)}%, ` +
        `экономия ${pt.saving.toFixed(1)} с`
      );
    });

    // График по параметру
    await chart.save({
      type: 'line',
      data: {
        labels: points.map((x) => String(x.value)),
        datasets: [
          {
            label: 'Полное время подъёма, с (с приложением)',
            data: points.map((x) => Number(x.totalTime.toFixed(1))),
            borderColor: chart.COLOR.accent, backgroundColor: 'rgba(91,141,239,0.12)',
            fill: true, tension: 0.2, pointRadius: 5, borderWidth: 3
          },
          {
            label: 'То же без приложения, с',
            data: points.map((x) => Number(x.totalTimeNoApp.toFixed(1))),
            borderColor: chart.COLOR.grey, borderDash: [8, 5],
            fill: false, tension: 0.2, pointRadius: 4, borderWidth: 2
          }
        ]
      },
      options: chart.options(`Чувствительность: ${exp.title}`, {
        scales: {
          y: chart.axis('время подъёма, с', { beginAtZero: false }),
          x: chart.axis(exp.unit ? `${exp.title}, ${exp.unit}` : exp.title, { grid: { display: false } })
        },
        plugins: {
          title: chart.options(`Чувствительность: ${exp.title}`).plugins.title,
          legend: { display: true, position: 'bottom', labels: { boxWidth: 16, padding: 12 } }
        }
      })
    }, exp.file);
  }

  // Сводный график: какой параметр двигает результат сильнее
  const sorted = results.slice().sort((a, b) => b.spread - a.spread);

  await chart.save({
    type: 'bar',
    data: {
      labels: sorted.map((r) => r.title),
      datasets: [{
        data: sorted.map((r) => Number((r.spread * 100).toFixed(1))),
        backgroundColor: sorted.map((r, i) => (i === 0 ? chart.COLOR.full : chart.COLOR.accent)),
        borderRadius: 6
      }]
    },
    options: chart.options('Какой параметр сильнее влияет на результат', {
      indexAxis: 'y',
      scales: {
        x: chart.axis('размах времени подъёма, % от базового', { beginAtZero: true }),
        y: chart.axis(null, { grid: { display: false } })
      },
      plugins: {
        title: chart.options('Какой параметр сильнее влияет на результат').plugins.title,
        legend: { display: false }
      }
    })
  }, 'sens_tornado.png');

  console.log('');
  console.log('  Параметр                       | Размах KPI, % от базового');
  sorted.forEach((r) => {
    console.log(`  ${r.title.padEnd(30)} | ${(r.spread * 100).toFixed(1).padStart(10)}%`);
  });

  const critical = sorted[0];
  console.log('');
  console.log(`[sensitivity] Самый критичный параметр: ${critical.title.toLowerCase()}.`);

  // Порог устойчивости по числу людей
  const students = results.find((r) => r.key === 'studentsInBuilding');
  const worst = students.points[students.points.length - 1];
  console.log(`[sensitivity] При ${worst.value} человек в корпусе время подъёма вырастает до ${worst.totalTime.toFixed(0)} с ` +
              `(${((worst.totalTime / baseline.totalTime - 1) * 100).toFixed(0)}% к базовому).`);

  const follow = results.find((r) => r.key === 'recommendationFollowRate');
  console.log(`[sensitivity] Запас прочности даёт поведение: рост доли следующих совету с 0 до 90% ` +
              `сокращает время подъёма на ${(follow.points[0].totalTime - follow.points[follow.points.length - 1].totalTime).toFixed(0)} с.`);
  console.log('[sensitivity] Графики сохранены в output/charts/');

  return { baseline, results, sorted, critical };
}

module.exports = { withParam, evaluate, EXPERIMENTS, run };

if (require.main === module) {
  run().catch((err) => { console.error('[sensitivity] Ошибка:', err.message); process.exit(1); });
}
