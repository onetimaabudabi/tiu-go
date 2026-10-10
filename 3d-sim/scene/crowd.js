/**
 * Толпа: пул тел, бюджет теней, обновление и отрисовка всех людей.
 *
 * Тел в сцене не больше SIM.maxVisiblePeople. Это не ограничение модели:
 * симулятор знает про всех, просто тем, кому тела не хватило, его
 * не выдают — они всё равно стоят в очереди, ждут, садятся и попадают
 * в статистику. Так картинка остаётся плавной на длинных пиках.
 *
 * Тело выдаётся только в момент появления человека у входа. Выдавать
 * его позже, посреди очереди, нельзя: человек бы вспыхнул из воздуха.
 */

import * as THREE from 'three';
import { Person } from './person.js';
import { SIM, PERF } from '../logic/params.js';

export class Crowd {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;        // null → запасные человечки
    this.people = [];
    this.rankTick = 0;

    // Бюджеты ставит logic/quality.js — он же меняет их на ходу
    const start = PERF.levels[PERF.startLevel];
    this.fullDetailBudget = start.fullDetail;
    this.lodDistance = start.lodDistance;
    this.shadowBudget = start.shadowCasters;
  }

  /** Новые бюджеты детализации. */
  setBudget(fullDetail, lodDistance, shadowCasters) {
    this.fullDetailBudget = fullDetail;
    this.lodDistance = lodDistance;
    this.shadowBudget = shadowCasters;
    this.rankTick = 1;          // пересортировать на ближайшем кадре
  }

  get count() { return this.people.length; }
  get full() { return this.people.length >= SIM.maxVisiblePeople; }

  /**
   * Выдаёт тело, если лимит не исчерпан.
   * @returns {Person|null}
   */
  spawn(x, y, z, facing) {
    if (this.full) return null;

    const person = new Person(this.assets);
    person.placeAt(x, y, z);
    if (facing) person.faceTo(facing.x, facing.z);

    this.scene.add(person.root);
    this.people.push(person);
    return person;
  }

  /** Человек уходит из сцены: плавно гаснет и потом убирается. */
  release(person) {
    if (!person) return;
    person.fadeOut();
  }

  /** Немедленно убрать всех — кнопка «Сброс». */
  clear() {
    for (const person of this.people) person.dispose();
    this.people.length = 0;
  }

  beginStep() {
    for (const person of this.people) person.beginStep();
  }

  update(dt) {
    for (let i = this.people.length - 1; i >= 0; i -= 1) {
      const person = this.people[i];
      person.update(dt);

      if (person.dead) {
        person.dispose();
        this.people.splice(i, 1);
      }
    }
  }

  render(alpha, camera, dt) {
    const cameraPosition = camera.position;

    for (const person of this.people) person.render(alpha, cameraPosition);

    // Ранжирование по дальности — не каждый кадр: сортировка семидесяти
    // человек каждые 16 мс не стоит своей точности, а расстояния
    // меняются медленно.
    this.rankTick += dt;
    if (this.rankTick >= 0.35) {
      this.rankTick = 0;
      this.#rank(cameraPosition);
    }
  }

  /**
   * Раздаёт полную детализацию и тени ближайшим.
   *
   * Полная модель Mixamo — 35 тысяч треугольников, упрощённая — около
   * четырёхсот. Поэтому решает не только расстояние, но и бюджет: даже
   * если вся толпа стоит в двух метрах, целиком показываем столько
   * человек, сколько машина тянет. Остальные — силуэты, и на общем плане
   * разницы не видно.
   */
  #rank(cameraPosition) {
    if (!this.people.length) return;

    const sorted = this.people
      .map((p) => ({ p, d: p.worldPosition(_v).distanceTo(cameraPosition) }))
      .sort((a, b) => a.d - b.d);

    for (let i = 0; i < sorted.length; i += 1) {
      const { p, d } = sorted[i];
      const full = i < this.fullDetailBudget && d <= this.lodDistance;

      p.setFar(!full);
      p.setShadow(full && i < this.shadowBudget);
    }
  }
}

const _v = new THREE.Vector3();
