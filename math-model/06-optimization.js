/**
 * Модель 6. Оптимальное распределение потока между лифтом и лестницей.
 *
 * Постановка. За время пика длительностью D приходит N человек. Лифты
 * обслуживают поток со скоростью ν чел/с, лестница — неограниченно, но
 * медленно и тем медленнее, чем выше этаж. Нужно выбрать долю x,
 * уходящую на лестницу, чтобы минимизировать суммарное время подъёма.
 *
 *   min_x  F(x) = N·x·T̄_лестница(x) + N·(1−x)·[ W(λ(1−x)) + T̄_поездки(x) ]
 *
 * Отдельно проверяется, кого именно отправлять: модель сравнивает
 * оптимальное правило «сначала нижние этажи» со случайным выбором.
 *
 * Запуск:  npm run math:optimize
 */

const { PARAMS, destinationDistribution, arrivalRate } = require('./params');
const physics = require('./04-elevator-physics');
const queue = require('./01-queueing-model');
const chart = require('./chart-helper');

/**
 * Разделение потока по правилу «на лестницу идут нижние этажи».
 * Возвращает среднее время лестничного подъёма для ушедших и среднюю
 * высоту поездки для оставшихся.
 */
function splitByFloor(share, p = PARAMS) {
  const dist = destinationDistribution(p.floors);

  let acc = 0;
  let stairsTime = 0;
  let stairsMass = 0;
  let rideFloors = 0;
  let rideMass = 0;
  let thresholdFloor = dist[0].floor;

  dist.forEach((d) => {
    const remaining = Math.max(0, share - acc);
    const toStairs = Math.min(d.p, remaining);   // часть этажа уходит пешком
    const toElevator = d.p - toStairs;

    if (toStairs > 0) {
      stairsTime += toStairs * (d.floor - 1) * p.stairsTimePerFloor;
      stairsMass += toStairs;
      thresholdFloor = d.floor;
    }
    if (toElevator > 0) {
      rideFloors += toElevator * (d.floor - 1);
      rideMass += toElevator;
    }

    acc += d.p;
  });

  return {
    avgStairsTime: stairsMass > 0 ? stairsTime / stairsMass : 0,
    avgRideFloors: rideMass > 0 ? rideFloors / rideMass : 0,
    thresholdFloor
  };
}

/** Случайное распределение: средние характеристики не зависят от доли. */
function splitRandom(p = PARAMS) {
  const dist = destinationDistribution(p.floors);
  const avgFloor = dist.reduce((s, d) => s + d.p * d.floor, 0);
  return {
    avgStairsTime: (avgFloor - 1) * p.stairsTimePerFloor,
    avgRideFloors: avgFloor - 1
  };
}

/**
 * Суммарное время подъёма всех людей за пик при доле x на лестнице.
 * Ожидание считается жидкостной моделью: она корректно работает и при
 * перегрузке, где формулы Эрланга неприменимы.
 */
function totalTime(share, opts = {}) {
  const p = opts.params || PARAMS;
  const smart = opts.smart !== false;

  const peak = p.peakHours[0];
  const duration = (peak.end - peak.start) * 3600;
  const lambda = arrivalRate((peak.start + peak.end) / 2, p);
  const people = lambda * duration;

  const mu = physics.serviceRate(p.capacity, p);
  const nu = mu * p.elevators;
  const split = smart ? splitByFloor(share, p) : splitRandom(p);

  const lambdaElevator = lambda * (1 - share);
  const wait = queue.effectiveWait(lambdaElevator, mu, p.elevators, duration);
  const fluid = queue.fluidOverload(lambdaElevator, nu, duration);

  const rideTime = split.avgRideFloors * physics.floorTime(p) + p.doorOpenTime + 2 * p.boardingTimePerPerson;

  const stairsTotal = people * share * split.avgStairsTime;
  const elevatorTotal = people * (1 - share) * (wait + rideTime);

  return {
    share,
    people,
    wait,
    overloaded: fluid.overloaded,
    stairsTotal,
    elevatorTotal,
    total: stairsTotal + elevatorTotal,
    perPerson: (stairsTotal + elevatorTotal) / people,
    thresholdFloor: split.thresholdFloor
  };
}

/** Перебор по сетке с шагом step. */
function gridSearch(opts = {}) {
  const step = opts.step || 0.01;
  const points = [];

  for (let x = 0; x <= 1.0001; x += step) {
    points.push(totalTime(Math.min(x, 1), opts));
  }

  const best = points.reduce((a, b) => (b.perPerson < a.perPerson ? b : a));
  return { points, best };
}

