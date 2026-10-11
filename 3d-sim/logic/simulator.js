/**
 * Симулятор учебного дня в холле корпуса 7.
 *
 * Что считается:
 *   • поток людей — из tech-model/params.js (население, поездок в день,
 *     доля поездок с первого этажа, веса пиков по расписанию пар);
 *   • кого везти — простой диспетчер: вызов уходит ближайшему свободному;
 *   • останавливаться или проезжать — logic/dispatch.js, то есть
 *     гистерезис из tech-model/03 с запасом мест из tech-model/07.
 *
 * Техническую часть можно выключить (setSystem). Тогда камера и логика
 * пропуска не работают, и лифт тормозит на каждом вызове — даже если
 * кабина полная и войти некому. Такая остановка стоит полного цикла
 * дверей, и именно из неё складывается разница между режимами.
 *
 * Люди бывают двух сортов: с телом и без. Без тела — те, кому не хватило
 * лимита сцены. Они живут по той же логике и попадают в статистику,
 * просто их не видно. Так на обеденном пике картинка не превращается
 * в слайд-шоу, а цифры остаются честными.
 */

import * as THREE from 'three';
import {
  BUILDING, ELEVATORS, HALL, SIM, DISPATCH,
  frontOf, floorY, hhmmToHours, hoursToHHMM
} from './params.js';
import {
  Queue, hallSlot, cabinSlot, doorwaySlot, doorFacing, landingSlot,
  VISIBLE_SLOTS, LANDING_SLOTS
} from './queue.js';
import { decideCall, makeRng } from './dispatch.js';

// Точки появления и ухода. Вход — в торце коридора, лестница — в стене
// вестибюля: оба проёма берутся из геометрии холла, а не на глаз.
const ENTRANCE = { x: HALL.entranceX + 1.6, z: 0 };
const ENTRANCE_IN = { x: HALL.entranceX - 1.2, z: 0 };
const STAIRS_IN = {
  x: HALL.stairsX,
  z: HALL.stairsSide * (HALL.doorPlane - 0.7)
};
const STAIRS = {
  x: HALL.stairsX,
  z: HALL.stairsSide * (HALL.doorPlane + 1.5)
};

let personSeq = 0;

export class Simulator {
  constructor(app, crowd) {
    this.app = app;
    this.crowd = crowd;
    this.scene = app.scene;
    this.elevators = app.elevators;
    this.hall = app.hall;

    this.working = this.elevators.filter((l) => !l.broken);

    // Техническая часть проекта: камера в кабине плюс решение
    // «остановиться или проехать». Выключателем служит setSystem().
    this.systemOn = true;

    this.rng = makeRng(SIM.peakIntervals.length * 7919 + BUILDING.floors);

    this.queues = new Map();
    for (const lift of this.working) this.queues.set(lift.number, new Queue(lift.number));

    // Ожидающие на верхних этажах: floor → массив людей
    this.upperWaiting = new Map();

    this.agents = this.working.map((lift) => new LiftAgent(lift, this));

    this.people = [];
    this.reset(SIM.dayStart);
  }

  // ======================= Жизненный цикл =======================

  reset(startHour = SIM.dayStart) {
    // Тела убирает толпа — она же их и создавала
    this.people.length = 0;
    this.crowd.clear();

    for (const queue of this.queues.values()) queue.clear();
    this.upperWaiting.clear();

    for (const lift of this.elevators) lift.reset();
    for (const agent of this.agents) agent.reset();

    this.time = startHour * 3600;        // модельные секунды от полуночи
    this.modeSince = this.time;
    this.lobbyDebt = 0;
    this.upperDebt = 0;

    this.stats = {
      inHall: 0, inLifts: 0, toStairs: 0, served: 0,
      avgWait: 0, maxQueue: 0, passes: 0, wrongPasses: 0, uselessStops: 0,
      stops: 0, waitSum: 0, waitCount: 0, offscreen: 0
    };

    this.history = [];      // для графиков: { hour, queue, load }
    this.historyTick = 0;
  }

