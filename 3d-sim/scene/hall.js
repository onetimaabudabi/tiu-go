/**
 * Холл первого этажа: пол, стены с проёмами, потолок, зоны ожидания.
 *
 * Шесть лифтовых порталов строит elevator.js — здесь только стена,
 * в которой для них вырезаны проёмы, и всё остальное помещение.
 * Зоны ожидания умеют менять цвет: это тепловая карта плотности.
 */

import * as THREE from 'three';
import { BUILDING, CABIN, HALL, PALETTE, liftX } from '../logic/params.js';
import { tileTexture, wallTexture, signTexture } from './textures.js';

const DOOR_HEIGHT = 2.1;

/** Прямоугольник со скруглением не нужен — простая рамка для Shape. */
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

    this.waitZones = [];

    this.#floor();
    this.#porch();
    this.#walls();
    this.#ceiling();
    this.#waitZonesBuild();
    this.#signs();
  }

  /** Пол в плитку 0.6 × 0.6 м. */
  #floor() {
    const repeatX = HALL.width / HALL.tile;
    const repeatY = HALL.depth / HALL.tile;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL.width, HALL.depth),
      new THREE.MeshStandardMaterial({
        map: tileTexture(PALETTE.hallFloorA, PALETTE.hallFloorB, repeatX, repeatY),
        roughness: 0.75,
        metalness: 0.05
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, 0);
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
    const x0 = HALL.width / 2;

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(depth, 0.12, HALL.depth),
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
    canopy.position.set(x0 + depth * 0.4, 2.95, HALL.entranceZ);
    canopy.castShadow = true;
    this.group.add(canopy);

    for (const dz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 2.95, 10),
        new THREE.MeshStandardMaterial({ color: 0x6f757a, metalness: 0.7, roughness: 0.4 })
      );
      post.position.set(
        x0 + depth * 0.72, 1.47,
        HALL.entranceZ + dz * (HALL.entranceWidth / 2 + 0.4)
      );
      this.group.add(post);
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

    // ---- Дальняя стена с шестью лифтовыми проёмами ----
    const back = new THREE.Shape();
    rect(back, -HALL.width / 2, 0, HALL.width / 2, HALL.height);

    for (let n = 1; n <= 6; n += 1) {
      const x = liftX(n);
      back.holes.push(hole(x - CABIN.width / 2, 0, x + CABIN.width / 2, DOOR_HEIGHT));
    }

    const backMesh = new THREE.Mesh(new THREE.ShapeGeometry(back), mat);
    backMesh.position.set(0, 0, HALL.liftWall);
    backMesh.receiveShadow = true;
    this.group.add(backMesh);

    // ---- Правая стена: вход и проём на лестницу ----
    // Локальный X фигуры превращается в мировой Z после поворота на -90°.
    const right = new THREE.Shape();
    rect(right, -HALL.depth / 2, 0, HALL.depth / 2, HALL.height);

    const eHalf = HALL.entranceWidth / 2;
    right.holes.push(hole(HALL.entranceZ - eHalf, 0, HALL.entranceZ + eHalf, 2.4));
    right.holes.push(hole(HALL.stairsZ - 1, 0, HALL.stairsZ + 1, 2.2));

    const rightMesh = new THREE.Mesh(new THREE.ShapeGeometry(right), mat);
    rightMesh.rotation.y = -Math.PI / 2;
    rightMesh.position.set(HALL.width / 2, 0, 0);
    rightMesh.receiveShadow = true;
    this.group.add(rightMesh);

    // ---- Левая стена: глухая ----
    const left = new THREE.Shape();
    rect(left, -HALL.depth / 2, 0, HALL.depth / 2, HALL.height);

    const leftMesh = new THREE.Mesh(new THREE.ShapeGeometry(left), mat);
    leftMesh.rotation.y = Math.PI / 2;
    leftMesh.position.set(-HALL.width / 2, 0, 0);
    leftMesh.receiveShadow = true;
    this.group.add(leftMesh);

    // ---- Передняя стена: витраж, чтобы холл просматривался снаружи ----
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL.width, HALL.height),
      new THREE.MeshPhysicalMaterial({
        color: 0xbcd4de,
        transparent: true,
        opacity: 0.12,
        roughness: 0.08,
        metalness: 0.0,
        transmission: 0.0,
        side: THREE.DoubleSide
      })
    );
    glass.position.set(0, HALL.height / 2, HALL.depth / 2);
    this.group.add(glass);

    // Импосты витража
    const mullionMat = new THREE.MeshStandardMaterial({
      color: 0x6f757a, metalness: 0.7, roughness: 0.4
    });
    const mullionGeo = new THREE.BoxGeometry(0.07, HALL.height, 0.07);
    for (let i = -2; i <= 2; i += 1) {
      const m = new THREE.Mesh(mullionGeo, mullionMat);
      m.position.set(i * (HALL.width / 5), HALL.height / 2, HALL.depth / 2);
      this.group.add(m);
    }
  }

  #ceiling() {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL.width, HALL.depth),
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

    // Потолочные светильники — светящиеся панели (сам свет в lighting.js)
    const lampGeo = new THREE.PlaneGeometry(1.6, 0.22);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3dd });

    for (let row = -1; row <= 1; row += 1) {
      for (let col = -2; col <= 2; col += 1) {
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.rotation.x = Math.PI / 2;
        lamp.position.set(col * 2.4, HALL.height - 0.02, row * 2.4);
        this.lamps.push(lamp);
        this.group.add(lamp);
      }
    }
  }

  /** Жёлтые квадраты перед дверями — они же тепловая карта. */
  #waitZonesBuild() {
    const geo = new THREE.PlaneGeometry(HALL.waitZoneSize, HALL.waitZoneSize);

    for (let n = 1; n <= 6; n += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: PALETTE.waitZone,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });

      const zone = new THREE.Mesh(geo, mat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(liftX(n), 0.02, HALL.waitZoneZ);
      zone.renderOrder = 1;
      this.group.add(zone);

      // Контур зоны, чтобы она читалась и при зелёной заливке
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: PALETTE.waitZone, transparent: true, opacity: 0.6 })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(liftX(n), 0.024, HALL.waitZoneZ);
      this.group.add(edge);

      this.waitZones.push({ mesh: zone, material: mat, edge });
    }
  }

  /**
   * Тепловая карта: цвет зоны по числу ожидающих.
   * Зелёный — свободно, жёлтый — очередь, красный — толпа.
   */
  setHeat(number, waiting) {
    const zone = this.waitZones[number - 1];
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

    // Над входом
    const entrance = make('ВХОД', 1.4, 0.34, {
      width: 512, height: 128, bg: '#1b4d2e', fg: '#d8f5e4',
      font: 'bold 72px system-ui, sans-serif', cacheKey: 'sign:entrance'
    });
    entrance.rotation.y = -Math.PI / 2;
    entrance.position.set(HALL.width / 2 - 0.04, 2.6, HALL.entranceZ);
    this.group.add(entrance);

    // Над проёмом лестницы
    const stairs = make('ЛЕСТНИЦА', 1.3, 0.3, {
      width: 512, height: 128, bg: '#2b2f33', fg: '#e8edf2',
      font: 'bold 60px system-ui, sans-serif', cacheKey: 'sign:stairs'
    });
    stairs.rotation.y = -Math.PI / 2;
    stairs.position.set(HALL.width / 2 - 0.04, 2.4, HALL.stairsZ);
    this.group.add(stairs);

    // Название корпуса на левой стене
    const title = make(BUILDING.name, 4.2, 0.5, {
      width: 1024, height: 128, bg: '#1a1d21', fg: '#cfd6dd',
      font: 'bold 52px system-ui, sans-serif', cacheKey: 'sign:building'
    });
    title.rotation.y = Math.PI / 2;
    title.position.set(-HALL.width / 2 + 0.04, 2.45, 0);
    this.group.add(title);
  }
}
