/**
 * TIU GO — параметры математической модели.
 *
 * Своих чисел про объект здесь больше нет: этажность, лифты, вместимость,
 * поток людей и расписание приходят из shared/params.json — того же файла,
 * из которого их берут техническая модель и приложение.
 *
 * Социальная модель дополняет базу тем, что нужно ей одной: весами функции
 * полезности и параметрами поведения.
 *
 * Про форму данных. Базовые параметры лежат вложенными (building, elevators,
 * people…), а скрипты этой модели исторически читают плоский PARAMS:
 * p.floors, p.capacity, p.elevatorSpeed. Поэтому ниже собирается плоское
 * представление — не копия чисел, а вычисляемый вид той же базы. Менять
 * значения в нём бессмысленно: источник один, он в shared/params.json.
 */

const base = require('../shared/params.json');

const { _comment, ...shared } = base;

// ---------- Надстройка социальной модели ----------

const utility = {
  weightTime: 0.6,        // вес времени в функции полезности
  weightComfort: 0.3,     // вес комфорта
  weightHealth: 0.1,      // вес пользы для здоровья
  logitTemperature: 0.5,  // «температура» τ логит-модели: меньше — рациональнее
  referenceTime: 300      // эталон «долгого» ожидания, с
};

const behavior = {
  followRecommendationRate: 0.7,  // доля тех, кто следует совету приложения
  optimisticWaitEstimate: 60,     // сколько человек ДУМАЕТ, что прождёт, без приложения
  departureAlternative: 'stairs'  // чем заменяет лифт тот, кто не дождался
};

// ---------- Вспомогательное ----------

/** "HH:MM" → часы с дробной частью. */
function hoursOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h + m / 60;
}

// ---------- Плоское представление базы ----------

const PARAMS = {
  // ---------- Физические ----------
  floors: shared.building.floors,
  floorHeight: shared.building.floorHeight,

  // Считаем по тем лифтам, которые реально ходят, а не по их общему числу:
  // три из шести в корпусе 7 не работают.
  elevators: shared.elevators.working.length,
  elevatorsTotal: shared.elevators.total,

  // Вместимость — наблюдаемый пик, а не паспортные пять человек.
  capacity: shared.elevators.capacityRealPeak,
  capacityNormal: shared.elevators.capacityRealNormal,

  elevatorSpeed: shared.elevators.speed,

  // Потери на разгон и торможение. При трапецеидальном профиле скорости
  // они равны v/a, поэтому число не задаётся руками, а следует из
  // скорости и ускорения из общей базы.
  accelerationTime: shared.elevators.speed / shared.elevators.acceleration,

  // Полный цикл дверей на одной остановке: открытие, удержание, закрытие.
  // Техническая модель считает остановку так же — иначе время рейса
  // у двух моделей расходилось бы на ровном месте.
  doorCycleTime:
    shared.elevators.doorOpenTime + shared.elevators.doorHoldTime + shared.elevators.doorCloseTime,

  boardingTimePerPerson: shared.elevators.boardingTimePerPerson,
  stairsTimePerFloor: shared.people.stairsTimePerFloor,

  // ---------- Потоки ----------
  studentsInBuilding: shared.people.students + shared.people.staff,
  tripsPerStudentPerDay: shared.people.tripsPerPersonPerDay,

  dayStart: shared.simulation.dayStart,
  dayEnd: shared.simulation.dayEnd,
  get activeHours() { return this.dayEnd - this.dayStart; },

  // Пики — те же интервалы, что в общей базе, только в долях часа:
  // формулы ниже считают по числовому времени, а не по строкам.
  peakHours: shared.peakIntervals.map((p) => ({
    start: hoursOf(p.start),
    end: hoursOf(p.end),
    weight: p.weight,
    label: p.label
  })),

  // Доля всех поездок, приходящаяся на пики. Не задаётся отдельно:
  // это просто сумма весов интервалов, остальное — фон.
  peakTrafficShare: shared.peakIntervals.reduce((s, p) => s + p.weight, 0),

  // ---------- Поведение и полезность ----------
  utilityWeightTime: utility.weightTime,
  utilityWeightComfort: utility.weightComfort,
  utilityWeightHealth: utility.weightHealth,
  rationality: utility.logitTemperature,
  referenceTime: utility.referenceTime,
  perceivedWaitNoApp: behavior.optimisticWaitEstimate,
  recommendationFollowRate: behavior.followRecommendationRate,

  // ---------- Наблюдения из TIU GO ----------
  cameraAccuracy: shared.camera.map50,

  // ---------- Параметры моделирования ----------
  simulationDays: shared.simulation.runs,
  randomSeed: shared.simulation.randomSeed
};

