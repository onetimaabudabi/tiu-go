/**
 * Сравнение режимов: что даёт техническая часть проекта.
 *
 * Это перенос tech-model/06-simulation.js в браузер — тот же учебный
 * день, те же приходы людей, та же камера, то же правило «остановиться
 * или проехать». День разыгрывается дважды одними и теми же людьми:
 *
 *   «без системы» — лифт тормозит на каждом вызванном этаже;
 *   «с системой»  — камера оценивает кабину и решает, стоит ли тормозить.
 *
 * Сравнение честное: одно зерно, одни пассажиры, разница только в правиле
 * остановки. Поэтому разницу нельзя списать на удачный день.
 *
 * Камера не разыгрывается покадрово: распределение её показаний приходит
 * готовой таблицей из tech-model/02 (measurementTable). Та же таблица
 * стоит за цифрами в отчёте, так что экран и отчёт считают одну камеру.
 *
 * Чего здесь нет — трёхмерного холла. Это чистый счёт: сорок тысяч
 * решений за день, тела и анимации тут только мешали бы.
 */

import {
  BUILDING, ELEVATORS, SIM, DISPATCH, COMPARE, measurementTable, reference
} from './params.js';
import { floorTime, DOOR_CYCLE } from './kinematics.js';
import { decideHysteresis } from './dispatch.js';

/**
 * Отдать управление браузеру между порциями расчёта.
 *
 * Через setTimeout было бы проще, но в фоновой вкладке браузер
 * растягивает его до секунды, и тридцать дней считались бы полминуты
 * вместо полсекунды. MessageChannel такому замедлению не подвержен.
 */
const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;

function yieldToBrowser() {
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));

  return new Promise((resolve) => {
    channel.port1.onmessage = () => { channel.port1.onmessage = null; resolve(); };
    channel.port2.postMessage(null);
  });
}

const CAPACITY = DISPATCH.capacity;
const LIFTS = ELEVATORS.working.length;
const DAY_START = SIM.dayStart * 3600;
const DAY_END = SIM.dayEnd * 3600;

/**
 * Тот же генератор, что в tech-model/io.js (mulberry32).
 * Совпадение важно: с одним зерном браузер разыгрывает ровно тот же
 * день, что и модель в Node, и числа можно сверять напрямую.
 */
export function makeRng(seed) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Выборка показаний камеры при реальной загрузке n. */
function sampleDetected(n, rng) {
  const row = measurementTable[Math.min(n, measurementTable.length - 1)];
  const u = rng();

  for (let d = 0; d < row.length; d += 1) {
    if (u <= row[d]) return d;
  }
  return row.length - 1;
}

// ---------- Поток людей ----------

/** 'HH:MM' → секунды от начала суток. */
function toSeconds(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 3600 + m * 60;
}

/** Сколько поездок за день и как они разложены по пикам. */
export function dailyArrivals() {
  const total = Math.round(SIM.population * SIM.tripsPerPersonPerDay);
  const peakWeight = SIM.peakIntervals.reduce((s, p) => s + p.weight, 0);

  return {
    total,
    intervals: SIM.peakIntervals.map((p) => ({
      label: p.label,
      from: toSeconds(p.start),
      to: toSeconds(p.end),
      people: Math.round(total * p.weight)
    })),
    background: Math.round(total * (1 - peakWeight))
  };
}

/** Этаж назначения по распределению из параметров. */
function pickFloor(rng) {
  const u = rng();
  let acc = 0;

  for (const [floor, p] of Object.entries(SIM.floorDistribution)) {
    acc += p;
    if (u <= acc) return Number(floor);
  }
  return BUILDING.floors;
}

/** Расписание приходов на день: массив { time, from, to }. */
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
 * Прогон одного учебного дня.
 *
 * @param {Array} arrivals    приходы, общие для обоих режимов
 * @param {boolean} useSystem включена ли техническая часть
 * @param {number} seed       зерно розыгрыша камеры
 * @param {number} [margin]   запас мест
 */
