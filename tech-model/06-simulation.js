/**
 * Модель 6. Симуляция учебного дня с камерами и логикой диспетчеризации.
 *
 * Три работающих лифта возят людей с 8:00 до 20:00. Поток неравномерный:
 * четверть всех поездок приходится на сорокаминутный обеденный пик, когда
 * корпус и без того перегружен. Именно там система либо помогает, либо нет.
 *
 * Каждый день разыгрывается дважды одними и теми же приходами людей:
 *   «без системы» — лифт тормозит на каждом вызванном этаже;
 *   «с системой»  — камера оценивает кабину и решает, стоит ли тормозить.
 *
 * Сравнение честное: одни и те же пассажиры, одно и то же зерно, разница
 * только в правиле остановки.
 *
 * Про скорость. Прямой розыгрыш камеры (30 кадров на каждое решение)
 * потребовал бы около двухсот миллионов бросков на 500 дней. Поэтому
 * распределение показаний камеры табулируется ОДИН раз по каждому
 * значению реальной загрузки, а в симуляции из таблицы делается выборка.
 * Статистически это то же самое, только в тысячу раз быстрее.
 *
 * Запуск:  npm run tech:sim
 */

const PARAMS = require('./params');
const errors = require('./02-detection-errors');
const decision = require('./03-decision-logic');
const physics = require('./04-elevator-physics');
const chart = require('./chart-helper');
const io = require('./io');

const E = PARAMS.elevators;
const B = PARAMS.building;
const SIM = PARAMS.simulation;

const CAPACITY = E.capacityRealPeak;
const MARGIN = decision.DEFAULT_MARGIN;
const ELEVATORS = E.working.length;

const DAY_START = SIM.dayStart * 3600;
const DAY_END = SIM.dayEnd * 3600;

// ---------- Таблица показаний камеры ----------

/**
 * Распределение показаний камеры для каждой реальной загрузки.
 * Строится один раз при загрузке модуля и дальше только опрашивается.
 */
function buildMeasurementTable(trials = 20000) {
  const table = [];

  for (let n = 0; n <= CAPACITY + 3; n += 1) {
    const rng = io.makeRng(SIM.randomSeed + n * 7919);
    const counts = new Array(n + 6).fill(0);

    for (let i = 0; i < trials; i += 1) {
      const d = Math.min(errors.measure(n, rng).tracked, counts.length - 1);
      counts[d] += 1;
    }

    // Переводим в кумулятивные доли — по ним удобно делать выборку
    const cumulative = [];
    let acc = 0;
    counts.forEach((c) => {
      acc += c / trials;
      cumulative.push(acc);
    });

    table.push(cumulative);
  }

  return table;
}

const MEASURE_TABLE = buildMeasurementTable();

/** Выборка показаний камеры при реальной загрузке n. */
function sampleDetected(n, rng) {
  const row = MEASURE_TABLE[Math.min(n, MEASURE_TABLE.length - 1)];
  const u = rng();

  for (let d = 0; d < row.length; d += 1) {
    if (u <= row[d]) return d;
  }
  return row.length - 1;
}

// ---------- Поток людей ----------

