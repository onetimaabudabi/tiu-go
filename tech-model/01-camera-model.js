/**
 * Модель 1. Камера в кабине лифта: геометрия обзора и качество детекции.
 *
 * Камера стоит под потолком в углу кабины и смотрит вниз вдоль диагонали.
 * Задача модели — ответить на три вопроса:
 *   1. какую часть пола и какую часть «плоскости голов» она реально видит;
 *   2. сколько человек физически помещается в кабину;
 *   3. как падает уверенность детекции с ростом числа людей.
 *
 * Ключевая мысль про геометрию: для подсчёта людей важен не пол, а
 * плоскость голов на высоте 1.7 м. До пола от камеры 2.4 м, а до голов —
 * всего 0.7 м, поэтому тот же угол обзора покрывает там заметно меньшую
 * площадь. Именно это, а не разрешение матрицы, ограничивает счёт.
 *
 * Запуск:  npm run tech:camera
 */

const PARAMS = require('./params');
const chart = require('./chart-helper');
const io = require('./io');

const CAM = PARAMS.camera;
const CABIN = PARAMS.cabin;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// ---------- Геометрия кабины ----------

/** Площадь пола кабины, м². */
function floorArea() {
  return CABIN.width * CABIN.depth;
}

/**
 * Вертикальный угол обзора. Горизонтальный задан в параметрах (90°),
 * вертикальный выводится из соотношения сторон матрицы 1920×1080:
 *
 *   tan(α_v / 2) = tan(α_h / 2) · (h_px / w_px)
 */
function verticalFov() {
  const [w, h] = CAM.resolution.split('x').map(Number);
  return 2 * Math.atan(Math.tan((CAM.fovDegrees / 2) * RAD) * (h / w)) * DEG;
}

/**
 * Видит ли камера точку (x, y) на высоте z.
 *
 * Камера стоит в углу (0, 0) на высоте mountingHeight, оптическая ось
 * направлена по диагонали кабины и наклонена вниз на угол tilt.
 * Точка попадает в кадр, если она одновременно:
 *   — внутри горизонтального сектора ±α_h/2 вокруг оси;
 *   — внутри вертикального сектора ±α_v/2 вокруг оси.
 *
 * @param {number} tiltDeg — наклон оптической оси вниз от горизонта
 */
function isVisible(x, y, z, tiltDeg) {
  const dz = CAM.mountingHeight - z; // насколько точка ниже камеры
  const horizontal = Math.hypot(x, y);

  // Точка ровно под камерой: видна, только если ось смотрит вертикально вниз
  if (horizontal < 1e-9) return tiltDeg + verticalFov() / 2 >= 90;

  // 1. Горизонталь: ось направлена по диагонали кабины
  const axisAzimuth = Math.atan2(CABIN.depth, CABIN.width) * DEG;
  const pointAzimuth = Math.atan2(y, x) * DEG;
  if (Math.abs(pointAzimuth - axisAzimuth) > CAM.fovDegrees / 2) return false;

  // 2. Вертикаль: угол понижения от горизонта до точки
  const depression = Math.atan2(dz, horizontal) * DEG;
  return Math.abs(depression - tiltDeg) <= verticalFov() / 2;
}

/**
 * Какая доля плоскости на высоте z попадает в кадр.
 * Считаем сеткой 200×200 по площади кабины — для площади этого с запасом.
 */
function coverage(z, tiltDeg, steps = 200) {
  let seen = 0;
  let total = 0;

  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const x = ((i + 0.5) / steps) * CABIN.width;
      const y = ((j + 0.5) / steps) * CABIN.depth;
      total += 1;
      if (isVisible(x, y, z, tiltDeg)) seen += 1;
    }
  }

  return seen / total;
}

/**
 * Подбирает наклон камеры: максимум покрытия плоскости голов.
 * Именно её надо видеть, чтобы считать людей, — пол вторичен.
 */
function bestTilt() {
  let best = { tilt: 0, heads: 0, floor: 0 };

  for (let tilt = 5; tilt <= 85; tilt += 1) {
    const heads = coverage(CABIN.personHeight, tilt);
    if (heads > best.heads) {
      best = { tilt, heads, floor: coverage(0, tilt) };
    }
  }

  return best;
}

