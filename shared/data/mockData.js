/**
 * TIU GO — симуляция шести лифтов ТИУ.
 *
 * Важно про камеры: они стоят НЕ в кабине, а в холле у лифтов и видят
 * зону ожидания. Поэтому поле `waiting` — это люди, стоящие ПЕРЕД лифтом,
 * а `occupancy` приходит от контроллера лифта (людей внутри кабины).
 *
 * Модуль отдаёт только «сырые» показания. Статус и рекомендация считаются
 * на сервере (shared/server.js), чтобы фронтенд ничего не вычислял.
 */

// ---------- Паспорт лифтов ----------

// Все лифты стоят в одном здании, поэтому адрес общий, а не свой у каждого.
const ADDRESS = 'Корпус 7, Мельникайте 70';

// Этажей в корпусе
const FLOORS = 16;

const ELEVATORS = [
  // Корпус один и в нём 16 этажей, поэтому все лифты ходят на всю высоту.
  // cameraFloor — на каком этаже висит камера; подпись собирает фронтенд
  // на нужном языке, поэтому в данных текста нет.
  { id: 1, number: 1, cameraFloor: 1, floors: FLOORS, capacity: 5 },
  { id: 2, number: 2, cameraFloor: 5, floors: FLOORS, capacity: 5 },
  { id: 3, number: 3, cameraFloor: 1, floors: FLOORS, capacity: 6 },
  { id: 4, number: 4, cameraFloor: 1, floors: FLOORS, capacity: 4 },
  { id: 5, number: 5, cameraFloor: 1, floors: FLOORS, capacity: 8 },
  { id: 6, number: 6, cameraFloor: 1, floors: FLOORS, capacity: 6 }
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
const state = ELEVATORS.map((lift) => ({
  ...lift,
  currentFloor: randInt(1, lift.floors),
  direction: 'idle', // 'up' | 'down' | 'idle'
  occupancy: randInt(0, lift.capacity),
  waiting: randInt(0, 4)
}));

/**
 * Шаг симуляции одного лифта: кабина едет, кто-то выходит и заходит,
 * в холле подходят и расходятся люди.
 */
function tickElevator(lift) {
  // 1. Движение кабины. Направление немного «залипает», как у настоящего лифта.
  const keepDirection = Math.random() < 0.6 && lift.direction !== 'idle';
  let step;

  if (lift.currentFloor >= lift.floors) step = -1;
  else if (lift.currentFloor <= 1) step = 1;
  else if (keepDirection) step = lift.direction === 'up' ? 1 : -1;
  else step = Math.random() < 0.5 ? 1 : -1;

  if (Math.random() < 0.25) {
    // стоит на этаже: идёт посадка/высадка
    lift.direction = 'idle';
  } else {
    lift.currentFloor = clamp(lift.currentFloor + step, 1, lift.floors);
    lift.direction = step > 0 ? 'up' : 'down';
  }

  // 2. Пассажиры в кабине
  const leaving = randInt(0, Math.min(3, lift.occupancy));
  lift.occupancy -= leaving;

  const freeSeats = lift.capacity - lift.occupancy;
  const boarding = Math.min(freeSeats, lift.waiting, randInt(0, 3));
  lift.occupancy = clamp(lift.occupancy + boarding, 0, lift.capacity);
  lift.waiting -= boarding; // эти люди уехали, камера их больше не видит

  // 3. Зона ожидания в холле
  let arrive = Math.random() < 0.45 ? randInt(1, 2) : 0;
  if (Math.random() < 0.05) arrive += randInt(2, 5); // перемена между парами — час пик

  // часть людей не дожидается и уходит по лестнице, поэтому очередь не растёт бесконечно
  const impatient = Math.round(lift.waiting * 0.22);
  const leave = impatient + (Math.random() < 0.2 ? 1 : 0);

  lift.waiting = clamp(lift.waiting + arrive - leave, 0, 15);
}

/** Один шаг симуляции для всех лифтов. */
function tick() {
  state.forEach(tickElevator);
}

/**
 * Снимок «сырых» показаний по всем лифтам — всё, что в реальной системе
 * придёт от камер в холлах и контроллеров лифтов.
 *
 * Производные поля здесь намеренно не считаются, их добавляет сервер
 * в shared/server.js по этим же данным:
 *   status, recommendation            — по occupancy / capacity / waiting;
 *   waitTime, waitTimeText            — прогноз ожидания;
 *   stairsTime, elevatorTime,
 *   fasterOption, savedSeconds        — сравнение с лестницей.
 *
 * Так при переходе на настоящие датчики менять придётся только tick(),
 * а формулы останутся в одном месте.
 */
function getElevators() {
  return state.map((lift) => ({
    id: lift.id,
    number: lift.number,
    cameraFloor: lift.cameraFloor,
    floors: lift.floors,
    currentFloor: lift.currentFloor,
    direction: lift.direction,
    occupancy: lift.occupancy,
    capacity: lift.capacity,
    waiting: lift.waiting
  }));
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
  TICK_MS,
  getElevators,
  startSimulation,
  tick
};
