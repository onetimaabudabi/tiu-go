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

// Все лифты стоят в одном здании, поэтому адрес общий, а не свой у каждого.
const ADDRESS = 'Корпус 7, Мельникайте 70';

// Этажей в корпусе
const FLOORS = 16;

// Этаж, на котором стоят камеры. Он один на все лифты и вынесен
// в константу, чтобы нигде не появилось «магической единицы».
const CAMERA_FLOOR = 1;

// Сколько человек камера способна насчитать в холле — верхняя граница очереди.
// В пик у одного лифта реально собирается 5–25 человек.
const MAX_WAITING = 30;

// Допустимые статусы работы лифта
const STATUSES = ['working', 'broken', 'maintenance'];

const ELEVATORS = [
  // Корпус один и в нём 16 этажей, поэтому все лифты ходят на всю высоту.
  // Камера у каждого лифта своя, но стоят они все на первом этаже.
  { id: 1, number: 1, floors: FLOORS, capacity: 5 },
  { id: 2, number: 2, floors: FLOORS, capacity: 5 },
  { id: 3, number: 3, floors: FLOORS, capacity: 6 },
  { id: 4, number: 4, floors: FLOORS, capacity: 4 },
  { id: 5, number: 5, floors: FLOORS, capacity: 8 },
  { id: 6, number: 6, floors: FLOORS, capacity: 6 }
];

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
  // Статус работы. По умолчанию все лифты на ходу.
  status: 'working',
  statusNote: null,

  // Лифт, которому значения выставили руками из админки, замирает:
  // иначе следующий же тик симуляции затрёт их через три секунды.
  frozen: false
}));

/** Работает ли лифт: сломанный и стоящий на обслуживании — нет. */
function isWorking(lift) {
  return lift.status === 'working';
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
  let arrive = Math.random() < 0.25 ? randInt(1, 2) : 0;
  if (Math.random() < 0.05) arrive += randInt(2, 6); // перемена между парами — час пик

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
    lift.status = 'working';
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

module.exports = {
  ADDRESS,
  FLOORS,
  CAMERA_FLOOR,
  TICK_MS,
  STATUSES,
  MAX_WAITING,
  getElevators,
  getAdminElevators,
  setElevator,
  resetRandom,
  setAllWorking,
  startSimulation,
  tick
};
