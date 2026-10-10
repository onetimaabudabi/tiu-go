/**
 * Модель 5. Эффективность системы: accuracy, precision, recall, F1.
 *
 * Решение «проехать мимо» — это бинарная классификация, и оценивать её
 * надо как классификацию. Положительным классом считается «кабина полная,
 * надо проезжать»:
 *
 *   TP — полная, проехали          правильно, сэкономили остановку
 *   FP — есть место, проехали      ошибка: бросили человека на этаже
 *   FN — полная, остановились      ошибка: встали зря, все подождали
 *   TN — есть место, остановились  правильно, человек уехал
 *
 *   precision = TP / (TP + FP)  — какая доля проездов была оправдана
 *   recall    = TP / (TP + FN)  — какую долю полных кабин система распознала
 *   F1        = 2·P·R / (P + R)
 *
 * Цена у ошибок разная, и это важно. FN стоит 7 секунд дверей для всех,
 * кто уже в кабине. FP стоит целого круга ожидания тому, мимо кого
 * проехали. Поэтому precision здесь дороже recall, и система должна
 * ошибаться скорее в сторону лишней остановки.
 *
 * Условия различаются двумя вещами:
 *   освещение — в тусклом свете растут систематические пропуски;
 *   загрузка  — в пик людей больше, перекрытий больше, счёт хуже.
 *
 * Запуск:  npm run tech:effect
 */

const PARAMS = require('./params');
const errors = require('./02-detection-errors');
const decision = require('./03-decision-logic');
const physics = require('./04-elevator-physics');
const chart = require('./chart-helper');
const io = require('./io');

const TRIALS = 6000;

/**
 * Четыре условия работы.
 *
 * extraMiss — добавка к систематическим пропускам от освещения.
 * Половина штрафа darknessPenalty в плюс вечером и в минус днём:
 * параметры в params.js измерены для среднего освещения кабины.
 */
const CONDITIONS = [
  { key: 'dayOffPeak',     label: 'День, вне пика',  extraMiss: -PARAMS.camera.darknessPenalty / 2, meanOccupancy: 3 },
  { key: 'dayPeak',        label: 'День, пик',       extraMiss: -PARAMS.camera.darknessPenalty / 2, meanOccupancy: 9 },
  { key: 'eveningOffPeak', label: 'Вечер, вне пика', extraMiss:  PARAMS.camera.darknessPenalty / 2, meanOccupancy: 3 },
  { key: 'eveningPeak',    label: 'Вечер, пик',      extraMiss:  PARAMS.camera.darknessPenalty / 2, meanOccupancy: 9 }
];

// ---------- Метрики ----------

/**
 * Считает TP/FP/FN/TN для заданных условий, усредняя по распределению
 * загрузки кабины. Решение принимается тем же правилом, что в модели 3.
 */
function metrics(condition, capacity, margin, rule = 'hysteresis') {
  const weights = decision.loadDistribution(condition.meanOccupancy, capacity);
  const opts = { extraMiss: condition.extraMiss };

  let TP = 0;
  let FP = 0;
  let FN = 0;
  let TN = 0;
  let baseRate = 0; // как часто кабина вообще бывает полной

  Object.keys(weights).forEach((key) => {
    const n = Number(key);
    const w = weights[key];
    if (w < 1e-6) return;

    const rng = io.makeRng(PARAMS.simulation.randomSeed + n * 6271 + margin * 31);
    const trulyFull = !decision.shouldStop(n, capacity);
    if (trulyFull) baseRate += w;
    let previous = null;
    let passes = 0;

    for (let i = 0; i < TRIALS; i += 1) {
      const detected = errors.measure(n, rng, opts).tracked;
      const action = decision.decide(rule, detected, capacity, margin, previous, rng);
      if (action === 'pass') passes += 1;
      previous = action;
    }

    const pPass = passes / TRIALS;

    if (trulyFull) {
      TP += w * pPass;
      FN += w * (1 - pPass);
    } else {
      FP += w * pPass;
      TN += w * (1 - pPass);
    }
  });

  const precision = TP + FP > 0 ? TP / (TP + FP) : null;
  const recall = TP + FN > 0 ? TP / (TP + FN) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;

  // Когда полная кабина почти не встречается, положительного класса
  // фактически нет: precision, recall и F1 считаются от долей процента
  // и ничего не характеризуют. Такие условия честнее оценивать точностью
  // и долей ложных проездов, а F1 помечать как неприменимый.
  const interpretable = baseRate >= 0.01;

  return {
    key: condition.key,
    label: condition.label,
    meanOccupancy: condition.meanOccupancy,
    baseRate: io.round(baseRate, 4),
    interpretable,
    TP: io.round(TP, 4),
    FP: io.round(FP, 4),
    FN: io.round(FN, 4),
    TN: io.round(TN, 4),
    accuracy: io.round(TP + TN, 4),
    precision: precision === null ? null : io.round(precision, 4),
    recall: recall === null ? null : io.round(recall, 4),
    f1: f1 === null ? null : io.round(f1, 4)
  };
}

