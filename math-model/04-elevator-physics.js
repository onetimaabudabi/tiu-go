/**
 * Модель 4. Физика движения лифта.
 *
 * Считает время полного рейса кабины («круглой поездки»): подъём с первого
 * этажа, остановки на этажах назначения, возврат вниз. Из времени рейса
 * выводится пропускная способность — сколько человек в час способны
 * перевезти шесть лифтов. Эта величина нужна всем остальным моделям:
 * именно она задаёт интенсивность обслуживания μ.
 *
 * Запуск:  npm run math:physics
 */

const { PARAMS, destinationDistribution } = require('./params');
const chart = require('./chart-helper');

/**
 * Время проезда одного этажа, с.
 * Включает потери на разгон и торможение — упрощение, при котором
 * ускорение «размазано» по каждому этажу.
 *
 *   t_floor = h / v + t_accel
 */
function floorTime(p = PARAMS) {
  return p.floorHeight / p.elevatorSpeed + p.accelerationTime;
}

/**
 * Ожидаемое число остановок при P пассажирах.
 *
 * Пассажиры выбирают этажи независимо, поэтому вероятность, что на этаже f
 * никто не выйдет, равна (1 − p_f)^P. Отсюда ожидаемое число различных
 * этажей назначения:
 *
 *   S(P) = Σ_f [ 1 − (1 − p_f)^P ]
 */
function expectedStops(passengers, p = PARAMS) {
  if (passengers <= 0) return 0;
  return destinationDistribution(p.floors)
    .reduce((sum, d) => sum + (1 - Math.pow(1 - d.p, passengers)), 0);
}

/**
 * Ожидаемый самый верхний этаж назначения — до него кабина поднимается.
 *
 *   P(H ≤ f) = F(f)^P,  где F — функция распределения этажей
 *   E[H] = Σ_f f · [ F(f)^P − F(f−1)^P ]
 */
function expectedHighestFloor(passengers, p = PARAMS) {
  if (passengers <= 0) return 1;

  const dist = destinationDistribution(p.floors);
  let cdf = 0;
  let prev = 0;
  let expectation = 0;

  dist.forEach((d) => {
    cdf += d.p;
    const probMaxIsHere = Math.pow(cdf, passengers) - Math.pow(prev, passengers);
    expectation += d.floor * probMaxIsHere;
    prev = Math.pow(cdf, passengers) ** (1 / passengers); // восстанавливаем F(f)
    prev = cdf;
  });

  return expectation;
}

/**
 * Время полного рейса кабины, с.
 *
 *   T_cycle = 2 · (H − 1) · t_floor            — подъём и возврат
 *           + (S + 1) · t_door                 — двери в холле и на остановках
 *           + 2 · P · t_board                  — посадка и высадка
 *
 * Двери открываются S + 1 раз: один раз в холле на посадку и по разу
 * на каждой остановке. Каждый пассажир стоит двух операций — зашёл и вышел.
 */
function cycleTime(passengers, p = PARAMS) {
  const stops = expectedStops(passengers, p);
  const highest = expectedHighestFloor(passengers, p);

  const travel = 2 * (highest - 1) * floorTime(p);
  const doors = (stops + 1) * p.doorOpenTime;
  const boarding = 2 * passengers * p.boardingTimePerPerson;

  return { total: travel + doors + boarding, travel, doors, boarding, stops, highest };
}

/**
 * Время рейса для конкретной группы пассажиров (а не для среднего случая).
 * Нужно имитационной модели: там известны фактические этажи назначения.
 */
function cycleTimeExact(destinationFloors, p = PARAMS) {
  const passengers = destinationFloors.length;
  if (passengers === 0) return 0;

  const stops = new Set(destinationFloors).size;
  const highest = Math.max.apply(null, destinationFloors);

  return 2 * (highest - 1) * floorTime(p)
    + (stops + 1) * p.doorOpenTime
    + 2 * passengers * p.boardingTimePerPerson;
}

/** Пропускная способность одного лифта, чел/ч. */
function throughputPerElevator(passengers, p = PARAMS) {
  if (passengers <= 0) return 0;
  return (3600 / cycleTime(passengers, p).total) * passengers;
}

/** Пропускная способность всей системы, чел/ч. */
function systemThroughput(passengers, p = PARAMS) {
  return throughputPerElevator(passengers, p) * p.elevators;
}

