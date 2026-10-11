/**
 * Очередь к лифту и раскладка людей по местам.
 *
 * Очередь — это список людей плюс правило, где каждому стоять.
 * Места считаются один раз и не зависят от того, кто в очереди:
 * когда передний уходит, остальные просто получают новые координаты
 * и доходят до них пешком — никаких перескоков.
 *
 * Раскладка считается от двери своего лифта: четыре человека в ряд
 * вдоль коридора, два ряда в глубину. Центральная полоса коридора
 * остаётся свободной — по ней ходят те, кто вышел из лифта напротив,
 * и те, кто идёт к дальним шахтам. Кому места в раскладке не хватило,
 * тот стоит в модели и в статистике, но тела не получает: встречный
 * коридор шириной 4,2 м физически не вмещает сотню человек, а честнее
 * показать, сколько людей осталось за кадром, чем ставить их друг в друга.
 */

import { CABIN, liftAnchor, frontOf } from './params.js';

// Раскладка в холле. Четыре человека в ряд укладываются в шаг шахт
// (2,1 м), три ряда — в половину ширины коридора: встречная очередь
// стоит у своей стены, и между ними остаётся проход.
const COLS = 4;          // человек в ряд вдоль коридора
const COL_STEP = 0.52;   // шаг между соседями в ряду, м
const ROWS = 3;          // рядов в глубину коридора
const ROW_STEP = 0.5;    // шаг между рядами, м
const FIRST_ROW = 0.85;  // отступ первого ряда от плоскости створок, м

/** Где стоит человек с номером index в очереди к лифту number. */
export function hallSlot(number, index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS) % ROWS;

  const lateral = (col - (COLS - 1) / 2) * COL_STEP;
  const distance = FIRST_ROW + row * ROW_STEP;

  return frontOf(number, distance, lateral);
}

/** Сколько человек помещается в видимую раскладку очереди. */
export const VISIBLE_SLOTS = COLS * ROWS;

/**
 * Место внутри кабины. Локальные координаты относительно центра пола:
 * два ряда вдоль длинной стороны, затылок в затылок.
 */
export function cabinSlot(index, capacity) {
  const perRow = 2;
  const rows = Math.ceil(capacity / perRow);
  const col = index % perRow;
  const row = Math.floor(index / perRow);

  const usable = CABIN.depth - 0.45;
  const stepZ = rows > 1 ? usable / (rows - 1) : 0;

  return {
    x: (col - (perRow - 1) / 2) * (CABIN.width / 2),
    // Первые вошедшие уходят в глубину кабины, к зеркалу
    z: -usable / 2 + row * stepZ
  };
}

/**
 * Точка перед дверью, через которую человек входит и выходит.
 * Створки узкие (900 мм), поэтому проход у всех один и тот же —
 * ровно по оси шахты.
 */
export function doorwaySlot(number) {
  return frontOf(number, 0.55);
}

/** Куда человек смотрит, стоя в очереди: на створки своего лифта. */
export function doorFacing(number) {
  const a = liftAnchor(number);
  return { x: a.x, z: a.z };
}

// Площадка верхнего этажа: ожидающие стоят в метре от створок
const LANDING_DISTANCE = 0.95;

/** Место ожидающего на верхнем этаже: до четырёх человек у створок. */
export function landingSlot(number, index) {
  return frontOf(number, LANDING_DISTANCE, (index - 1.5) * 0.5);
}

/** Вместимость площадки верхнего этажа в видимых телах. */
export const LANDING_SLOTS = 4;

export class Queue {
  constructor(number) {
    this.number = number;
    this.people = [];
  }

  get length() { return this.people.length; }

  add(person) {
    this.people.push(person);
    return this.people.length - 1;
  }

  remove(person) {
    const i = this.people.indexOf(person);
    if (i >= 0) this.people.splice(i, 1);
    return i;
  }

  indexOf(person) { return this.people.indexOf(person); }

  /** Первые n человек — те, кто реально зайдёт в кабину. */
  front(n) { return this.people.slice(0, n); }

  clear() { this.people.length = 0; }
}
