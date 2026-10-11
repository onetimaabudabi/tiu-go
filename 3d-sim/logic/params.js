/**
 * TIU GO — параметры 3D-визуализации.
 *
 * Сюда стекаются числа из моделей:
 *   • tech-model/params.js  — физика лифтов, камера, диспетчер, кабина;
 *   • math-model/params.js  — параметры социальной модели (для справки);
 *   • shared/params.json    — через обе модели: объект, люди, расписание.
 *
 * Всё это приходит одним виртуальным модулем, который собирает Vite
 * (см. vite.config.mjs). Своих физических чисел визуализация не держит:
 * скорость кабины, ускорение, работа дверей, вместимость, время посадки,
 * скорость шага, терпение, запас мест и ширина пограничной зоны — всё
 * из моделей. Здесь остаётся только то, чего в моделях нет и быть не
 * может: геометрия холла, палитра и настройки производительности.
 */

import {
  tech, math, optimalMargin, measurementTable, reference
} from 'virtual:tiu-params';

export { tech, math, measurementTable, reference };

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
  payloadKg: tech.elevators.payloadKg,
  // Номинальная скорость и ускорение — паспортные для пассажирского
  // лифта на 1000 кг в доме до 16 этажей (1 м/с, 1 м/с²).
  speed: tech.elevators.speed,
  acceleration: tech.elevators.acceleration,
  doorWidth: tech.elevators.doorWidth,
  doorOpenTime: tech.elevators.doorOpenTime,
  doorCloseTime: tech.elevators.doorCloseTime,
  doorHoldTime: tech.elevators.doorHoldTime,
  // Полный цикл дверей на одной остановке — то же, что DOOR_CYCLE
  // в tech-model/04 и doorCycleTime в math-model.
  get doorCycle() {
    return this.doorOpenTime + this.doorHoldTime + this.doorCloseTime;
  },
  boardingTimePerPerson: tech.elevators.boardingTimePerPerson
};

export const CABIN = {
  width: tech.cabin.width,
  depth: tech.cabin.depth,
  height: tech.cabin.height,
  personHeight: tech.cabin.personHeight
};

// ---------- Две группы шахт ----------
//
// В корпусе 7 лифты стоят друг против друга: три шахты по левую руку от
// входящего и три по правую. Номера идут от входа вглубь холла, состав
// групп — из shared/params.json (elevators.banks). Работают 1 и 2 слева
// и 6 справа, в глубине: из-за этого очередь всегда перекошена на левую
// сторону, и в визуализации это видно.

export const BANKS = {
  left: {
    id: 'left',
    label: 'слева от входа',
    // side = +1 — сторона с положительным Z. Человек входит с +X и
    // смотрит в сторону −X, поэтому его левая рука указывает на +Z.
    side: +1,
    numbers: tech.elevators.banks.left.slice()
  },
  right: {
    id: 'right',
    label: 'справа от входа',
    side: -1,
    numbers: tech.elevators.banks.right.slice()
  }
};

// ---------- Геометрия сцены ----------
//
// Этих размеров нет ни в одной модели: они описывают только картинку.
// Кабина берётся из tech-model (cabin), остальное — лифтовой холл
// корпуса 7: коридор между двумя группами шахт, вход с торца.

export const HALL = {
  // Длина холла вдоль X: от торцевой стены до линии входа
  length: 10.4,
  // Расстояние между плоскостями створок двух групп. Для встречных
  // групп нужно полторы-две глубины кабины, иначе выходящие упираются
  // в ожидающих; 4,2 м — как раз две глубины.
  corridor: 4.2,
  get height() { return BUILDING.floorHeight; },
  tile: 0.6,

  // Шаг осей шахт в группе: шахта 1,7 м плюс простенок
  liftPitch: 2.1,
  // Ось ближней ко входу шахты
  liftFirstX: 1.9,
  shaftWidth: 1.7,
  // Глубина шахты: кабина плюс зазоры спереди и сзади
  get shaftDepth() { return CABIN.depth + 0.4; },

  // Плоскость створок каждой группы: z = ±doorPlane
  get doorPlane() { return this.corridor / 2; },
  // Полная глубина ядра здания: коридор плюс две шахты
  get span() { return this.corridor + 2 * this.shaftDepth; },

  // Вход — проём в торце со стороны улицы
  get entranceX() { return this.length / 2; },
  entranceWidth: 2.6,
  entranceHeight: 2.4,

  // Лестница — проём в левой стене вестибюля, за ближней шахтой.
  // Туда уходят те, кто не дождался лифта.
  stairsX: 3.9,
  stairsWidth: 1.6,
  stairsSide: +1,

  // Зона ожидания перед дверью: подсвеченный прямоугольник на полу
  waitZoneWidth: 1.8,
  waitZoneDepth: 1.3,
  // На сколько метров от плоскости створок отстоит её дальний край
  waitZoneGap: 0.25
};

// ---------- Привязка лифта к месту в холле ----------

const anchors = new Map();

