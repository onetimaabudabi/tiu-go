/**
 * Лифт: шахта, кабина, створки, табло.
 *
 * Кинематика повторяет tech-model/04-elevator-physics.js — трапецеидальный
 * профиль скорости с разгоном и торможением params.elevators.acceleration
 * до params.elevators.speed. Время рейса, посчитанное здесь, совпадает
 * с travelTime() из модели: это одна и та же формула, только там нужен
 * итог, а здесь ещё и положение кабины в каждый момент.
 *
 * Сломанные лифты (tech.elevators.broken) строятся как обычные, но
 * никогда не едут: двери заварены, шахта приглушена, на створках
 * табличка «Не работает».
 */

import * as THREE from 'three';
import {
  BUILDING, CABIN, HALL, PALETTE, LIGHT, ELEVATORS, liftX, floorY
} from '../logic/params.js';
import { signTexture, createDisplay, css } from './textures.js';

// Плавная кривая для створок и прочих «механических» движений
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const DOOR_HEIGHT = 2.1;
const SHAFT_DEPTH = HALL.shaftDepth;
const CABIN_GAP = 0.12;       // зазор между порогом шахты и кабиной

// Общая геометрия и материалы: шесть шахт по шестнадцать этажей — это
// сотни мешей, и создавать для каждого свой BufferGeometry незачем.
const shared = {};

function sharedBox(key, w, h, d) {
  const id = `box:${key}`;
  if (!shared[id]) shared[id] = new THREE.BoxGeometry(w, h, d);
  return shared[id];
}

function sharedMat(key, factory) {
  const id = `mat:${key}`;
  if (!shared[id]) shared[id] = factory();
  return shared[id];
}

/**
 * Прозрачные створки для режима слежения.
 *
 * Пока кабина едет, она закрытая коробка: ни пассажиров, ни происходящего
 * внутри не видно. В режиме «Следить за лифтом» створки этого лифта
 * становятся полупрозрачными, а створки этажей скрываются — получается
 * разрез шахты, на котором видно и кабину, и людей в ней.
 */
function xrayMaterial() {
  return sharedMat('door-xray', () => new THREE.MeshStandardMaterial({
    color: PALETTE.door,
    metalness: 0.6,
    roughness: 0.25,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide
  }));
}

/** Полированная сталь створок. */
function doorMaterial(broken) {
  return sharedMat(broken ? 'door-broken' : 'door', () => new THREE.MeshStandardMaterial({
    color: broken ? PALETTE.doorBroken : PALETTE.door,
    metalness: broken ? 0.45 : 0.8,
    roughness: broken ? 0.55 : 0.2
  }));
}

export class Elevator {
  /**
   * @param {number} number   номер лифта, 1…6
   * @param {boolean} broken  сломан ли (берётся из tech-model/params.js)
   */
  constructor(number, broken) {
    this.number = number;
    this.broken = broken;
    this.capacity = ELEVATORS.capacityRealPeak;

    // ---- состояние движения ----
    this.floor = 1;             // текущий этаж (целый, когда стоим)
    this.targetFloor = 1;
    this.position = floorY(1);  // высота пола кабины, м
    this.prevPosition = this.position;
    this.velocity = 0;

    // Профиль поездки
    this.trip = null;
    this.tripTime = 0;

    // Затухающие колебания после остановки
    this.bounce = 0;
    this.bounceTime = 0;

    // ---- состояние дверей ----
    // 'idle' | 'opening' | 'open' | 'closing' | 'moving'
    this.state = 'idle';
    this.doorPhase = 0;         // 0 — закрыто, 1 — открыто
    this.prevDoorPhase = 0;
    this.doorTimer = 0;
    this.holdRequested = false;
    this.doorFloor = 1;         // чьи створки на этаже сейчас анимируются

    // ---- данные для табло ----
    this.occupancy = 0;
    this.queue = 0;
    this.skipFlash = 0;         // секунды, пока горит «Пропущено»

    this.x = liftX(number);
    this.zFront = HALL.liftWall;

    this.group = new THREE.Group();
    this.group.name = `elevator-${number}`;

    this.landingDoors = [];
    this.displays = [];

    this.#buildShaft();
    this.#buildCabin();
    this.#buildLandings();
    this.#buildHallBoards();

    this.#applyCabinPosition();
  }