/**
 * Интенсивность обслуживания одного лифта μ, чел/с.
 *
 * Важно: в кабине едет сразу несколько человек, поэтому μ — это не
 * 1/T_cycle, а P/T_cycle. Если взять 1/T_cycle, система массового
 * обслуживания окажется перегружена даже в спокойные часы, чего в
 * реальности не происходит.
 */
function serviceRate(passengers = PARAMS.capacity, p = PARAMS) {
  return passengers / cycleTime(passengers, p).total;
}

/** Расчёт по всем сценариям загрузки кабины. */
function analyze(p = PARAMS) {
  const rows = [];
  for (let passengers = 1; passengers <= p.capacity; passengers += 1) {
    const c = cycleTime(passengers, p);
    rows.push({
      passengers,
      stops: c.stops,
      highest: c.highest,
      travel: c.travel,
      doors: c.doors,
      boarding: c.boarding,
      cycle: c.total,
      perElevator: throughputPerElevator(passengers, p),
      system: systemThroughput(passengers, p)
    });
  }
  return rows;
}

// ---------- Запуск ----------
async function run(p = PARAMS) {
  console.log('[physics] Считаю время рейса кабины…');

  const rows = analyze(p);
  const full = rows[rows.length - 1];

  console.log(`[physics] Время проезда одного этажа: ${floorTime(p).toFixed(2)} с`);
  console.log('');
  console.log('  Пасс. | Остановок | Верх. этаж | Ход, с | Двери, с | Посадка, с | Рейс, с | Лифт, чел/ч | Система, чел/ч');
  rows.forEach((r) => {
    console.log(
      `  ${String(r.passengers).padStart(5)} | ${r.stops.toFixed(2).padStart(9)} | ${r.highest.toFixed(1).padStart(10)} | ` +
      `${r.travel.toFixed(1).padStart(6)} | ${r.doors.toFixed(1).padStart(8)} | ${r.boarding.toFixed(1).padStart(10)} | ` +
      `${r.cycle.toFixed(1).padStart(7)} | ${r.perElevator.toFixed(0).padStart(11)} | ${r.system.toFixed(0).padStart(14)}`
    );
  });

  console.log('');
  console.log(`[physics] При полной кабине (${p.capacity} чел.) рейс длится ${full.cycle.toFixed(1)} с`);
  console.log(`[physics] Пропускная способность системы: ${full.system.toFixed(0)} чел/ч`);
  console.log(`[physics] Интенсивность обслуживания μ = ${serviceRate(p.capacity, p).toFixed(4)} чел/с на лифт`);

  // График: время рейса и пропускная способность от числа пассажиров
  await chart.save({
    type: 'bar',
    data: {
      labels: rows.map((r) => `${r.passengers} чел.`),
      datasets: [
        {
          type: 'bar',
          label: 'Время рейса, с',
          data: rows.map((r) => Number(r.cycle.toFixed(1))),
          backgroundColor: chart.COLOR.accent,
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: 'Пропускная способность системы, чел/ч',
          data: rows.map((r) => Number(r.system.toFixed(0))),
          borderColor: chart.COLOR.ok,
          backgroundColor: chart.COLOR.ok,
          tension: 0.2,
          pointRadius: 5,
          yAxisID: 'y1'
        }
      ]
    },
    options: chart.options('Время рейса и пропускная способность', {
      scales: {
        y: chart.axis('время рейса, с', { beginAtZero: true, position: 'left' }),
        y1: chart.axis('чел/ч', { beginAtZero: true, position: 'right', grid: { display: false } }),
        x: chart.axis(null, { grid: { display: false } })
      },
      plugins: {
        title: chart.options('Время рейса и пропускная способность').plugins.title,
        legend: { display: true, position: 'bottom', labels: { boxWidth: 16, padding: 14 } }
      }
    })
  }, 'physics_cycle_time.png');

  console.log('[physics] График сохранён: physics_cycle_time.png');

  return {
    floorTime: floorTime(p),
    rows,
    full,
    serviceRate: serviceRate(p.capacity, p),
    systemThroughput: full.system
  };
}

module.exports = {
  floorTime, expectedStops, expectedHighestFloor, cycleTime, cycleTimeExact,
  throughputPerElevator, systemThroughput, serviceRate, analyze, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[physics] Ошибка:', err.message); process.exit(1); });
}