// ---------- Запуск ----------
async function run(p = PARAMS) {
  console.log('[optimize] Ищу оптимальное распределение потока в утренний пик…');

  const smart = gridSearch({ params: p, smart: true });
  const random = gridSearch({ params: p, smart: false });

  const current = totalTime(0, { params: p, smart: true });     // все едут на лифте
  const best = smart.best;

  console.log(`[optimize] В пик приходит ${Math.round(current.people)} человек за ${Math.round((p.peakHours[0].end - p.peakHours[0].start) * 60)} минут`);
  console.log(`[optimize] Пропускная способность лифтов: ${Math.round(physics.serviceRate(p.capacity, p) * p.elevators * 3600)} чел/ч`);
  console.log('');

  console.log('  Доля на лестницу | Ожидание, с | Время на человека, с | Суммарно, чел·ч');
  [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].forEach((x) => {
    const r = totalTime(x, { params: p, smart: true });
    const mark = Math.abs(x - best.share) < 0.005 ? '  ← оптимум' : '';
    console.log(
      `  ${String(Math.round(x * 100)).padStart(15)}% | ${r.wait.toFixed(1).padStart(11)} | ` +
      `${r.perPerson.toFixed(1).padStart(20)} | ${(r.total / 3600).toFixed(1).padStart(15)}${mark}`
    );
  });

  // Реальное поведение без приложения берём из модели полезности
  const utility = require('./03-utility-model');
  const todayElevatorShare = utility.loadAfterApp(0, 300, p).withoutApp;
  const today = totalTime(1 - todayElevatorShare, { params: p, smart: false });

  console.log('');
  console.log(`[optimize] Сегодня без приложения на лестницу уходит ${((1 - todayElevatorShare) * 100).toFixed(0)}% (оценка по модели полезности),`);
  console.log(`[optimize] и уходят они неадресно: время на человека ${today.perPerson.toFixed(1)} с.`);
  console.log('');
  console.log(`[optimize] Оптимум: ${(best.share * 100).toFixed(0)}% потока на лестницу.`);
  console.log(`[optimize] Правило: пешком идут все, кому не выше ${Math.round(best.thresholdFloor)}-го этажа.`);
  console.log(`[optimize] Время на человека: ${current.perPerson.toFixed(1)} с → ${best.perPerson.toFixed(1)} с ` +
              `(выигрыш ${(current.perPerson - best.perPerson).toFixed(1)} с, ${((1 - best.perPerson / current.perPerson) * 100).toFixed(0)}%).`);
  console.log(`[optimize] Относительно сегодняшнего поведения выигрыш ${(today.perPerson - best.perPerson).toFixed(1)} с на человека ` +
              `(${((today.total - best.total) / 3600).toFixed(1)} человеко-часов за пик).`);
  console.log('[optimize] Сценарий «0% на лестницу» — гипотетический: он показывает, что было бы,');
  console.log('[optimize] если бы все упорно ждали лифт, и служит верхней границей потерь.');
  console.log('');
  console.log(`[optimize] Если отправлять на лестницу случайных людей, а не нижние этажи,`);
  console.log(`[optimize] лучший результат хуже: ${random.best.perPerson.toFixed(1)} с против ${best.perPerson.toFixed(1)} с.`);
  console.log('[optimize] Отсюда практический вывод: приложение должно советовать лестницу');
  console.log('[optimize] адресно — тем, кто едет невысоко, а не всем подряд.');

  await chart.save({
    type: 'line',
    data: {
      labels: smart.points.map((x) => (x.share * 100).toFixed(0)),
      datasets: [
        {
          label: 'Нижние этажи идут пешком (оптимальное правило)',
          data: smart.points.map((x) => Number(x.perPerson.toFixed(1))),
          borderColor: chart.COLOR.ok, backgroundColor: 'rgba(34,197,94,0.12)',
          fill: true, pointRadius: 0, borderWidth: 3, tension: 0.1
        },
        {
          label: 'Пешком идут случайные люди',
          data: random.points.map((x) => Number(x.perPerson.toFixed(1))),
          borderColor: chart.COLOR.grey, borderDash: [8, 5],
          fill: false, pointRadius: 0, borderWidth: 2, tension: 0.1
        }
      ]
    },
    options: chart.options(`Оптимум: ${(best.share * 100).toFixed(0)}% потока на лестницу`, {
      scales: {
        y: chart.axis('время подъёма на человека, с', { beginAtZero: true }),
        x: chart.axis('доля, уходящая на лестницу, %', { grid: { display: false }, ticks: { maxTicksLimit: 11 } })
      },
      plugins: {
        title: chart.options(`Оптимум: ${(best.share * 100).toFixed(0)}% потока на лестницу`).plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 16, padding: 12 } }
      }
    })
  }, 'optimization_flow_split.png');

  console.log('[optimize] График сохранён: optimization_flow_split.png');

  return { best, current, smart, random };
}

module.exports = { splitByFloor, splitRandom, totalTime, gridSearch, run };

if (require.main === module) {
  run().catch((err) => { console.error('[optimize] Ошибка:', err.message); process.exit(1); });
}
