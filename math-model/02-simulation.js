/**
 * Модель 2. Имитационное моделирование учебного дня (Монте-Карло).
 *
 * Дискретно-событийная симуляция: поток заявок неоднородный пуассоновский,
 * шесть лифтов обслуживают очередь группами по вместимости кабины.
 *
 * Главная особенность модели — люди не ждут бесконечно. У каждого есть
 * порог терпения: как только ожидание делает лестницу выгоднее лифта,
 * человек уходит. Именно поэтому в реальном корпусе очередь не растёт до
 * сотен человек, хотя аналитическая модель показывает перегрузку втрое.
 *
 * Сравниваются два сценария:
 *   без приложения — человек встаёт в очередь и уходит, уже потеряв время;
 *   с приложением  — видит прогноз сразу и решает, не теряя ни секунды.
 *
 * Запуск:  npm run math:sim
 */

const { PARAMS, createRandom, arrivalRate, destinationDistribution } = require('./params');
const physics = require('./04-elevator-physics');
const utilityModel = require('./03-utility-model');
const chart = require('./chart-helper');

/**
 * Порог терпения: ожидание, при котором лифт и лестница равнополезны.
 * Выводится из функции полезности приравниванием U_лифт = U_лестница:
 *
 *   T_ждать = T_лестница − T_поездки − T_посадки
 *           + (T_ref / w_time) · (w_comfort·ΔC + w_health·ΔH)
 */
function patienceThreshold(floor, p = PARAMS) {
  const ride = (floor - 1) * physics.floorTime(p);
  const service = p.doorOpenTime + 2 * p.boardingTimePerPerson;
  const stairs = (floor - 1) * p.stairsTimePerFloor;

  const dComfort = utilityModel.ATTRIBUTES.elevator.comfort - utilityModel.ATTRIBUTES.stairs.comfort;
  const dHealth = utilityModel.ATTRIBUTES.stairs.health - utilityModel.ATTRIBUTES.elevator.health;

  const bonus = (p.referenceTime / p.utilityWeightTime)
    * (p.utilityWeightComfort * dComfort - p.utilityWeightHealth * dHealth);

  return Math.max(10, stairs - ride - service + bonus);
}

/** Выбор этажа назначения по заданному распределению. */
function sampleFloor(dist, random) {
  const r = random();
  let acc = 0;
  for (let i = 0; i < dist.length; i += 1) {
    acc += dist[i].p;
    if (r <= acc) return dist[i].floor;
  }
  return dist[dist.length - 1].floor;
}

/** Генерация моментов прихода методом прореживания (thinning). */
function generateArrivals(random, p = PARAMS) {
  const start = p.dayStart * 3600;
  const end = p.dayEnd * 3600;

  // Верхняя граница интенсивности по всему дню
  let lambdaMax = 0;
  for (let h = p.dayStart; h < p.dayEnd; h += 0.01) {
    lambdaMax = Math.max(lambdaMax, arrivalRate(h, p));
  }

  const arrivals = [];
  let t = start;

  while (t < end) {
    t += -Math.log(1 - random()) / lambdaMax;   // шаг однородного потока
    if (t >= end) break;
    if (random() <= arrivalRate(t / 3600, p) / lambdaMax) arrivals.push(t);
  }

  return arrivals;
}

/**
 * Один день работы системы.
 *
 * @param {boolean} withApp — включено ли приложение
 */