/** 'HH:MM' -> секунды от начала суток. */
function toSeconds(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/**
 * Сколько человек приходит за день и как они распределены по времени.
 *
 * Веса пиков в сумме дают 0.95, оставшиеся 5 % — ровный фон по всему дню.
 */
function dailyArrivals() {
  const total = Math.round(
    (PARAMS.people.students + PARAMS.people.staff) * SIM.tripsPerPersonPerDay
  );

  const peakWeight = PARAMS.peakIntervals.reduce((s, p) => s + p.weight, 0);

  const intervals = PARAMS.peakIntervals.map((p) => ({
    label: p.label,
    from: toSeconds(p.start),
    to: toSeconds(p.end),
    people: Math.round(total * p.weight)
  }));

  return {
    total,
    intervals,
    background: Math.round(total * (1 - peakWeight))
  };
}

/** Этаж назначения по распределению из параметров. */
function pickFloor(rng) {
  const u = rng();
  let acc = 0;

  for (const [floor, p] of Object.entries(PARAMS.floorDistribution)) {
    acc += p;
    if (u <= acc) return Number(floor);
  }
  return B.floors;
}

/**
 * Расписание приходов на день: массив { time, from, to }.
 * Люди либо заходят с первого этажа, либо вызывают лифт с произвольного.
 */
function buildArrivals(rng) {
  const plan = dailyArrivals();
  const arrivals = [];

  const addPerson = (time) => {
    const fromLobby = rng() < SIM.lobbyShare;
    const to = pickFloor(rng);
    let from = 1;

    if (!fromLobby) {
      from = pickFloor(rng);
      if (from === to) from = from > 1 ? 1 : 2;
    }

    arrivals.push({ time, from, to });
  };

  plan.intervals.forEach((interval) => {
    for (let i = 0; i < interval.people; i += 1) {
      addPerson(interval.from + rng() * (interval.to - interval.from));
    }
  });

  for (let i = 0; i < plan.background; i += 1) {
    addPerson(DAY_START + rng() * (DAY_END - DAY_START));
  }

  arrivals.sort((a, b) => a.time - b.time);
  return arrivals;
}

// ---------- Один день ----------

/**
 * Прогон одного дня.
 *
 * @param {Array} arrivals — заранее построенные приходы (общие для обоих режимов)
 * @param {boolean} useSystem — включена ли камера с логикой пропуска
 * @param {number} seed — зерно розыгрыша
 * @param {number} [margin] — запас мест; по умолчанию штатный, перебором
 *        его гоняет 07-optimization.js
 */
function simulateDay(arrivals, useSystem, seed, margin = MARGIN) {
  const rng = io.makeRng(seed);

  // Очередь ожидающих на каждом этаже
  const queues = Array.from({ length: B.floors + 1 }, () => []);

  // Когда каждый лифт освободится и где он при этом окажется
  const lifts = Array.from({ length: ELEVATORS }, () => ({ freeAt: DAY_START, floor: 1 }));

  // Ожидание считаем раздельно: на первом этаже лифт берёт всех подряд,
  // а мимо промежуточных как раз и проезжает. Общее среднее эти две
  // группы смешивает, и вред от проездов в нём теряется.
  const waits = [];
  const waitsLobby = [];
  const waitsUpper = [];
  const servedByHour = new Array(24).fill(0);
  let maxQueue = 0;
  let served = 0;
  let stops = 0;
  let passes = 0;
  let passCorrect = 0;   // проехали мимо полной кабины — правильно
  let passWrong = 0;     // проехали, хотя место было — FP
  let uselessStops = 0;  // остановились у полной кабины — FN
  let previousDecision = null;

  // Решения по времени суток, по часам
  const byHour = Array.from({ length: 24 }, () => ({ stops: 0, passes: 0 }));

  let index = 0;
  let clock = DAY_START;

  while (clock < DAY_END) {
    // Ближайший освободившийся лифт
    const lift = lifts.reduce((a, b) => (b.freeAt < a.freeAt ? b : a));
    clock = Math.max(lift.freeAt, clock);
    if (clock >= DAY_END) break;

    // Всех, кто пришёл к этому моменту, ставим в очередь на их этаже
    while (index < arrivals.length && arrivals[index].time <= clock) {
      queues[arrivals[index].from].push(arrivals[index]);
      index += 1;
    }

    // Лифт едет к первому этажу за основной группой
    let time = clock + physics.floorTime(lift.floor, 1);
    let occupancy = 0;
    const cabin = [];

    const lobby = queues[1];
    while (cabin.length < CAPACITY && lobby.length) {
      const person = lobby.shift();
      cabin.push(person);
      const waited = Math.max(time - person.time, 0);
      waits.push(waited);
      waitsLobby.push(waited);
    }

    if (!cabin.length) {
      // Никого нет — лифт ждёт следующего прихода, а не крутится вхолостую
      const nextArrival = index < arrivals.length ? arrivals[index].time : DAY_END;
      lift.freeAt = Math.max(nextArrival, clock + 10);
      lift.floor = 1;
      continue;
    }

    occupancy = cabin.length;
    time += occupancy * E.boardingTimePerPerson;

    // Куда едем: все заказанные этажи по возрастанию
    const targets = [...new Set(cabin.map((p) => p.to))].sort((a, b) => a - b);
    const top = targets[targets.length - 1];

    let current = 1;

    for (let floor = 2; floor <= top; floor += 1) {
      const isTarget = targets.includes(floor);
      const waiting = queues[floor].length;
      const hour = Math.floor(time / 3600);

      // Решение по промежуточному вызову
      let stopHere = isTarget;
      let decided = null;

      if (!isTarget && waiting > 0) {
        if (useSystem) {
          const detected = sampleDetected(occupancy, rng);
          decided = decision.decide('hysteresis', detected, CAPACITY, margin,
            previousDecision, rng);
          previousDecision = decided;
          stopHere = decided === 'stop';
        } else {
          stopHere = true; // без системы тормозим на каждом вызове
        }

        if (!stopHere) {
          passes += 1;
          if (byHour[hour]) byHour[hour].passes += 1;
          if (occupancy >= CAPACITY) passCorrect += 1;
          else passWrong += 1;
        }
      }

      if (!stopHere) continue;

      // Остановка
      time += physics.floorTime(current, floor);
      current = floor;
      time += physics.DOOR_CYCLE;
      stops += 1;
      if (byHour[hour]) byHour[hour].stops += 1;

      // Высадка
      if (isTarget) {
        const leaving = cabin.filter((p) => p.to === floor).length;
        occupancy -= leaving;
        served += leaving;
        if (servedByHour[Math.floor(time / 3600)] !== undefined) {
          servedByHour[Math.floor(time / 3600)] += leaving;
        }
        time += leaving * E.boardingTimePerPerson;
      }

      // Посадка с этажа
      const space = CAPACITY - occupancy;
      if (waiting > 0) {
        if (space <= 0) {
          uselessStops += 1; // двери открылись, войти некому
        } else {
          const boarding = Math.min(space, waiting);
          for (let k = 0; k < boarding; k += 1) {
            const person = queues[floor].shift();
            cabin.push(person);
            const waited = Math.max(time - person.time, 0);
            waits.push(waited);
            waitsUpper.push(waited);
          }
          occupancy += boarding;
          time += boarding * E.boardingTimePerPerson;
        }
      }
    }

    // Высаживаем всех, кто ещё остался: это те, кто подсел на промежуточных
    // этажах и едет ниже либо выше верхней точки рейса
    served += occupancy;
    if (servedByHour[Math.floor(time / 3600)] !== undefined) {
      servedByHour[Math.floor(time / 3600)] += occupancy;
    }

    // Самая длинная очередь за день — показатель перегрузки корпуса
    const queued = queues.reduce((sum, q) => sum + q.length, 0);
    if (queued > maxQueue) maxQueue = queued;

    lift.freeAt = time;
    lift.floor = current;
  }

  const w = io.stats(waits);
  const wLobby = io.stats(waitsLobby);
  const wUpper = io.stats(waitsUpper);
  const hours = (DAY_END - DAY_START) / 3600;

  // Сколько осталось не увезённых к концу дня
  const leftover = queues.reduce((sum, q) => sum + q.length, 0);

  // Пропускная способность в самый загруженный час. Именно она упирается
  // в лифты: за сутки спрос всё равно рассасывается, и суточное среднее
  // показывает не возможности системы, а размер потока.
  const peakHour = Math.max(...servedByHour);

  return {
    served,
    leftover,
    stops,
    passes,
    passCorrect,
    passWrong,
    uselessStops,
    maxQueue,
    throughput: io.round(served / hours, 1),
    peakThroughput: peakHour,
    avgWait: io.round(w.mean, 1),
    avgWaitLobby: io.round(wLobby.mean, 1),
    avgWaitUpper: io.round(wUpper.mean, 1),
    p95Wait: io.round(w.p95, 1),
    byHour: byHour.map((h, i) => ({ hour: i, stops: h.stops, passes: h.passes }))
      .filter((h) => h.hour >= SIM.dayStart && h.hour < SIM.dayEnd)
  };
}

// ---------- Запуск ----------

async function run() {
  io.header('Модель 6. Симуляция учебного дня');

  const plan = dailyArrivals();
  const runs = SIM.runs;

  console.log('');
  console.log('  День: ' + SIM.dayStart + ':00 – ' + SIM.dayEnd + ':00, прогонов: ' + runs);
  console.log('  Людей в корпусе: ' + (PARAMS.people.students + PARAMS.people.staff) +
    ', поездок за день: ' + plan.total);
  console.log('  Лифтов: ' + ELEVATORS + ' (номера ' + E.working.join(', ') + '), вместимость ' +
    CAPACITY + ', запас мест ' + MARGIN);
  console.log('  Самый тяжёлый интервал: ' +
    plan.intervals.reduce((a, b) => (b.people > a.people ? b : a)).label + ' — ' +
    plan.intervals.reduce((a, b) => (b.people > a.people ? b : a)).people + ' поездок');

  const withSystem = [];
  const withoutSystem = [];
  const hourly = Array.from({ length: 24 }, () => ({ stops: 0, passes: 0 }));

  const started = Date.now();

  for (let r = 0; r < runs; r += 1) {
    const seed = SIM.randomSeed + r * 104729;
    const arrivals = buildArrivals(io.makeRng(seed));

    const a = simulateDay(arrivals, true, seed + 1);
    const b = simulateDay(arrivals, false, seed + 1);

    withSystem.push(a);
    withoutSystem.push(b);

    a.byHour.forEach((h) => {
      hourly[h.hour].stops += h.stops / runs;
      hourly[h.hour].passes += h.passes / runs;
    });
  }

  console.log('  Расчёт занял ' + io.round((Date.now() - started) / 1000, 1) + ' с');

  const agg = (list, field) => io.stats(list.map((x) => x[field]));

  const thrWith = agg(withSystem, 'peakThroughput');
  const thrWithout = agg(withoutSystem, 'peakThroughput');
  const dayWith = agg(withSystem, 'throughput');
  const dayWithout = agg(withoutSystem, 'throughput');
  const queueWith = agg(withSystem, 'maxQueue');
  const queueWithout = agg(withoutSystem, 'maxQueue');
  const waitWith = agg(withSystem, 'avgWait');
  const waitWithout = agg(withoutSystem, 'avgWait');
  const stopsWith = agg(withSystem, 'stops');
  const stopsWithout = agg(withoutSystem, 'stops');

  const delta = (before, after) => (before === 0 ? '—' :
    (after >= before ? '+' : '') + io.round((after / before - 1) * 100, 1) + ' %');

  io.header('Результаты ' + runs + ' прогонов');
  io.table(['Показатель', 'Без системы', 'С системой', 'Изменение'], [
    ['Пропускная способность в пиковый час, чел/ч',
      Math.round(thrWithout.mean), Math.round(thrWith.mean),
      delta(thrWithout.mean, thrWith.mean)],
    ['Среднее ожидание, с', io.round(waitWithout.mean, 1), io.round(waitWith.mean, 1),
      delta(waitWithout.mean, waitWith.mean)],
    ['Ожидание, 95-й перцентиль, с', io.round(agg(withoutSystem, 'p95Wait').mean, 1),
      io.round(agg(withSystem, 'p95Wait').mean, 1),
      delta(agg(withoutSystem, 'p95Wait').mean, agg(withSystem, 'p95Wait').mean)],
    ['Самая длинная очередь за день, чел', Math.round(queueWithout.mean),
      Math.round(queueWith.mean), delta(queueWithout.mean, queueWith.mean)],
    ['Остановок за день', Math.round(stopsWithout.mean), Math.round(stopsWith.mean),
      delta(stopsWithout.mean, stopsWith.mean)],
    ['Бесполезных остановок за день', Math.round(agg(withoutSystem, 'uselessStops').mean),
      Math.round(agg(withSystem, 'uselessStops').mean),
      delta(agg(withoutSystem, 'uselessStops').mean, agg(withSystem, 'uselessStops').mean)],
    ['Увезено за день, чел', Math.round(agg(withoutSystem, 'served').mean),
      Math.round(agg(withSystem, 'served').mean), '']
  ]);

  console.log('');
  console.log('  За сутки увозятся все ' + plan.total + ' поездок в обоих режимах: спрос');
  console.log('  в среднем ' + Math.round(dayWithout.mean) + ' чел/ч, и за двенадцать часов');
  console.log('  очередь рассасывается даже без системы. Поэтому суточное среднее');
  console.log('  ничего не говорит о возможностях лифтов — смотреть надо на пиковый');
  console.log('  час, длину очереди и время ожидания.');

  const passes = agg(withSystem, 'passes');
  const passCorrect = agg(withSystem, 'passCorrect');
  const passWrong = agg(withSystem, 'passWrong');
  const accuracy = passCorrect.mean / Math.max(passes.mean, 1);

  io.header('Решения системы за день');
  io.table(['Показатель', 'Значение'], [
    ['Проездов мимо этажа', Math.round(passes.mean)],
    ['из них обоснованных', Math.round(passCorrect.mean)],
    ['из них ошибочных (FP)', Math.round(passWrong.mean)],
    ['Доля обоснованных проездов', io.round(accuracy * 100, 1) + ' %'],
    ['Бесполезных остановок (FN)', Math.round(agg(withSystem, 'uselessStops').mean)]
  ]);

  const gain = (thrWith.mean / thrWithout.mean - 1) * 100;
  const gainSd = (thrWith.sd / thrWithout.mean) * 100;
  const waitGain = (1 - waitWith.mean / waitWithout.mean) * 100;

  console.log('');
  console.log('  Система поднимает пропускную способность в пиковый час на ' +
    io.round(gain, 1) + ' ± ' + io.round(gainSd, 1) + ' %');
  console.log('  Среднее ожидание сокращается на ' + io.round(waitGain, 1) + ' %');
  console.log('  Доля обоснованных проездов: ' + io.round(accuracy * 100, 1) + ' %');
  console.log('  Бесполезных остановок за день стало меньше на ' +
    Math.round(agg(withoutSystem, 'uselessStops').mean - agg(withSystem, 'uselessStops').mean) +
    ' из ' + Math.round(agg(withoutSystem, 'uselessStops').mean));

  // ---------- Графики ----------

  const hist = (values, bins = 24) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);

    values.forEach((v) => {
      const b = Math.min(Math.floor((v - min) / step), bins - 1);
      counts[b] += 1;
    });

    return {
      labels: counts.map((_, i) => Math.round(min + step * (i + 0.5))),
      counts
    };
  };

  const hWith = hist(withSystem.map((x) => x.peakThroughput));

  await chart.save({
    type: 'bar',
    data: {
      labels: hWith.labels,
      datasets: [{
        label: 'С системой',
        data: hWith.counts,
        backgroundColor: chart.COLOR.accent
      }]
    },
    options: chart.options('Пропускная способность в пиковый час, ' + runs + ' прогонов', {
      scales: {
        y: chart.axis('число дней', { beginAtZero: true }),
        x: chart.axis('человек за пиковый час', { grid: { display: false } })
      }
    })
  }, 'sim_throughput_hist.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: hourly.map((_, i) => i).filter((i) => i >= SIM.dayStart && i < SIM.dayEnd)
        .map((i) => i + ':00'),
      datasets: [
        {
          label: 'Остановок',
          data: hourly.filter((_, i) => i >= SIM.dayStart && i < SIM.dayEnd)
            .map((h) => io.round(h.stops, 1)),
          backgroundColor: chart.COLOR.accent
        },
        {
          label: 'Проездов мимо',
          data: hourly.filter((_, i) => i >= SIM.dayStart && i < SIM.dayEnd)
            .map((h) => io.round(h.passes, 1)),
          backgroundColor: chart.COLOR.full
        }
      ]
    },
    options: chart.options('Решения системы по часам: проезды концентрируются в пиках', {
      scales: {
        y: chart.axis('событий за день', { beginAtZero: true }),
        x: chart.axis('время суток', { grid: { display: false } })
      }
    }, true)
  }, 'sim_decisions_by_hour.png');

  await chart.save({
    type: 'bar',
    data: {
      labels: ['Без системы', 'С системой'],
      datasets: [{
        label: 'Пропускная способность в пиковый час, чел/ч',
        data: [Math.round(thrWithout.mean), Math.round(thrWith.mean)],
        backgroundColor: [chart.COLOR.grey, chart.COLOR.accent]
      }]
    },
    options: chart.options('Пиковый час: среднее за ' + runs + ' дней', {
      scales: {
        y: chart.axis('человек за пиковый час', { beginAtZero: true }),
        x: chart.axis('', { grid: { display: false } })
      }
    })
  }, 'sim_throughput_compare.png');

  const result = {
    runs,
    plan,
    capacity: CAPACITY,
    margin: MARGIN,
    elevators: ELEVATORS,
    withSystem: {
      peakThroughput: { mean: io.round(thrWith.mean, 2), sd: io.round(thrWith.sd, 2),
        p05: thrWith.p05, p95: thrWith.p95 },
      dayThroughput: io.round(dayWith.mean, 1),
      maxQueue: Math.round(queueWith.mean),
      avgWait: io.round(waitWith.mean, 1),
      p95Wait: io.round(agg(withSystem, 'p95Wait').mean, 1),
      stops: Math.round(stopsWith.mean),
      passes: Math.round(passes.mean),
      passCorrect: Math.round(passCorrect.mean),
      passWrong: Math.round(passWrong.mean),
      uselessStops: Math.round(agg(withSystem, 'uselessStops').mean)
    },
    withoutSystem: {
      peakThroughput: { mean: io.round(thrWithout.mean, 2), sd: io.round(thrWithout.sd, 2) },
      dayThroughput: io.round(dayWithout.mean, 1),
      maxQueue: Math.round(queueWithout.mean),
      avgWait: io.round(waitWithout.mean, 1),
      p95Wait: io.round(agg(withoutSystem, 'p95Wait').mean, 1),
      stops: Math.round(stopsWithout.mean),
      uselessStops: Math.round(agg(withoutSystem, 'uselessStops').mean)
    },
    gainPercent: io.round(gain, 2),
    gainSd: io.round(gainSd, 2),
    waitGainPercent: io.round(waitGain, 2),
    passAccuracy: io.round(accuracy, 4),
    hourly: hourly.map((h, i) => ({ hour: i, stops: io.round(h.stops, 1), passes: io.round(h.passes, 1) }))
      .filter((h) => h.hour >= SIM.dayStart && h.hour < SIM.dayEnd)
  };

  io.saveData('06-simulation', result);
  console.log('');
  console.log('  Графики: sim_throughput_hist.png, sim_decisions_by_hour.png,');
  console.log('           sim_throughput_compare.png');
  console.log('  Данные:  output/data/06-simulation.json');

  return result;
}

module.exports = {
  buildMeasurementTable, sampleDetected, dailyArrivals, buildArrivals, simulateDay, run
};

if (require.main === module) {
  run().catch((err) => { console.error('[sim] Ошибка:', err.message); process.exit(1); });
}
