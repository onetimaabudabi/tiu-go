/**
 * Лифтовой холл первого этажа: пол, стены с проёмами, потолок, зоны ожидания.
 *
 * Планировка — как в корпусе 7: не зал с лифтами по одной стене, а коридор,
 * в котором шахты стоят друг против друга, по три с каждой стороны. Вход
 * с торца: входящий видит сразу обе группы, слева 1-2-3, справа 4-5-6.
 *
 * Шесть лифтовых порталов строит elevator.js — здесь только стены,
 * в которых для них вырезаны проёмы, и всё остальное помещение.
 * Зоны ожидания умеют менять цвет: это тепловая карта плотности.
 */

import * as THREE from 'three';
import {
  BUILDING, ELEVATORS, BANKS, HALL, PALETTE, liftAnchor
} from '../logic/params.js';
import { tileTexture, wallTexture, signTexture } from './textures.js';

const DOOR_HEIGHT = 2.1;
const DOOR_WIDTH = ELEVATORS.doorWidth;

/** Прямоугольная рамка для Shape. */
function rect(shape, x0, y0, x1, y1) {
  shape.moveTo(x0, y0);
  shape.lineTo(x1, y0);
  shape.lineTo(x1, y1);
  shape.lineTo(x0, y1);
  shape.lineTo(x0, y0);
}

/** Прямоугольное отверстие в стене. */
function hole(x0, y0, x1, y1) {
  const path = new THREE.Path();
  rect(path, x0, y0, x1, y1);
  return path;
}

export class Hall {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'hall';
    scene.add(this.group);

    // Зоны ожидания по номеру лифта
    this.waitZones = new Map();

