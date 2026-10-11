/**
 * Кинематика кабины — то же, что tech-model/04-elevator-physics.js.
 *
 * Трапецеидальный профиль скорости: разгон с ускорением a до номинальной
 * скорости v, крейсер, торможение тем же a. Если расстояния на разгон
 * не хватает, профиль треугольный и номинальная скорость не достигается.
 *
 *   t = (d − v²/a) / v + 2·v/a      — трапеция
 *   t = 2·√(d/a)                    — треугольник
 *
 * Оба числа, v и a, приходят из shared/params.json: 1 м/с и 1 м/с² —
 * паспортные для пассажирского лифта на 1000 кг в доме до 16 этажей.
 *
 * Модуль один на всю визуализацию: по нему едет кабина на экране
 * (scene/elevator.js) и по нему же считает время сравнение режимов
 * (logic/compare.js). Иначе кабина ехала бы одно время, а модель
 * считала бы другое.
 */

import { BUILDING, ELEVATORS } from './params.js';

/** Полный цикл дверей на одной остановке: открыть, подержать, закрыть. */
export const DOOR_CYCLE = ELEVATORS.doorCycle;

/**
 * Разбор поездки на участки: сколько длится разгон, крейсер и торможение.
 * Нужен не только итог, но и положение кабины в каждый момент.
 */
export function profile(distance) {
  const v = ELEVATORS.speed;
  const a = ELEVATORS.acceleration;

  if (distance <= 0) {
    return { total: 0, tAcc: 0, dAcc: 0, vPeak: 0, tCruise: 0, distance: 0 };
  }

  const rampDistance = (v * v) / a;      // путь на разгон плюс торможение

  if (distance < rampDistance) {
    const tAcc = Math.sqrt(distance / a);
    return {
      total: 2 * tAcc, tAcc, dAcc: distance / 2,
      vPeak: a * tAcc, tCruise: 0, distance
    };
  }

  const tAcc = v / a;
  const dAcc = (v * v) / (2 * a);
  const tCruise = (distance - rampDistance) / v;

  return { total: 2 * tAcc + tCruise, tAcc, dAcc, vPeak: v, tCruise, distance };
}

/** Пройденный путь к моменту t внутри профиля. */
export function travelled(p, t) {
  const a = ELEVATORS.acceleration;

  if (t <= 0) return 0;
  if (t >= p.total) return p.distance;

  if (t < p.tAcc) return 0.5 * a * t * t;

  const tDecelStart = p.tAcc + p.tCruise;
  if (t < tDecelStart) return p.dAcc + p.vPeak * (t - p.tAcc);

  const td = t - tDecelStart;
  return p.dAcc + p.vPeak * p.tCruise + p.vPeak * td - 0.5 * a * td * td;
}

/** Время проезда расстояния d метров. */
export function travelTime(distance) {
  return profile(distance).total;
}

/** Время проезда между этажами без учёта остановок. */
export function floorTime(from, to) {
  return travelTime(Math.abs(to - from) * BUILDING.floorHeight);
}
