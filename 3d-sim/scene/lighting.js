/**
 * Освещение сцены.
 *
 * Три слоя: общий тёплый ambient, «солнце» из окон холла и точечные
 * источники — по одному в каждой кабине и над каждой лифтовой дверью.
 * Тени мягкие (PCFSoftShadowMap настраивается в main.js), камера теней
 * ужата до холла — там всё действие, а тянуть её на 48 метров незачем.
 */

import * as THREE from 'three';
import { HALL, PALETTE, LIGHT, ELEVATORS, liftX } from '../logic/params.js';

export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'lighting';
    scene.add(this.group);

    this.hallLights = [];
    this.shadowsEnabled = true;

    this.#ambient();
    this.#sun();
    this.#hall();
  }

  /** Общий тёплый свет — чтобы тени не проваливались в чёрное. */
  #ambient() {
    this.ambient = new THREE.AmbientLight(PALETTE.ambient, LIGHT.ambientIntensity);
    this.group.add(this.ambient);

    // Лёгкая подсветка снизу: пол отражает свет, иначе ноги выглядят оторванными.
    this.bounce = new THREE.HemisphereLight(0xffffff, PALETTE.hallFloorA, 0.25);
    this.group.add(this.bounce);
  }

  /** Направленный свет — имитация солнца через витражи холла. */
  #sun() {
    const sun = new THREE.DirectionalLight(PALETTE.sun, LIGHT.sunIntensity);
    sun.position.set(14, 18, 12);
    sun.target.position.set(0, 1, -2);
    sun.castShadow = true;

    const d = Math.max(HALL.width, HALL.depth) * 0.8;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;

    this.sun = sun;
    this.group.add(sun);
    this.group.add(sun.target);
  }

  /** Точечный свет над каждой лифтовой дверью в холле. */
  #hall() {
    for (let i = 1; i <= ELEVATORS.total; i += 1) {
      const light = new THREE.PointLight(
        PALETTE.cabinLight, LIGHT.hallSpotIntensity, 7, 2
      );
      light.position.set(liftX(i), HALL.height - 0.25, HALL.liftWall + 1.1);

      this.hallLights.push({ light, working: ELEVATORS.working.includes(i) });
      this.group.add(light);
    }

    // Заполняющий свет в центре холла, чтобы середина не проваливалась.
    this.fill = new THREE.PointLight(0xffffff, 0.35, 18, 2);
    this.fill.position.set(0, HALL.height - 0.4, 1);
    this.group.add(this.fill);
  }

  /** Отключение теней — часть снижения качества при падении FPS. */
  setShadows(enabled) {
    if (this.shadowsEnabled === enabled) return;
    this.shadowsEnabled = enabled;
    this.sun.castShadow = enabled;
    // Компенсируем потерю контраста: без теней сцена выглядит плоской.
    this.ambient.intensity = enabled ? LIGHT.ambientIntensity : LIGHT.ambientIntensity * 1.15;
  }

  /**
   * Сколько точечных источников оставить.
   *
   * Три.js считает каждый источник для каждого пикселя, поэтому на
   * встроенной графике шесть ламп холла плюс лампы кабин — это заметная
   * часть кадра. Уровни: 2 — все лампы, 1 — только над рабочими лифтами,
   * 0 — лампы холла выключены, остаются кабины и общий свет.
   */
  setQuality(level) {
    if (this.quality === level) return;
    this.quality = level;

    for (const entry of this.hallLights) {
      entry.light.visible = level >= 2 || (level === 1 && entry.working);
    }

    this.fill.visible = level >= 1;

    // Чем меньше ламп, тем выше общий свет — иначе холл проваливается
    this.ambient.intensity = LIGHT.ambientIntensity * (level >= 2 ? 1 : level === 1 ? 1.2 : 1.5);
    this.bounce.intensity = level >= 1 ? 0.25 : 0.4;
  }
}