// ---------- Сколько человек помещается в кабину ----------

/**
 * Три независимых предела вместимости. Реальный — наименьший из них.
 *
 * Предел по площади силуэта считается по параметру avgAreaM2 = 0.08 м².
 * Это площадь силуэта человека В КАДРЕ, а не след на полу, поэтому
 * как оценка вместимости она заведомо завышена — что и показывает расчёт.
 */
function capacityLimits() {
  const area = floorArea();

  const byPayload = Math.floor(PARAMS.elevators.payloadKg / PARAMS.people.avgWeightKg);
  const bySilhouette = Math.floor(area / PARAMS.people.avgAreaM2);

  // Давка в общественном транспорте: 5 чел/м² — верхняя физическая граница
  const CRUSH_DENSITY = 5;
  const byCrush = Math.floor(area * CRUSH_DENSITY);

  return {
    floorArea: io.round(area, 2),
    byPayload,
    bySilhouette,
    byCrush,
    crushDensity: CRUSH_DENSITY,
    silhouetteDensity: io.round(1 / PARAMS.people.avgAreaM2, 1),
    declaredPeak: PARAMS.elevators.capacityRealPeak,
    declaredPassport: PARAMS.elevators.capacityPassport,
    // Чему верить на практике: минимум из физических пределов
    binding: Math.min(byPayload, byCrush)
  };
}

// ---------- Качество детекции ----------

/**
 * Штраф за перекрытия. Людей заслоняет не воздух, а другие люди,
 * поэтому при включённой поправке отсчёт идёт от второго человека:
 * одному в кабине перекрывать себя нечем.
 */
function occlusionPenalty(n) {
  const effective = CAM.useCorrectedOcclusion ? Math.max(n - 1, 0) : n;
  return CAM.occludedPersonPenalty * (1 - Math.exp(-effective / 3));
}

/** Штраф за толпу: начинается после седьмого человека. */
function crowdPenalty(n) {
  return n > 7 ? CAM.crowdPenalty * (n - 7) : 0;
}

/**
 * Уверенность детекции как функция числа людей в кабине.
 *
 *   base       = map50
 *   crowd      = crowdPenalty · (n − 7),  если n > 7
 *   occlusion  = 0.15 · (1 − exp(−(n−1) / 3))   см. occlusionPenalty()
 *   darkness   = darknessPenalty (освещение в кабине всегда слабое)
 *
 * Нижняя граница 0.5 — ниже уверенности «подбрасывания монеты»
 * детектор опускать смысла нет, это уже не измерение.
 */
function detectionConfidence(n) {
  return Math.max(0.5, CAM.map50 - crowdPenalty(n) - occlusionPenalty(n) - CAM.darknessPenalty);
}

/** Тот же расчёт буквально по исходной постановке — для сравнения. */
function detectionConfidenceLiteral(n) {
  const occlusion = CAM.occludedPersonPenalty * (1 - Math.exp(-n / 3));
  return Math.max(0.5, CAM.map50 - crowdPenalty(n) - occlusion - CAM.darknessPenalty);
}

