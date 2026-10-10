/**
 * TIU GO — параметры математической модели.
 *
 * Единственное место, где заданы числа. Все шесть моделей берут их отсюда,
 * поэтому менять сценарий нужно только здесь.
 *
 * Про этажность: в техзадании на модель стояло 10 этажей, но корпус 7 —
 * шестнадцатиэтажный, и само приложение, и документы в docs/ считают по 16.
 * Разные цифры в одном проекте расходились бы, поэтому здесь 16.
 */

const PARAMS = {
  // ---------- Физические ----------
  floors: 16,                  // этажей в корпусе
  elevators: 6,                // лифтов
  capacity: 5,                 // вместимость кабины, чел
  floorHeight: 3,              // высота этажа, м
  elevatorSpeed: 1.0,          // номинальная скорость, м/с
  accelerationTime: 1.5,       // потери на разгон и торможение, с
  doorOpenTime: 3,             // открытие и закрытие дверей, с
  boardingTimePerPerson: 2,    // посадка или высадка одного человека, с
  stairsTimePerFloor: 12,      // подъём на один этаж по лестнице, с

  // ---------- Потоки ----------
  studentsInBuilding: 1500,    // человек в корпусе
  tripsPerStudentPerDay: 4,    // поездок на лифте в день

  // Учебный день: с 8:00 до 18:00. Последний пик приходится на 17:10,
  // поэтому окно должно быть именно десятичасовым — иначе интеграл
  // потока λ(t) не сойдётся с суточным числом поездок.
  dayStart: 8,
  dayEnd: 18,
  activeHours: 10,            // длительность учебного дня, ч

  // Доля всех поездок, которая приходится на пиковые интервалы.
  // В исходном ТЗ веса пиков давали в сумме единицу — тогда на остальной
  // день оставался нулевой поток, а в утренний пик получалось 4200 чел/ч
  // на корпус в 1500 человек. Поэтому введён явный коэффициент: 60%
  // поездок в пики, 40% равномерно по дню.
  peakTrafficShare: 0.6,

  // Пики привязаны к расписанию пар. weight — доля ПИКОВОГО трафика,
  // приходящаяся на конкретный интервал (в сумме единица).
  peakHours: [
    { start: 8.33,  end: 8.83,  weight: 0.35, label: '08:20–08:50' },
    { start: 13.50, end: 13.83, weight: 0.20, label: '13:30–13:50' },
    { start: 15.33, end: 15.67, weight: 0.25, label: '15:20–15:40' },
    { start: 17.17, end: 17.50, weight: 0.20, label: '17:10–17:30' }
  ],

  // ---------- Поведение ----------
  utilityWeightTime: 0.6,      // вес времени в функции полезности
  utilityWeightComfort: 0.3,   // вес комфорта
  utilityWeightHealth: 0.1,    // вес пользы для здоровья
  rationality: 0.5,            // «температура» τ логит-модели: меньше — рациональнее

  // Время измеряется сотнями секунд, комфорт и здоровье — долями единицы.
  // Чтобы слагаемые функции полезности были сопоставимы, время делится
  // на эталон. 300 с — субъективно «долгое» ожидание, которое человек
  // воспринимает как полную потерю.
  referenceTime: 300,

  // Сколько человек ДУМАЕТ, что прождёт, не имея данных о загруженности.
  // Без приложения оценка оптимистична и не зависит от реальной очереди —
  // именно на этом разрыве и строится польза TIU GO.
  perceivedWaitNoApp: 60,

  // ---------- Наблюдения из TIU GO ----------
  cameraAccuracy: 0.92,        // точность детекции людей (YOLO)
  recommendationFollowRate: 0.7, // доля тех, кто следует совету приложения
  measurementNoise: 0.05,      // шум измерений, 5%

  // ---------- Параметры моделирования ----------
  simulationDays: 1000,        // прогонов Монте-Карло
  randomSeed: 20261006         // фиксируем зерно: результаты воспроизводимы
};

/**
 * Распределение этажей назначения.
 *
 * Нижние этажи популярнее: там деканаты, аудитории общего потока и столовая.
 * Используем убывающий вес ~1/sqrt(этаж), первый этаж исключён — туда на
 * лифте не ездят.
 */
function destinationDistribution(floors = PARAMS.floors) {
  const weights = [];
  let total = 0;

  for (let f = 2; f <= floors; f += 1) {
    const w = 1 / Math.sqrt(f - 1);
    weights.push({ floor: f, weight: w });
    total += w;
  }

  return weights.map((x) => ({ floor: x.floor, p: x.weight / total }));
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

/** Интенсивность потока λ(t), чел/сек, в зависимости от часа суток. */
function arrivalRate(hour, params = PARAMS) {
  const totalTrips = params.studentsInBuilding * params.tripsPerStudentPerDay;
  const peakTrips = totalTrips * params.peakTrafficShare;
  const peak = params.peakHours.find((p) => hour >= p.start && hour < p.end);

  if (peak) {
    const durationSec = (peak.end - peak.start) * 3600;
    return (peakTrips * peak.weight) / durationSec;
  }

  // Фон: оставшиеся поездки равномерно по непиковому времени
  const peakDuration = params.peakHours.reduce((s, p) => s + (p.end - p.start), 0);
  const backgroundSec = (params.activeHours - peakDuration) * 3600;
  return (totalTrips * (1 - params.peakTrafficShare)) / backgroundSec;
}

/** Средняя за день интенсивность, чел/сек. */
function averageArrivalRate(params = PARAMS) {
  const totalTrips = params.studentsInBuilding * params.tripsPerStudentPerDay;
  return totalTrips / (params.activeHours * 3600);
}

module.exports = {
  PARAMS,
  destinationDistribution,
  averageDestination,
  createRandom,
  arrivalRate,
  averageArrivalRate
};