function simulateDay(random, withApp, p = PARAMS) {
  const dist = destinationDistribution(p.floors);
  const arrivals = generateArrivals(random, p);
  const serviceRate = physics.serviceRate(p.capacity, p) * p.elevators; // чел/с всей системой

  const elevatorFree = new Array(p.elevators).fill(p.dayStart * 3600);
  const queue = [];
  let head = 0;

  const stats = {
    arrivals: arrivals.length,
    boarded: 0,
    leftToStairs: 0,
    leftImmediately: 0,
    waitSum: 0,
    wastedSum: 0,     // время, потерянное теми, кто в итоге ушёл
    totalTimeSum: 0,  // полное время подъёма по всем людям
    maxQueue: 0,
    busyTime: 0,
    queueTrace: []
  };

  // Доверие к совету ограничено точностью детекции камер
  const trust = withApp ? p.recommendationFollowRate * p.cameraAccuracy : 0;

  let next = 0;
  let nextSample = p.dayStart * 3600;
  let now = p.dayStart * 3600; // модельное время: назад оно не идёт

  while (next < arrivals.length || head < queue.length) {
    // Ближайшее событие: приход человека или освобождение лифта
    let freeIdx = 0;
    for (let i = 1; i < p.elevators; i += 1) {
      if (elevatorFree[i] < elevatorFree[freeIdx]) freeIdx = i;
    }

    const nextArrival = next < arrivals.length ? arrivals[next] : Infinity;

    // Простаивающий лифт отправляется не раньше текущего момента: иначе
    // отправка попала бы в прошлое, до прихода стоящих в очереди людей.
    const nextFree = head < queue.length ? Math.max(elevatorFree[freeIdx], now) : Infinity;

    const t = Math.min(nextArrival, nextFree);
    if (!isFinite(t)) break;
    now = t;

    if (nextArrival <= nextFree) {
      // ---- Пришёл человек ----
      const floor = sampleFloor(dist, random);
      const patience = patienceThreshold(floor, p) * (0.7 + 0.6 * random()); // разброс терпения

      // Оценка ожидания по текущей очереди
      const waiting = queue.length - head;
      const estimate = waiting / serviceRate;

      if (withApp && random() < trust && estimate > patience) {
        // Приложение сразу советует лестницу — человек не теряет времени
        stats.leftImmediately += 1;
        stats.leftToStairs += 1;
        stats.totalTimeSum += (floor - 1) * p.stairsTimePerFloor;
      } else {
        queue.push({ t, floor, patience });
      }

      next += 1;
    } else {
      // ---- Освободился лифт: сажаем группу ----
      const group = [];
      while (group.length < p.capacity && head < queue.length) {
        const person = queue[head];

        if (t - person.t > person.patience) {
          // Не дождался: ушёл на лестницу, потеряв время ожидания
          stats.leftToStairs += 1;
          stats.wastedSum += person.patience;
          stats.totalTimeSum += person.patience + (person.floor - 1) * p.stairsTimePerFloor;
          head += 1;
          continue;
        }

        group.push(person);
        stats.waitSum += t - person.t;
        stats.boarded += 1;
        head += 1;
      }

      if (group.length === 0) {
        // Все, кто стоял, уже ушли — лифт ждёт следующего прихода
        elevatorFree[freeIdx] = nextArrival === Infinity ? t + 1 : nextArrival;
        continue;
      }

      const floors = group.map((g) => g.floor);
      const cycle = physics.cycleTimeExact(floors, p);
      elevatorFree[freeIdx] = t + cycle;
      stats.busyTime += cycle;

      group.forEach((g) => {
        const ride = (g.floor - 1) * physics.floorTime(p) + p.doorOpenTime;
        stats.totalTimeSum += (t - g.t) + ride;
      });
    }

    // Периодический замер длины очереди (только тех, кто ещё готов ждать)
    if (t >= nextSample) {
      let alive = 0;
      for (let i = head; i < queue.length; i += 1) {
        if (t - queue[i].t <= queue[i].patience) alive += 1;
      }
      stats.maxQueue = Math.max(stats.maxQueue, alive);
      stats.queueTrace.push({ t, queue: alive });
      nextSample = t + 120;
    }
  }

  const served = stats.boarded || 1;
  const people = stats.arrivals || 1;

  return {
    avgWait: stats.waitSum / served,
    avgTotalTime: stats.totalTimeSum / people,
    wastedPerPerson: stats.wastedSum / people,
    maxQueue: stats.maxQueue,
    stairsShare: stats.leftToStairs / people,
    immediateShare: stats.leftImmediately / people,
    utilization: stats.busyTime / (p.elevators * (p.dayEnd - p.dayStart) * 3600),
    arrivals: stats.arrivals,
    queueTrace: stats.queueTrace
  };
}

/** Квантиль по отсортированному массиву. */
function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

/** Прогон N дней для одного сценария. */
function runScenario(withApp, days, p = PARAMS) {
  const random = createRandom(p.randomSeed + (withApp ? 1 : 0));
  const results = [];
  let sampleDay = null;

  for (let d = 0; d < days; d += 1) {
    const day = simulateDay(random, withApp, p);
    results.push(day);
    if (d === Math.floor(days / 2)) sampleDay = day; // «типичный» день для графика
  }

  const waits = results.map((r) => r.avgWait).sort((a, b) => a - b);
  const totals = results.map((r) => r.avgTotalTime).sort((a, b) => a - b);

  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;

  return {
    days,
    waits,
    avgWait: mean(waits),
    p50: percentile(waits, 0.50),
    p90: percentile(waits, 0.90),
    p95: percentile(waits, 0.95),
    p99: percentile(waits, 0.99),
    avgTotalTime: mean(totals),
    maxQueue: mean(results.map((r) => r.maxQueue)),
    stairsShare: mean(results.map((r) => r.stairsShare)),
    immediateShare: mean(results.map((r) => r.immediateShare)),
    wastedPerPerson: mean(results.map((r) => r.wastedPerPerson)),
    utilization: mean(results.map((r) => r.utilization)),
    sampleDay
  };
}