/** До какого числа людей уверенность держится выше порога. */
function reliableUpTo(threshold) {
  let last = 0;
  for (let n = 1; n <= 14; n += 1) {
    if (detectionConfidence(n) >= threshold) last = n;
    else break;
  }
  return last;
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 1. Камера в кабине: геометрия обзора и детекция');

  const fovV = verticalFov();
  const tilt = bestTilt();
  const limits = capacityLimits();

  console.log('');
  console.log('  Кабина: ' + CABIN.width + ' × ' + CABIN.depth + ' × ' + CABIN.height +
    ' м, площадь пола ' + limits.floorArea + ' м²');
  console.log('  Камера: ' + CAM.model + ', ' + CAM.resolution + ', ' + CAM.fps + ' FPS, ' +
    'установлена на ' + CAM.mountingHeight + ' м');
  console.log('  Угол обзора: ' + CAM.fovDegrees + '° по горизонтали, ' +
    io.round(fovV, 1) + '° по вертикали (из соотношения сторон 16:9)');
  console.log('');
  console.log('  Оптимальный наклон оси вниз: ' + tilt.tilt + '°');
  console.log('    покрытие плоскости голов (1.7 м): ' + io.round(tilt.heads * 100, 1) + ' %');
  console.log('    покрытие пола (0 м):              ' + io.round(tilt.floor * 100, 1) + ' %');
  console.log('    слепая зона по головам:           ' + io.round((1 - tilt.heads) * 100, 1) + ' %');

  // Покрытие при разных наклонах — видно, насколько узок рабочий диапазон
  io.header('Покрытие при разных наклонах камеры');
  const tiltRows = [];
  for (let t = 20; t <= 80; t += 10) {
    tiltRows.push([t + '°', io.round(coverage(CABIN.personHeight, t) * 100, 1),
      io.round(coverage(0, t) * 100, 1)]);
  }
  io.table(['Наклон', 'Головы, %', 'Пол, %'], tiltRows);

  // Вместимость
  io.header('Сколько человек помещается в кабину');
  io.table(['Ограничение', 'Человек', 'Комментарий'], [
    ['По грузоподъёмности (1000 кг / 70 кг)', limits.byPayload, 'физический предел'],
    ['По давке (5 чел/м² × ' + limits.floorArea + ' м²)', limits.byCrush, 'физический предел'],
    ['По площади силуэта (' + PARAMS.people.avgAreaM2 + ' м²/чел)', limits.bySilhouette,
      limits.silhouetteDensity + ' чел/м² — нефизично'],
    ['Паспорт лифта', limits.declaredPassport, 'норматив'],
    ['Наблюдаемый пик', limits.declaredPeak, 'из наблюдений корпуса 7']
  ]);

  console.log('');
  console.log('  Параметр avgAreaM2 = ' + PARAMS.people.avgAreaM2 + ' м² описывает силуэт человека');
  console.log('  В КАДРЕ, а не след на полу: как оценка вместимости он даёт ' +
    limits.silhouetteDensity + ' чел/м²,');
  console.log('  что вдвое с лишним выше предела давки. Связывающее ограничение — ' +
    limits.binding + ' человек,');
  console.log('  и наблюдаемый пик в ' + limits.declaredPeak + ' человек в него укладывается.');

  // Уверенность детекции
  io.header('Уверенность детекции от числа людей в кабине');
  const confRows = [];
  const confidence = [];
  const literal = [];
  for (let n = 1; n <= 12; n += 1) {
    const c = detectionConfidence(n);
    const l = detectionConfidenceLiteral(n);
    confidence.push(io.round(c, 4));
    literal.push(io.round(l, 4));
    confRows.push([n, io.round(c, 3), io.round(crowdPenalty(n), 3),
      io.round(occlusionPenalty(n), 3), io.round(l, 3)]);
  }
  io.table(['Людей', 'Уверенность', 'Штраф толпы', 'Штраф перекрытий', 'Без поправки'],
    confRows);

  console.log('');
  console.log('  Поправка на перекрытия: ' +
    (CAM.useCorrectedOcclusion ? 'включена' : 'выключена') +
    ' (camera.useCorrectedOcclusion в params.js)');
  console.log('  Без неё один человек в пустой кабине уже получает штраф за перекрытие —');
  console.log('  перекрывать его там некому, и вся модель выходит пессимистичнее реальной.');

  const reliable80 = reliableUpTo(0.80);
  const reliable70 = reliableUpTo(0.70);
  const reliable60 = reliableUpTo(0.60);

  console.log('');
  console.log('  Рабочий диапазон счёта:');
  console.log('    уверенность ≥ 0.80 — до ' + reliable80 + ' чел (почти пустая кабина)');
  console.log('    уверенность ≥ 0.70 — до ' + reliable70 + ' чел');
  console.log('    уверенность ≥ 0.60 — до ' + reliable60 + ' чел');
  console.log('  Дальше счёт по кадру перестаёт быть измерением, и решение должно');
  console.log('  опираться на запас мест, а не на точное число (см. модель 3).');

  // ---------- Графики ----------

  await chart.save({
    type: 'line',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => i + 1),
      datasets: [
        {
          label: 'Уверенность детекции',
          data: confidence,
          borderColor: chart.COLOR.accent,
          backgroundColor: 'rgba(91, 141, 239, 0.12)',
          fill: true,
          tension: 0.25,
          borderWidth: 3,
          pointRadius: 4
        },
        {
          label: 'Без поправки на перекрытия',
          data: literal,
          borderColor: chart.COLOR.violet,
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Порог надёжного счёта 0.70',
          data: new Array(12).fill(0.7),
          borderColor: chart.COLOR.busy,
          borderDash: [8, 5],
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: chart.options('Уверенность детекции падает с ростом числа людей', {
      scales: {
        y: chart.axis('уверенность', { min: 0.5, max: 1.0 }),
        x: chart.axis('человек в кабине', { grid: { display: false } })
      }
    }, true)
  }, 'camera_confidence.png');

  // Из чего складывается падение уверенности
  await chart.save({
    type: 'bar',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => i + 1),
      datasets: [
        {
          label: 'Остаточная уверенность',
          data: confidence,
          backgroundColor: chart.COLOR.ok
        },
        {
          label: 'Потери на перекрытиях',
          data: Array.from({ length: 12 }, (_, i) => io.round(occlusionPenalty(i + 1), 4)),
          backgroundColor: chart.COLOR.busy
        },
        {
          label: 'Потери на толпе',
          data: Array.from({ length: 12 }, (_, i) => io.round(crowdPenalty(i + 1), 4)),
          backgroundColor: chart.COLOR.full
        },
        {
          label: 'Потери на освещении',
          data: new Array(12).fill(CAM.darknessPenalty),
          backgroundColor: chart.COLOR.grey
        }
      ]
    },
    options: chart.options('Из чего складывается потеря точности', {
      scales: {
        y: chart.axis('доля', { stacked: true, max: 1.0 }),
        x: chart.axis('человек в кабине', { stacked: true, grid: { display: false } })
      }
    }, true)
  }, 'camera_confidence_breakdown.png');

  // Покрытие плоскости голов и пола в зависимости от наклона
  const tilts = [];
  const headCov = [];
  const floorCov = [];
  for (let t = 10; t <= 85; t += 5) {
    tilts.push(t);
    headCov.push(io.round(coverage(CABIN.personHeight, t) * 100, 1));
    floorCov.push(io.round(coverage(0, t) * 100, 1));
  }

  await chart.save({
    type: 'line',
    data: {
      labels: tilts,
      datasets: [
        {
          label: 'Плоскость голов (1.7 м)',
          data: headCov,
          borderColor: chart.COLOR.accent,
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.2
        },
        {
          label: 'Пол кабины (0 м)',
          data: floorCov,
          borderColor: chart.COLOR.violet,
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.2
        }
      ]
    },
    options: chart.options('Покрытие кабины в зависимости от наклона камеры', {
      scales: {
        y: chart.axis('покрытие, %', { beginAtZero: true, max: 100 }),
        x: chart.axis('наклон оптической оси вниз, градусов', { grid: { display: false } })
      }
    }, true)
  }, 'camera_coverage_vs_tilt.png');

  const result = {
    cabin: { width: CABIN.width, depth: CABIN.depth, floorArea: limits.floorArea },
    fov: { horizontal: CAM.fovDegrees, vertical: io.round(fovV, 2) },
    tilt: { best: tilt.tilt, headCoverage: io.round(tilt.heads, 4), floorCoverage: io.round(tilt.floor, 4) },
    coverageByTilt: tilts.map((t, i) => ({ tilt: t, heads: headCov[i], floor: floorCov[i] })),
    capacity: limits,
    occlusionCorrected: CAM.useCorrectedOcclusion,
    confidence: confidence.map((c, i) => ({
      people: i + 1, confidence: c, literal: literal[i]
    })),
    reliable: { at80: reliable80, at70: reliable70, at60: reliable60 }
  };

  io.saveData('01-camera', result);
  console.log('');
  console.log('  Графики: camera_confidence.png, camera_confidence_breakdown.png, camera_coverage_vs_tilt.png');
  console.log('  Данные:  output/data/01-camera.json');

  return result;
}

module.exports = {
  floorArea, verticalFov, isVisible, coverage, bestTilt,
  capacityLimits, occlusionPenalty, crowdPenalty,
  detectionConfidence, detectionConfidenceLiteral, reliableUpTo, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[camera] Ошибка:', err.message); process.exit(1); });
}
