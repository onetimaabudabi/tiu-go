/**
 * Здание: шестнадцать этажей, перекрытия, внешняя оболочка.
 *
 * Ядро здания — лифтовой коридор с двумя группами шахт по бокам.
 * Перекрытия почти прозрачные: иначе в режиме «разрез здания» не видно,
 * как едут кабины. Непрозрачными остаются только полосы перед дверями
 * обеих групп: на них стоят и ходят вышедшие пассажиры, и без твёрдого
 * пола они выглядели бы висящими в воздухе.
 *
 * Шахты строит elevator.js: перекрытие их намеренно не перекрывает —
 * в реальном здании шахта идёт насквозь.
 */

import * as THREE from 'three';
import { BUILDING, HALL, floorY } from '../logic/params.js';
import { signTexture } from './textures.js';

// Глубина полосы перед дверями, по которой ходят люди
const LANDING_DEPTH = 1.4;

export class Building {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'building';
    scene.add(this.group);

    // Габариты ядра: коридор плюс обе шахтовые стенки
    this.coreLength = HALL.length;
    this.coreSpan = HALL.span;

    this.#slabs();
    this.#shell();
    this.#floorLabels();
    this.#ground();
  }

  /** Координата Z, на которую выходит пассажир лифта на верхнем этаже. */
  landingDistance() {
    return LANDING_DEPTH * 0.6;
  }

  #slabs() {
    // Плита коридора: по ней видно уровень этажа, но она не загораживает
    // шахты в разрезе.
    const slabGeo = new THREE.BoxGeometry(this.coreLength, 0.14, HALL.corridor);
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x9fb0bb,
      transparent: true,
      opacity: 0.07,
      roughness: 0.9,
      metalness: 0.0,
      depthWrite: false
    });

    const landingGeo = new THREE.BoxGeometry(this.coreLength, 0.06, LANDING_DEPTH);
    const landingMat = new THREE.MeshStandardMaterial({
      color: 0xb4b0a8,
      transparent: true,
      opacity: 0.82,
      roughness: 0.85,
      metalness: 0.04
    });

    const beamGeo = new THREE.BoxGeometry(this.coreLength + 0.1, 0.1, 0.1);
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x7d8991, roughness: 0.8, metalness: 0.2,
      transparent: true, opacity: 0.45
    });

    // Храним по этажам, чтобы режим «разрез» мог их отключать
    this.landings = [];
    this.levels = new Map();

    for (let f = 2; f <= BUILDING.floors; f += 1) {
      const y = floorY(f);
      const parts = [];

      const slab = new THREE.Mesh(slabGeo, slabMat);
      slab.position.set(0, y - 0.07, 0);
      this.group.add(slab);
      parts.push(slab);

      // По полосе перед каждой группой дверей ходят люди
      for (const side of [-1, 1]) {
        const landing = new THREE.Mesh(landingGeo, landingMat);
        landing.position.set(
          0, y - 0.03,
          side * (HALL.doorPlane - LANDING_DEPTH / 2)
        );
        landing.receiveShadow = true;
        this.group.add(landing);
        this.landings.push(landing);
        parts.push(landing);

        // Балка по фасаду — читаемая граница этажа
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(0, y - 0.05, side * this.coreSpan / 2);
        this.group.add(beam);
        parts.push(beam);
      }

      this.levels.set(f, parts);
    }

    this.cutawayFloor = BUILDING.floors;

    // Кровля
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(this.coreLength + 0.3, 0.2, this.coreSpan + 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x6d7378, roughness: 0.9, metalness: 0.1,
        transparent: true, opacity: 0.5
      })
    );
    roof.position.set(0, BUILDING.height + 0.6, 0);
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

    // Длинные стены — за шахтами
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(this.coreLength, height), mat);
      wall.position.set(0, yCenter, side * this.coreSpan / 2);
      this.group.add(wall);
    }

    // Торцы
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(this.coreSpan, height), mat);
      wall.rotation.y = side * Math.PI / 2;
      wall.position.set(side * this.coreLength / 2, yCenter, 0);
      this.group.add(wall);
    }
  }

  /** Номера этажей на фасаде — ориентир в режиме разреза. */
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

      label.position.set(
        -this.coreLength / 2 + 0.6, floorY(f) + 1.1,
        this.coreSpan / 2 + 0.08
      );
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

    for (const [f, parts] of this.levels) {
      const visible = f <= floor;
      for (const part of parts) part.visible = visible;
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