  // ======================= Построение =======================

  /** Шахта: полупрозрачные стенки, направляющие рельсы, трос. */
  #buildShaft() {
    const height = BUILDING.height;
    const w = HALL.shaftWidth;
    const zCenter = this.zFront - SHAFT_DEPTH / 2;

    const wallMat = sharedMat(this.broken ? 'shaft-broken' : 'shaft', () =>
      new THREE.MeshStandardMaterial({
        color: this.broken ? PALETTE.shaftBroken : PALETTE.shaft,
        transparent: true,
        opacity: this.broken ? 0.22 : 0.15,
        roughness: 0.9,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false
      }));

    // Задняя и две боковые стенки
    const back = new THREE.Mesh(sharedBox('shaft-back', w, height, 0.06), wallMat);
    back.position.set(this.x, height / 2, zCenter - SHAFT_DEPTH / 2);
    this.group.add(back);

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(sharedBox('shaft-side', 0.06, height, SHAFT_DEPTH), wallMat);
      wall.position.set(this.x + side * w / 2, height / 2, zCenter);
      this.group.add(wall);
    }

    // Направляющие рельсы — два тонких цилиндра по бокам кабины
    const railMat = sharedMat('rail', () => new THREE.MeshStandardMaterial({
      color: PALETTE.rail, metalness: 0.85, roughness: 0.35
    }));
    const railGeo = shared['geo:rail'] ||
      (shared['geo:rail'] = new THREE.CylinderGeometry(0.045, 0.045, height, 8));

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(this.x + side * (CABIN.width / 2 + 0.16), height / 2, zCenter + 0.1);
      this.group.add(rail);
    }

    // Трос: тонкая линия от лебёдки до крыши кабины
    const cableMat = sharedMat('cable', () => new THREE.MeshStandardMaterial({
      color: PALETTE.cable, metalness: 0.6, roughness: 0.5
    }));
    this.cable = new THREE.Mesh(
      shared['geo:cable'] ||
      (shared['geo:cable'] = new THREE.CylinderGeometry(0.02, 0.02, 1, 6)),
      cableMat
    );
    this.cable.position.set(this.x, 0, zCenter);
    this.group.add(this.cable);

    // Машинное отделение сверху — чтобы трос не висел в воздухе
    const head = new THREE.Mesh(
      sharedBox('shaft-head', w, 0.5, SHAFT_DEPTH),
      sharedMat('shaft-head', () => new THREE.MeshStandardMaterial({
        color: PALETTE.shaftBroken, roughness: 0.8, metalness: 0.2
      }))
    );
    head.position.set(this.x, height + 0.25, zCenter);
    this.group.add(head);

    // Световая полоса в шахте: загорается, когда кабина едет
    const stripMat = new THREE.MeshBasicMaterial({
      color: PALETTE.cabinLight,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.stripMaterial = stripMat;

    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(
        shared['geo:strip'] ||
        (shared['geo:strip'] = new THREE.PlaneGeometry(SHAFT_DEPTH * 0.8, BUILDING.height)),
        stripMat
      );
      strip.rotation.y = side * Math.PI / 2;
      strip.position.set(this.x + side * (w / 2 - 0.04), BUILDING.height / 2, zCenter);
      this.group.add(strip);
    }
  }

  /** Кабина: пол, потолок, зеркальная задняя стенка, поручень, панель кнопок. */
  #buildCabin() {
    const cabin = new THREE.Group();
    const { width: w, depth: d, height: h } = CABIN;

    const wallMat = sharedMat('cabin-wall', () => new THREE.MeshStandardMaterial({
      color: PALETTE.cabinWall, metalness: 0.7, roughness: 0.3
    }));
    const floorMat = sharedMat('cabin-floor', () => new THREE.MeshStandardMaterial({
      color: PALETTE.cabinFloor, roughness: 0.9, metalness: 0.1
    }));
    const ceilMat = sharedMat('cabin-ceil', () => new THREE.MeshStandardMaterial({
      color: PALETTE.cabinCeiling, roughness: 0.85, metalness: 0.0
    }));
    const mirrorMat = sharedMat('cabin-mirror', () => new THREE.MeshStandardMaterial({
      color: PALETTE.mirror, metalness: 1.0, roughness: 0.05
    }));

    // Пол и потолок
    const floorMesh = new THREE.Mesh(sharedBox('cabin-floor', w, 0.06, d), floorMat);
    floorMesh.position.set(0, -0.03, 0);
    floorMesh.receiveShadow = true;
    cabin.add(floorMesh);

    const ceiling = new THREE.Mesh(sharedBox('cabin-ceil', w, 0.06, d), ceilMat);
    ceiling.position.set(0, h + 0.03, 0);
    cabin.add(ceiling);

    // Боковые стены
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(sharedBox('cabin-side', 0.05, h, d), wallMat);
      wall.position.set(side * (w / 2), h / 2, 0);
      cabin.add(wall);
    }

    // Задняя стенка — зеркало
    const mirror = new THREE.Mesh(sharedBox('cabin-back', w, h, 0.05), mirrorMat);
    mirror.position.set(0, h / 2, -d / 2);
    cabin.add(mirror);

    // Потолочный светильник: матовая панель плюс точечный источник
    const lamp = new THREE.Mesh(
      shared['geo:lamp'] ||
      (shared['geo:lamp'] = new THREE.PlaneGeometry(w * 0.6, d * 0.55)),
      // Не MeshBasicMaterial: чистый белый светильник вблизи засвечивает
      // половину кадра, а подсвеченная поверхность ведёт себя спокойнее.
      sharedMat('lamp', () => new THREE.MeshStandardMaterial({
        color: 0xe8dcc4, emissive: 0xfff1d8, emissiveIntensity: 0.55,
        roughness: 1, metalness: 0, side: THREE.DoubleSide
      }))
    );
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, h - 0.04, 0);
    cabin.add(lamp);
    this.lampMesh = lamp;

    if (!this.broken) {
      const light = new THREE.PointLight(PALETTE.cabinLight, LIGHT.cabinIntensity, 4.5, 2);
      light.position.set(0, h - 0.3, 0);
      cabin.add(light);
      this.cabinLight = light;
    } else {
      lamp.material = sharedMat('lamp-off', () => new THREE.MeshStandardMaterial({
        color: 0x4a4a4a, roughness: 1, metalness: 0, side: THREE.DoubleSide
      }));
    }

    // Поручень по трём стенам на высоте метра — одна труба по ломаной
    const railPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-w / 2 + 0.06, 1.0, d / 2 - 0.25),
      new THREE.Vector3(-w / 2 + 0.06, 1.0, -d / 2 + 0.14),
      new THREE.Vector3(0, 1.0, -d / 2 + 0.08),
      new THREE.Vector3(w / 2 - 0.06, 1.0, -d / 2 + 0.14),
      new THREE.Vector3(w / 2 - 0.06, 1.0, d / 2 - 0.25)
    ], false, 'catmullrom', 0.08);

    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(railPath, 48, 0.022, 8, false),
      sharedMat('handrail', () => new THREE.MeshStandardMaterial({
        color: PALETTE.handrail, metalness: 0.9, roughness: 0.25
      }))
    );
    cabin.add(rail);

    // Панель с кнопками этажей
    const panel = new THREE.Mesh(
      sharedBox('panel', 0.03, 0.78, 0.2),
      sharedMat('panel', () => new THREE.MeshStandardMaterial({
        color: 0x2b2f33, metalness: 0.6, roughness: 0.4
      }))
    );
    panel.position.set(w / 2 - 0.04, 1.15, d / 2 - 0.45);
    cabin.add(panel);

    const buttons = new THREE.Mesh(
      shared['geo:buttons'] ||
      (shared['geo:buttons'] = new THREE.PlaneGeometry(0.18, 0.74)),
      sharedMat('buttons', () => new THREE.MeshBasicMaterial({
        map: buttonPanelTexture(BUILDING.floors), transparent: true
      }))
    );
    buttons.rotation.y = -Math.PI / 2;
    buttons.position.set(w / 2 - 0.056, 1.15, d / 2 - 0.45);
    cabin.add(buttons);

    // Створки кабины
    this.cabinDoors = this.#makeDoorPair(w, DOOR_HEIGHT, d / 2 + 0.02);
    cabin.add(this.cabinDoors.group);

    cabin.position.set(this.x, 0, this.zFront - CABIN_GAP - CABIN.depth / 2);
    this.cabin = cabin;
    this.group.add(cabin);
  }

  /**
   * Пара створок: две панели, разъезжающиеся в стороны.
   * Возвращает группу и метод set(phase), где phase 0…1.
   */
  #makeDoorPair(openWidth, height, z) {
    const group = new THREE.Group();
    const leafWidth = openWidth / 2;
    const geo = sharedBox(`leaf:${leafWidth.toFixed(3)}:${height}`, leafWidth, height, 0.05);
    const mat = doorMaterial(this.broken);

    const leaves = [];
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(geo, mat);
      leaf.castShadow = false;
      leaf.position.set(side * leafWidth / 2, height / 2, z);
      leaves.push({ mesh: leaf, side, closedX: side * leafWidth / 2 });
      group.add(leaf);
    }

    return {
      group,
      leaves,
      set(phase) {
        for (const leaf of leaves) {
          leaf.mesh.position.x = leaf.closedX + leaf.side * leafWidth * phase;
        }
      }
    };
  }

  /** Створки и порталы на каждом этаже + площадка перед ними. */
  #buildLandings() {
    const frameMat = sharedMat('portal', () => new THREE.MeshStandardMaterial({
      color: 0x8d9398, metalness: 0.6, roughness: 0.45
    }));

    for (let f = 1; f <= BUILDING.floors; f += 1) {
      const y = floorY(f);
      const pair = this.#makeDoorPair(CABIN.width, DOOR_HEIGHT, this.zFront + 0.03);
      pair.group.position.set(this.x, y, 0);
      pair.set(0);
      this.group.add(pair.group);
      this.landingDoors.push(pair);

      // Обрамление проёма: две стойки и перемычка
      const portal = new THREE.Group();
      for (const side of [-1, 1]) {
        const jamb = new THREE.Mesh(
          sharedBox('jamb', 0.09, DOOR_HEIGHT + 0.12, 0.12), frameMat
        );
        jamb.position.set(side * (CABIN.width / 2 + 0.045), (DOOR_HEIGHT + 0.12) / 2, this.zFront + 0.03);
        portal.add(jamb);
      }
      const lintel = new THREE.Mesh(
        sharedBox('lintel', CABIN.width + 0.18, 0.12, 0.12), frameMat
      );
      lintel.position.set(0, DOOR_HEIGHT + 0.06, this.zFront + 0.03);
      portal.add(lintel);
      portal.position.set(this.x, y, 0);
      this.group.add(portal);

      if (this.broken && f === 1) {
        // Табличка «Не работает» на створках в холле.
        // На верхних этажах хватает приглушённых створок — 48 красных
        // табличек в разрезе здания только мешают.
        const plate = new THREE.Mesh(
          shared['geo:plate'] ||
          (shared['geo:plate'] = new THREE.PlaneGeometry(0.86, 0.3)),
          sharedMat('plate-broken', () => new THREE.MeshBasicMaterial({
            map: signTexture('НЕ РАБОТАЕТ', {
              width: 512, height: 180, bg: '#5a1f1f', fg: '#ffd9d9',
              border: '#d9534f', font: 'bold 64px system-ui, sans-serif',
              cacheKey: 'sign:broken'
            }),
            toneMapped: false
          }))
        );
        plate.position.set(this.x, y + 1.42, this.zFront + 0.09);
        this.group.add(plate);
      }
    }
  }

  /** Живые табло над дверью в холле: этаж с направлением и счётчик очереди. */
  #buildHallBoards() {
    // Табло этажа
    this.floorBoard = createDisplay(256, 96, (ctx, w, h, floor, dir, broken) => {
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2a3038';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      if (broken) {
        ctx.fillStyle = '#d9534f';
        ctx.font = 'bold 44px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('— —', w / 2, h / 2 + 2);
        return;
      }

      ctx.fillStyle = '#ffb648';
      ctx.font = 'bold 58px "SF Mono", Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(floor), w / 2 + 34, h / 2 + 3);

      ctx.fillStyle = dir === '•' ? '#6c757d' : '#4ad991';
      ctx.font = 'bold 50px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(dir, w / 2 + 50, h / 2 + 3);
    });

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.28),
      new THREE.MeshBasicMaterial({ map: this.floorBoard.texture, toneMapped: false })
    );
    board.position.set(this.x, DOOR_HEIGHT + 0.3, this.zFront + 0.11);
    this.group.add(board);

    // Табло очереди «Ждут: N»
    this.queueBoard = createDisplay(256, 96, (ctx, w, h, queue, level) => {
      const bg = { free: '#15402f', busy: '#473a12', full: '#4a1c1c' }[level] || '#15402f';
      const fg = { free: '#4ad991', busy: '#ffd166', full: '#ff7a73' }[level] || '#4ad991';

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      ctx.fillStyle = fg;
      ctx.font = 'bold 42px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Ждут: ${queue}`, w / 2, h / 2 + 2);
    });

    const qBoard = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.28),
      new THREE.MeshBasicMaterial({ map: this.queueBoard.texture, toneMapped: false })
    );
    qBoard.position.set(this.x, DOOR_HEIGHT + 0.64, this.zFront + 0.11);
    this.group.add(qBoard);

    // Вспышка «Пропущено» — висит поверх табло и обычно невидима
    this.skipMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.34),
      new THREE.MeshBasicMaterial({
        map: signTexture('ПРОПУЩЕНО', {
          width: 512, height: 160, bg: '#d9534f', fg: '#ffffff',
          font: 'bold 72px system-ui, sans-serif', cacheKey: 'sign:skip'
        }),
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthTest: false
      })
    );
    this.skipMesh.renderOrder = 10;
    this.skipMesh.position.set(this.x, DOOR_HEIGHT + 0.98, this.zFront + 0.12);
    this.skipMesh.visible = false;
    this.group.add(this.skipMesh);

    // Номер лифта на перемычке
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.22),
      new THREE.MeshBasicMaterial({
        map: signTexture(String(this.number), {
          width: 192, height: 144, bg: '#1a1d21', fg: '#cfd6dd',
          font: 'bold 104px system-ui, sans-serif',
          cacheKey: `sign:lift:${this.number}`
        }),
        toneMapped: false
      })
    );
    label.position.set(this.x - 0.62, DOOR_HEIGHT + 0.3, this.zFront + 0.11);
    this.group.add(label);
  }

  // ======================= Кинематика =======================

  /**
   * Трапецеидальный профиль: разгон a до скорости v, крейсер, торможение a.
   * Если расстояния на разгон не хватает, профиль треугольный.
   * Полное время совпадает с travelTime() из tech-model/04.
   */
  static profile(distance) {
    const v = ELEVATORS.speed;
    const a = ELEVATORS.acceleration;

    if (distance <= 0) return { total: 0, tAcc: 0, dAcc: 0, vPeak: 0, tCruise: 0, distance: 0 };

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
  static travelled(profile, t) {
    const a = ELEVATORS.acceleration;

    if (t <= 0) return 0;
    if (t >= profile.total) return profile.distance;

    if (t < profile.tAcc) return 0.5 * a * t * t;

    const tDecelStart = profile.tAcc + profile.tCruise;
    if (t < tDecelStart) return profile.dAcc + profile.vPeak * (t - profile.tAcc);

    const td = t - tDecelStart;
    return profile.dAcc + profile.vPeak * profile.tCruise +
      profile.vPeak * td - 0.5 * a * td * td;
  }

  /** Время поездки с текущего этажа до указанного — для диспетчера. */
  timeTo(floor) {
    const distance = Math.abs(floor - this.floor) * BUILDING.floorHeight;
    return Elevator.profile(distance).total;
  }

  // ======================= Команды =======================

  get busy() { return this.state !== 'idle'; }
  get doorsOpen() { return this.state === 'open'; }
  get moving() { return this.state === 'moving'; }

  /** Отправить кабину на этаж. Работает только из состояния покоя. */
  moveTo(floor) {
    if (this.broken || this.state !== 'idle' || floor === this.floor) return false;

    const distance = Math.abs(floor - this.floor) * BUILDING.floorHeight;
    this.trip = {
      profile: Elevator.profile(distance),
      from: this.floor,
      to: floor,
      dir: Math.sign(floor - this.floor)
    };
    this.tripTime = 0;
    this.targetFloor = floor;
    this.state = 'moving';
    return true;
  }

  /** Открыть створки на текущем этаже. */
  openDoors() {
    if (this.broken || this.state !== 'idle') return false;
    this.doorFloor = this.floor;
    this.state = 'opening';
    this.doorTimer = 0;
    return true;
  }

  /** Попросить подержать двери ещё — вызывается, пока идёт посадка. */
  keepOpen() {
    this.holdRequested = true;
  }

  /** Закрыть створки досрочно. */
  closeDoors() {
    if (this.state !== 'open') return false;
    this.state = 'closing';
    this.doorTimer = 0;
    return true;
  }

  /**
   * Разрез шахты: створки этажей убираются, створки кабины становятся
   * прозрачными. Включается при слежении за конкретным лифтом.
   */
  setXray(on) {
    if (this.xray === on) return;
    this.xray = on;

    for (const pair of this.landingDoors) pair.group.visible = !on;

    const mat = on ? xrayMaterial() : doorMaterial(this.broken);
    for (const leaf of this.cabinDoors.leaves) leaf.mesh.material = mat;
  }

  /** Красная вспышка «Пропущено» над дверью проезжаемого этажа. */
  flashSkip(floor = this.floor) {
    this.skipFlash = 1.0;
    this.skipMesh.position.y = floorY(floor) + DOOR_HEIGHT + 0.98;
  }

  // ======================= Шаг логики =======================

  beginStep() {
    this.prevPosition = this.position;
    this.prevDoorPhase = this.doorPhase;
  }

  update(dt) {
    switch (this.state) {
      case 'moving': this.#stepMoving(dt); break;
      case 'opening': this.#stepDoors(dt, ELEVATORS.doorOpenTime, 1, 'open'); break;
      case 'open': this.#stepHold(dt); break;
      case 'closing': this.#stepDoors(dt, ELEVATORS.doorCloseTime, -1, 'idle'); break;
      default: break;
    }

    // Затухающие колебания после остановки: ощутимые, но не трясучка
    if (this.bounceTime > 0) {
      this.bounceTime = Math.max(0, this.bounceTime - dt);
      const t = 0.6 - this.bounceTime;
      this.bounce = 0.02 * Math.exp(-7 * t) * Math.sin(26 * t);
    } else {
      this.bounce = 0;
    }

    if (this.skipFlash > 0) this.skipFlash = Math.max(0, this.skipFlash - dt);
  }

  #stepMoving(dt) {
    this.tripTime += dt;

    const { profile, from, dir } = this.trip;
    const s = Elevator.travelled(profile, this.tripTime);
    this.position = floorY(from) + dir * s;

    // Скорость нужна световой полосе и табло с направлением
    const prev = Elevator.travelled(profile, Math.max(0, this.tripTime - dt));
    this.velocity = dt > 0 ? (s - prev) / dt * dir : 0;

    if (this.tripTime >= profile.total) {
      this.floor = this.trip.to;
      this.position = floorY(this.floor);
      this.velocity = 0;
      this.trip = null;
      this.state = 'idle';
      this.bounceTime = 0.6;
    }
  }

  #stepDoors(dt, duration, direction, nextState) {
    this.doorTimer += dt;
    const t = Math.min(1, this.doorTimer / Math.max(duration, 0.001));
    this.doorPhase = direction > 0 ? easeInOutCubic(t) : 1 - easeInOutCubic(t);

    if (t >= 1) {
      this.doorPhase = direction > 0 ? 1 : 0;
      this.state = nextState;
      this.doorTimer = 0;
      this.holdRequested = false;
    }
  }

  #stepHold(dt) {
    this.doorTimer += dt;

    // Минимум держим doorHoldTime; пока идёт посадка, таймер сбрасывается
    if (this.holdRequested) {
      this.doorTimer = 0;
      this.holdRequested = false;
      return;
    }

    if (this.doorTimer >= ELEVATORS.doorHoldTime) {
      this.state = 'closing';
      this.doorTimer = 0;
    }
  }

  // ======================= Отрисовка =======================

  /**
   * Переносит состояние логики в сцену. alpha — доля между предыдущим
   * и текущим шагом: без неё при 144 Гц кабина двигалась бы ступеньками.
   */
  render(alpha) {
    const y = this.prevPosition + (this.position - this.prevPosition) * alpha;
    this.renderY = y + this.bounce;
    this.#applyCabinPosition();

    const phase = this.prevDoorPhase + (this.doorPhase - this.prevDoorPhase) * alpha;
    this.cabinDoors.set(phase);

    // Створки на этаже открываются синхронно с кабиной
    const landing = this.landingDoors[this.doorFloor - 1];
    if (landing && !this.xray) landing.set(phase);
    if (this.lastDoorFloor !== undefined && this.lastDoorFloor !== this.doorFloor) {
      const old = this.landingDoors[this.lastDoorFloor - 1];
      if (old) old.set(0);
    }
    this.lastDoorFloor = this.doorFloor;

    // Световая полоса: яркость по модулю скорости
    const speedShare = Math.min(1, Math.abs(this.velocity) / ELEVATORS.speed);
    this.stripMaterial.opacity = speedShare * 0.22;

    // Вспышка «Пропущено» гаснет за секунду
    if (this.skipFlash > 0) {
      this.skipMesh.visible = true;
      this.skipMesh.material.opacity = Math.min(1, this.skipFlash * 2);
    } else if (this.skipMesh.visible) {
      this.skipMesh.visible = false;
    }

    this.#updateBoards();
  }

  #applyCabinPosition() {
    const y = this.renderY !== undefined ? this.renderY : this.position;
    this.cabin.position.y = y;

    // Трос тянется от машинного отделения до крыши кабины
    const top = BUILDING.height;
    const cabinTop = y + CABIN.height + 0.06;
    const len = Math.max(0.01, top - cabinTop);
    this.cable.scale.y = len;
    this.cable.position.y = cabinTop + len / 2;
  }

  #updateBoards() {
    const dir = this.velocity > 0.05 ? '↑' : this.velocity < -0.05 ? '↓' : '•';
    const shownFloor = this.moving
      ? Math.max(1, Math.min(BUILDING.floors, Math.round(this.position / BUILDING.floorHeight) + 1))
      : this.floor;

    this.floorBoard.draw(`${shownFloor}:${dir}:${this.broken}`, shownFloor, dir, this.broken);

    const level = this.queue >= 10 ? 'full' : this.queue >= 4 ? 'busy' : 'free';
    this.queueBoard.draw(`${this.queue}:${level}`, this.queue, level);
  }

  /** Сброс в исходное положение — для кнопки «Сброс». */
  reset() {
    this.floor = 1;
    this.targetFloor = 1;
    this.position = floorY(1);
    this.prevPosition = this.position;
    this.velocity = 0;
    this.trip = null;
    this.tripTime = 0;
    this.state = 'idle';
    this.doorPhase = 0;
    this.prevDoorPhase = 0;
    this.doorTimer = 0;
    this.bounce = 0;
    this.bounceTime = 0;
    this.occupancy = 0;
    this.queue = 0;
    this.skipFlash = 0;

    for (const pair of this.landingDoors) pair.set(0);
    this.cabinDoors.set(0);
    this.renderY = undefined;
    this.#applyCabinPosition();
  }
}

/** Панель кнопок: 16 кружков в два столбца. Текстура одна на все кабины. */
let panelTexture = null;
function buttonPanelTexture(floors) {
  if (panelTexture) return panelTexture;

  const el = document.createElement('canvas');
  el.width = 128;
  el.height = 512;
  const ctx = el.getContext('2d');

  ctx.clearRect(0, 0, 128, 512);

  const rows = Math.ceil(floors / 2);
  for (let i = 0; i < floors; i += 1) {
    const col = i % 2;
    const row = rows - 1 - Math.floor(i / 2);
    const cx = 36 + col * 56;
    const cy = 40 + row * (432 / rows);

    ctx.beginPath();
    ctx.arc(cx, cy, 19, 0, Math.PI * 2);
    ctx.fillStyle = '#3c4249';
    ctx.fill();
    ctx.strokeStyle = '#8d969e';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#e8edf2';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx, cy + 1);
  }

  panelTexture = new THREE.CanvasTexture(el);
  panelTexture.colorSpace = THREE.SRGBColorSpace;
  return panelTexture;
}

export { css };