// Старое имя поля: скрипты читают p.doorOpenTime, подразумевая под ним
// полную работу дверей на остановке. Оставляем алиас, чтобы не трогать
// семь файлов ради переименования.
PARAMS.doorOpenTime = PARAMS.doorCycleTime;

/**
 * Распределение этажей назначения.
 *
 * Берётся из общей базы (floorDistribution) — ровно то же, по которому
 * раскладывает людей техническая модель. Первый этаж исключён: туда
 * на лифте не ездят, оставшиеся доли нормируются заново.
 */
function destinationDistribution(floors = PARAMS.floors) {
  const entries = Object.entries(shared.floorDistribution)
    .map(([floor, p]) => ({ floor: Number(floor), weight: p }))
    .filter((x) => x.floor > 1 && x.floor <= floors);

  const total = entries.reduce((s, x) => s + x.weight, 0) || 1;
  return entries.map((x) => ({ floor: x.floor, p: x.weight / total }));
}

/** Средний этаж назначения с учётом распределения. */
function averageDestination(floors = PARAMS.floors) {
  return destinationDistribution(floors).reduce((s, x) => s + x.floor * x.p, 0);
}

/**
 * Детерминированный генератор случайных чисел (xorshift32).
 * Нужен, чтобы симуляция давала одинаковый результат при каждом запуске —
 * иначе отчёт и графики расходились бы между прогонами.
 */
function createRandom(seed = PARAMS.randomSeed) {
  let state = seed >>> 0 || 1;

  return function random() {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Интенсивность потока λ(t), чел/сек, в зависимости от часа суток.
 *
 * Вес интервала — это доля ВСЕХ поездок за день, а не доля пикового
 * трафика: так же устроены веса в shared/params.json и в технической
 * модели. Сумма весов 0.95, оставшиеся 5 % размазаны по дню между пиками.
 */
function arrivalRate(hour, params = PARAMS) {
  if (hour < params.dayStart || hour >= params.dayEnd) return 0;

  const totalTrips = params.studentsInBuilding * params.tripsPerStudentPerDay;
  const peak = params.peakHours.find((p) => hour >= p.start && hour < p.end);

  if (peak) {
    return (totalTrips * peak.weight) / ((peak.end - peak.start) * 3600);
  }

  const peakWeight = params.peakHours.reduce((s, p) => s + p.weight, 0);
  const peakSeconds = params.peakHours.reduce((s, p) => s + (p.end - p.start) * 3600, 0);
  const quietSeconds = Math.max(1, params.activeHours * 3600 - peakSeconds);

  return (totalTrips * Math.max(0, 1 - peakWeight)) / quietSeconds;
}

/** Средняя за день интенсивность, чел/сек. */
function averageArrivalRate(params = PARAMS) {
  const totalTrips = params.studentsInBuilding * params.tripsPerStudentPerDay;
  return totalTrips / (params.activeHours * 3600);
}

module.exports = {
  ...shared,
  utility,
  behavior,

  // Плоский вид и помощники — то, чем пользуются скрипты модели
  PARAMS,
  destinationDistribution,
  averageDestination,
  createRandom,
  arrivalRate,
  averageArrivalRate
};
