/**
 * Модель 3. Выбор «лифт или лестница» через функцию полезности.
 *
 * Каждый человек сравнивает две альтернативы по трём критериям: время,
 * комфорт и польза для здоровья. Выбор стохастический — описывается
 * логит-моделью с «температурой» τ: при малом τ человек почти всегда
 * выбирает лучшее, при большом решает почти наугад.
 *
 * Ключевая деталь модели: без приложения человек не знает реальной
 * очереди и пользуется оптимистичной оценкой. Приложение заменяет догадку
 * фактическим прогнозом — в этом и состоит его эффект.
 *
 * Запуск:  npm run math:utility
 */

const { PARAMS } = require('./params');
const physics = require('./04-elevator-physics');
const chart = require('./chart-helper');

// Неденежные характеристики альтернатив, шкала 0…1
const ATTRIBUTES = {
  elevator: { comfort: 1.0, health: 0.1 },
  stairs:   { comfort: 0.3, health: 0.9 }
};

/** Время подъёма на лифте: ожидание + поездка + посадка-высадка. */
function elevatorTime(floor, wait, p = PARAMS) {
  const ride = (floor - 1) * physics.floorTime(p);
  const service = p.doorOpenTime + 2 * p.boardingTimePerPerson;
  return wait + ride + service;
}

/** Время подъёма по лестнице. */
function stairsTime(floor, p = PARAMS) {
  return (floor - 1) * p.stairsTimePerFloor;
}

/**
 * Полезность альтернативы.
 *
 *   U = − w_time · (T / T_ref) + w_comfort · C + w_health · H
 *
 * Время нормируется на эталон T_ref, иначе слагаемые несопоставимы:
 * секунды исчисляются сотнями, а комфорт и здоровье — долями единицы.
 */
function utility(time, attrs, weights, p = PARAMS) {
  return -weights.time * (time / p.referenceTime)
    + weights.comfort * attrs.comfort
    + weights.health * attrs.health;
}

function defaultWeights(p = PARAMS) {
  return { time: p.utilityWeightTime, comfort: p.utilityWeightComfort, health: p.utilityWeightHealth };
}

/**
 * Вероятность выбрать лифт (логит):
 *
 *   P(лифт) = exp(U_лифт/τ) / ( exp(U_лифт/τ) + exp(U_лестница/τ) )
 */
function probabilityElevator(floor, wait, opts = {}) {
  const p = opts.params || PARAMS;
  const weights = opts.weights || defaultWeights(p);
  const tau = opts.tau === undefined ? p.rationality : opts.tau;

  const uElevator = utility(elevatorTime(floor, wait, p), ATTRIBUTES.elevator, weights, p);
  const uStairs = utility(stairsTime(floor, p), ATTRIBUTES.stairs, weights, p);

  // Вычитаем максимум — защита от переполнения экспоненты
  const max = Math.max(uElevator, uStairs);
  const eE = Math.exp((uElevator - max) / tau);
  const eS = Math.exp((uStairs - max) / tau);

  return { p: eE / (eE + eS), uElevator, uStairs };
}

/**
 * Порог веса времени, при котором человек начинает предпочитать лестницу
 * (P(лифт) падает ниже 0.5). Ищем бинарным поиском по w_time.
 */
