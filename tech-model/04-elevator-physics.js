/**
 * Модель 4. Физика движения кабины с учётом решений системы.
 *
 * Здесь считается то, ради чего всё затевалось: сколько времени лифт
 * тратит на рейс и сколько людей успевает увезти за час.
 *
 * Главный расход времени — не движение, а остановки. Каждая стоит
 * 7 секунд только на двери (2 + 3 + 2) плюс время на вход и выход людей,
 * тогда как проезд одного этажа занимает 4 секунды. Поэтому остановка
 * у полной кабины — чистый убыток: двери открылись, никто не вошёл,
 * все внутри подождали.
 *
 * Модель сравнивает два режима:
 *   «без системы» — лифт тормозит на каждом вызванном этаже;
 *   «с системой»  — проезжает мимо, если камера видит, что мест нет.
 *
 * Запуск:  npm run tech:physics
 */

const PARAMS = require('./params');
const decision = require('./03-decision-logic');
const chart = require('./chart-helper');
const io = require('./io');

const E = PARAMS.elevators;
const B = PARAMS.building;

// Полный цикл дверей на одной остановке
const DOOR_CYCLE = E.doorOpenTime + E.doorHoldTime + E.doorCloseTime;

// ---------- Кинематика ----------

/**
 * Время проезда расстояния d метров по трапецеидальному профилю скорости.
 *
 * Разгон до v занимает путь v²/(2a). Если на разгон и торможение пути
 * хватает, профиль трапецеидальный:
 *
 *   t = (d − v²/a) / v + 2·v/a
 *
 * Если не хватает — кабина не успевает набрать номинальную скорость,
 * профиль треугольный и время считается как t = 2·√(d/a).
 */
function travelTime(distance) {
  if (distance <= 0) return 0;

  const v = E.speed;
  const a = E.acceleration;
  const rampDistance = (v * v) / a; // разгон плюс торможение

  if (distance < rampDistance) return 2 * Math.sqrt(distance / a);

  return (distance - rampDistance) / v + 2 * (v / a);
}

/** Время проезда между этажами без учёта остановок. */
function floorTime(from, to) {
  return travelTime(Math.abs(to - from) * B.floorHeight);
}

/**
 * Время рейса по формуле из постановки задачи.
 *
 *   travel   — проезд от текущего этажа до целевого;
 *   stops    — полный цикл дверей на каждой остановке;
 *   boarding — вход и выход: каждый пассажир учитывается дважды.
 */
function tripTime(currentFloor, targetFloor, stops, passengers) {
  const travel = floorTime(currentFloor, targetFloor);
  const stopTime = stops.length * DOOR_CYCLE;
  const boarding = passengers * E.boardingTimePerPerson * 2;

  return travel + stopTime + boarding;
}

// ---------- Куда едут люди ----------

/** Нормированное распределение этажей назначения. */
function destinations() {
  const dist = PARAMS.floorDistribution;
  const total = Object.values(dist).reduce((a, b) => a + b, 0);

  return Object.keys(dist).map((floor) => ({
    floor: Number(floor),
    p: dist[floor] / total
  }));
}

/**
 * Сколько РАЗНЫХ этажей закажут P пассажиров.
 *
 * Два человека на один этаж — это одна остановка, а не две, и с ростом
 * загрузки эта экономия заметна. Вероятность, что этаж не заказан никем,
 * равна (1 − p)^P, значит ожидаемое число остановок:
 *
 *   E[stops] = Σ_f [ 1 − (1 − p_f)^P ]
 */
function expectedStops(passengers) {
  return destinations().reduce((sum, d) => sum + (1 - Math.pow(1 - d.p, passengers)), 0);
}

/** Средний этаж назначения — до него кабина доезжает в верхней точке рейса. */
function averageTopFloor(passengers) {
  const dist = destinations();

  // Верхняя точка рейса — самый высокий из заказанных этажей.
  // P(максимум ≤ f) = (Σ_{g ≤ f} p_g)^P, отсюда ожидание через хвосты.
  let expectation = 0;
  for (let f = 1; f <= B.floors; f += 1) {
    const cdf = dist.filter((d) => d.floor <= f).reduce((s, d) => s + d.p, 0);
    expectation += 1 - Math.pow(cdf, passengers);
  }

  return 1 + expectation;
}

// ---------- Рейс туда и обратно ----------

/**
 * Полный круг: кабина набирает людей на первом этаже, развозит их,
 * возвращается вниз.
 *
 * @param {number} passengers — сколько человек увозит рейс
 * @param {number} extraStops — остановки по вызовам с промежуточных этажей
 */
