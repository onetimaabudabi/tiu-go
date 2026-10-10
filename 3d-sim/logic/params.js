/**
 * TIU GO — параметры 3D-визуализации.
 *
 * Сюда стекаются числа из двух мест:
 *   • tech-model/params.js  — физика лифтов, камера, расписание пар, потоки;
 *   • math-model/params.js  — параметры социальной модели (для справки).
 *
 * Оба файла приходят через виртуальный модуль, который собирает Vite
 * (см. vite.config.mjs). В самой визуализации собственных чисел нет —
 * только геометрия сцены и палитра, которых в моделях быть не может.
 */

import { tech, math, optimalMargin } from 'virtual:tiu-params';

export { tech, math };

// ---------- Здание ----------

export const BUILDING = {
  name: tech.building.name,
  floors: tech.building.floors,
  floorHeight: tech.building.floorHeight,
  // Полная высота здания, м
  get height() { return this.floors * this.floorHeight; },
  cafeteriaFloor: tech.building.cafeteriaFloor
};

// ---------- Лифты ----------

export const ELEVATORS = {
  total: tech.elevators.total,
  working: tech.elevators.working.slice(),
  broken: tech.elevators.broken.slice(),
  capacityPassport: tech.elevators.capacityPassport,
  capacityRealPeak: tech.elevators.capacityRealPeak,
  capacityRealNormal: tech.elevators.capacityRealNormal,
  speed: tech.elevators.speed,
  acceleration: tech.elevators.acceleration,
  doorOpenTime: tech.elevators.doorOpenTime,
  doorCloseTime: tech.elevators.doorCloseTime,
  doorHoldTime: tech.elevators.doorHoldTime,
  boardingTimePerPerson: tech.elevators.boardingTimePerPerson
};

// ---------- Геометрия сцены ----------
//
// Этих размеров нет ни в одной модели: они описывают только картинку.
// Кабина берётся из tech-model (cabin), всё остальное — холл корпуса 7
// по плану этажа.

export const CABIN = {
  width: tech.cabin.width,
  depth: tech.cabin.depth,
  height: tech.cabin.height
};

export const HALL = {
  width: 12,          // вдоль X
  depth: 8,           // вдоль Z
  height: 3,          // до потолка
  tile: 0.6,          // сторона напольной плитки, м
  // Лифты стоят вдоль дальней стены
  liftWall: -4,
  // Шаг между осями шахт: шесть лифтов ровно по ширине холла
  get liftPitch() { return this.width / ELEVATORS.total; },
  // Первая ось: середина левой ячейки
  get liftFirstX() { return -this.width / 2 + this.liftPitch / 2; },
  shaftWidth: 1.7,
  // Глубина шахты: кабина плюс зазоры спереди и сзади
  get shaftDepth() { return CABIN.depth + 0.4; },
  // Площадка перед лифтами на верхних этажах — туда выходят пассажиры
  landingDepth: 2.6,
  // Зона ожидания перед дверьми
  waitZoneZ: -2.6,
  waitZoneSize: 1.4,
  // Вход в холл — проём справа
  entranceX: 6,
  entranceZ: 2,
  entranceWidth: 3,
  // Лестница — проём рядом со входом, туда уходят те, кто не дождался
  stairsZ: -2.2
};

/** Мировая координата X оси лифта по его номеру (1…6). */
export function liftX(number) {
  return HALL.liftFirstX + (number - 1) * HALL.liftPitch;
}

/** Высота пола этажа (1-й этаж — ноль). */
export function floorY(floor) {
  return (floor - 1) * BUILDING.floorHeight;
}

// ---------- Палитра ----------
//
// Цвета заданы в постановке задачи. Держим их в одном месте, чтобы
// модули сцены не знали шестнадцатеричных литералов.

export const PALETTE = {
  cabinWall: 0xb8b8b8,
  cabinFloor: 0x333333,
  cabinCeiling: 0xf0f0f0,
  cabinLight: 0xffe6b3,
  mirror: 0xdfe6ea,
  handrail: 0x9aa3a8,
  door: 0xc9ced2,
  doorBroken: 0x6f7478,
  shaft: 0x7f8c93,
  shaftBroken: 0x55595c,
  rail: 0x5a6065,
  cable: 0x3c4043,
  hallFloorA: 0xb9b5ad,
  hallFloorB: 0xa8a49c,
  hallWall: 0xcfc9bf,
  hallCeiling: 0xf4f2ee,
  waitZone: 0xe8c33a,
  sky: 0x11161c,
  ambient: 0xfff4e6,
  sun: 0xfff2dc,
  heat: { free: 0x3fb27f, busy: 0xe8c33a, full: 0xd9534f },
  skipFlash: 0xd9534f
};

// ---------- Освещение ----------

export const LIGHT = {
  ambientIntensity: 0.4,
  sunIntensity: 0.6,
  cabinIntensity: 1.0,
  hallSpotIntensity: 0.55
};

// ---------- Движение людей ----------

export const WALK = {
  // Средняя скорость пешехода — эталон для timeScale анимации ходьбы
  reference: 1.4,
  speed: 1.25,
  speedJitter: 0.2,
  // Радиус, на котором человек считает, что дошёл до цели
  arriveEpsilon: 0.12,
  // Скорость доворота корпуса, рад/с
  turnSpeed: 6,
  // Длительность кроссфейда между анимациями, с
  fade: 0.35,
  // Плавное появление и исчезновение, с
  fadeIn: 0.6,
  fadeOut: 0.5
};

