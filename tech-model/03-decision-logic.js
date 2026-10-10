/**
 * Модель 3. Алгоритм «остановиться или проехать мимо».
 *
 * Лифт едет вверх, на промежуточном этаже горит вызов. Камера показала
 * detected человек в кабине. Останавливаться или нет?
 *
 * Базовое правило:
 *   detected + safety_margin >= capacity   →  проехать
 *   иначе                                  →  остановиться
 *
 * Запас мест safety_margin нужен не для красоты: модель 2 показала, что
 * камера систематически НЕДОсчитывает людей из-за перекрытий. Сравнивать
 * её показания с вместимостью напрямую — значит гарантированно
 * останавливаться у полной кабины.
 *
 * Отдельный сюжет — пограничная зона. Когда оценка колеблется вокруг
 * порога, решение переворачивается от секунды к секунде, и лифт начинает
 * «метаться». Модель сравнивает три способа с этим справиться:
 *
 *   «порог»       — голое сравнение, без защиты от дребезга;
 *   «монетка»     — в зоне шириной 2 места решение бросается монеткой
 *                   (так сформулировано в исходной постановке);
 *   «гистерезис»  — в той же зоне СОХРАНЯЕТСЯ предыдущее решение.
 *
 * Запуск:  npm run tech:decision
 */

const PARAMS = require('./params');
const errors = require('./02-detection-errors');
const chart = require('./chart-helper');
const io = require('./io');

// Ширина пограничной зоны в местах
const BAND = 2;

// Запас мест по умолчанию; оптимальное значение ищет 07-optimization.js
const DEFAULT_MARGIN = 1;

const TRIALS = 20000;

// ---------- Эталон: как надо было поступить ----------

/**
 * Остановка полезна, если в кабину реально влезет хотя бы один человек.
 * Это и есть истина, с которой сравниваются решения системы.
 */
function shouldStop(realPeople, capacity) {
  return realPeople < capacity;
}

// ---------- Три правила ----------

/** Голое сравнение с порогом. */
function decideThreshold(detected, capacity, margin) {
  return detected + margin >= capacity ? 'pass' : 'stop';
}

/**
 * Пограничная зона с монеткой — буквально как в постановке задачи.
 * Внутри зоны решение каждый раз разыгрывается заново.
 */
function decideCoin(detected, capacity, margin, previous, rng) {
  const effective = detected + margin;

  if (effective >= capacity) return 'pass';
  if (effective < capacity - BAND) return 'stop';
  return rng() < 0.5 ? 'pass' : 'stop';
}

/**
 * Настоящий гистерезис: в пограничной зоне решение не пересматривается,
 * а наследуется. Переключение происходит, только когда оценка выходит
 * за границу зоны, — ровно это и гасит дребезг.
 */
function decideHysteresis(detected, capacity, margin, previous) {
  const effective = detected + margin;

  if (effective >= capacity) return 'pass';
  if (effective < capacity - BAND) return 'stop';
  return previous || 'stop';
}

const RULES = {
  threshold: { label: 'Порог', fn: decideThreshold },
  coin: { label: 'Монетка в зоне', fn: decideCoin },
  hysteresis: { label: 'Гистерезис', fn: decideHysteresis }
};

/** Единый вызов любого из правил. */
function decide(rule, detected, capacity, margin, previous, rng) {
  if (rule === 'coin') return decideCoin(detected, capacity, margin, previous, rng);
  if (rule === 'hysteresis') return decideHysteresis(detected, capacity, margin, previous);
  return decideThreshold(detected, capacity, margin);
}

// ---------- Оценка правила на одной загрузке ----------

/**
 * Прогоняет правило на серии решений при постоянной реальной загрузке.
 *
 * Кабина стоит на месте, меняются только показания камеры — так видно
 * чистое поведение правила, не смешанное с динамикой поездки.
 * Заодно считается дребезг: доля секунд, когда решение перевернулось
 * без всякой причины снаружи.
 */
function evaluateRule(rule, realPeople, capacity, margin, trials = TRIALS, opts) {
  const rng = io.makeRng(PARAMS.simulation.randomSeed + realPeople * 7717 + margin * 13);
  const truth = shouldStop(realPeople, capacity);

  let correct = 0;
  let wrongPass = 0; // FP: проехали, хотя место было
  let wrongStop = 0; // FN: остановились, хотя никто не влезет
  let flips = 0;
  let passes = 0;
  let previous = null;

  for (let i = 0; i < trials; i += 1) {
    const detected = errors.measure(realPeople, rng, opts).tracked;
    const action = decide(rule, detected, capacity, margin, previous, rng);

    if (action === 'pass') passes += 1;
    if ((action === 'stop') === truth) correct += 1;
    else if (action === 'pass') wrongPass += 1;
    else wrongStop += 1;

    if (previous !== null && action !== previous) flips += 1;
    previous = action;
  }

  return {
    rule,
    realPeople,
    capacity,
    margin,
    truth: truth ? 'остановиться' : 'проехать',
    accuracy: io.round(correct / trials, 4),
    pPass: io.round(passes / trials, 4),
    wrongPass: io.round(wrongPass / trials, 4),
    wrongStop: io.round(wrongStop / trials, 4),
    flipRate: io.round(flips / Math.max(trials - 1, 1), 4)
  };
}

