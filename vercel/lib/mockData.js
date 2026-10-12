/**
 * TIU GO — симуляция шести лифтов ТИУ.
 *
 * Важно про камеры: они стоят ТОЛЬКО В ХОЛЛЕ ПЕРВОГО ЭТАЖА — по одной
 * на каждый лифт. Камера видит очередь перед своим лифтом внизу и больше
 * ничего: ни кабину, ни другие этажи.
 *
 * Отсюда два разных источника данных, которые нельзя путать:
 *   waitingAtFirstFloor — сколько человек ждёт этот лифт на 1 этаже.
 *                         Это и есть то, что считает камера.
 *   occupancy           — сколько человек внутри кабины. Камера этого
 *                         не видит; значение приходит от контроллера
 *                         лифта, а в симуляции задаётся моком или админкой.
 *
 * Модуль отдаёт только «сырые» показания. Статус загруженности и
 * рекомендация считаются на сервере (shared/server.js), чтобы фронтенд
 * ничего не вычислял.
 *
 * Отдельно от загруженности есть статус РАБОТЫ лифта (`status`): он не
 * вычисляется, а приходит извне — из диспетчерской, а пока из админки.
 */

// ---------- Паспорт лифтов ----------
//
// Числа про сам объект приходят из shared/params.json — того же файла,
// по которому считают обе математические модели. Здесь их не дублируем:
// иначе приложение и модели опять начнут показывать разное.

const params = require('./params.json');

// Все лифты стоят в одном здании, поэтому адрес общий, а не свой у каждого.
const ADDRESS = params.building.name;

// Этажей в корпусе
const FLOORS = params.building.floors;

// Этаж, на котором стоят камеры. Он один на все лифты и вынесен
// в константу, чтобы нигде не появилось «магической единицы».
const CAMERA_FLOOR = 1;

// Сколько человек камера способна насчитать в холле — верхняя граница очереди.
// В пик у одного лифта реально собирается 5–25 человек.
const MAX_WAITING = 30;

// Допустимые статусы работы лифта
const STATUSES = ['working', 'broken', 'maintenance'];

// Вместимость показываем наблюдаемую пиковую, а не паспортную: в интерфейсе
// важно, сколько людей реально набивается, а не что написано в табличке.
const CAPACITY = params.elevators.capacityRealPeak;

/** Статус лифта по спискам из общих параметров. */
function statusOf(number) {
  if (params.elevators.broken.includes(number)) return 'broken';
  if (params.elevators.working.includes(number)) return 'working';
  return 'maintenance';
}

// Корпус один и в нём 16 этажей, поэтому все лифты ходят на всю высоту.
// Камера у каждого лифта своя, но стоят они все на первом этаже.
const ELEVATORS = Array.from({ length: params.elevators.total }, (_, i) => ({
  id: i + 1,
  number: i + 1,
  floors: FLOORS,
  capacity: CAPACITY
}));

const TICK_MS = 3000; // данные обновляются раз в 3 секунды

// ---------- Утилиты ----------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---------- Текущее состояние ----------

/** Случайные показания одного лифта — с них начинается и ими сбрасывается симуляция. */
function randomReadings(lift) {
  return {
    currentFloor: randInt(1, lift.floors),
    direction: 'idle', // 'up' | 'down' | 'idle'
    occupancy: randInt(0, lift.capacity),
    // Стартовое значение подобрано под установившийся режим симуляции:
    // иначе приложение первые пару минут после запуска показывает
    // красную плашку, которой в этот момент ничто не соответствует
    waitingAtFirstFloor: randInt(0, 3)
  };
}

const state = ELEVATORS.map((lift) => Object.assign({}, lift, randomReadings(lift), {
  // Статус работы берём из общих параметров: в корпусе 7 сейчас
  // три лифта из шести не работают.
  status: statusOf(lift.number),
  statusNote: null,

  // Лифт, которому значения выставили руками из админки, замирает:
  // иначе следующий же тик симуляции затрёт их через три секунды.
  frozen: false
}));

/** Работает ли лифт: сломанный и стоящий на обслуживании — нет. */
function isWorking(lift) {
  return lift.status === 'working';
}