  /**
   * Включить или выключить техническую часть.
   *
   * Счётчики сбрасываются: смешивать остановки двух режимов в одной
   * сумме нельзя — получится средняя температура по палате. Время суток
   * и люди в холле остаются на месте, чтобы разницу было видно сразу.
   */
  setSystem(on) {
    if (this.systemOn === on) return;
    this.systemOn = on;

    this.stats.passes = 0;
    this.stats.wrongPasses = 0;
    this.stats.uselessStops = 0;
    this.stats.stops = 0;
    this.stats.served = 0;
    this.stats.toStairs = 0;
    this.stats.waitSum = 0;
    this.stats.waitCount = 0;
    this.stats.avgWait = 0;
    this.modeSince = this.time;

    for (const lift of this.elevators) lift.lastDecision = 'stop';
  }

  /** Сколько модельных минут работает текущий режим. */
  get modeMinutes() {
    return Math.max(0, (this.time - (this.modeSince ?? this.time)) / 60);
  }

  /** Перемотка на сценарий: «Утро», «Обед», «После пар». */
  jumpTo(hhmm) {
    this.reset(hhmmToHours(hhmm));
  }

  get clockLabel() {
    return hoursToHHMM((this.time / 3600) % 24);
  }

  /** Подпись текущего отрезка дня. */
  get phaseLabel() {
    const hours = (this.time / 3600) % 24;

    for (const peak of SIM.peakIntervals) {
      if (hours >= hhmmToHours(peak.start) && hours < hhmmToHours(peak.end)) {
        return peak.label;
      }
    }

    if (hours < SIM.dayStart || hours >= SIM.dayEnd) return 'корпус закрыт';
    return 'между пиками';
  }

  // ======================= Поток людей =======================