/**
 * Распределение загрузки кабины при заданной средней.
 * Биномиальное по числу мест: простое, ограниченное сверху вместимостью
 * и с единственным параметром — то, что нужно для развёртки по интенсивности.
 */
function loadDistribution(meanOccupancy, capacity) {
  const p = Math.min(Math.max(meanOccupancy / capacity, 0), 1);
  const weights = {};

  const choose = (n, k) => {
    let r = 1;
    for (let i = 0; i < k; i += 1) r = r * (n - i) / (i + 1);
    return r;
  };

  for (let k = 0; k <= capacity; k += 1) {
    weights[k] = choose(capacity, k) * Math.pow(p, k) * Math.pow(1 - p, capacity - k);
  }

  return weights;
}

/** Средние показатели правила по всему распределению загрузки. */
function evaluateOverLoad(rule, capacity, margin, weights, trials = 3000, opts) {
  let accuracy = 0;
  let wrongPass = 0;
  let wrongStop = 0;
  let flipRate = 0;
  let pPass = 0;

  Object.keys(weights).forEach((key) => {
    const n = Number(key);
    const w = weights[key];
    if (w < 1e-6) return;

    const r = evaluateRule(rule, n, capacity, margin, trials, opts);
    accuracy += w * r.accuracy;
    wrongPass += w * r.wrongPass;
    wrongStop += w * r.wrongStop;
    flipRate += w * r.flipRate;
    pPass += w * r.pPass;
  });

  return {
    rule,
    margin,
    accuracy: io.round(accuracy, 4),
    wrongPass: io.round(wrongPass, 4),
    wrongStop: io.round(wrongStop, 4),
    flipRate: io.round(flipRate, 4),
    pPass: io.round(pPass, 4)
  };
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 3. Алгоритм «остановиться или проехать мимо»');

  const capacity = PARAMS.elevators.capacityRealPeak;
  const margin = DEFAULT_MARGIN;

  console.log('');
  console.log('  Вместимость: ' + capacity + ' человек (наблюдаемый пик), паспорт — ' +
    PARAMS.elevators.capacityPassport);
  console.log('  Запас мест по умолчанию: ' + margin + ' (оптимум ищет модель 7)');
  console.log('  Ширина пограничной зоны: ' + BAND + ' места');

  // ---------- Таблица сценариев ----------
  io.header('Разбор сценариев (правило «порог», запас мест 0)');

  const scenarios = [
    { real: 5, detected: 5, cap: 5, note: 'камера не ошиблась' },
    { real: 5, detected: 4, cap: 5, note: 'FN: одного не увидела' },
    { real: 3, detected: 4, cap: 5, note: 'FP: увидела лишнего' },
    { real: 9, detected: 10, cap: 10, note: 'FP: увидела лишнего' },
    { real: 9, detected: 8, cap: 10, note: 'FN: двоих не увидела' }
  ];

  const scenarioRows = scenarios.map((s) => {
    const action = decideThreshold(s.detected, s.cap, 0);
    const truth = shouldStop(s.real, s.cap);
    const ok = (action === 'stop') === truth;

    return [s.real, s.detected, s.cap, action === 'pass' ? 'проехать' : 'остановиться',
      ok ? 'верно' : 'ошибка', ok ? s.note : s.note + ' → ' +
        (action === 'pass' ? 'проехали мимо свободного места' : 'встали зря')];
  });

  io.table(['Реально', 'Камера', 'Вместимость', 'Решение', 'Итог', 'Что произошло'],
    scenarioRows);

  console.log('');
  console.log('  Эталон здесь один и явный: останавливаться стоит тогда и только тогда,');
  console.log('  когда в кабину реально влезет хотя бы один человек (real < capacity).');
  console.log('  По нему 9 человек из 10 — ещё не полная кабина, и проезд мимо');
  console.log('  засчитывается как ошибка, даже если на практике это разумный выбор.');
  console.log('  Ровно этот компромисс и настраивается запасом мест.');

  // ---------- Решения по всей шкале загрузки ----------
  io.header('Вероятность проехать мимо в зависимости от реальной загрузки');

  const byLoad = [];
  for (let n = 0; n <= capacity + 2; n += 1) {
    byLoad.push({
      people: n,
      threshold: evaluateRule('threshold', n, capacity, margin, 4000),
      hysteresis: evaluateRule('hysteresis', n, capacity, margin, 4000)
    });
  }

  io.table(['Людей', 'Надо', 'P(проехать)', 'Точность', 'Ошибка FP', 'Ошибка FN'],
    byLoad.map((r) => [r.people, r.threshold.truth, r.threshold.pPass,
      r.threshold.accuracy, r.threshold.wrongPass, r.threshold.wrongStop]));

  // ---------- Сравнение трёх правил ----------
  io.header('Три способа пройти пограничную зону');

  const peakWeights = loadDistribution(7, capacity);
  const ruleRows = Object.keys(RULES).map((key) => {
    const r = evaluateOverLoad(key, capacity, margin, peakWeights, 3000);
    return [RULES[key].label, r.accuracy, r.wrongPass, r.wrongStop, r.flipRate];
  });

  io.table(['Правило', 'Точность', 'Ошибка FP', 'Ошибка FN', 'Дребезг решений'], ruleRows);

  console.log('');
  console.log('  Дребезг — доля секунд, когда решение перевернулось само по себе,');
  console.log('  без изменения обстановки. Монетка в пограничной зоне, вопреки');
  console.log('  замыслу, дребезг не гасит, а создаёт: каждое попадание в зону —');
  console.log('  это новый бросок. Гистерезис в той же зоне держит прошлое решение');
  console.log('  и переключается, только когда оценка выходит за её границу.');

  // ---------- Сколько этажей пропустит за день ----------
  io.header('Пропуски этажей при разной интенсивности вызовов');

  const CALLS_PER_DAY = 900; // промежуточных вызовов за учебный день
  const intensityRows = [];
  const intensity = [];

  [2, 4, 6, 8, 9].forEach((meanOcc) => {
    const weights = loadDistribution(meanOcc, capacity);
    const r = evaluateOverLoad('hysteresis', capacity, margin, weights, 2500);

    const skipped = Math.round(r.pPass * CALLS_PER_DAY);
    const wrongPass = Math.round(r.wrongPass * CALLS_PER_DAY);
    const wrongStop = Math.round(r.wrongStop * CALLS_PER_DAY);

    intensity.push({ meanOccupancy: meanOcc, pPass: r.pPass, skipped, wrongPass, wrongStop,
      accuracy: r.accuracy });
    intensityRows.push([meanOcc, r.pPass, skipped, wrongPass, wrongStop, r.accuracy]);
  });

  io.table(['Средняя загрузка', 'Доля проездов', 'Пропущено этажей/день',
    'из них зря (FP)', 'Зря остановок (FN)', 'Точность'], intensityRows);

  console.log('');
  console.log('  Расчёт на ' + CALLS_PER_DAY + ' промежуточных вызовов за учебный день.');

  // ---------- Какая точность камеры нужна ----------
  io.header('Какая точность детектора нужна для 95 % верных решений');

  // Развёртку считаем при двух запасах мест. Это принципиально:
  // запас подобран под недосчёт КОНКРЕТНОГО детектора, и если улучшать
  // камеру, не трогая запас, решения начнут портиться — хорошая камера
  // перестанет попадать в ту компенсацию, под которую запас настраивался.
  const qualityRows = [];
  const quality = [];

  [0.80, 0.85, 0.90, 0.92, 0.95, 0.97, 0.99].forEach((map50) => {
    const calibrated = evaluateOverLoad('hysteresis', capacity, 0, peakWeights, 2000, { map50 });
    const fixed = evaluateOverLoad('hysteresis', capacity, margin, peakWeights, 2000, { map50 });

    quality.push({
      map50,
      accuracy: calibrated.accuracy,
      wrongPass: calibrated.wrongPass,
      wrongStop: calibrated.wrongStop,
      accuracyFixedMargin: fixed.accuracy
    });

    qualityRows.push([map50, calibrated.accuracy, calibrated.wrongPass,
      calibrated.wrongStop, fixed.accuracy]);
  });

  io.table(['map50', 'Точность (запас 0)', 'Ошибка FP', 'Ошибка FN',
    'Точность (запас ' + margin + ')'], qualityRows);

  const enough = quality.find((q) => q.accuracy >= 0.95);
  console.log('');
  if (enough) {
    console.log('  Порога 95 % верных решений хватает начиная с map50 = ' + enough.map50 + '.');
  } else {
    console.log('  Даже при map50 = 0.99 точность решений не достигает 95 %:');
    console.log('  упирается не детектор, а перекрытия — их не лечит никакая модель.');
  }

  console.log('');
  console.log('  Обратите внимание на последний столбец: при ЗАФИКСИРОВАННОМ запасе мест');
  console.log('  точность с ростом качества камеры не растёт, а падает. Это не парадокс:');
  console.log('  запас в ' + margin + ' место подобран под недосчёт именно этого детектора.');
  console.log('  Поставив камеру лучше и не перенастроив запас, система начнёт проезжать');
  console.log('  мимо свободных мест. Запас и камеру надо настраивать вместе — этим');
  console.log('  занимается модель 7.');

  // ---------- Графики ----------

  await chart.save({
    type: 'line',
    data: {
      labels: byLoad.map((r) => r.people),
      datasets: [
        {
          label: 'Вероятность проехать мимо',
          data: byLoad.map((r) => r.threshold.pPass),
          borderColor: chart.COLOR.accent,
          backgroundColor: 'rgba(91, 141, 239, 0.12)',
          fill: true,
          borderWidth: 3,
          pointRadius: 4,
          tension: 0.2
        },
        {
          label: 'Правильное решение (1 — проехать, 0 — остановиться)',
          data: byLoad.map((r) => r.threshold.truth === 'проехать' ? 1 : 0),
          borderColor: chart.COLOR.grey,
          borderDash: [8, 5],
          borderWidth: 2,
          pointRadius: 0,
          stepped: true
        }
      ]
    },
    options: chart.options('Решение системы против идеального решения', {
      scales: {
        y: chart.axis('вероятность', { beginAtZero: true, max: 1 }),
        x: chart.axis('реально людей в кабине', { grid: { display: false } })
      }
    }, true)
  }, 'decision_pass_probability.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: ruleRows.map((r) => r[0]),
      datasets: [
        {
          label: 'Точность решений',
          data: ruleRows.map((r) => r[1]),
          backgroundColor: chart.COLOR.ok
        },
        {
          label: 'Дребезг решений',
          data: ruleRows.map((r) => r[4]),
          backgroundColor: chart.COLOR.full
        }
      ]
    },
    options: chart.options('Монетка в пограничной зоне дребезг создаёт, а не гасит', {
      scales: {
        y: chart.axis('доля', { beginAtZero: true, max: 1 }),
        x: chart.axis('', { grid: { display: false } })
      }
    }, true)
  }, 'decision_rules_compare.png');

  await chart.save({
    type: 'line',
    data: {
      labels: quality.map((q) => q.map50),
      datasets: [
        {
          label: 'Запас мест подобран под камеру (0)',
          data: quality.map((q) => q.accuracy),
          borderColor: chart.COLOR.accent,
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.2
        },
        {
          label: 'Запас мест зафиксирован (' + margin + ')',
          data: quality.map((q) => q.accuracyFixedMargin),
          borderColor: chart.COLOR.busy,
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.2
        },
        {
          label: 'Цель 95 %',
          data: quality.map(() => 0.95),
          borderColor: chart.COLOR.full,
          borderDash: [8, 5],
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: chart.options('Камеру и запас мест нужно настраивать вместе', {
      scales: {
        y: chart.axis('доля верных решений', { min: 0.5, max: 1 }),
        x: chart.axis('map50 детектора', { grid: { display: false } })
      }
    }, true)
  }, 'decision_vs_map50.png');

  const result = {
    capacity,
    margin,
    band: BAND,
    callsPerDay: CALLS_PER_DAY,
    scenarios: scenarios.map((s, i) => ({
      real: s.real, detected: s.detected, capacity: s.cap,
      action: scenarioRows[i][3], correct: scenarioRows[i][4] === 'верно', note: s.note
    })),
    byLoad: byLoad.map((r) => ({
      people: r.people, truth: r.threshold.truth,
      pPass: r.threshold.pPass, accuracy: r.threshold.accuracy,
      wrongPass: r.threshold.wrongPass, wrongStop: r.threshold.wrongStop,
      hysteresisAccuracy: r.hysteresis.accuracy
    })),
    rules: Object.keys(RULES).map((key, i) => ({
      rule: key, label: RULES[key].label, accuracy: ruleRows[i][1],
      wrongPass: ruleRows[i][2], wrongStop: ruleRows[i][3], flipRate: ruleRows[i][4]
    })),
    intensity,
    quality,
    enoughAt: enough ? enough.map50 : null
  };

  io.saveData('03-decision', result);
  console.log('');
  console.log('  Графики: decision_pass_probability.png, decision_rules_compare.png,');
  console.log('           decision_vs_map50.png');
  console.log('  Данные:  output/data/03-decision.json');

  return result;
}

module.exports = {
  BAND, DEFAULT_MARGIN, RULES,
  shouldStop, decideThreshold, decideCoin, decideHysteresis, decide,
  evaluateRule, loadDistribution, evaluateOverLoad, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[decision] Ошибка:', err.message); process.exit(1); });
}