// ---------- Симуляция ----------

export const SIM = {
  dayStart: tech.simulation.dayStart,
  dayEnd: tech.simulation.dayEnd,
  lobbyShare: tech.simulation.lobbyShare,
  tripsPerPersonPerDay: tech.simulation.tripsPerPersonPerDay,
  population: tech.people.students + tech.people.staff,
  peakIntervals: tech.peakIntervals.map((p) => ({ ...p })),
  schedule: tech.schedule.map((p) => ({ ...p })),
  floorDistribution: { ...tech.floorDistribution },

  // Сколько человек одновременно держим в сцене. Остальные существуют
  // в модели и считаются в статистике, но тела не получают.
  maxVisiblePeople: 70,

  // Сколько секунд человек готов ждать, прежде чем уйти на лестницу.
  patienceSeconds: 90,

  // Ускорение времени. 60× из постановки задачи оставлено кнопкой, но
  // по умолчанию стоит 10×: на 60× человек проходит метр с лишним за кадр,
  // и движение перестаёт читаться как движение. В постановке сказано
  // «плавность важнее точности физики» — поэтому так.
  defaultSpeed: 10,
  speeds: [1, 10, 30, 60, 100],
  // Выше этого ускорения показываем предупреждение о таймлапсе
  smoothSpeedLimit: 30,

  // Фиксированный шаг логики, с реального времени
  fixedStep: 1 / 60,
  maxStepsPerFrame: 5
};

// ---------- Алгоритм «остановиться или проехать» ----------

export const DISPATCH = {
  // Ширина пограничной зоны — из tech-model/03-decision-logic.js
  band: 2,
  // Запас мест: берём оптимум, найденный tech-model/07-optimization.js.
  // Если модель ещё не запускали, остаётся значение по умолчанию оттуда же.
  margin: Number.isFinite(optimalMargin) ? optimalMargin : 1,
  marginFromModel: Number.isFinite(optimalMargin),
  capacity: tech.elevators.capacityRealPeak,
  camera: {
    falsePositiveRate: tech.camera.falsePositiveRate,
    falseNegativeRate: tech.camera.falseNegativeRate,
    map50: tech.camera.map50
  }
};

// ---------- Сценарии для кнопок ----------
//
// Берём три самых показательных интервала из tech-model/params.js:
// утренний приход, обеденный максимум и пик после четвёртой пары.

function findPeak(startsWith) {
  return SIM.peakIntervals.find((p) => p.start === startsWith) || null;
}

export const SCENARIOS = [
  { id: 'morning', hhmm: '08:00', peak: findPeak('08:00'), label: 'Утро' },
  { id: 'lunch', hhmm: '13:05', peak: findPeak('13:05'), label: 'Обед' },
  { id: 'after', hhmm: '15:20', peak: findPeak('15:20'), label: 'После пар' }
];

// ---------- Производительность ----------

export const PERF = {
  // Ниже этого FPS снижаем детализацию, выше второго порога — возвращаем
  fpsFloor: 30,
  fpsComfort: 52,
  // Сколько секунд терпим, прежде чем менять уровень
  dropAfter: 2,
  raiseAfter: 6,

  /**
   * Уровни качества.
   *
   * Одна модель Mixamo — около 35 тысяч треугольников. Семьдесят таких
   * персонажей это два с половиной миллиона за кадр: дискретная карта
   * потянет, встроенная графика — нет. Поэтому детализация не задана
   * жёстко, а подбирается под машину: сколько персонажей тянем в полном
   * виде, с какого расстояния переходим на упрощённые, какой масштаб
   * пикселей и сколько источников света.
   *
   * fullDetail — максимум персонажей с полной моделью и анимацией;
   * lodDistance — дальше этого расстояния персонаж всегда упрощённый;
   * lights — 2: все, 1: половина холла, 0: только кабины.
   */
  levels: [
    { name: 'минимум', fullDetail: 8, lodDistance: 11, pixelRatio: 1, shadows: false, shadowCasters: 0, lights: 0 },
    { name: 'низкое', fullDetail: 16, lodDistance: 16, pixelRatio: 1, shadows: false, shadowCasters: 0, lights: 1 },
    { name: 'среднее', fullDetail: 32, lodDistance: 22, pixelRatio: 1.25, shadows: true, shadowCasters: 10, lights: 1 },
    { name: 'высокое', fullDetail: 70, lodDistance: 30, pixelRatio: 1.5, shadows: true, shadowCasters: 14, lights: 2 }
  ],

  // С какого уровня стартуем: сразу высокий, дальше подстроится сам
  startLevel: 3
};

/** Перевод "HH:MM" в часы с дробной частью. */
export function hhmmToHours(value) {
  const [h, m] = String(value).split(':').map(Number);
  return h + m / 60;
}

/** Перевод часов с дробной частью в "HH:MM". */
export function hoursToHHMM(hours) {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export default {
  tech, math, BUILDING, ELEVATORS, CABIN, HALL, PALETTE,
  LIGHT, WALK, SIM, DISPATCH, SCENARIOS, PERF, liftX, floorY
};
