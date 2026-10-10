/**
 * Модель 7. Подбор запаса мест в правиле принятия решения.
 *
 * Запас мест — единственный настраиваемый параметр логики:
 *
 *   detected + safety_margin >= capacity  →  проехать
 *
 * Он нужен потому, что камера систематически НЕДОсчитывает людей
 * (модель 2: при полной кабине смещение около полутора человек).
 * Без запаса система почти никогда не распознаёт полную кабину
 * и тормозит там, где войти уже некому.
 *
 * Но запас работает в обе стороны. Чем он больше, тем увереннее система
 * распознаёт полные кабины (растёт recall) и тем чаще проезжает мимо тех,
 * кто ещё мог бы войти (падает precision). Цена этих ошибок разная:
 * лишняя остановка стоит 7 секунд всем, кто внутри, а проезд мимо —
 * целого круга ожидания тому, кого не взяли. Поэтому оптимум смещён
 * в сторону осторожности.
 *
 * Критерий выбора требует оговорки. Общее среднее ожидание с ростом
 * запаса падает монотонно — но падает оно за счёт первого этажа, где
 * лифт берёт всех подряд и никого не проезжает. А страдает от запаса
 * ровно противоположная группа: те, кто ждёт на промежуточных этажах.
 * Их в корпусе меньшинство, и в общем среднем их беда тонет.
 *
 * Поэтому запас оценивается по той группе, судьбу которой он и решает:
 * берём значение, при котором ожидание НА ПРОМЕЖУТОЧНЫХ ЭТАЖАХ минимально,
 * а пропускная способность в пиковый час не проседает больше чем на процент.
 * Пассажиры первого этажа при этом ничего не теряют — их лифт не проезжает
 * ни при каком запасе.
 *
 * Запуск:  npm run tech:optimize
 */

const PARAMS = require('./params');
const decision = require('./03-decision-logic');
const simulation = require('./06-simulation');
const chart = require('./chart-helper');
const io = require('./io');

const CAPACITY = PARAMS.elevators.capacityRealPeak;

// Перебираем на один шаг шире, чем в постановке задачи: так видно,
// что оптимум лежит внутри диапазона, а не упирается в его край.
const MARGINS = [0, 1, 2, 3, 4];

// Дней на каждое значение запаса. Меньше, чем в модели 6: там нужна
// точность итогового числа, здесь — сравнение вариантов между собой.
const DAYS = 120;

// ---------- Прогон одного значения запаса ----------

/**
 * Гоняет учебный день с заданным запасом мест и собирает операционные
 * показатели. Приходы людей одни и те же для всех значений запаса —
 * сравнение идёт на одинаковых днях.
 */
function evaluateMargin(margin, days = DAYS) {
  const waits = [];
  const waitsLobby = [];
  const waitsUpper = [];
  const peakThroughput = [];
  const queues = [];
  const passes = [];
  const wrongPasses = [];
  const uselessStops = [];

  for (let d = 0; d < days; d += 1) {
    const seed = PARAMS.simulation.randomSeed + d * 104729;
    const arrivals = simulation.buildArrivals(io.makeRng(seed));
    const r = simulation.simulateDay(arrivals, true, seed + 1, margin);

    waits.push(r.avgWait);
    waitsLobby.push(r.avgWaitLobby);
    waitsUpper.push(r.avgWaitUpper);
    peakThroughput.push(r.peakThroughput);
    queues.push(r.maxQueue);
    passes.push(r.passes);
    wrongPasses.push(r.passWrong);
    uselessStops.push(r.uselessStops);
  }

  const mean = (list) => io.stats(list).mean;

  const totalPasses = mean(passes);
  const wrong = mean(wrongPasses);
  const useless = mean(uselessStops);

  return {
    margin,
    avgWait: io.round(mean(waits), 1),
    avgWaitLobby: io.round(mean(waitsLobby), 1),
    avgWaitUpper: io.round(mean(waitsUpper), 1),
    peakThroughput: Math.round(mean(peakThroughput)),
    maxQueue: Math.round(mean(queues)),
    passes: Math.round(totalPasses),
    wrongPasses: Math.round(wrong),
    uselessStops: Math.round(useless),
    // Ошибочные решения обоих видов за день
    wrongDecisions: Math.round(wrong + useless),
    passAccuracy: io.round(totalPasses > 0 ? 1 - wrong / totalPasses : 1, 4)
  };
}