function roundTrip(passengers, extraStops) {
  const top = averageTopFloor(passengers);
  const exitStops = expectedStops(passengers);
  const stops = exitStops + extraStops;

  const travelUp = floorTime(1, top);
  const travelDown = floorTime(top, 1);

  // Вход внизу плюс выход наверху — отсюда множитель 2 в формуле рейса
  const boarding = passengers * E.boardingTimePerPerson * 2;

  // Вошедшие с промежуточных этажей тоже тратят время на посадку
  const extraBoarding = extraStops * E.boardingTimePerPerson;

  return {
    passengers,
    topFloor: io.round(top, 2),
    exitStops: io.round(exitStops, 2),
    extraStops: io.round(extraStops, 2),
    stops: io.round(stops, 2),
    travel: io.round(travelUp + travelDown, 1),
    doors: io.round(stops * DOOR_CYCLE, 1),
    boarding: io.round(boarding + extraBoarding, 1),
    total: io.round(travelUp + travelDown + stops * DOOR_CYCLE + boarding + extraBoarding, 1)
  };
}

// ---------- Пропускная способность ----------

/**
 * Пропускная способность по формуле из постановки задачи:
 *
 *   throughput = capacity / avg_trip_time · working_elevators
 *
 * Множитель 3600 переводит результат из «человек в секунду» в «человек в час».
 */
function throughput(capacity, tripSeconds, elevators = E.working.length) {
  return (capacity / tripSeconds) * elevators * 3600;
}

/**
 * Сравнение двух режимов при заданной средней загрузке.
 *
 * Без системы лифт тормозит на всех вызванных этажах. С системой часть
 * этих остановок отсекается — ровно та часть, где камера видит, что
 * мест нет. Доля проездов берётся из модели 3, чтобы физика и логика
 * считались по одним и тем же правилам.
 */
