/**
 * Модель 2. Ошибки детекции: FP, FN, перекрытия и секундное окно.
 *
 * Камера не измеряет число людей, а оценивает его, и ошибается в обе стороны:
 *
 *   FN (false negative) — человека не увидели. Система решит, что место
 *                         есть, лифт остановится, а войти будет некуда.
 *   FP (false positive) — увидели того, кого нет. Система решит, что
 *                         кабина полная, и проедет мимо ждущих людей.
 *
 * Ошибки принципиально разного происхождения, и это главное в модели:
 *
 *   1. ПЕРЕКРЫТИЯ. Человек за спиной соседа не виден ни в одном кадре
 *      секунды. Ошибка систематическая, окном не лечится.
 *   2. МЕРЦАНИЕ. В тесной кабине уверенность падает, и рамка то появляется,
 *      то пропадает от кадра к кадру. Ошибка случайная и окном лечится.
 *
 * Поэтому способ чтения счёта важнее самого детектора. Модель сравнивает два:
 *
 *   «среднее»  — усреднить число рамок по 30 кадрам. Наивный способ:
 *                мерцание смещает среднее вниз, и счёт занижается.
 *   «трекинг»  — человек засчитан, если трек подтверждён тремя подряд
 *                кадрами. Так работают реальные счётчики (ByteTrack,
 *                DeepSORT): мерцание гасится, случайная рамка не успевает
 *                подтвердиться, а перекрытие по-прежнему не лечится.
 *
 * Запуск:  npm run tech:errors
 */

const PARAMS = require('./params');
const camera = require('./01-camera-model');
const chart = require('./chart-helper');
const io = require('./io');

const CAM = PARAMS.camera;

// Кадров в окне принятия решения (одна секунда)
const FRAMES_PER_WINDOW = CAM.fps;

// Сколько подряд идущих кадров трекер требует для подтверждения объекта.
// Три — типовая настройка min_hits у ByteTrack и DeepSORT.
const TRACK_MIN_HITS = 3;

// Выше этой доли мерцания рамка уже не несёт информации
const MAX_FLICKER = 0.9;

// Сколько раз разыгрываем каждую ситуацию
const TRIALS = 20000;

// ---------- Качество детектора ----------

/**
 * Частоты ошибок при заданной точности детектора.
 *
 * Все три частоты из params.js измерены для YOLOv8n с map50 = 0.92.
 * Для другой модели они пересчитываются пропорционально доле
 * НЕраспознанного: детектор с map50 = 0.96 ошибается вдвое реже,
 * чем с 0.92, потому что 1 − 0.96 вдвое меньше 1 − 0.92.
 *
 *   k = (1 − map50) / (1 − map50_базовое)
 *
 * Это нужно, чтобы в модели 3 можно было спросить: какой точности
 * камера достаточна, чтобы решения были верными в 95 % случаев.
 */
function rates(map50 = CAM.map50) {
  const k = (1 - map50) / (1 - CAM.map50);

  return {
    map50,
    scale: k,
    falseNegative: CAM.falseNegativeRate * k,
    falsePositive: CAM.falsePositiveRate * k,
    occlusion: CAM.occludedPersonPenalty * k
  };
}

// ---------- Два источника ошибок ----------

/**
 * Доля людей, перекрытых соседями. Та же экспонента, что в модели 1:
 * первый человек в кабине перекрыть себя не может, дальше вероятность
 * растёт и выходит на насыщение.
 */
function occludedShare(n) {
  const effective = CAM.useCorrectedOcclusion ? Math.max(n - 1, 0) : n;
  return 1 - Math.exp(-effective / 3);
}

/**
 * Систематические пропуски: перекрытого человека не видно всю секунду.
 * Потолок — occludedPersonPenalty: даже в битком набитой кабине часть
 * пассажиров остаётся на виду у камеры.
 */
function systematicMissRate(n, map50, extraMiss = 0) {
  return Math.min(Math.max(occludedShare(n) * rates(map50).occlusion + extraMiss, 0), 0.9);
}

