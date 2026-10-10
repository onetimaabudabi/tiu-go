/**
 * Здание: шестнадцать этажей, перекрытия, внешняя оболочка.
 *
 * Перекрытия почти прозрачные — иначе в режиме «разрез здания» не видно,
 * как едут кабины. Непрозрачной остаётся только площадка перед лифтами:
 * на ней стоят и ходят вышедшие пассажиры, и без твёрдого пола они
 * выглядели бы висящими в воздухе.
 *
 * Шахты строит elevator.js: перекрытие их намеренно не перекрывает —
 * в реальном здании шахта идёт насквозь.
 */

import * as THREE from 'three';
import { BUILDING, HALL, PALETTE, floorY } from '../logic/params.js';
import { signTexture } from './textures.js';

export class Building {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'building';
    scene.add(this.group);

    // Плита перекрытия занимает только «жилую» часть этажа: от стены
    // с лифтами до фасада.
    this.slabZ0 = HALL.liftWall;
    this.slabZ1 = HALL.depth / 2;
    this.slabDepth = this.slabZ1 - this.slabZ0;
    this.slabCenterZ = (this.slabZ0 + this.slabZ1) / 2;

    this.#slabs();
    this.#shell();
    this.#floorLabels();
    this.#ground();
  }

  /** Координата Z, на которую выходит пассажир на верхнем этаже. */
  landingZ() {
    return HALL.liftWall + HALL.landingDepth * 0.55;
  }

  #slabs() {
    const slabGeo = new THREE.BoxGeometry(HALL.width, 0.14, this.slabDepth);
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x9fb0bb,
      transparent: true,
      opacity: 0.07,
      roughness: 0.9,
      metalness: 0.0,
      depthWrite: false
    });

    const landingGeo = new THREE.BoxGeometry(HALL.width, 0.06, HALL.landingDepth);
    const landingMat = new THREE.MeshStandardMaterial({
      color: 0xb4b0a8,
      transparent: true,
      opacity: 0.82,
      roughness: 0.85,
      metalness: 0.04
    });

    const beamGeo = new THREE.BoxGeometry(HALL.width + 0.1, 0.1, 0.1);
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x7d8991, roughness: 0.8, metalness: 0.2,
      transparent: true, opacity: 0.45
    });

    // Храним по этажам, чтобы режим «разрез» мог их отключать
    this.landings = [];
    this.levels = new Map();

    for (let f = 2; f <= BUILDING.floors; f += 1) {
      const y = floorY(f);

      const slab = new THREE.Mesh(slabGeo, slabMat);
      slab.position.set(0, y - 0.07, this.slabCenterZ);
      this.group.add(slab);

      const landing = new THREE.Mesh(landingGeo, landingMat);
      landing.position.set(0, y - 0.03, HALL.liftWall + HALL.landingDepth / 2);
      landing.receiveShadow = true;
      this.group.add(landing);
      this.landings.push(landing);

      // Балка по фасаду — читаемая граница этажа
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(0, y - 0.05, this.slabZ1);
      this.group.add(beam);

      this.levels.set(f, { slab, landing, beam });
    }

    this.cutawayFloor = BUILDING.floors;

    // Кровля
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(HALL.width + 0.3, 0.2, this.slabDepth + HALL.shaftDepth + 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x6d7378, roughness: 0.9, metalness: 0.1,
        transparent: true, opacity: 0.5
      })
    );
    roof.position.set(0, BUILDING.height + 0.6, (this.slabZ1 + HALL.liftWall - HALL.shaftDepth) / 2);
    this.roof = roof;
    this.group.add(roof);
  }

  /** Внешняя оболочка — почти невидимая, только чтобы читался объём. */
  #shell() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9ec0d4,
      transparent: true,
      opacity: 0.05,
      roughness: 0.2,
      metalness: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const height = BUILDING.height - HALL.height;
    const yCenter = HALL.height + height / 2;
    const depth = this.slabZ1 - (HALL.liftWall - HALL.shaftDepth);
    const zCenter = (this.slabZ1 + HALL.liftWall - HALL.shaftDepth) / 2;

    // Фасад
    const front = new THREE.Mesh(new THREE.PlaneGeometry(HALL.width, height), mat);
    front.position.set(0, yCenter, this.slabZ1);
    this.group.add(front);

    // Боковые стены
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), mat);
      wall.rotation.y = side * Math.PI / 2;
      wall.position.set(side * HALL.width / 2, yCenter, zCenter);
      this.group.add(wall);
    }

    // Задняя стена
    const back = new THREE.Mesh(new THREE.PlaneGeometry(HALL.width, height), mat);
    back.position.set(0, yCenter, HALL.liftWall - HALL.shaftDepth);
    this.group.add(back);
  }

  /** Номера этажей на торце — ориентир в режиме разреза. */
  #floorLabels() {
    const geo = new THREE.PlaneGeometry(0.72, 0.46);

    for (let f = 1; f <= BUILDING.floors; f += 1) {
      const accent = f === BUILDING.cafeteriaFloor;
      const label = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: signTexture(String(f), {
          width: 192, height: 128,
          bg: accent ? '#4a3a12' : '#1a1d21',
          fg: accent ? '#ffd166' : '#aeb7bf',
          font: 'bold 84px system-ui, sans-serif',
          cacheKey: `sign:floor:${f}:${accent}`
        }),
        toneMapped: false,
        transparent: true
      }));

      label.rotation.y = Math.PI / 2;
      label.position.set(-HALL.width / 2 - 0.08, floorY(f) + 1.1, HALL.liftWall + 0.9);
      this.group.add(label);
    }
  }

  /** Земля вокруг здания — чтобы тени было на что ложиться. */
  #ground() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 48),
      new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 1.0, metalness: 0.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /**
   * Срез по этажу: всё выше указанного этажа скрывается.
   *
   * Нужен виду «Сверху». Перекрытия полупрозрачные по отдельности, но
   * пятнадцать штук друг за другом дают сплошную белую пелену, и холл
   * сверху не читается вовсе.
   */
  setCutawayFloor(floor) {
    if (this.cutawayFloor === floor) return;
    this.cutawayFloor = floor;

    for (const [f, level] of this.levels) {
      const visible = f <= floor;
      level.slab.visible = visible;
      level.landing.visible = visible;
      level.beam.visible = visible;
    }
  }

  /** Прячет кровлю, когда камера поднялась выше здания. */
  setRoofVisible(visible) {
    if (this.roofVisible === visible) return;
    this.roofVisible = visible;
    this.roof.visible = visible;
  }

  /** Полный вид здания — отмена среза. */
  showAllFloors() {
    this.setCutawayFloor(BUILDING.floors);
  }
}
