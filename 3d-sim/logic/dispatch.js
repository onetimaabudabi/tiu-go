/**
 * Алгоритм «остановиться или проехать».
 *
 * Перенос tech-model/03-decision-logic.js в браузер: там CommonJS и
 * двадцать тысяч прогонов Монте-Карло, здесь нужны те же три функции,
 * но по одному решению за раз. Формулы и смысл не менялись:
 *
 *   shouldStop(real, capacity)  — как надо было поступить (эталон);
 *   decideHysteresis(...)       — как поступает система;
 *   BAND                        — ширина пограничной зоны.
 *
 * Запас мест margin берётся из результата tech-model/07-optimization.js
 * (см. logic/params.js): при нём суммарное ожидание на верхних этажах
 * минимально.
 *
 * Камера видит кабину не идеально — detect() добавляет к реальному
 * числу людей ошибки с вероятностями из tech.camera.
 */

import { DISPATCH, ELEVATORS } from './params.js';

export const BAND = DISPATCH.band;

/** Эталон: остановка полезна, если в кабину влезет хотя бы один человек. */
export function shouldStop(realPeople, capacity = DISPATCH.capacity) {
  return realPeople < capacity;
}

/** Голое сравнение с порогом. */
export function decideThreshold(detected, capacity, margin) {
  return detected + margin >= capacity ? 'pass' : 'stop';
}

/**
 * Гистерезис: внутри пограничной зоны решение наследуется, а не
 * пересматривается. Именно это гасит дребезг на границе вместимости.
 */
export function decideHysteresis(detected, capacity, margin, previous) {
  const effective = detected + margin;

  if (effective >= capacity) return 'pass';
  if (effective < capacity - BAND) return 'stop';
  return previous || 'stop';
}

/**
 * Что «видит» камера в кабине.
 *
 * Ложные пропуски и ложные срабатывания разыгрываются на каждого
 * человека отдельно с вероятностями falseNegativeRate и
 * falsePositiveRate из tech-model/params.js.
 */
export function detect(realPeople, rng = Math.random) {
  let detected = 0;

  for (let i = 0; i < realPeople; i += 1) {
    if (rng() >= DISPATCH.camera.falseNegativeRate) detected += 1;
  }

  // Ложные срабатывания: сумка или отражение, принятые за человека
  const falsePositives = Math.round(realPeople * DISPATCH.camera.falsePositiveRate);
  for (let i = 0; i < falsePositives; i += 1) {
    if (rng() < 0.5) detected += 1;
  }

  return detected;
}

/**
 * Решение лифта на вызове с первого этажа.
 * Возвращает и решение, и всё, что нужно статистике.
 */
export function decideCall(lift, rng = Math.random) {
  const capacity = DISPATCH.capacity;
  const real = lift.occupancy;
  const detected = detect(real, rng);

  const action = decideHysteresis(detected, capacity, DISPATCH.margin, lift.lastDecision);
  lift.lastDecision = action;

  const truth = shouldStop(real, capacity) ? 'stop' : 'pass';

  return {
    action,
    detected,
    real,
    correct: action === truth,
    // Проехал мимо, хотя место было, — самая обидная ошибка
    wrongPass: action === 'pass' && truth === 'stop',
    // Остановился впустую: место кончилось, никто не вошёл
    uselessStop: action === 'stop' && truth === 'pass'
  };
}

/**
 * Кому отдать вызов: среди свободных лифтов берём тот, что приедет
 * раньше. Если все заняты — вызов подождёт, как в жизни.
 */
export function chooseLift(elevators) {
  let best = null;
  let bestTime = Infinity;

  for (const lift of elevators) {
    if (lift.broken || lift.busy) continue;
    if (lift.occupancy >= ELEVATORS.capacityRealPeak) continue;

    const time = lift.timeTo(1);
    if (time < bestTime) { bestTime = time; best = lift; }
  }

  return best;
}

/** Детерминированный генератор (mulberry32) — повторяемость прогонов. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