/**
 * Мерцание рамки в одном кадре: базовый промах детектора плюс потеря
 * уверенности от тесноты. Это НЕ пропуск человека — в следующем кадре
 * рамка, скорее всего, вернётся.
 */
function flickerRate(n, map50, extraFlicker = 0) {
  return Math.min(
    rates(map50).falseNegative + camera.crowdPenalty(n) + extraFlicker,
    MAX_FLICKER
  );
}

/**
 * Ожидаемое число ложных рамок за кадр.
 * Кандидатов тем больше, чем насыщеннее кадр: берём n + 1 областей
 * (каждый человек как источник двойной рамки плюс фон).
 */
function falsePositiveRate(n, map50) {
  return rates(map50).falsePositive * (n + 1);
}

// ---------- Розыгрыш одного измерения ----------

/** Есть ли в последовательности `hits` серия из `need` подряд. */
function hasRun(hits, need) {
  let run = 0;
  for (let i = 0; i < hits.length; i += 1) {
    run = hits[i] ? run + 1 : 0;
    if (run >= need) return true;
  }
  return false;
}

/**
 * Что покажет камера за секунду, если в кабине реально n человек.
 *
 * Сначала разыгрывается, кто перекрыт — на всю секунду сразу.
 * Затем по каждому видимому человеку и каждой ложной области строится
 * история из тридцати кадров, и счёт читается двумя способами.
 *
 * @param {object} [opts]
 * @param {number} [opts.map50] — точность детектора, если не штатная
 * @param {number} [opts.extraMiss] — добавка к СИСТЕМАТИЧЕСКИМ пропускам.
 *        Сюда попадает освещение: в тусклом свете человек в дальнем углу
 *        не опознаётся ни в одном кадре, и окно решения не помогает.
 *        Именно так освещение влияет на счёт, а не через мерцание —
 *        мерцание трекинг гасит почти полностью (модель 5).
 * @param {number} [opts.extraFlicker] — добавка к мерцанию рамки
 * @returns {{tracked: number, averaged: number}}
 */
function measure(n, rng, opts) {
  const o = typeof opts === 'number' ? { map50: opts } : (opts || {});
  const map50 = o.map50;
  const hidden = systematicMissRate(n, map50, o.extraMiss || 0);
  const flicker = flickerRate(n, map50, o.extraFlicker || 0);
  const fpPerFrame = rates(map50).falsePositive;

  let trackedPeople = 0;
  let frameSum = 0;

  for (let i = 0; i < n; i += 1) {
    // Перекрыт на всю секунду — не виден ни в одном кадре
    if (rng() < hidden) continue;

    const hits = [];
    for (let f = 0; f < FRAMES_PER_WINDOW; f += 1) {
      const seen = rng() >= flicker;
      hits.push(seen);
      if (seen) frameSum += 1;
    }

    if (hasRun(hits, TRACK_MIN_HITS)) trackedPeople += 1;
  }

  // Ложные рамки: каждая из n+1 областей живёт своей жизнью
  let trackedGhosts = 0;
  for (let k = 0; k < n + 1; k += 1) {
    const hits = [];
    for (let f = 0; f < FRAMES_PER_WINDOW; f += 1) {
      const seen = rng() < fpPerFrame;
      hits.push(seen);
      if (seen) frameSum += 1;
    }

    if (hasRun(hits, TRACK_MIN_HITS)) trackedGhosts += 1;
  }

  return {
    tracked: trackedPeople + trackedGhosts,
    averaged: Math.round(frameSum / FRAMES_PER_WINDOW)
  };
}

/** Распределение показаний камеры при n реальных людях. */
function measurementDistribution(n, trials = TRIALS, opts) {
  const rng = io.makeRng(PARAMS.simulation.randomSeed + n * 7919);
  const tracked = [];
  const averaged = [];

  for (let i = 0; i < trials; i += 1) {
    const m = measure(n, rng, opts);
    tracked.push(m.tracked);
    averaged.push(m.averaged);
  }

  const st = io.stats(tracked);
  const sa = io.stats(averaged);
  const exact = tracked.filter((x) => x === n).length / trials;

  return {
    people: n,
    mean: io.round(st.mean, 3),
    sd: io.round(st.sd, 3),
    bias: io.round(st.mean - n, 3),
    meanAveraged: io.round(sa.mean, 3),
    biasAveraged: io.round(sa.mean - n, 3),
    exact: io.round(exact, 4),
    under: io.round(tracked.filter((x) => x < n).length / trials, 4),
    over: io.round(tracked.filter((x) => x > n).length / trials, 4),
    error: io.round(1 - exact, 4)
  };
}