    this.#floor();
    this.#porch();
    this.#stairLanding();
    this.#walls();
    this.#ceiling();
    this.#waitZonesBuild();
    this.#signs();
  }

  /** Пол коридора в плитку 0.6 × 0.6 м. */
  #floor() {
    const repeatX = HALL.length / HALL.tile;
    const repeatZ = HALL.corridor / HALL.tile;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL.length, HALL.corridor),
      new THREE.MeshStandardMaterial({
        map: tileTexture(PALETTE.hallFloorA, PALETTE.hallFloorB, repeatX, repeatZ),
        roughness: 0.75,
        metalness: 0.05
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.floorMesh = mesh;
    this.group.add(mesh);
  }

  /**
   * Крыльцо перед входом.
   *
   * Люди появляются и исчезают за проёмом, то есть снаружи холла.
   * Без площадки они возникали бы прямо на голой земле — вместо входа
   * в корпус получался бы выход в пустоту.
   */
  #porch() {
    const depth = 3.2;
    const x0 = HALL.entranceX;
    const width = HALL.corridor + 1.6;

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(depth, 0.12, width),
      new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.95, metalness: 0.02 })
    );
    slab.position.set(x0 + depth / 2, -0.06, 0);
    slab.receiveShadow = true;
    this.group.add(slab);

    // Козырёк над входом
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(depth * 0.8, 0.12, HALL.entranceWidth + 1.2),
      new THREE.MeshStandardMaterial({
        color: 0x5f666c, roughness: 0.6, metalness: 0.35
      })
    );
    canopy.position.set(x0 + depth * 0.4, HALL.height - 0.15, 0);
    canopy.castShadow = true;
    this.group.add(canopy);

    for (const dz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, HALL.height - 0.15, 10),
        new THREE.MeshStandardMaterial({ color: 0x6f757a, metalness: 0.7, roughness: 0.4 })
      );
      post.position.set(
        x0 + depth * 0.72, (HALL.height - 0.15) / 2,
        dz * (HALL.entranceWidth / 2 + 0.4)
      );
      this.group.add(post);
    }
  }

  /**
   * Площадка за проёмом лестницы.
   *
   * Тот, кто не дождался лифта, уходит через этот проём и исчезает уже
   * за стеной холла. Без площадки последние шаги он делал бы по воздуху.
   */
  #stairLanding() {
    const side = HALL.stairsSide;
    const depth = 2.0;

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(HALL.stairsWidth + 0.8, 0.12, depth),
      new THREE.MeshStandardMaterial({ color: 0x8a8681, roughness: 0.95, metalness: 0.02 })
    );
    slab.position.set(
      HALL.stairsX, -0.06,
      side * (HALL.doorPlane + depth / 2)
    );
    slab.receiveShadow = true;
    this.group.add(slab);

    // Первые ступени — видно, что проём ведёт вверх, а не в пустоту
    const stepMat = new THREE.MeshStandardMaterial({
      color: 0x9a948c, roughness: 0.9, metalness: 0.03
    });
    for (let i = 0; i < 5; i += 1) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(HALL.stairsWidth, 0.16, 0.3), stepMat
      );
      step.position.set(
        HALL.stairsX, 0.08 + i * 0.16,
        side * (HALL.doorPlane + 0.9 + i * 0.3)
      );
      step.receiveShadow = true;
      this.group.add(step);
    }
  }

  #wallMaterial() {
    if (!this.wallMat) {
      this.wallMat = new THREE.MeshStandardMaterial({
        map: wallTexture(PALETTE.hallWall),
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide
      });
    }
    return this.wallMat;
  }

  #walls() {
    const mat = this.#wallMaterial();
    const half = HALL.length / 2;

    // ---- Две стены с лифтовыми проёмами ----
    //
    // Стена стоит на постоянном Z, поэтому фигура лежит прямо в плоскости
    // XY: местный X — это мировой X, поворачивать ничего не нужно.
    for (const bank of Object.values(BANKS)) {
      const shape = new THREE.Shape();
      rect(shape, -half, 0, half, HALL.height);

      for (const number of bank.numbers) {
        const x = liftAnchor(number).x;
        shape.holes.push(hole(x - DOOR_WIDTH / 2, 0, x + DOOR_WIDTH / 2, DOOR_HEIGHT));
      }

      // Проём на лестницу — в стене той группы, где он есть по плану
      if (bank.side === HALL.stairsSide) {
        shape.holes.push(hole(
          HALL.stairsX - HALL.stairsWidth / 2, 0,
          HALL.stairsX + HALL.stairsWidth / 2, 2.2
        ));
      }

      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
      mesh.position.set(0, 0, bank.side * HALL.doorPlane);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // ---- Торец со входом ----
    // Стена стоит на постоянном X: после поворота на −90° местный X
    // фигуры становится мировым Z.
    const front = new THREE.Shape();
    rect(front, -HALL.corridor / 2, 0, HALL.corridor / 2, HALL.height);

    const eHalf = HALL.entranceWidth / 2;
    front.holes.push(hole(-eHalf, 0, eHalf, HALL.entranceHeight));

    const frontMesh = new THREE.Mesh(new THREE.ShapeGeometry(front), mat);
    frontMesh.rotation.y = -Math.PI / 2;
    frontMesh.position.set(HALL.entranceX, 0, 0);
    frontMesh.receiveShadow = true;
    this.group.add(frontMesh);

    // Витраж по обе стороны от входа — холл просматривается с улицы
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xbcd4de,
      transparent: true,
      opacity: 0.12,
      roughness: 0.08,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    const glassWidth = (HALL.corridor - HALL.entranceWidth) / 2;
    for (const dz of [-1, 1]) {
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(glassWidth, HALL.entranceHeight), glassMat
      );
      glass.rotation.y = -Math.PI / 2;
      glass.position.set(
        HALL.entranceX - 0.02, HALL.entranceHeight / 2,
        dz * (eHalf + glassWidth / 2)
      );
      this.group.add(glass);
    }

    // ---- Глухой торец в глубине холла ----
    const back = new THREE.Shape();
    rect(back, -HALL.corridor / 2, 0, HALL.corridor / 2, HALL.height);

    const backMesh = new THREE.Mesh(new THREE.ShapeGeometry(back), mat);
    backMesh.rotation.y = Math.PI / 2;
    backMesh.position.set(-half, 0, 0);
    backMesh.receiveShadow = true;
    this.group.add(backMesh);
  }

  #ceiling() {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL.length, HALL.corridor),
      new THREE.MeshStandardMaterial({
        color: PALETTE.hallCeiling, roughness: 0.95, metalness: 0.0,
        side: THREE.DoubleSide
      })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, HALL.height, 0);
    this.ceilingMesh = mesh;
    this.group.add(mesh);

    this.lamps = [];

    // Потолочные светильники: продольные панели по коридору
    // (сам свет — в lighting.js)
    const lampGeo = new THREE.PlaneGeometry(1.6, 0.22);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3dd });
    const rows = [-1, 0, 1];
    const columns = Math.floor(HALL.length / 2.4);

    for (const row of rows) {
      for (let col = 0; col < columns; col += 1) {
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.rotation.x = Math.PI / 2;
        lamp.position.set(
          -HALL.length / 2 + 1.2 + col * 2.4,
          HALL.height - 0.02,
          row * (HALL.corridor / 2 - 0.9)
        );
        this.lamps.push(lamp);
        this.group.add(lamp);
      }
    }
  }

  /** Жёлтые прямоугольники перед дверями — они же тепловая карта. */
  #waitZonesBuild() {
    const geo = new THREE.PlaneGeometry(HALL.waitZoneWidth, HALL.waitZoneDepth);

    for (let n = 1; n <= ELEVATORS.total; n += 1) {
      const a = liftAnchor(n);
      // Дальний край зоны отстоит от створок на waitZoneGap
      const z = a.z - a.side * (HALL.waitZoneGap + HALL.waitZoneDepth / 2);

      const mat = new THREE.MeshBasicMaterial({
        color: PALETTE.waitZone,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });

      const zone = new THREE.Mesh(geo, mat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(a.x, 0.02, z);
      zone.renderOrder = 1;
      this.group.add(zone);

      // Контур зоны, чтобы она читалась и при зелёной заливке
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: PALETTE.waitZone, transparent: true, opacity: 0.6 })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(a.x, 0.024, z);
      this.group.add(edge);

      this.waitZones.set(n, { mesh: zone, material: mat, edge });
    }
  }

  /**
   * Тепловая карта: цвет зоны по числу ожидающих.
   * Зелёный — свободно, жёлтый — очередь, красный — толпа.
   */
  setHeat(number, waiting) {
    const zone = this.waitZones.get(number);
    if (!zone) return;

    const full = Math.min(1, waiting / 12);
    const from = new THREE.Color(PALETTE.heat.free);
    const mid = new THREE.Color(PALETTE.heat.busy);
    const to = new THREE.Color(PALETTE.heat.full);

    const color = full < 0.5
      ? from.clone().lerp(mid, full / 0.5)
      : mid.clone().lerp(to, (full - 0.5) / 0.5);

    zone.material.color.copy(color);
    zone.material.opacity = 0.34 + full * 0.34;
    zone.edge.material.color.copy(color);
  }

  /**
   * Прячет потолок, когда камера поднялась выше него.
   * Иначе вид «Сверху» упирается в белую плиту, а в холле ничего не видно.
   */
  setCeilingVisible(visible) {
    if (this.ceilingVisible === visible) return;
    this.ceilingVisible = visible;
    this.ceilingMesh.visible = visible;
    for (const lamp of this.lamps) lamp.visible = visible;
  }

  #signs() {
    const make = (text, width, height, opts) => new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: signTexture(text, opts), toneMapped: false })
    );

    // Над входом, со стороны холла
    const entrance = make('ВХОД', 1.4, 0.34, {
      width: 512, height: 128, bg: '#1b4d2e', fg: '#d8f5e4',
      font: 'bold 72px system-ui, sans-serif', cacheKey: 'sign:entrance'
    });
    entrance.rotation.y = -Math.PI / 2;
    entrance.position.set(HALL.entranceX - 0.04, HALL.entranceHeight + 0.3, 0);
    this.group.add(entrance);

    // Над проёмом лестницы: табличка смотрит в коридор
    const stairs = make('ЛЕСТНИЦА', 1.3, 0.3, {
      width: 512, height: 128, bg: '#2b2f33', fg: '#e8edf2',
      font: 'bold 60px system-ui, sans-serif', cacheKey: 'sign:stairs'
    });
    stairs.rotation.y = HALL.stairsSide > 0 ? Math.PI : 0;
    stairs.position.set(
      HALL.stairsX, 2.45,
      HALL.stairsSide * (HALL.doorPlane - 0.04)
    );
    this.group.add(stairs);

    // Название корпуса на глухом торце
    const title = make(BUILDING.name, 3.4, 0.4, {
      width: 1024, height: 128, bg: '#1a1d21', fg: '#cfd6dd',
      font: 'bold 52px system-ui, sans-serif', cacheKey: 'sign:building'
    });
    title.rotation.y = Math.PI / 2;
    title.position.set(-HALL.length / 2 + 0.04, 2.45, 0);
    this.group.add(title);

    // Указатели групп: какие номера на этой стороне. Состав берётся
    // из параметров, поэтому таблички не разойдутся с планировкой.
    for (const bank of Object.values(BANKS)) {
      const numbers = bank.numbers.join(' · ');
      const plate = make(`ЛИФТЫ ${numbers}`, 1.9, 0.3, {
        width: 640, height: 112, bg: '#1a1d21', fg: '#9fb4c7',
        font: 'bold 54px system-ui, sans-serif',
        cacheKey: `sign:bank:${bank.id}:${numbers}`
      });
      // Над средней шахтой группы: там табличку не перекрывают ни
      // указатель лестницы, ни козырёк входа.
      const middle = bank.numbers[Math.floor(bank.numbers.length / 2)];

      plate.rotation.y = bank.side > 0 ? Math.PI : 0;
      plate.position.set(
        liftAnchor(middle).x, 2.62,
        bank.side * (HALL.doorPlane - 0.04)
      );
      this.group.add(plate);
    }
  }
}