// ---------- Наплыв людей ----------
//
// Без этой волны очередь у каждого лифта — чистый шум: пришло двое, ушёл
// один, и так по кругу. На таких данных прогноз на пять минут вперёд
// показывал бы случайное число, а не тенденцию.
//
// В жизни поток общий для всего холла: закончилась пара — к лифтам идут
// все сразу, через несколько минут наплыв спадает. Поэтому держим один
// медленно плавающий множитель прихода, общий для всех шести лифтов.
// Он меняется плавно (к цели смещаемся на 8 % за тик), а цель
// переставляется в среднем раз в две минуты.

const PRESSURE_MIN = 0.35;   // затишье посреди пары
const PRESSURE_MAX = 2.6;    // перемена: люди идут потоком
const PRESSURE_STEP = 0.08;  // доля пути к новой цели за один тик

let pressure = 1;
let pressureTarget = 1;

/** Шаг волны наплыва. Вызывается раз в тик вместе с лифтами. */
function tickPressure() {
  // Новая цель примерно раз в две минуты (тик — 3 секунды)
  if (Math.random() < 0.025) {
    pressureTarget = PRESSURE_MIN + Math.random() * (PRESSURE_MAX - PRESSURE_MIN);
  }

  pressure += (pressureTarget - pressure) * PRESSURE_STEP;
}

/** Текущий множитель наплыва — его же показывает отладка симуляции. */
function getPressure() {
  return Number(pressure.toFixed(3));
}

/**
 * Шаг симуляции одного лифта: кабина едет, кто-то выходит и заходит,
 * в холле подходят и расходятся люди.
 */
function tickElevator(lift) {
  // Значения из админки симуляция не трогает
  if (lift.frozen) return;

  // Неработающий лифт стоит: кабина на месте, внутри никого,
  // а очередь в холле расходится по лестнице и к соседним лифтам.
  if (!isWorking(lift)) {
    lift.direction = 'idle';
    lift.occupancy = 0;
    // Очередь внизу расходится к соседним лифтам и по лестнице
    lift.waitingAtFirstFloor = Math.max(lift.waitingAtFirstFloor - randInt(1, 3), 0);
    return;
  }

  // 1. Движение кабины. Направление немного «залипает», как у настоящего лифта.
  //
  // Отдельно учитывается возврат вниз: если в холле первого этажа стоит
  // очередь, а в кабине есть место, диспетчер гонит лифт за людьми.
  // Без этого кабина блуждает по верхним этажам, на первый попадает редко,
  // и очередь внизу не рассасывается вообще.
  const wantsToReturn = lift.waitingAtFirstFloor > 2 &&
    lift.occupancy < lift.capacity &&
    lift.currentFloor > 1;

  const keepDirection = Math.random() < 0.6 && lift.direction !== 'idle';
  let step;

  if (lift.currentFloor >= lift.floors) step = -1;
  else if (lift.currentFloor <= 1) step = 1;
  else if (wantsToReturn) step = Math.random() < 0.8 ? -1 : 1;
  else if (keepDirection) step = lift.direction === 'up' ? 1 : -1;
  else step = Math.random() < 0.5 ? 1 : -1;

  if (Math.random() < 0.25) {
    // стоит на этаже: идёт посадка/высадка
    lift.direction = 'idle';
  } else {
    lift.currentFloor = clamp(lift.currentFloor + step, 1, lift.floors);
    lift.direction = step > 0 ? 'up' : 'down';
  }

  // 2. Пассажиры в кабине.
  //
  // Высадка возможна на любом этаже, посадка — тоже: люди заходят и на
  // верхних этажах, просто там нет камер и система об этом не знает.
  // Из очереди первого этажа вычитаются только те, кто реально уехал, —
  // именно это изменение и «видит» камера.
  if (Math.random() < 0.6) {
    lift.occupancy -= randInt(0, Math.min(2, lift.occupancy));
  }

  if (lift.currentFloor === CAMERA_FLOOR) {
    const freeSeats = lift.capacity - lift.occupancy;
    const boarding = Math.min(freeSeats, lift.waitingAtFirstFloor, randInt(1, 5));
    lift.occupancy = clamp(lift.occupancy + boarding, 0, lift.capacity);
    lift.waitingAtFirstFloor -= boarding;
  } else if (Math.random() < 0.35) {
    // Посадка на верхнем этаже: для камеры её не существует,
    // но заполненность кабины она меняет
    const freeSeats = lift.capacity - lift.occupancy;
    lift.occupancy = clamp(lift.occupancy + Math.min(freeSeats, randInt(0, 2)), 0, lift.capacity);
  }

  // 3. Очередь в холле первого этажа.
  //
  // Числа подобраны так, чтобы плашка на главном экране жила во всех трёх
  // состояниях, а не висела в красном: типичная суммарная очередь по шести
  // лифтам — 5–12 человек (жёлтая зона), свободно бывает примерно треть
  // времени, большая очередь — редкое событие на перемене.
  let arrive = Math.random() < 0.25 * pressure ? randInt(1, 2) : 0;
  if (Math.random() < 0.05 * pressure) arrive += randInt(2, 6); // перемена между парами

  // Часть людей не дожидается и уходит по лестнице или к соседнему лифту,
  // поэтому очередь не растёт бесконечно.
  const impatient = Math.round(lift.waitingAtFirstFloor * 0.25);
  const leave = impatient + (Math.random() < 0.25 ? 1 : 0);

  lift.waitingAtFirstFloor = clamp(
    lift.waitingAtFirstFloor + arrive - leave, 0, MAX_WAITING
  );
}