/**
 * Где стоит лифт и куда смотрят его двери.
 *
 * Лифт собирается в своих координатах — дверями в +Z — и целиком
 * ставится на место: сдвиг по X вдоль коридора, сдвиг по Z на свою
 * плоскость створок, поворот на 180° для левой группы. Поэтому ни один
 * модуль сцены не знает, в какой группе стоит лифт: он работает
 * с местными координатами, а разворот делает группа объекта.
 *
 * @returns {{x: number, z: number, side: number, rotationY: number,
 *            bank: object, index: number}}
 */
export function liftAnchor(number) {
  if (anchors.has(number)) return anchors.get(number);

  const bank = Object.values(BANKS).find((b) => b.numbers.includes(number));
  if (!bank) throw new Error(`лифт №${number} не числится ни в одной группе`);

  const index = bank.numbers.indexOf(number);
  const anchor = {
    bank,
    index,
    side: bank.side,
    x: HALL.liftFirstX - index * HALL.liftPitch,
    z: bank.side * HALL.doorPlane,
    // Левая группа развёрнута: её двери смотрят в −Z
    rotationY: bank.side > 0 ? Math.PI : 0
  };

  anchors.set(number, anchor);
  return anchor;
}

/** Мировая координата X оси лифта. */
export function liftX(number) { return liftAnchor(number).x; }

/** Мировая координата Z плоскости створок лифта. */
export function liftZ(number) { return liftAnchor(number).z; }

/**
 * Точка в холле перед дверью лифта.
 * @param {number} number    номер лифта
 * @param {number} distance  сколько метров от плоскости створок внутрь коридора
 * @param {number} [lateral] сдвиг вдоль коридора
 */
export function frontOf(number, distance, lateral = 0) {
  const a = liftAnchor(number);
  return { x: a.x + lateral, z: a.z - a.side * distance };
}

/** Высота пола этажа (1-й этаж — ноль). */
export function floorY(floor) {
  return (floor - 1) * BUILDING.floorHeight;
}

// ---------- Палитра ----------

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
  // Скорость шага и разброс — из shared/params.json. 1,35 м/с это
  // наблюдаемая средняя скорость пешехода в помещении (Фруин: 1,2–1,4).
  speed: tech.people.walkSpeed,
  speedJitter: tech.people.walkSpeedSpread,

  // Эталон для timeScale анимации: с какой скоростью идёт персонаж
  // в самом клипе Mixamo. Это свойство анимации, а не корпуса 7,
  // поэтому число живёт здесь, а не в параметрах объекта.
  reference: 1.4,

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
  lobbyShare: tech.people.lobbyShare,
  tripsPerPersonPerDay: tech.people.tripsPerPersonPerDay,
  population: tech.people.students + tech.people.staff,
  stairsTimePerFloor: tech.people.stairsTimePerFloor,
  peakIntervals: tech.peakIntervals.map((p) => ({ ...p })),
  schedule: tech.schedule.map((p) => ({ ...p })),
  floorDistribution: { ...tech.floorDistribution },
  randomSeed: tech.simulation.randomSeed,

  // Сколько секунд человек готов ждать, прежде чем уйти на лестницу.
  // Из shared/params.json (people.patienceSeconds).
  patienceSeconds: tech.people.patienceSeconds,

  // Сколько человек одновременно держим в сцене. Остальные существуют
  // в модели и считаются в статистике, но тела не получают.
  maxVisiblePeople: 70,

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
  // Ширина пограничной зоны гистерезиса — из tech-model (dispatch.band),
  // то же число, что BAND в 03-decision-logic.js.
  band: tech.dispatch.band,

  // Запас мест: берём оптимум, найденный tech-model/07-optimization.js.
  // Если модель ещё не запускали, остаётся штатное значение оттуда же.
  margin: Number.isFinite(optimalMargin) ? optimalMargin : tech.dispatch.safetyMargin,
  marginFromModel: Number.isFinite(optimalMargin),

  capacity: tech.elevators.capacityRealPeak,
  camera: {
    falsePositiveRate: tech.camera.falsePositiveRate,
    falseNegativeRate: tech.camera.falseNegativeRate,
    map50: tech.camera.map50,
    fps: tech.camera.fps
  }
};

// ---------- Сравнение режимов ----------

export const COMPARE = {
  // Сколько учебных дней разыгрывать на каждый режим по нажатию кнопки.
  // Модель в отчёте считает 500 дней; в браузере столько не нужно —
  // разброс пропускной способности около 2 %, и на трёх десятках дней
  // разница между режимами уже уверенно больше разброса.
  days: 30,
  // Дней за один заход цикла, чтобы не морозить кадр
  chunk: 3
};

// ---------- Сценарии для кнопок ----------
//
// Берём три самых показательных интервала из shared/params.json:
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
  tech, math, BUILDING, ELEVATORS, CABIN, BANKS, HALL, PALETTE,
  LIGHT, WALK, SIM, DISPATCH, COMPARE, SCENARIOS, PERF,
  liftAnchor, liftX, liftZ, frontOf, floorY
};