function timeWeightThreshold(floor, wait, p = PARAMS) {
  const probe = (wTime) => {
    const rest = 1 - wTime;
    const share = p.utilityWeightComfort + p.utilityWeightHealth;
    const weights = {
      time: wTime,
      comfort: rest * (p.utilityWeightComfort / share),
      health: rest * (p.utilityWeightHealth / share)
    };
    return probabilityElevator(floor, wait, { weights, params: p }).p;
  };

  if (probe(0.999) >= 0.5) return null; // лестницу не выберут ни при каком весе

  let lo = 0;
  let hi = 0.999;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (probe(mid) >= 0.5) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Доля потока, остающаяся на лифтах, при заданной доле следующих совету.
 *
 * Без приложения человек исходит из оптимистичной оценки ожидания.
 * С приложением он видит фактический прогноз (с поправкой на точность
 * детекции: ошибка камер делает совет менее убедительным).
 */
function loadAfterApp(followRate, realWait, p = PARAMS) {
  const dist = require('./params').destinationDistribution(p.floors);

  let withoutApp = 0;
  let withApp = 0;

  dist.forEach((d) => {
    const naive = probabilityElevator(d.floor, p.perceivedWaitNoApp, { params: p }).p;

    // Доверие к совету ограничено точностью детекции
    const trust = followRate * p.cameraAccuracy;
    const informed = probabilityElevator(d.floor, realWait, { params: p }).p;
    const mixed = trust * informed + (1 - trust) * naive;

    withoutApp += d.p * naive;
    withApp += d.p * mixed;
  });

  return { withoutApp, withApp, reduction: (withoutApp - withApp) / withoutApp };
}

// ---------- Запуск ----------
async function run(p = PARAMS) {
  console.log('[utility] Считаю функцию полезности…');

  const waitOffPeak = 10;    // спокойные часы: лифт подходит почти сразу
  const waitPeak = 300;      // пик: реальное ожидание, которое показывает приложение

  console.log(`[utility] Нормировка времени: T_ref = ${p.referenceTime} с`);
  console.log(`[utility] Веса: время ${p.utilityWeightTime}, комфорт ${p.utilityWeightComfort}, здоровье ${p.utilityWeightHealth}, τ = ${p.rationality}`);
  console.log('');
  console.log('  Этаж | T лифт, с | T лестн., с | U лифт | U лестн. | P(лифт) вне пика | P(лифт) в пик');

  const floors = [2, 3, 5, 7, 10, 13, 16].filter((f) => f <= p.floors);
  const table = floors.map((floor) => {
    const off = probabilityElevator(floor, waitOffPeak, { params: p });
    const peak = probabilityElevator(floor, waitPeak, { params: p });
    const row = {
      floor,
      tElevator: elevatorTime(floor, waitOffPeak, p),
      tStairs: stairsTime(floor, p),
      uElevator: off.uElevator,
      uStairs: off.uStairs,
      pOff: off.p,
      pPeak: peak.p
    };

    console.log(
      `  ${String(floor).padStart(4)} | ${row.tElevator.toFixed(1).padStart(9)} | ${row.tStairs.toFixed(0).padStart(11)} | ` +
      `${row.uElevator.toFixed(3).padStart(6)} | ${row.uStairs.toFixed(3).padStart(8)} | ` +
      `${(row.pOff * 100).toFixed(1).padStart(16)}% | ${(row.pPeak * 100).toFixed(1).padStart(12)}%`
    );
    return row;
  });

  // Порог веса времени
  console.log('');
  [3, 7, 12].filter((f) => f <= p.floors).forEach((floor) => {
    const th = timeWeightThreshold(floor, waitOffPeak, p);
    console.log(th === null
      ? `[utility] Этаж ${floor}: лестницу не выберут ни при каком весе времени`
      : `[utility] Этаж ${floor}: лестница становится предпочтительнее при w_time > ${th.toFixed(2)}`);
  });

  // Влияние доли следующих рекомендации
  console.log('');
  console.log('  Следуют совету | Поток на лифты до | после | Снижение нагрузки');
  const shares = [0, 0.3, 0.5, 0.7, 0.9];
  const effects = shares.map((share) => {
    const r = loadAfterApp(share, waitPeak, p);
    console.log(
      `  ${String(Math.round(share * 100)).padStart(13)}% | ${(r.withoutApp * 100).toFixed(1).padStart(16)}% | ` +
      `${(r.withApp * 100).toFixed(1).padStart(5)}% | ${(r.reduction * 100).toFixed(1).padStart(16)}%`
    );
    return Object.assign({ share }, r);
  });

  // График 1: вероятность выбора лифта от этажа
  const allFloors = [];
  for (let f = 2; f <= p.floors; f += 1) allFloors.push(f);

  await chart.save({
    type: 'line',
    data: {
      labels: allFloors,
      datasets: [
        {
          label: 'Вне пика (ожидание 10 с)',
          data: allFloors.map((f) => Number((probabilityElevator(f, waitOffPeak, { params: p }).p * 100).toFixed(1))),
          borderColor: chart.COLOR.ok, tension: 0.2, pointRadius: 3, borderWidth: 3
        },
        {
          label: 'Пик, человек видит реальное ожидание (300 с)',
          data: allFloors.map((f) => Number((probabilityElevator(f, waitPeak, { params: p }).p * 100).toFixed(1))),
          borderColor: chart.COLOR.full, tension: 0.2, pointRadius: 3, borderWidth: 3
        },
        {
          label: `Пик без приложения (догадка ${p.perceivedWaitNoApp} с)`,
          data: allFloors.map((f) => Number((probabilityElevator(f, p.perceivedWaitNoApp, { params: p }).p * 100).toFixed(1))),
          borderColor: chart.COLOR.grey, borderDash: [8, 5], tension: 0.2, pointRadius: 0, borderWidth: 2
        }
      ]
    },
    options: chart.options('Вероятность выбрать лифт в зависимости от этажа', {
      scales: {
        y: chart.axis('P(лифт), %', { beginAtZero: true, max: 100 }),
        x: chart.axis('этаж назначения', { grid: { display: false } })
      },
      plugins: {
        title: chart.options('Вероятность выбрать лифт в зависимости от этажа').plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 16, padding: 12 } }
      }
    })
  }, 'utility_choice_by_floor.png');

  // График 2: снижение нагрузки от доли следующих совету
  await chart.save({
    type: 'bar',
    data: {
      labels: shares.map((s) => `${Math.round(s * 100)}%`),
      datasets: [{
        label: 'Доля потока, остающаяся на лифтах',
        data: effects.map((e) => Number((e.withApp * 100).toFixed(1))),
        backgroundColor: chart.COLOR.accent,
        borderRadius: 6
      }]
    },
    options: chart.options('Снижение нагрузки на лифты в пик', {
      scales: {
        y: chart.axis('поток на лифты, %', { beginAtZero: true, max: 100 }),
        x: chart.axis('доля следующих рекомендации', { grid: { display: false } })
      },
      plugins: {
        title: chart.options('Снижение нагрузки на лифты в пик').plugins.title,
        legend: { display: false }
      }
    })
  }, 'utility_load_reduction.png');

  console.log('');
  console.log('[utility] Графики сохранены: utility_choice_by_floor.png, utility_load_reduction.png');

  return { table, effects, waitOffPeak, waitPeak };
}

module.exports = {
  ATTRIBUTES, elevatorTime, stairsTime, utility, probabilityElevator,
  timeWeightThreshold, loadAfterApp, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[utility] Ошибка:', err.message); process.exit(1); });
}