/** Один шаг симуляции для всех лифтов. */
function tick() {
  tickPressure();
  state.forEach(tickElevator);
}

/**
 * Снимок «сырых» показаний по всем лифтам — всё, что в реальной системе
 * придёт от камер в холле первого этажа, контроллеров лифтов и диспетчерской.
 *
 * Производные поля здесь намеренно не считаются, их добавляет сервер
 * в shared/server.js по этим же данным:
 *   status (загруженности), recommendation  — по occupancy / capacity / очереди;
 *   waitTimeMin, waitTimeMax, confidence    — прогноз ожидания диапазоном;
 *   stairsTime, elevatorTotal,
 *   fasterOption, savedSeconds              — сравнение с лестницей.
 *
 * Так при переходе на настоящие датчики менять придётся только tick(),
 * а формулы останутся в одном месте.
 */
function getElevators() {
  return state.map((lift) => ({
    id: lift.id,
    number: lift.number,
    cameraFloor: CAMERA_FLOOR,   // камера у всех лифтов одна и внизу
    floors: lift.floors,
    currentFloor: lift.currentFloor,
    direction: lift.direction,
    occupancy: lift.occupancy,
    capacity: lift.capacity,
    waitingAtFirstFloor: lift.waitingAtFirstFloor,
    workStatus: lift.status,     // 'working' | 'broken' | 'maintenance'
    statusNote: lift.statusNote  // пояснение для пользователя или null
  }));
}

// ---------- Управление из админки ----------

/**
 * Полное состояние лифтов для админки — вместе с границами полей,
 * чтобы форма сама знала, что можно вводить.
 */
function getAdminElevators() {
  return state.map((lift) => ({
    id: lift.id,
    number: lift.number,
    cameraFloor: CAMERA_FLOOR,
    floors: lift.floors,
    capacity: lift.capacity,
    currentFloor: lift.currentFloor,
    occupancy: lift.occupancy,
    waitingAtFirstFloor: lift.waitingAtFirstFloor,
    status: lift.status,
    statusNote: lift.statusNote,
    frozen: lift.frozen
  }));
}

function findState(id) {
  return state.find((lift) => lift.id === Number(id)) || null;
}

/**
 * Применяет правку из админки. Любое из полей можно не передавать —
 * тогда оно остаётся прежним. Числа подрезаются по границам лифта,
 * чтобы форма не смогла сломать симуляцию.
 *
 * @returns {{ok: boolean, error?: string, elevator?: object}}
 */