  /**
   * Сколько человек в секунду приходит к лифтам на первом этаже.
   *
   * Все поездки за день = население × поездок на человека. Доля
   * lobbyShare начинается в холле. Внутри пиков поток идёт с весом пика,
   * между пиками — ровным фоном на оставшиеся 5 %.
   */
  #lobbyRate(hours) {
    const trips = SIM.population * SIM.tripsPerPersonPerDay * SIM.lobbyShare;
    return this.#rateFor(hours, trips);
  }

  /** То же для вызовов с верхних этажей. */
  #upperRate(hours) {
    const trips = SIM.population * SIM.tripsPerPersonPerDay * (1 - SIM.lobbyShare);
    return this.#rateFor(hours, trips);
  }

  #rateFor(hours, trips) {
    if (hours < SIM.dayStart || hours >= SIM.dayEnd) return 0;

    let peakWeight = 0;
    let peakSeconds = 0;

    for (const peak of SIM.peakIntervals) {
      const start = hhmmToHours(peak.start);
      const end = hhmmToHours(peak.end);
      peakSeconds += (end - start) * 3600;

      if (hours >= start && hours < end) {
        return (trips * peak.weight) / ((end - start) * 3600);
      }
      peakWeight += peak.weight;
    }

    // Фон между пиками: остаток веса, размазанный по свободному времени
    const background = Math.max(0, 1 - peakWeight);
    const daySeconds = (SIM.dayEnd - SIM.dayStart) * 3600;
    const quiet = Math.max(1, daySeconds - peakSeconds);

    return (trips * background) / quiet;
  }

  /** Куда едет человек из холла — по floorDistribution из tech-model. */
  #pickDestination() {
    const entries = Object.entries(SIM.floorDistribution)
      .map(([floor, p]) => ({ floor: Number(floor), p }))
      .filter((x) => x.floor !== 1);

    const total = entries.reduce((s, x) => s + x.p, 0);
    let roll = this.rng() * total;

    for (const entry of entries) {
      roll -= entry.p;
      if (roll <= 0) return entry.floor;
    }

    return entries[entries.length - 1].floor;
  }

  // ======================= Шаг =======================

  update(dt) {
    this.time += dt;

    this.#spawn(dt);
    this.#stepPeople(dt);
    for (const agent of this.agents) agent.update(dt);
    this.#stepBoards();
    this.#collectStats(dt);

    this.crowd.update(dt);
  }

  beginStep() {
    this.crowd.beginStep();
  }

  render(alpha, dt) {
    this.crowd.render(alpha, this.app.camera, dt);
  }

  #spawn(dt) {
    const hours = (this.time / 3600) % 24;

    // ---- холл ----
    this.lobbyDebt += this.#lobbyRate(hours) * dt;
    while (this.lobbyDebt >= 1) {
      this.lobbyDebt -= 1;
      this.#spawnLobby();
    }

    // ---- верхние этажи ----
    this.upperDebt += this.#upperRate(hours) * dt;
    while (this.upperDebt >= 1) {
      this.upperDebt -= 1;
      this.#spawnUpper();
    }
  }

  /** Человек вошёл в корпус и идёт к лифтам. */
  #spawnLobby() {
    if (!this.working.length) return;

    // Люди встают к лифту с самой короткой очередью — так и в жизни
    let best = this.working[0];
    for (const lift of this.working) {
      if (this.queues.get(lift.number).length < this.queues.get(best.number).length) best = lift;
    }

    const queue = this.queues.get(best.number);
    const index = queue.length;

    const person = {
      id: ++personSeq,
      from: 1,
      to: this.#pickDestination(),
      lift: best,
      state: 'walkIn',
      waitStart: this.time,
      body: null,
      slot: index
    };

    // Тело выдаём только тем, кто помещается в видимую раскладку
    if (index < VISIBLE_SLOTS) {
      person.body = this.crowd.spawn(ENTRANCE.x, 0, ENTRANCE.z, ENTRANCE_IN);
    }
    if (!person.body) this.stats.offscreen += 1;

    queue.add(person);
    this.people.push(person);

    if (person.body) {
      const slot = hallSlot(best.number, index);
      const door = doorFacing(best.number);
      person.body.walkPath(
        [{ x: ENTRANCE_IN.x, z: ENTRANCE_IN.z }, { x: slot.x, z: slot.z }],
        () => { person.state = 'wait'; person.body.faceTo(door.x, door.z); }
      );
    } else {
      person.state = 'wait';
    }
  }

  /** Человек вызвал лифт на верхнем этаже — ему вниз. */
  #spawnUpper() {
    const floor = this.#pickDestination();   // то же распределение этажей
    if (floor === 1) return;

    const list = this.upperWaiting.get(floor) || [];
    const number = this.working[Math.floor(this.rng() * this.working.length)].number;

    const person = {
      id: ++personSeq,
      from: floor,
      to: 1,
      lift: null,
      state: 'waitUpper',
      waitStart: this.time,
      body: null,
      floor
    };

    const index = list.length;
    if (index < LANDING_SLOTS) {
      const slot = landingSlot(number, index);
      person.body = this.crowd.spawn(
        slot.x, floorY(floor), slot.z, doorFacing(number)
      );
    }
    if (!person.body) this.stats.offscreen += 1;

    list.push(person);
    this.upperWaiting.set(floor, list);
    this.people.push(person);
  }

  #stepPeople() {   // dt не нужен: очередь переставляется по событиям
    // Очередь подтягивается вперёд, когда передние уезжают
    for (const lift of this.working) {
      const queue = this.queues.get(lift.number);

      for (let i = 0; i < queue.people.length; i += 1) {
        const person = queue.people[i];
        if (person.state !== 'wait' && person.state !== 'walkIn') continue;

        if (person.slot !== i) {
          person.slot = i;
          if (person.body && person.state === 'wait') {
            const slot = hallSlot(lift.number, i);
            const door = doorFacing(lift.number);
            person.body.moveTo(slot.x, slot.z, () => {
              person.body.faceTo(door.x, door.z);
            });
          }
        }
      }

      // Терпение кончилось — на лестницу
      for (let i = queue.people.length - 1; i >= 0; i -= 1) {
        const person = queue.people[i];
        if (person.state !== 'wait') continue;
        if (this.time - person.waitStart < SIM.patienceSeconds) continue;

        queue.remove(person);
        person.state = 'leave';
        this.stats.toStairs += 1;

        if (person.body) {
          person.body.walkPath(
            [{ x: STAIRS_IN.x, z: STAIRS_IN.z }, { x: STAIRS.x, z: STAIRS.z }],
            () => this.crowd.release(person.body)
          );
        } else {
          person.state = 'done';
        }
      }
    }
  }

  /** Табло «Ждут», тепловая карта пола и счётчик в кабине. */
  #stepBoards() {
    for (const lift of this.elevators) {
      const queue = this.queues.get(lift.number);
      lift.queue = queue ? queue.length : 0;
      this.hall.setHeat(lift.number, lift.queue);
    }
  }

  #collectStats(dt) {
    let inHall = 0;
    let inLifts = 0;

    for (const person of this.people) {
      if (person.state === 'wait' || person.state === 'walkIn') inHall += 1;
      if (person.state === 'ride') inLifts += 1;
    }

    this.stats.inHall = inHall;
    this.stats.inLifts = inLifts;
    this.stats.maxQueue = Math.max(this.stats.maxQueue, inHall);
    this.stats.avgWait = this.stats.waitCount
      ? this.stats.waitSum / this.stats.waitCount
      : 0;

    // Убираем из списка тех, кто окончательно ушёл
    if (this.people.length > 400) {
      this.people = this.people.filter((p) => p.state !== 'done');
    }

    // Точка для графиков раз в модельную минуту
    this.historyTick += dt;
    if (this.historyTick >= 60) {
      this.historyTick = 0;
      const load = this.working.length
        ? this.working.reduce((s, l) => s + l.occupancy, 0) / this.working.length
        : 0;

      this.history.push({
        label: this.clockLabel,
        queue: inHall,
        load: Number(load.toFixed(2))
      });

      if (this.history.length > 120) this.history.shift();
    }
  }

  /** Засчитать завершённое ожидание. */
  noteWait(person) {
    this.stats.waitSum += this.time - person.waitStart;
    this.stats.waitCount += 1;
  }
}