/** Точность решений по модели 3 — метрическая оценка того же запаса. */
function decisionQuality(margin) {
  const weights = decision.loadDistribution(9, CAPACITY);
  const r = decision.evaluateOverLoad('hysteresis', CAPACITY, margin, weights, 2500);

  return {
    margin,
    accuracy: r.accuracy,
    wrongPass: r.wrongPass,
    wrongStop: r.wrongStop
  };
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 7. Подбор запаса мест');

  console.log('');
  console.log('  Вместимость: ' + CAPACITY + ' человек');
  console.log('  Перебор запаса: ' + MARGINS.join(', ') + ' (в постановке 0–3)');
  console.log('  Дней на каждое значение: ' + DAYS);

  const started = Date.now();
  const operational = MARGINS.map((m) => evaluateMargin(m));
  const quality = MARGINS.map((m) => decisionQuality(m));

  console.log('  Расчёт занял ' + io.round((Date.now() - started) / 1000, 1) + ' с');

  io.header('Операционные показатели');
  io.table(['Запас', 'Ожидание всего, с', 'с 1-го этажа, с', 'с промежуточных, с',
    'Пиковый час, чел', 'Очередь, чел'],
    operational.map((r) => [r.margin, r.avgWait, r.avgWaitLobby, r.avgWaitUpper,
      r.peakThroughput, r.maxQueue]));

  console.log('');
  console.log('  Два столбца ожидания ведут себя по-разному: с первого этажа оно падает');
  console.log('  монотонно (лифт быстрее оборачивается), а с промежуточных сначала падает,');
  console.log('  потом снова растёт — там начинают сказываться проезды мимо.');

  io.header('Ошибочные решения за день');
  io.table(['Запас', 'Проездов', 'Зря проехал (FP)', 'Зря встал (FN)', 'Ошибок всего',
    'Доля верных проездов'],
    operational.map((r) => [r.margin, r.passes, r.wrongPasses, r.uselessStops,
      r.wrongDecisions, r.passAccuracy]));

  io.header('Качество решений');
  io.table(['Запас', 'Точность решений', 'Ошибка FP', 'Ошибка FN', 'Доля верных проездов'],
    quality.map((q, i) => [q.margin, q.accuracy, q.wrongPass, q.wrongStop,
      operational[i].passAccuracy]));

  // ---------- Выбор оптимума ----------

  // Отсеиваем значения, роняющие пиковую пропускную способность: разгружать
  // очередь ценой провозной способности бессмысленно.
  const bestThroughput = Math.max(...operational.map((r) => r.peakThroughput));
  const viable = operational.filter((r) => r.peakThroughput >= bestThroughput * 0.99);

  // Среди оставшихся берём лучшее для тех, кого система и проезжает мимо
  const optimum = viable.reduce((a, b) => (b.avgWaitUpper < a.avgWaitUpper ? b : a));

  io.header('Оптимум');
  console.log('');
  console.log('  Проходят по пропускной способности (не ниже ' +
    Math.round(bestThroughput * 0.99) + ' чел/пик): запас ' +
    viable.map((r) => r.margin).join(', '));
  console.log('  Из них лучшее ожидание на промежуточных этажах даёт запас ' +
    optimum.margin + '.');
  console.log('');
  console.log('  ОПТИМАЛЬНЫЙ ЗАПАС МЕСТ: ' + optimum.margin);
  console.log('');
  console.log('  При нём:');
  console.log('    ожидание с промежуточных этажей ' + optimum.avgWaitUpper + ' с');
  console.log('    ожидание с первого этажа        ' + optimum.avgWaitLobby + ' с');
  console.log('    среднее по всем                 ' + optimum.avgWait + ' с');
  console.log('    пиковый час                     ' + optimum.peakThroughput + ' чел');
  console.log('    самая длинная очередь           ' + optimum.maxQueue + ' чел');
  console.log('    ошибочных решений за день       ' + optimum.wrongDecisions +
    ' (' + optimum.wrongPasses + ' проездов зря + ' + optimum.uselessStops + ' остановок зря)');
  console.log('    доля верных проездов            ' + io.round(optimum.passAccuracy * 100, 1) + ' %');

  const zero = operational[0];
  console.log('');
  console.log('  Что даёт запас по сравнению с его отсутствием:');
  console.log('    ожидание с промежуточных ' + zero.avgWaitUpper + ' → ' +
    optimum.avgWaitUpper + ' с (' +
    io.round((optimum.avgWaitUpper / zero.avgWaitUpper - 1) * 100, 1) + ' %)');
  console.log('    бесполезных остановок    ' + zero.uselessStops + ' → ' + optimum.uselessStops);
  console.log('    но проездов зря          ' + zero.wrongPasses + ' → ' + optimum.wrongPasses);

  const tooBig = operational[operational.length - 1];
  console.log('');
  console.log('  Дальше запас увеличивать нечем: при ' + tooBig.margin +
    ' бесполезных остановок уже ' + tooBig.uselessStops + ', убирать больше нечего,');
  console.log('  а проездов зря становится ' + tooBig.wrongPasses + ' за день — и ожидание');
  console.log('  на промежуточных этажах снова растёт, до ' + tooBig.avgWaitUpper + ' с.');

  // ---------- Графики ----------

  await chart.save({
    type: 'line',
    data: {
      labels: operational.map((r) => r.margin),
      datasets: [
        {
          label: 'Ожидание с промежуточных этажей, с',
          data: operational.map((r) => r.avgWaitUpper),
          borderColor: chart.COLOR.full,
          borderWidth: 3,
          pointRadius: 6,
          tension: 0.2,
          yAxisID: 'y'
        },
        {
          label: 'Ожидание с первого этажа, с',
          data: operational.map((r) => r.avgWaitLobby),
          borderColor: chart.COLOR.accent,
          borderWidth: 3,
          pointRadius: 6,
          tension: 0.2,
          yAxisID: 'y'
        },
        {
          label: 'Пиковый час, чел',
          data: operational.map((r) => r.peakThroughput),
          borderColor: chart.COLOR.ok,
          borderWidth: 3,
          pointRadius: 6,
          tension: 0.2,
          yAxisID: 'y1'
        }
      ]
    },
    options: chart.options('Запас мест: первый этаж выигрывает, промежуточные — нет', {
      scales: {
        y: Object.assign(chart.axis('среднее ожидание, с'), { position: 'left' }),
        y1: Object.assign(chart.axis('пиковый час, человек'),
          { position: 'right', grid: { display: false } }),
        x: chart.axis('запас мест', { grid: { display: false } })
      }
    }, true)
  }, 'optimize_wait_throughput.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: operational.map((r) => r.margin),
      datasets: [
        {
          label: 'Проехал зря (FP) — человека бросили на этаже',
          data: operational.map((r) => r.wrongPasses),
          backgroundColor: chart.COLOR.full
        },
        {
          label: 'Встал зря (FN) — двери открылись впустую',
          data: operational.map((r) => r.uselessStops),
          backgroundColor: chart.COLOR.busy
        }
      ]
    },
    options: chart.options('Запас мест меняет один вид ошибок на другой', {
      scales: {
        y: chart.axis('случаев за день', { stacked: true, beginAtZero: true }),
        x: chart.axis('запас мест', { stacked: true, grid: { display: false } })
      }
    }, true)
  }, 'optimize_error_tradeoff.png');

  await chart.save({
    type: 'line',
    data: {
      labels: quality.map((q) => q.margin),
      datasets: [
        {
          label: 'Точность решений',
          data: quality.map((q) => q.accuracy),
          borderColor: chart.COLOR.violet,
          borderWidth: 3,
          pointRadius: 6,
          tension: 0.2
        },
        {
          label: 'Доля верных проездов',
          data: operational.map((r) => r.passAccuracy),
          borderColor: chart.COLOR.teal,
          borderWidth: 3,
          pointRadius: 6,
          tension: 0.2
        }
      ]
    },
    options: chart.options('Качество решений в зависимости от запаса мест', {
      scales: {
        y: chart.axis('доля', { beginAtZero: true, max: 1 }),
        x: chart.axis('запас мест', { grid: { display: false } })
      }
    }, true)
  }, 'optimize_accuracy.png');

  const result = {
    capacity: CAPACITY,
    margins: MARGINS,
    days: DAYS,
    operational,
    quality,
    optimum: optimum.margin,
    optimumDetails: optimum,
    baseline: zero
  };

  io.saveData('07-optimization', result);
  console.log('');
  console.log('  Графики: optimize_wait_throughput.png, optimize_error_tradeoff.png,');
  console.log('           optimize_accuracy.png');
  console.log('  Данные:  output/data/07-optimization.json');

  return result;
}

module.exports = { MARGINS, evaluateMargin, decisionQuality, run };

if (require.main === module) {
  run().catch((err) => { console.error('[optimize] Ошибка:', err.message); process.exit(1); });
}
