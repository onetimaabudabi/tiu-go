/**
 * Очередь к лифту и раскладка людей по местам.
 *
 * Очередь — это список людей плюс правило, где каждому стоять.
 * Места считаются один раз и не зависят от того, кто в очереди:
 * когда передний уходит, остальные просто получают новые координаты
 * и доходят до них пешком — никаких перескоков.
 */

import { CABIN, HALL, liftX } from './params.js';

// Раскладка в холле: три человека в ряд, ряды уходят от дверей в холл
const COLS = 3;
const COL_STEP = 0.46;
const ROW_STEP = 0.62;
const MAX_ROWS = 8;

/** Где стоит человек с номером index в очереди к лифту number. */
export function hallSlot(number, index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const clampedRow = Math.min(row, MAX_ROWS - 1);

  // Переполнение раскладываем вширь, а не бесконечно вглубь холла
  const overflow = Math.max(0, row - (MAX_ROWS - 1));
  const side = overflow % 2 === 0 ? 1 : -1;
  const spread = Math.ceil(overflow / 2) * COL_STEP;

  return {
    x: liftX(number) + (col - 1) * COL_STEP + side * spread,
    z: HALL.waitZoneZ + clampedRow * ROW_STEP
  };
}

/** Сколько человек помещается в видимую раскладку очереди. */
export const VISIBLE_SLOTS = COLS * MAX_ROWS;

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

/** Точка перед дверью, через которую человек входит и выходит. */
export function doorwaySlot(number) {
  return { x: liftX(number), z: HALL.liftWall + 0.55 };
}

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