// ======================= Контроллер одного лифта =======================

/**
 * Решает, куда ехать и кого пускать.
 *
 * Логика намеренно простая — собирательное управление без оптимизации
 * маршрутов: взять очередь внизу, развезти по этажам, по пути забрать
 * тех, кого стоит забрать, вернуться. Интересное место здесь одно:
 * решение «остановиться или проехать» на попутном этаже, и оно берётся
 * из той же модели, что и расчёты в tech-model.
 */
class LiftAgent {
  constructor(lift, sim) {
    this.lift = lift;
    this.sim = sim;
    this.reset();
  }

  reset() {
    this.onboard = [];
    this.phase = 'idle';       // idle | alighting | boarding
    this.transfer = [];        // кто сейчас заходит или выходит
    this.transferTimer = 0;
    this.nextTransfer = 0;
    this.direction = 1;          // куда кабина идёт сейчас: вверх
    this.lastStopFloor = null;   // где створки уже открывались в этот приезд
    this.lift.lastDecision = 'stop';
  }

  get capacity() { return DISPATCH.capacity; }

  update(dt) {
    const lift = this.lift;
    lift.occupancy = this.onboard.length;

    if (this.phase === 'alighting' || this.phase === 'boarding') {
      this.#stepTransfer(dt);
      return;
    }

    if (lift.busy) return;      // едет или двигает створками

    // Приехали — сперва выпускаем
    if (this.onboard.some((p) => p.to === lift.floor)) {
      if (this.#open()) this.#beginAlighting();
      return;
    }

    // Сажаем тех, кого можем взять на этом этаже
    const boardable = this.#boardableHere();
    if (this.#shouldOpenFor(boardable.length)) {
      if (this.#open()) this.#beginBoarding(boardable, lift.floor);
      return;
    }

    const next = this.#chooseNextFloor();
    if (next !== null && next !== lift.floor && lift.moveTo(next)) {
      // Уехали — на новом этаже створки открывать снова можно
      this.lastStopFloor = null;
    }
  }

  /**
   * Кого можно посадить на текущем этаже.
   *
   * Направление не спрашиваем. В корпусе 7 на этаже одна кнопка вызова
   * без стрелок — лифт приезжает на любой вызов, и кто успел, тот и зашёл,
   * даже если ему потом ехать в другую сторону. Именно из этого и растёт
   * задача проекта: кабина набивается до отказа и дальше возит сама себя.
   */
  #boardableHere() {
    const lift = this.lift;

    if (lift.floor === 1) return this.sim.queues.get(lift.number).people;
    return this.sim.upperWaiting.get(lift.floor) || [];
  }

  /**
   * Открывать ли створки на вызов с этого этажа.
   *
   * С технической частью — только если есть куда посадить: камера уже
   * показала, что мест нет, и тормозить незачем. Без неё лифт тормозит
   * на каждый вызов, и у полной кабины цикл дверей уходит впустую —
   * семь секунд для всех, кто внутри, и для всех, кто ждёт выше.
   */
  #shouldOpenFor(waiting) {
    if (!waiting) return false;

    // На этом этаже створки уже открывались в этот приезд. Второй раз
    // подряд лифт их не открывает — он уезжает, а вызов остаётся гореть
    // и достаётся следующей кабине. Без этого полный лифт с невлезшей
    // очередью перед носом открывался бы до конца дня.
    if (this.lastStopFloor === this.lift.floor) return false;

    if (this.onboard.length < this.capacity) return true;
    return !this.sim.systemOn;
  }