// ---------- Запуск ----------
async function run(p = PARAMS) {
  const days = p.simulationDays;
  console.log(`[sim] Симуляция ${days} дней без приложения…`);
  const started = Date.now();
  const base = runScenario(false, days, p);

  console.log(`[sim] Симуляция ${days} дней с приложением…`);
  const app = runScenario(true, days, p);

  console.log(`[sim] Готово за ${((Date.now() - started) / 1000).toFixed(1)} с`);
  console.log('');
  console.log('  Показатель                          | Без приложения | С приложением');
  const row = (name, a, b, unit = '') => console.log(
    `  ${name.padEnd(35)} | ${String(a).padStart(14)} | ${String(b).padStart(13)} ${unit}`
  );

  row('Среднее ожидание тех, кто ехал, с', base.avgWait.toFixed(1), app.avgWait.toFixed(1));
  row('Среднее время подъёма на человека, с', base.avgTotalTime.toFixed(1), app.avgTotalTime.toFixed(1));
  row('Потеряно в очереди впустую, с/чел', base.wastedPerPerson.toFixed(1), app.wastedPerPerson.toFixed(1));
  row('Ушли на лестницу, %', (base.stairsShare * 100).toFixed(1), (app.stairsShare * 100).toFixed(1));
  row('…из них сразу, без ожидания, %', (base.immediateShare * 100).toFixed(1), (app.immediateShare * 100).toFixed(1));
  row('Максимальная очередь, чел', base.maxQueue.toFixed(1), app.maxQueue.toFixed(1));
  row('Загрузка лифтов, %', (base.utilization * 100).toFixed(1), (app.utilization * 100).toFixed(1));

  console.log('');
  console.log('  Перцентили среднего ожидания (без приложения → с приложением):');
  [['P50', 'p50'], ['P90', 'p90'], ['P95', 'p95'], ['P99', 'p99']].forEach(([label, key]) => {
    console.log(`    ${label}: ${base[key].toFixed(1)} с → ${app[key].toFixed(1)} с`);
  });

  const saved = base.avgTotalTime - app.avgTotalTime;
  console.log('');
  console.log(`[sim] В 95% дней среднее ожидание не превышает ${base.p95.toFixed(0)} с без приложения и ${app.p95.toFixed(0)} с с ним.`);
  console.log(`[sim] Экономия полного времени подъёма: ${saved.toFixed(1)} с на человека.`);

  // График 1: распределение среднего ожидания по дням
  const bins = 24;
  const all = base.waits.concat(app.waits);
  const lo = Math.min.apply(null, all);
  const hi = Math.max.apply(null, all);
  const width = (hi - lo) / bins || 1;

  const hist = (arr) => {
    const h = new Array(bins).fill(0);
    arr.forEach((v) => { h[Math.min(bins - 1, Math.floor((v - lo) / width))] += 1; });
    return h;
  };

  await chart.save({
    type: 'bar',
    data: {
      labels: Array.from({ length: bins }, (_, i) => (lo + width * (i + 0.5)).toFixed(0)),
      datasets: [
        { label: 'Без приложения', data: hist(base.waits), backgroundColor: 'rgba(156, 163, 175, 0.75)' },
        { label: 'С приложением', data: hist(app.waits), backgroundColor: 'rgba(34, 197, 94, 0.75)' }
      ]
    },
    options: chart.options(`Распределение среднего ожидания по ${days} дням`, {
      scales: {
        y: chart.axis('число дней', { beginAtZero: true }),
        x: chart.axis('среднее ожидание за день, с', { grid: { display: false } })
      },
      plugins: {
        title: chart.options(`Распределение среднего ожидания по ${days} дням`).plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 16, padding: 12 } }
      }
    })
  }, 'sim_wait_distribution.png');

  // График 2: очередь в течение одного дня
  const trace = base.sampleDay.queueTrace;
  const traceApp = app.sampleDay.queueTrace;

  await chart.save({
    type: 'line',
    data: {
      labels: trace.map((x) => (x.t / 3600).toFixed(1)),
      datasets: [
        {
          label: 'Без приложения',
          data: trace.map((x) => x.queue),
          borderColor: chart.COLOR.grey, pointRadius: 0, borderWidth: 2, tension: 0.2
        },
        {
          label: 'С приложением',
          data: traceApp.map((x) => x.queue),
          borderColor: chart.COLOR.ok, pointRadius: 0, borderWidth: 2, tension: 0.2
        }
      ]
    },
    options: chart.options('Длина очереди в течение дня', {
      scales: {
        y: chart.axis('человек в очереди', { beginAtZero: true }),
        x: chart.axis('час суток', { grid: { display: false }, ticks: { maxTicksLimit: 12 } })
      },
      plugins: {
        title: chart.options('Длина очереди в течение дня').plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 16, padding: 12 } }
      }
    })
  }, 'sim_queue_timeline.png');

  console.log('[sim] Графики сохранены: sim_wait_distribution.png, sim_queue_timeline.png');

  return { base, app, saved };
}

module.exports = { patienceThreshold, generateArrivals, simulateDay, runScenario, percentile, run };

if (require.main === module) {
  run().catch((err) => { console.error('[sim] Ошибка:', err.message); process.exit(1); });
}