export function simulateDay(arrivals, useSystem, seed, margin = DISPATCH.margin) {
  const rng = makeRng(seed);

  // Очередь ожидающих на каждом этаже
  const queues = Array.from({ length: BUILDING.floors + 1 }, () => []);

  // Когда каждый лифт освободится и где он при этом окажется
  const lifts = Array.from({ length: LIFTS }, () => ({ freeAt: DAY_START, floor: 1 }));

  const waits = [];
  const servedByHour = new Array(24).fill(0);
  let maxQueue = 0;
  let served = 0;
  let stops = 0;
  let passes = 0;
  let passCorrect = 0;   // проехали мимо полной кабины — правильно
  let passWrong = 0;     // проехали, хотя место было
  let uselessStops = 0;  // остановились у полной кабины
  let previousDecision = null;

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
    let time = clock + floorTime(lift.floor, 1);
    const cabin = [];

    const lobby = queues[1];
    while (cabin.length < CAPACITY && lobby.length) {
      const person = lobby.shift();
      cabin.push(person);
      waits.push(Math.max(time - person.time, 0));
    }

    if (!cabin.length) {
      // Никого нет — лифт ждёт следующего прихода, а не крутится вхолостую
      const nextArrival = index < arrivals.length ? arrivals[index].time : DAY_END;
      lift.freeAt = Math.max(nextArrival, clock + 10);
      lift.floor = 1;
      continue;
    }

    let occupancy = cabin.length;
    time += occupancy * ELEVATORS.boardingTimePerPerson;

    // Куда едем: все заказанные этажи по возрастанию
    const targets = [...new Set(cabin.map((p) => p.to))].sort((a, b) => a - b);
    const top = targets[targets.length - 1];

    let current = 1;

    for (let floor = 2; floor <= top; floor += 1) {
      const isTarget = targets.includes(floor);
      const waiting = queues[floor].length;

      // Решение по промежуточному вызову
      let stopHere = isTarget;

      if (!isTarget && waiting > 0) {
        if (useSystem) {
          const detected = sampleDetected(occupancy, rng);
          const decided = decideHysteresis(detected, CAPACITY, margin, previousDecision);
          previousDecision = decided;
          stopHere = decided === 'stop';
        } else {
          stopHere = true; // без системы тормозим на каждом вызове
        }

        if (!stopHere) {
          passes += 1;
          if (occupancy >= CAPACITY) passCorrect += 1;
          else passWrong += 1;
        }
      }

      if (!stopHere) continue;

      // Остановка
      time += floorTime(current, floor);
      current = floor;
      time += DOOR_CYCLE;
      stops += 1;

      // Высадка
      if (isTarget) {
        const leaving = cabin.filter((p) => p.to === floor).length;
        occupancy -= leaving;
        served += leaving;
        if (servedByHour[Math.floor(time / 3600)] !== undefined) {
          servedByHour[Math.floor(time / 3600)] += leaving;
        }
        time += leaving * ELEVATORS.boardingTimePerPerson;
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
            waits.push(Math.max(time - person.time, 0));
          }
          occupancy += boarding;
          time += boarding * ELEVATORS.boardingTimePerPerson;
        }
      }
    }

    // Высаживаем всех, кто ещё остался
    served += occupancy;
    if (servedByHour[Math.floor(time / 3600)] !== undefined) {
      servedByHour[Math.floor(time / 3600)] += occupancy;
    }

    const queued = queues.reduce((sum, q) => sum + q.length, 0);
    if (queued > maxQueue) maxQueue = queued;

    lift.freeAt = time;
    lift.floor = current;
  }

  const sorted = waits.slice().sort((a, b) => a - b);
  const mean = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  const p95 = sorted.length
    ? sorted[Math.min(Math.floor(0.95 * sorted.length), sorted.length - 1)]
    : 0;

  return {
    served,
    stops,
    passes,
    passCorrect,
    passWrong,
    uselessStops,
    maxQueue,
    // Пропускная способность в самый загруженный час: именно она
    // упирается в лифты, суточное среднее показывает размер потока.
    peakThroughput: Math.max(...servedByHour),
    avgWait: mean,
    p95Wait: p95
  };
}

// ---------- Серия дней ----------

const FIELDS = [
  'peakThroughput', 'avgWait', 'p95Wait', 'maxQueue',
  'stops', 'uselessStops', 'passes', 'passCorrect', 'passWrong', 'served'
];

function average(list, field) {
  return list.reduce((s, x) => s + x[field], 0) / Math.max(list.length, 1);
}

function summarize(list) {
  const out = {};
  for (const field of FIELDS) out[field] = average(list, field);
  return out;
}

/**
 * Прогон серии дней в обоих режимах.
 *
 * Считается порциями по COMPARE.chunk дней: тридцать дней подряд — это
 * доля секунды, но заметная доля, и кадр на ней спотыкается. Между
 * порциями управление возвращается браузеру, а наружу уходит прогресс.
 *
 * @param {object} [options]
 * @param {number} [options.days]      сколько дней на режим
 * @param {function} [options.onProgress] (сделано, всего)
 */
export async function run({ days = COMPARE.days, onProgress = null } = {}) {
  const withSystem = [];
  const withoutSystem = [];
  const started = performance.now();

  for (let day = 0; day < days; day += 1) {
    const seed = SIM.randomSeed + day * 104729;
    const arrivals = buildArrivals(makeRng(seed));

    withSystem.push(simulateDay(arrivals, true, seed + 1));
    withoutSystem.push(simulateDay(arrivals, false, seed + 1));

    if ((day + 1) % COMPARE.chunk === 0 || day === days - 1) {
      if (onProgress) onProgress(day + 1, days);
      // Отдаём кадр браузеру, иначе страница замирает на время счёта
      await yieldToBrowser();
    }
  }

  const on = summarize(withSystem);
  const off = summarize(withoutSystem);

  return {
    days,
    margin: DISPATCH.margin,
    lifts: LIFTS,
    capacity: CAPACITY,
    elapsed: (performance.now() - started) / 1000,
    on,
    off,
    gainPercent: (on.peakThroughput / off.peakThroughput - 1) * 100,
    waitGainPercent: (1 - on.avgWait / off.avgWait) * 100,
    passAccuracy: on.passCorrect / Math.max(on.passes, 1),
    // Чем закончила та же модель на 500 днях — для сверки
    reference
  };
}

export default { run, simulateDay, dailyArrivals, makeRng };