  /** Открыть створки и засчитать остановку. */
  #open() {
    if (!this.lift.openDoors()) return false;
    this.sim.stats.stops += 1;
    return true;
  }

  // ---------- выбор следующего этажа ----------

  /**
   * Куда ехать дальше — собирательное управление (алгоритм SCAN).
   *
   * Так ездят настоящие лифты: кабина идёт в одну сторону, обслуживая
   * всё по пути, и разворачивается, только когда впереди не осталось
   * ни высадки, ни вызова. Нельзя, набрав полную кабину, вернуться
   * вниз за новым вызовом — те, кто внутри, никуда не приедут.
   *
   * Сканируя этажи по ходу движения, кабина на каждом спрашивает:
   *   • этаж заказан кем-то из пассажиров — останавливаемся всегда;
   *   • на этаже ждут — решает техническая часть. Если она выключена,
   *     останавливаемся тоже всегда, и дальше считайте сами, сколько
   *     раз двери откроются впустую.
   *
   * Это та же последовательность, по которой считает рейс
   * tech-model/06-simulation.js, — поэтому картинка на экране и числа
   * в отчёте описывают одно и то же движение.
   */
  #chooseNextFloor() {
    const lift = this.lift;

    const drops = new Set(this.onboard.map((p) => p.to));
    const calls = this.#callFloors();

    let dir = this.direction || 1;

    // Два захода: по ходу движения, потом в обратную сторону
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const last = this.#furthestAhead(drops, calls, dir);

      if (last !== null) {
        for (
          let floor = lift.floor + dir;
          dir > 0 ? floor <= last : floor >= last;
          floor += dir
        ) {
          // За своими пассажирами едем всегда
          if (drops.has(floor)) {
            this.direction = dir;
            return floor;
          }

          if (!calls.has(floor)) continue;

          // Без технической части решение не принимается вовсе
          if (!this.sim.systemOn) {
            this.direction = dir;
            return floor;
          }

          const verdict = decideCall(lift, this.sim.rng);

          if (verdict.action === 'stop') {
            this.direction = dir;
            return floor;
          }

          // Проезжаем мимо: над дверью этого этажа загорается «Пропущено»
          lift.flashSkip(floor);
          this.sim.stats.passes += 1;
          if (verdict.wrongPass) this.sim.stats.wrongPasses += 1;
        }
      }

      dir = -dir;
    }

    // Делать нечего — возвращаемся вниз, там всегда кто-то появится
    this.direction = -1;
    return lift.floor === 1 ? null : 1;
  }

  /**
   * Этажи, с которых поступил вызов.
   *
   * Кнопка на этаже одна и без стрелки, поэтому вызов не делится на
   * «вверх» и «вниз»: кабина, идущая мимо, считается подходящей. Так
   * устроена собирательная система управления в корпусе 7 — и так же
   * считает рейс tech-model/06.
   */
  #callFloors() {
    const calls = new Set();

    if (this.sim.queues.get(this.lift.number).length) calls.add(1);
    for (const [floor, list] of this.sim.upperWaiting) {
      if (list.length) calls.add(floor);
    }

    return calls;
  }

  /** Самая дальняя цель по ходу движения; null — впереди пусто. */
  #furthestAhead(drops, calls, dir) {
    let best = null;

    for (const floor of [...drops, ...calls]) {
      if ((floor - this.lift.floor) * dir <= 0) continue;
      if (best === null || (floor - best) * dir > 0) best = floor;
    }

    return best;
  }

  // ---------- посадка и высадка ----------

  #beginAlighting() {
    this.phase = 'alighting';
    this.transfer = this.onboard.filter((p) => p.to === this.lift.floor);
    this.transferTimer = 0;
    this.nextTransfer = 0;
    this.queueIndex = 0;
  }

  #beginBoarding(source, floor) {
    const free = this.capacity - this.onboard.length;
    const ready = source.filter((p) => p.state === 'wait' || p.state === 'waitUpper');

    // Створки открылись, а войти некому: та самая бесполезная остановка,
    // от которой избавляет техническая часть.
    if (free <= 0 && ready.length) this.sim.stats.uselessStops += 1;

    this.phase = 'boarding';
    this.boardFloor = floor;
    this.transfer = ready.slice(0, Math.max(0, free));
    this.transferTimer = 0;
    this.nextTransfer = 0;
    this.queueIndex = 0;

    for (const person of this.transfer) person.state = 'boarding';
  }

  /**
   * Люди входят и выходят по одному: каждые boardingTimePerPerson секунд
   * трогается следующий. Так створки стоят открытыми ровно столько,
   * сколько длится посадка, — как и считает tech-model/04.
   */
  #stepTransfer(dt) {
    const lift = this.lift;
    this.transferTimer += dt;

    // Пока кто-то движется, створки держим открытыми
    lift.keepOpen();

    while (
      this.queueIndex < this.transfer.length &&
      this.transferTimer >= this.nextTransfer
    ) {
      const person = this.transfer[this.queueIndex];
      this.queueIndex += 1;
      this.nextTransfer += ELEVATORS.boardingTimePerPerson;

      if (this.phase === 'boarding') this.#sendIn(person);
      else this.#sendOut(person);
    }

    const done = this.queueIndex >= this.transfer.length &&
      this.transfer.every((p) => p.state !== 'boarding' && p.state !== 'alighting');

    if (done) {
      this.phase = 'idle';
      this.transfer = [];
      this.lastStopFloor = lift.floor;
      lift.closeDoors();
    }
  }

  #sendIn(person) {
    const lift = this.lift;
    const slotIndex = this.onboard.length;
    const slot = cabinSlot(slotIndex, this.capacity);

    // Из очереди человек выбывает сразу: место за ним не держат
    if (this.boardFloor === 1) {
      this.sim.queues.get(lift.number).remove(person);
    } else {
      const list = this.sim.upperWaiting.get(this.boardFloor);
      if (list) list.splice(list.indexOf(person), 1);
    }

    this.onboard.push(person);
    person.lift = lift;
    this.sim.noteWait(person);
    this.sim.stats.served += 1;

    if (!person.body) {
      person.state = 'ride';
      return;
    }

    const doorway = doorwaySlot(lift.number);
    // Место в кабине задано в её координатах; лифт переводит его в холл
    const seat = lift.toWorld(slot.x, lift.cabin.position.z + slot.z);

    person.body.walkPath(
      [
        { x: doorway.x, z: doorway.z },
        { x: seat.x, z: seat.z }
      ],
      () => {
        person.state = 'ride';
        person.body.attachTo(lift.cabin, { x: slot.x, y: 0, z: slot.z });
      }
    );
    person.state = 'boarding';
  }

  #sendOut(person) {
    const lift = this.lift;
    const index = this.onboard.indexOf(person);
    if (index >= 0) this.onboard.splice(index, 1);

    if (!person.body) {
      person.state = 'done';
      return;
    }

    person.state = 'alighting';

    // Возвращаем человека в мировые координаты ровно там, где он стоял
    const world = person.body.root.getWorldPosition(new THREE.Vector3());
    person.body.detachTo(this.sim.scene, world);

    if (lift.floor === 1) {
      // Внизу — через коридор на выход из корпуса
      const out = frontOf(lift.number, 1.3);

      person.body.walkPath(
        [
          { x: out.x, y: 0, z: out.z },
          { x: ENTRANCE_IN.x, y: 0, z: ENTRANCE_IN.z },
          { x: ENTRANCE.x, y: 0, z: ENTRANCE.z }
        ],
        () => { person.state = 'done'; this.sim.crowd.release(person.body); }
      );
    } else {
      // Наверху — на площадку перед дверью и дальше по коридору этажа
      const y = floorY(lift.floor);
      const away = person.id % 2 === 0 ? 1 : -1;
      const step = frontOf(lift.number, 1.0);
      const exit = frontOf(lift.number, 0.8, away * 3.2);

      person.body.walkPath(
        [
          { x: step.x, y, z: step.z },
          { x: exit.x, y, z: exit.z }
        ],
        () => { person.state = 'done'; this.sim.crowd.release(person.body); }
      );
    }
  }
}

export { LiftAgent };