/**
 * Экономия времени системой в тех же условиях.
 * Берётся из физической модели: сколько секунд рейса отсекают
 * пропущенные остановки.
 */
function timeSaving(condition, callsPerTrip = 3, margin = decision.DEFAULT_MARGIN) {
  const c = physics.compareModes(condition.meanOccupancy, callsPerTrip, margin,
    { extraMiss: condition.extraMiss });

  return {
    key: condition.key,
    label: condition.label,
    tripWithout: c.without.total,
    tripWith: c.withSystem.total,
    savedSeconds: c.savedSeconds,
    savedPercent: c.savedPercent,
    throughputGain: c.gainPercent
  };
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 5. Эффективность системы: accuracy, precision, recall, F1');

  const capacity = PARAMS.elevators.capacityRealPeak;
  const margin = decision.DEFAULT_MARGIN;

  console.log('');
  console.log('  Положительный класс: «кабина полная, надо проезжать»');
  console.log('  Вместимость ' + capacity + ', запас мест ' + margin + ', правило — гистерезис');

  // Метрики по условиям
  io.header('Метрики по условиям работы');
  const results = CONDITIONS.map((c) => metrics(c, capacity, margin));

  const dash = (v) => (v === null ? '—' : v);

  io.table(['Условие', 'Полная кабина', 'Accuracy', 'Precision', 'Recall', 'F1'],
    results.map((r) => [r.label, r.baseRate, r.accuracy,
      r.interpretable ? dash(r.precision) : '—',
      r.interpretable ? dash(r.recall) : '—',
      r.interpretable ? dash(r.f1) : '—']));

  console.log('');
  console.log('  Столбец «полная кабина» — как часто она вообще бывает полной.');
  console.log('  Вне пика это доли процента: положительного класса практически нет,');
  console.log('  и precision, recall и F1 там считать не от чего. Такие условия');
  console.log('  оцениваются точностью и долей ложных проездов (таблица ниже).');

  io.header('Из чего складываются метрики');
  io.table(['Условие', 'TP', 'FP', 'FN', 'TN'],
    results.map((r) => [r.label, r.TP, r.FP, r.FN, r.TN]));

  const scored = results.filter((r) => r.interpretable);
  const best = scored.reduce((a, b) => (b.f1 > a.f1 ? b : a));
  const worst = scored.reduce((a, b) => (b.f1 < a.f1 ? b : a));

  console.log('');
  console.log('  Среди условий, где метрики применимы:');
  console.log('    лучше всего — «' + best.label + '», F1 = ' + best.f1);
  console.log('    хуже всего  — «' + worst.label + '», F1 = ' + worst.f1);
  console.log('');
  console.log('  Вне пика система почти не вмешивается: доля ложных проездов ' +
    results.filter((r) => !r.interpretable).map((r) => r.FP).join(' и ') + ' —');
  console.log('  практически никого мимо не проезжает, и это ровно то поведение,');
  console.log('  которое от неё нужно в спокойное время.');

  // Экономия времени
  io.header('Экономия времени в тех же условиях');
  const savings = CONDITIONS.map((c) => timeSaving(c));

  io.table(['Условие', 'Рейс без системы, с', 'Рейс с системой, с', 'Экономия, с',
    'Экономия, %', 'Прирост пропускной, %'],
    savings.map((s) => [s.label, s.tripWithout, s.tripWith, s.savedSeconds,
      s.savedPercent, s.throughputGain]));

  console.log('');
  console.log('  Вне пика экономить нечего: кабина не заполняется, и система просто');
  console.log('  не вмешивается. Весь выигрыш приходится на пик — ровно тогда, когда');
  console.log('  он и нужен.');

  // Зависимость от запаса мест
  io.header('Как запас мест меняет баланс ошибок в пик');

  const marginRows = [];
  const byMargin = [];
  const peakConditions = CONDITIONS.filter((c) => c.meanOccupancy >= 8);

  [0, 1, 2, 3].forEach((m) => {
    const row = [m];
    const entry = { margin: m, conditions: {} };

    peakConditions.forEach((cond) => {
      const r = metrics(cond, capacity, m);
      row.push(r.precision === null ? '—' : r.precision);
      row.push(r.recall === null ? '—' : r.recall);
      entry.conditions[cond.key] = { precision: r.precision, recall: r.recall, f1: r.f1 };
    });

    marginRows.push(row);
    byMargin.push(entry);
  });

  io.table(['Запас мест'].concat(
    peakConditions.flatMap((c) => [c.label + ': precision', c.label + ': recall'])),
    marginRows);

  console.log('');
  console.log('  Видно, в какую сторону работает запас: он поднимает recall —');
  console.log('  система увереннее распознаёт полную кабину, — но роняет precision,');
  console.log('  потому что начинает проезжать и мимо тех, кто ещё мог бы войти.');
  console.log('  Где именно проходит оптимум, решает модель 7.');

  // Цена ошибок
  io.header('Чего стоит каждая ошибка');
  const doorCost = physics.DOOR_CYCLE;
  const waitCost = Math.round(physics.compareModes(9, 3).without.total);

  io.table(['Ошибка', 'Что происходит', 'Цена'], [
    ['FN', 'остановились у полной кабины', doorCost + ' с для всех, кто внутри'],
    ['FP', 'проехали мимо свободного места', '≈ ' + waitCost + ' с ожидания следующего рейса']
  ]);

  console.log('');
  console.log('  Цена FP примерно в ' + io.round(waitCost / doorCost, 0) + ' раз выше цены FN.');
  console.log('  Отсюда правило настройки: при сомнении лучше остановиться.');
  console.log('  В метриках это значит, что precision важнее recall.');

  // ---------- Графики ----------

  await chart.save({
    type: 'bar',
    data: {
      labels: results.map((r) => r.label),
      datasets: [
        { label: 'Accuracy', data: results.map((r) => r.accuracy), backgroundColor: chart.COLOR.accent },
        { label: 'Precision', data: results.map((r) => r.interpretable ? r.precision : null), backgroundColor: chart.COLOR.ok },
        { label: 'Recall', data: results.map((r) => r.interpretable ? r.recall : null), backgroundColor: chart.COLOR.busy },
        { label: 'F1', data: results.map((r) => r.interpretable ? r.f1 : null), backgroundColor: chart.COLOR.violet }
      ]
    },
    options: chart.options('Качество решений в разных условиях', {
      scales: {
        y: chart.axis('значение метрики', { beginAtZero: true, max: 1 }),
        x: chart.axis('', { grid: { display: false } })
      }
    }, true)
  }, 'effect_metrics_by_condition.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: results.map((r) => r.label),
      datasets: [{
        label: 'F1-score (вне пика не определён)',
        data: results.map((r) => r.interpretable ? r.f1 : null),
        backgroundColor: results.map((r) =>
          r.f1 === best.f1 ? chart.COLOR.ok : (r.f1 === worst.f1 ? chart.COLOR.full : chart.COLOR.accent))
      }]
    },
    options: chart.options('F1-score по условиям: пик и темнота бьют по качеству', {
      scales: {
        y: chart.axis('F1', { beginAtZero: true, max: 1 }),
        x: chart.axis('', { grid: { display: false } })
      }
    })
  }, 'effect_f1.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: savings.map((s) => s.label),
      datasets: [
        { label: 'Рейс без системы', data: savings.map((s) => s.tripWithout), backgroundColor: chart.COLOR.grey },
        { label: 'Рейс с системой', data: savings.map((s) => s.tripWith), backgroundColor: chart.COLOR.accent }
      ]
    },
    options: chart.options('Время рейса: весь выигрыш приходится на пик', {
      scales: {
        y: chart.axis('секунд на рейс', { beginAtZero: true }),
        x: chart.axis('', { grid: { display: false } })
      }
    }, true)
  }, 'effect_time_saving.png');

  const result = {
    capacity,
    margin,
    conditions: results,
    byMargin,
    savings,
    best: { label: best.label, f1: best.f1 },
    worst: { label: worst.label, f1: worst.f1 },
    errorCost: { falseNegativeSeconds: doorCost, falsePositiveSeconds: waitCost }
  };

  io.saveData('05-effectiveness', result);
  console.log('');
  console.log('  Графики: effect_metrics_by_condition.png, effect_f1.png, effect_time_saving.png');
  console.log('  Данные:  output/data/05-effectiveness.json');

  return result;
}

module.exports = { CONDITIONS, metrics, timeSaving, run };

if (require.main === module) {
  run().catch((err) => { console.error('[effect] Ошибка:', err.message); process.exit(1); });
}