function setElevator(id, patch) {
  const lift = findState(id);
  if (!lift) return { ok: false, error: 'Лифт не найден' };

  const data = patch || {};

  if (data.status !== undefined) {
    if (STATUSES.indexOf(data.status) === -1) {
      return { ok: false, error: 'Неизвестный статус: ' + data.status };
    }
    lift.status = data.status;
  }

  if (data.statusNote !== undefined) {
    const note = typeof data.statusNote === 'string' ? data.statusNote.trim() : '';
    lift.statusNote = note ? note.slice(0, 120) : null;
  }

  let touchedNumbers = false;

  if (data.currentFloor !== undefined && data.currentFloor !== null && data.currentFloor !== '') {
    lift.currentFloor = clamp(Math.round(Number(data.currentFloor)) || 1, 1, lift.floors);
    touchedNumbers = true;
  }

  if (data.occupancy !== undefined && data.occupancy !== null && data.occupancy !== '') {
    lift.occupancy = clamp(Math.round(Number(data.occupancy)) || 0, 0, lift.capacity);
    touchedNumbers = true;
  }

  // Админка присылает очередь под коротким именем waiting — это та же
  // очередь на первом этаже, другой в системе больше нет
  const queue = data.waitingAtFirstFloor !== undefined ? data.waitingAtFirstFloor : data.waiting;

  if (queue !== undefined && queue !== null && queue !== '') {
    lift.waitingAtFirstFloor = clamp(Math.round(Number(queue)) || 0, 0, MAX_WAITING);
    touchedNumbers = true;
  }

  // Руками выставленные цифры держатся до «Сбросить к случайным»
  if (touchedNumbers) lift.frozen = true;

  return { ok: true, elevator: getAdminElevators().find((item) => item.id === lift.id) };
}

/** Возвращает симуляцию в исходное состояние: случайные цифры, все лифты на ходу. */
function resetRandom() {
  state.forEach((lift) => {
    Object.assign(lift, randomReadings(lift));
    // Возвращаемся не к «всё работает», а к тому, что записано
    // в shared/params.json: три лифта из шести стоят.
    lift.status = statusOf(lift.number);
    lift.statusNote = null;
    lift.frozen = false;
  });

  return getAdminElevators();
}

/** Снимает поломки и обслуживание, цифры при этом не трогает. */
function setAllWorking() {
  state.forEach((lift) => {
    lift.status = 'working';
    lift.statusNote = null;
  });

  return getAdminElevators();
}

/** Запускает симуляцию: обновление каждые 3 секунды. */
function startSimulation() {
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  return timer;
}

// ---------- Serverless: состояние снаружи, а не в процессе ----------
//
// На постоянном сервере состояние жило в этом модуле и двигалось
// таймером. В serverless процесс умирает между запросами, поэтому
// состояние приходит из хранилища, прокручивается на столько шагов,
// сколько прошло времени, и возвращается обратно.

/** Поднимает состояние из хранилища. Мусор игнорируем и начинаем заново. */
function hydrate(saved) {
  if (!Array.isArray(saved) || saved.length !== state.length) return false;

  saved.forEach((item, i) => {
    if (item && typeof item === 'object') Object.assign(state[i], item);
  });

  return true;
}

/** Снимок состояния для записи в хранилище. */
function snapshot() {
  return state.map((lift) => ({ ...lift }));
}

// Дальше этого числа шагов не прокручиваем: после долгого простоя
// догонять тысячи тиков бессмысленно и дорого — хватает того, что
// картина станет свежей.
const MAX_CATCHUP_TICKS = 40;

/**
 * Прокручивает симуляцию на время, прошедшее с прошлого вызова.
 * @param {number} sinceMs  отметка времени прошлого тика
 * @returns {number} сколько шагов сделали
 */
function tickTo(sinceMs, now = Date.now()) {
  if (!sinceMs) { tick(); return 1; }

  const steps = Math.min(Math.floor((now - sinceMs) / TICK_MS), MAX_CATCHUP_TICKS);
  for (let i = 0; i < steps; i += 1) tick();
  return steps;
}

module.exports = {
  hydrate,
  snapshot,
  tickTo,
  ADDRESS,
  FLOORS,
  CAMERA_FLOOR,
  CAPACITY,
  TICK_MS,
  STATUSES,
  MAX_WAITING,
  getElevators,
  getPressure,
  getAdminElevators,
  setElevator,
  resetRandom,
  setAllWorking,
  startSimulation,
  tick
};