function compareModes(meanOccupancy, callsPerTrip, margin = decision.DEFAULT_MARGIN, opts) {
  const capacity = E.capacityRealPeak;
  const weights = decision.loadDistribution(meanOccupancy, capacity);
  const rule = decision.evaluateOverLoad('hysteresis', capacity, margin, weights, 1500, opts);

  const passengers = Math.max(Math.round(meanOccupancy), 1);

  // Без системы отрабатываются все вызовы
  const without = roundTrip(passengers, callsPerTrip);

  // С системой отсекается доля pPass
  const honored = callsPerTrip * (1 - rule.pPass);
  const withSystem = roundTrip(passengers, honored);

  return {
    meanOccupancy,
    callsPerTrip,
    margin,
    pPass: rule.pPass,
    skippedPerTrip: io.round(callsPerTrip * rule.pPass, 2),
    without,
    withSystem,
    savedSeconds: io.round(without.total - withSystem.total, 1),
    savedPercent: io.round((without.total - withSystem.total) / without.total * 100, 1),
    throughputWithout: io.round(throughput(passengers, without.total), 1),
    throughputWith: io.round(throughput(passengers, withSystem.total), 1),
    gainPercent: io.round(
      (throughput(passengers, withSystem.total) / throughput(passengers, without.total) - 1) * 100, 1)
  };
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 4. Физика движения кабины с учётом решений');

  console.log('');
  console.log('  Кабина: v = ' + E.speed + ' м/с, a = ' + E.acceleration + ' м/с², этаж ' +
    B.floorHeight + ' м');
  console.log('  Двери: ' + E.doorOpenTime + ' + ' + E.doorHoldTime + ' + ' + E.doorCloseTime +
    ' = ' + DOOR_CYCLE + ' с на остановку');
  console.log('  Посадка: ' + E.boardingTimePerPerson + ' с на человека');
  console.log('  Работают лифты: ' + E.working.join(', ') + ' (' + E.working.length +
    ' из ' + E.total + ')');

  // Кинематика
  io.header('Время проезда: движение дешевле остановки');
  const kinRows = [];
  for (const f of [1, 2, 3, 5, 8, 10, 15]) {
    const d = f * B.floorHeight;
    kinRows.push([f, d, io.round(travelTime(d), 2), io.round(travelTime(d) / f, 2)]);
  }
  io.table(['Этажей', 'Метров', 'Время, с', 'с/этаж'], kinRows);

  console.log('');
  console.log('  Один этаж — ' + io.round(travelTime(B.floorHeight), 1) + ' с, одна остановка — ' +
    DOOR_CYCLE + ' с только на двери.');
  console.log('  Остановка у полной кабины стоит столько же, сколько проезд ' +
    io.round(DOOR_CYCLE / travelTime(B.floorHeight), 1) + ' этажей,');
  console.log('  и не привозит ни одного человека.');

  // Рейс
  io.header('Из чего складывается рейс');
  const tripRows = [];
  for (const p of [2, 4, 6, 8, 10]) {
    const t = roundTrip(p, 2);
    tripRows.push([p, t.topFloor, t.exitStops, t.travel, t.doors, t.boarding, t.total]);
  }
  io.table(['Пассажиров', 'Верхний этаж', 'Остановок на выход', 'Движение, с',
    'Двери, с', 'Посадка, с', 'Всего, с'], tripRows);

  // Сравнение режимов
  io.header('Пропускная способность с системой и без неё');

  const modes = [];
  const modeRows = [];
  [4, 6, 7, 8, 9].forEach((meanOcc) => {
    const c = compareModes(meanOcc, 3);
    modes.push(c);
    modeRows.push([meanOcc, c.pPass, c.skippedPerTrip, c.without.total, c.withSystem.total,
      c.savedSeconds, c.throughputWithout, c.throughputWith, c.gainPercent]);
  });

  io.table(['Средняя загрузка', 'Доля проездов', 'Пропущено/рейс', 'Рейс без, с',
    'Рейс с, с', 'Экономия, с', 'Без, чел/ч', 'С системой, чел/ч', 'Прирост, %'], modeRows);

  const peak = modes[modes.length - 1];
  const normal = modes[1];

  console.log('');
  console.log('  Вне пика (загрузка ' + normal.meanOccupancy + ') система почти не вмешивается:');
  console.log('  мест хватает, проезжать мимо незачем — прирост ' + normal.gainPercent + ' %.');
  console.log('  В пик (загрузка ' + peak.meanOccupancy + ') она отсекает ' +
    peak.skippedPerTrip + ' бесполезных остановок за рейс');
  console.log('  и поднимает пропускную способность на ' + peak.gainPercent + ' % — с ' +
    peak.throughputWithout + ' до ' + peak.throughputWith + ' чел/ч на три лифта.');

  // Зависимость от числа вызовов
  io.header('Чем чаще вызовы, тем больше выигрыш');
  const callRows = [];
  const byCalls = [];
  [1, 2, 3, 4, 5, 6].forEach((calls) => {
    const c = compareModes(9, calls);
    byCalls.push(c);
    callRows.push([calls, c.without.total, c.withSystem.total, c.savedSeconds, c.gainPercent]);
  });
  io.table(['Вызовов за рейс', 'Без системы, с', 'С системой, с', 'Экономия, с', 'Прирост, %'],
    callRows);

  // ---------- Графики ----------

  await chart.save({
    type: 'bar',
    data: {
      labels: modes.map((m) => m.meanOccupancy + ' чел'),
      datasets: [
        {
          label: 'Без системы',
          data: modes.map((m) => m.throughputWithout),
          backgroundColor: chart.COLOR.grey
        },
        {
          label: 'С системой',
          data: modes.map((m) => m.throughputWith),
          backgroundColor: chart.COLOR.accent
        }
      ]
    },
    options: chart.options('Пропускная способность трёх лифтов, чел/ч', {
      scales: {
        y: chart.axis('человек в час', { beginAtZero: true }),
        x: chart.axis('средняя загрузка кабины', { grid: { display: false } })
      }
    }, true)
  }, 'physics_throughput.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: tripRows.map((r) => r[0] + ' чел'),
      datasets: [
        { label: 'Движение', data: tripRows.map((r) => r[3]), backgroundColor: chart.COLOR.accent },
        { label: 'Двери', data: tripRows.map((r) => r[4]), backgroundColor: chart.COLOR.full },
        { label: 'Посадка и высадка', data: tripRows.map((r) => r[5]), backgroundColor: chart.COLOR.busy }
      ]
    },
    options: chart.options('Время рейса: двери дороже движения', {
      scales: {
        y: chart.axis('секунд', { stacked: true }),
        x: chart.axis('пассажиров за рейс', { stacked: true, grid: { display: false } })
      }
    }, true)
  }, 'physics_trip_breakdown.png');

  await chart.save({
    type: 'line',
    data: {
      labels: byCalls.map((c) => c.callsPerTrip),
      datasets: [
        {
          label: 'Прирост пропускной способности, %',
          data: byCalls.map((c) => c.gainPercent),
          borderColor: chart.COLOR.ok,
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          fill: true,
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.2
        }
      ]
    },
    options: chart.options('Выигрыш растёт вместе с числом промежуточных вызовов', {
      scales: {
        y: chart.axis('прирост, %', { beginAtZero: true }),
        x: chart.axis('вызовов с промежуточных этажей за рейс', { grid: { display: false } })
      }
    })
  }, 'physics_gain_vs_calls.png');

  const result = {
    doorCycle: DOOR_CYCLE,
    floorTravelTime: io.round(travelTime(B.floorHeight), 2),
    workingElevators: E.working.length,
    kinematics: kinRows.map((r) => ({ floors: r[0], meters: r[1], seconds: r[2], perFloor: r[3] })),
    trips: tripRows.map((r) => ({
      passengers: r[0], topFloor: r[1], exitStops: r[2],
      travel: r[3], doors: r[4], boarding: r[5], total: r[6]
    })),
    modes,
    byCalls,
    peakGainPercent: peak.gainPercent,
    peakThroughputWithout: peak.throughputWithout,
    peakThroughputWith: peak.throughputWith
  };

  io.saveData('04-physics', result);
  console.log('');
  console.log('  Графики: physics_throughput.png, physics_trip_breakdown.png,');
  console.log('           physics_gain_vs_calls.png');
  console.log('  Данные:  output/data/04-physics.json');

  return result;
}

module.exports = {
  DOOR_CYCLE, travelTime, floorTime, tripTime,
  destinations, expectedStops, averageTopFloor, roundTrip,
  throughput, compareModes, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[physics] Ошибка:', err.message); process.exit(1); });
}