// ---------- Матрица ошибок для решения «полный / не полный» ----------

/**
 * Матрица ошибок при заданной истинной загрузке.
 *
 * Классом «положительно» считается «кабина полная»: именно по нему
 * система принимает решение проехать мимо этажа.
 */
function confusionAt(n, capacity, trials = TRIALS, opts) {
  const rng = io.makeRng(PARAMS.simulation.randomSeed + n * 104729 + capacity);
  const trulyFull = n >= capacity;

  let detectedFull = 0;
  for (let i = 0; i < trials; i += 1) {
    if (measure(n, rng, opts).tracked >= capacity) detectedFull += 1;
  }

  const pFull = detectedFull / trials;

  return {
    people: n,
    capacity,
    trulyFull,
    pDetectedFull: io.round(pFull, 4),
    pDetectedFree: io.round(1 - pFull, 4),
    pError: io.round(trulyFull ? 1 - pFull : pFull, 4),
    errorType: trulyFull ? 'FN — лифт остановится зря' : 'FP — лифт проедет мимо'
  };
}

/**
 * Полная матрица 2×2, усреднённая по распределению загрузки.
 * Веса — насколько часто кабина бывает заполнена так или иначе.
 */
function confusionMatrix(capacity, loadWeights, trials = 4000) {
  let TP = 0;
  let FN = 0;
  let FP = 0;
  let TN = 0;
  const rows = [];

  Object.keys(loadWeights).forEach((key) => {
    const n = Number(key);
    const w = loadWeights[key];
    const c = confusionAt(n, capacity, trials);

    if (c.trulyFull) {
      TP += w * c.pDetectedFull;
      FN += w * c.pDetectedFree;
    } else {
      FP += w * c.pDetectedFull;
      TN += w * c.pDetectedFree;
    }

    rows.push(Object.assign({ weight: w }, c));
  });

  return {
    capacity,
    TP: io.round(TP, 4),
    FN: io.round(FN, 4),
    FP: io.round(FP, 4),
    TN: io.round(TN, 4),
    accuracy: io.round(TP + TN, 4),
    rows
  };
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 2. Ошибки детекции: FP, FN и секундное окно');

  const capacity = PARAMS.elevators.capacityRealPeak;

  console.log('');
  console.log('  Базовые ошибки детектора: FP ' + (CAM.falsePositiveRate * 100) + ' %, FN ' +
    (CAM.falseNegativeRate * 100) + ' %');
  console.log('  Окно решения: ' + FRAMES_PER_WINDOW + ' кадров (' +
    CAM.detectionLatency + ' мс на кадр), подтверждение трека — ' +
    TRACK_MIN_HITS + ' кадра подряд');
  console.log('  Вместимость для решения: ' + capacity + ' человек');

  // Два источника ошибок
  io.header('Два источника ошибок: перекрытия и мерцание');
  const splitRows = [];
  for (let n = 1; n <= 12; n += 1) {
    splitRows.push([n, io.round(occludedShare(n) * 100, 1),
      io.round(systematicMissRate(n) * 100, 1), io.round(flickerRate(n) * 100, 1),
      io.round(falsePositiveRate(n), 2)]);
  }
  io.table(['Людей', 'Перекрыто, %', 'Систем. пропуск, %', 'Мерцание/кадр, %',
    'Ложных рамок/кадр'], splitRows);

  console.log('');
  console.log('  Мерцание гасится окном: чтобы потерять человека, рамка должна пропасть');
  console.log('  во всех ' + FRAMES_PER_WINDOW + ' кадрах или ни разу не продержаться ' +
    TRACK_MIN_HITS + ' кадра подряд.');
  console.log('  Перекрытие окном не лечится: заслонённый человек заслонён всю секунду.');

  // Распределение показаний
  io.header('Что показывает камера при разном числе людей');
  const dist = [];
  const distRows = [];
  for (let n = 1; n <= 12; n += 1) {
    const d = measurementDistribution(n, 8000);
    dist.push(d);
    distRows.push([n, d.mean, d.bias, d.sd, io.round(d.exact * 100, 1), d.meanAveraged,
      d.biasAveraged]);
  }
  io.table(['Реально', 'Трекинг', 'Смещение', 'СКО', 'Точно, %', 'Среднее по кадрам',
    'Смещение'], distRows);

  const firstBad = dist.find((d) => d.error > 0.10);
  console.log('');
  console.log('  Вероятность ошибиться в счёте превышает 10 % начиная с ' +
    (firstBad ? firstBad.people + ' человек' : 'более чем 12 человек') + '.');
  console.log('  Трекинг против наивного усреднения при полной кабине: смещение ' +
    dist[capacity - 1].bias + ' против ' + dist[capacity - 1].biasAveraged + ' человека.');

  // Матрица ошибок для 5, 7 и 10 человек
  io.header('Матрица ошибок решения «кабина полная» (порог ' + capacity + ')');
  const focus = [5, 7, 10].map((n) => confusionAt(n, capacity, 20000));
  io.table(['Реально', 'Истинно полная', 'P(решит «полная»)', 'P(решит «есть место»)',
    'P(ошибки)', 'Тип ошибки'],
    focus.map((c) => [c.people, c.trulyFull ? 'да' : 'нет', c.pDetectedFull,
      c.pDetectedFree, c.pError, c.errorType]));

  // Ошибка по всей шкале загрузки
  const errorCurve = [];
  for (let n = 1; n <= 12; n += 1) errorCurve.push(confusionAt(n, capacity, 6000));

  const over5 = errorCurve.filter((c) => c.pError > 0.05).map((c) => c.people);
  console.log('');
  console.log('  Чаще чем в 5 % случаев система ошибается при загрузке: ' +
    (over5.length ? over5.join(', ') + ' чел' : 'ни при какой'));
  console.log('  Опасная зона — у самого порога: отклонение на одного человека');
  console.log('  переворачивает решение целиком.');

  // Сводная матрица при равномерной загрузке
  const weights = {};
  for (let n = 1; n <= 12; n += 1) weights[n] = 1 / 12;
  const matrix = confusionMatrix(capacity, weights);

  io.header('Сводная матрица ошибок (равномерная загрузка 1–12 человек)');
  io.table(['', 'Решение «полная»', 'Решение «есть место»'], [
    ['Реально полная', matrix.TP + '  (TP)', matrix.FN + '  (FN)'],
    ['Реально есть место', matrix.FP + '  (FP)', matrix.TN + '  (TN)']
  ]);
  console.log('');
  console.log('  Доля верных решений без запаса мест: ' + io.round(matrix.accuracy * 100, 1) + ' %');
  console.log('  Камера систематически недосчитывает, поэтому сравнивать её показания');
  console.log('  напрямую с вместимостью нельзя — нужен запас мест (модель 3).');

  // ---------- Графики ----------

  await chart.save({
    type: 'line',
    data: {
      labels: errorCurve.map((c) => c.people),
      datasets: [
        {
          label: 'Вероятность ошибочного решения',
          data: errorCurve.map((c) => c.pError),
          borderColor: chart.COLOR.full,
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          fill: true,
          borderWidth: 3,
          tension: 0.2,
          pointRadius: 4
        },
        {
          label: 'Допустимые 5 %',
          data: new Array(errorCurve.length).fill(0.05),
          borderColor: chart.COLOR.grey,
          borderDash: [8, 5],
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: chart.options('Ошибка решения максимальна у самого порога вместимости', {
      scales: {
        y: chart.axis('вероятность ошибки', { beginAtZero: true }),
        x: chart.axis('реально людей в кабине', { grid: { display: false } })
      }
    }, true)
  }, 'errors_decision_probability.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: splitRows.map((r) => r[0]),
      datasets: [
        {
          label: 'Систематические пропуски (перекрытия) — окном не лечатся',
          data: splitRows.map((r) => r[2]),
          backgroundColor: chart.COLOR.full
        },
        {
          label: 'Мерцание рамки за кадр — гасится окном',
          data: splitRows.map((r) => r[3]),
          backgroundColor: chart.COLOR.accent
        }
      ]
    },
    options: chart.options('Два источника ошибок ведут себя по-разному', {
      scales: {
        y: chart.axis('доля, %'),
        x: chart.axis('человек в кабине', { grid: { display: false } })
      }
    }, true)
  }, 'errors_miss_split.png');

  await chart.save({
    type: 'line',
    data: {
      labels: dist.map((d) => d.people),
      datasets: [
        {
          label: 'Истинное число людей',
          data: dist.map((d) => d.people),
          borderColor: chart.COLOR.grey,
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: 'Счёт по трекам (3 кадра подряд)',
          data: dist.map((d) => d.mean),
          borderColor: chart.COLOR.ok,
          borderWidth: 3,
          pointRadius: 4,
          tension: 0.15
        },
        {
          label: 'Наивное среднее по 30 кадрам',
          data: dist.map((d) => d.meanAveraged),
          borderColor: chart.COLOR.busy,
          borderWidth: 3,
          pointRadius: 4,
          tension: 0.15
        }
      ]
    },
    options: chart.options('Способ чтения счёта важнее самого детектора', {
      scales: {
        y: chart.axis('показания камеры, человек', { beginAtZero: true }),
        x: chart.axis('реально людей в кабине', { grid: { display: false } })
      }
    }, true)
  }, 'errors_count_bias.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: focus.map((c) => c.people + ' чел ' + (c.trulyFull ? '(полная)' : '(есть место)')),
      datasets: [
        {
          label: 'Решение «полная» — проехать',
          data: focus.map((c) => c.pDetectedFull),
          backgroundColor: focus.map((c) => c.trulyFull ? chart.COLOR.ok : chart.COLOR.full)
        },
        {
          label: 'Решение «есть место» — остановиться',
          data: focus.map((c) => c.pDetectedFree),
          backgroundColor: focus.map((c) => c.trulyFull ? chart.COLOR.full : chart.COLOR.ok)
        }
      ]
    },
    options: chart.options('Матрица ошибок при загрузке 5, 7 и 10 человек', {
      scales: {
        y: chart.axis('вероятность', { stacked: true, max: 1 }),
        x: chart.axis('', { stacked: true, grid: { display: false } })
      }
    }, true)
  }, 'errors_confusion_by_load.png');

  const result = {
    capacity,
    framesPerWindow: FRAMES_PER_WINDOW,
    trackMinHits: TRACK_MIN_HITS,
    sources: splitRows.map((r) => ({
      people: r[0], occludedShare: r[1], systematicMiss: r[2],
      flickerPerFrame: r[3], falsePositivesPerFrame: r[4]
    })),
    distribution: dist,
    decisionError: errorCurve.map((c) => ({
      people: c.people, trulyFull: c.trulyFull,
      pDetectedFull: c.pDetectedFull, pError: c.pError
    })),
    focus,
    matrix: { TP: matrix.TP, FN: matrix.FN, FP: matrix.FP, TN: matrix.TN, accuracy: matrix.accuracy },
    errorOver10Percent: firstBad ? firstBad.people : null,
    errorOver5PercentAt: over5
  };

  io.saveData('02-errors', result);
  console.log('');
  console.log('  Графики: errors_decision_probability.png, errors_miss_split.png,');
  console.log('           errors_count_bias.png, errors_confusion_by_load.png');
  console.log('  Данные:  output/data/02-errors.json');

  return result;
}

module.exports = {
  rates, occludedShare, systematicMissRate, flickerRate, falsePositiveRate,
  measure, measurementDistribution, confusionAt, confusionMatrix,
  FRAMES_PER_WINDOW, TRACK_MIN_HITS, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[errors] Ошибка:', err.message); process.exit(1); });
}
