/**
 * Режим «вид с камеры наблюдения».
 *
 * Камера перестаёт быть зрительской и становится той самой камерой,
 * про которую написана техническая модель: висит под потолком на
 * высоте camera.mountingHeight, смотрит вниз под фиксированным углом,
 * угол обзора — camera.fovDegrees по горизонтали, кадр — 16:9.
 *
 * Важное про угол обзора. В three.js fov задаётся по вертикали, а в
 * tech-model/params.js записан горизонтальный (90°) — тот же, что
 * 01-camera-model.js пересчитывает в вертикальный по разрешению
 * 1920×1080. Поэтому здесь считается ровно та же формула: вертикальный
 * угол выводится из горизонтального и соотношения сторон, и картинка
 * на экране соответствует расчёту обзора, а не выглядит похоже.
 *
 * Кадр 16:9 получается не растягиванием: рендерер пишет только в
 * прямоугольник нужного соотношения (setViewport + setScissor), а
 * остальное окно остаётся чёрным — как рамка монитора охраны.
 *
 * Мульти-камера делит тот же прямоугольник на четыре части, у каждой
 * своя камера на своём этаже. Верхние этажи в сцене освещены только
 * общим светом, поэтому на время режима над площадками добавляются
 * лампы — иначе три из четырёх видов были бы чёрными.
 */

import * as THREE from 'three';
import {
  BUILDING, HALL, PALETTE, LIGHT, tech, floorY
} from '../logic/params.js';
import { easeInOutCubic } from './elevator.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const CAM = tech.camera;

/** Соотношение сторон кадра — из разрешения камеры (1920x1080 → 16:9). */
export const FRAME_ASPECT = (() => {
  const m = /^(\d+)\s*[xх×]\s*(\d+)$/i.exec(String(CAM.resolution || '').trim());
  if (!m) return 16 / 9;
  return Number(m[1]) / Number(m[2]);
})();

/**
 * Вертикальный угол обзора из горизонтального.
 * Та же формула, что в tech-model/01-camera-model.js (verticalFov).
 */
export function verticalFov(horizontalDeg, aspect) {
  return 2 * Math.atan(Math.tan((horizontalDeg / 2) * RAD) / aspect) * DEG;
}

/** Вертикальный угол камеры наблюдения, ° — для PerspectiveCamera. */
export const CCTV_FOV = verticalFov(CAM.fovDegrees, FRAME_ASPECT);

/** Высота подвеса, м — из технической модели. */
export const MOUNT_HEIGHT = CAM.mountingHeight;

/** Наклон к зоне ожидания, °. 34° — середина диапазона из постановки. */
export const PITCH_DEG = 34;

/*
 * Наклон камер верхних этажей. Там нет ни стен, ни потолка — только
 * перекрытие и площадки, и при 34° полкадра занимает пустой пол.
 * Положе — в кадр попадают створки и площадка, то есть то, ради чего
 * камера на этаже и висела бы.
 */
const UPPER_PITCH_DEG = 26;

// Покачивание подвеса: ±2° по рысканью и чуть меньше по наклону.
const SWAY_YAW = 2 * RAD;
const SWAY_PITCH = 1.2 * RAD;

/**
 * Камеры наблюдения.
 *
 * Все координаты считаются из геометрии холла, руками не проставлены.
 * Камера висит в углу вестибюля над группой шахт, что слева от входа,
 * и смотрит вглубь коридора — в кадр попадают зоны ожидания обеих
 * групп, включая дальний шестой лифт у правой стены.
 *
 * aim задаёт только направление; сам наклон берётся из PITCH_DEG,
 * поэтому точка, в которую смотрит камера, — это пересечение луча
 * с полом на расстоянии mountingHeight / tan(pitch).
 */
const AIM_DEEP = { x: HALL.liftFirstX - 2 * HALL.liftPitch, z: -(HALL.doorPlane - 0.85) };

export const CAMERAS = [
  {
    id: 'CAM-01',
    name: 'Холл 1 этажа',
    floor: 1,
    x: HALL.entranceX - 1.0,
    z: HALL.doorPlane - 0.45,
    aim: AIM_DEEP
  },
  {
    id: 'CAM-02',
    name: 'Холл 2 этажа',
    floor: 2,
    x: HALL.liftFirstX + 1.4,
    z: HALL.doorPlane - 0.45,
    aim: AIM_DEEP
  },
  {
    id: 'CAM-03',
    name: `Холл ${BUILDING.cafeteriaFloor} этажа · столовая`,
    floor: BUILDING.cafeteriaFloor,
    x: HALL.liftFirstX + 1.4,
    z: HALL.doorPlane - 0.45,
    aim: AIM_DEEP
  },
  {
    id: 'CAM-04',
    name: `Холл ${BUILDING.floors} этажа`,
    floor: BUILDING.floors,
    x: HALL.liftFirstX + 1.4,
    z: HALL.doorPlane - 0.45,
    aim: AIM_DEEP
  }
];

/** Описание камеры по её идентификатору. */
export function cameraById(id) {
  return CAMERAS.find((c) => c.id === id) || CAMERAS[0];
}

/**
 * Поза камеры: откуда смотрит и куда.
 *
 * @returns {{position: THREE.Vector3, target: THREE.Vector3}}
 */
export function posePlan(def) {
  const pitch = def.floor === 1 ? PITCH_DEG : UPPER_PITCH_DEG;
  const y = floorY(def.floor) + MOUNT_HEIGHT;
  const position = new THREE.Vector3(def.x, y, def.z);

  const dx = def.aim.x - def.x;
  const dz = def.aim.z - def.z;
  const len = Math.hypot(dx, dz) || 1;

  // Луч под углом PITCH_DEG упирается в пол на этом расстоянии
  const reach = MOUNT_HEIGHT / Math.tan(pitch * RAD);

  const target = new THREE.Vector3(
    def.x + (dx / len) * reach,
    floorY(def.floor),
    def.z + (dz / len) * reach
  );

  return { position, target };
}

/**
 * Прямоугольник кадра 16:9, вписанный в окно.
 * Координаты в CSS-пикселях, начало — левый верхний угол окна.
 */
export function frameRect(width, height, aspect = FRAME_ASPECT) {
  let w = width;
  let h = w / aspect;

  if (h > height) {
    h = height;
    w = h * aspect;
  }

  return {
    x: Math.round((width - w) / 2),
    y: Math.round((height - h) / 2),
    w: Math.round(w),
    h: Math.round(h)
  };
}

// ======================= Контроллер =======================

export class CameraViewController {
  /**
   * @param {object} app  внешний интерфейс сцены из main.js
   */
  constructor(app) {
    this.app = app;

    // Угол обзора зрительской камеры: вернём его при выходе
    this.baseFov = app.camera.fov;

    this.active = false;
    this.multi = false;
    this.current = CAMERAS[0];

    this.time = 0;              // для покачивания подвеса
    this.sway = true;

    // Своя камера на каждый вид наблюдения. Главную камеру сцены
    // в одиночном режиме ведём сами — так ранжирование детализации
    // в толпе считается от того, что реально видно.
    this.cameras = new Map();

    // Переход 0,8 с: откуда и куда летим
    this.tween = {
      active: false,
      t: 0,
      duration: 0.8,
      fromPos: new THREE.Vector3(),
      fromQuat: new THREE.Quaternion(),
      fromFov: 52
    };

    this.lights = [];           // лампы верхних этажей для мульти-камеры
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.views = [];            // [{ def, camera, rect }] — для оверлея

    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._matrix = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
  }

  /** Камера наблюдения для вида (создаётся при первом обращении). */
  #cameraFor(def) {
    if (this.cameras.has(def.id)) return this.cameras.get(def.id);

    const camera = new THREE.PerspectiveCamera(CCTV_FOV, FRAME_ASPECT, 0.1, 400);
    camera.name = `cctv-${def.id}`;
    this.cameras.set(def.id, camera);
    return camera;
  }

  /** Высота, с которой смотрит основной вид — нужна для потолка холла. */
  get probeHeight() {
    return floorY(this.current.floor) + MOUNT_HEIGHT;
  }

  /** Список камер, участвующих в кадре прямо сейчас. */
  get activeDefs() {
    if (!this.multi) return [this.current];
    return CAMERAS.slice(0, 4);
  }

  // ---------- вход и выход ----------

  /**
   * Включить режим наблюдения.
   * @param {string} [id]  идентификатор камеры, по умолчанию CAM-01
   */
  enter(id = CAMERAS[0].id) {
    const def = cameraById(id);
    const first = !this.active;

    this.current = def;
    this.active = true;

    const app = this.app;

    // Разрезы и срезки мешают: камера стоит внутри здания
    app.building.showAllFloors();
    for (const lift of app.elevators) {
      lift.setXray(false);
      lift.setTopView(false);
    }
    if (app.crowd) app.crowd.setCeiling(Infinity);

    // Орбита выключается: зритель видит то, что видит камера
    app.controls.enabled = false;

    if (first) {
      this.tween.fromPos.copy(app.camera.position);
      this.tween.fromQuat.copy(app.camera.quaternion);
      this.tween.fromFov = app.camera.fov;
      this.tween.t = 0;
      this.tween.active = true;
    }

    if (this.multi) this.#addFloorLights();

    return def;
  }

  /** Вернуться к обычной камере. */
  exit({ fly = true } = {}) {
    if (!this.active) return;

    this.active = false;
    this.#removeFloorLights();

    const app = this.app;
    const renderer = app.renderer;

    // Вернуть рендереру полное окно
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);

    app.camera.fov = this.baseFov;
    app.camera.aspect = window.innerWidth / window.innerHeight;
    app.camera.updateProjectionMatrix();

    // Чтобы орбита не крутанула картинку при перехвате, отдаём ей ту
    // точку, на которую камера смотрит прямо сейчас.
    const { target } = posePlan(this.current);
    app.controls.target.copy(target);
    app.controls.enabled = true;

    this.views.length = 0;

    if (fly) app.setView('hall');
  }

  /** Включить или выключить разделение экрана на четыре вида. */
  setMulti(on) {
    if (this.multi === on) return;
    this.multi = on;

    if (!this.active) return;
    if (on) this.#addFloorLights();
    else this.#removeFloorLights();
  }

  /** Покачивание подвеса можно выключить — для записи видео. */
  setSway(on) { this.sway = Boolean(on); }

  // ---------- поза ----------

  /**
   * Поза камеры наблюдения с покачиванием.
   *
   * Покачивание добавляется поворотом направления взгляда, а не
   * смещением камеры: подвес качается, а не ездит по потолку.
   */
  #applyPose(camera, def, blend = 1) {
    const { position, target } = posePlan(def);

    this._pos.copy(position);
    this._target.copy(target);

    if (this.sway) {
      const yaw = Math.sin(this.time * 0.37) * SWAY_YAW;
      const pitch = Math.sin(this.time * 0.23 + 1.1) * SWAY_PITCH;

      const dir = this._dir.copy(this._target).sub(this._pos);
      const len = dir.length();
      dir.normalize();

      // Поворот вокруг вертикали и вокруг поперечной оси кадра
      const side = this._side.crossVectors(dir, UP).normalize();
      dir.applyAxisAngle(UP, yaw).applyAxisAngle(side, pitch);

      this._target.copy(this._pos).addScaledVector(dir, len);
    }

    camera.fov = CCTV_FOV;
    camera.aspect = FRAME_ASPECT;

    if (blend >= 1) {
      camera.position.copy(this._pos);
      camera.lookAt(this._target);
      camera.updateProjectionMatrix();
      return;
    }

    // Переход: позиция линейно, ориентация через кватернион
    this._matrix.lookAt(this._pos, this._target, UP);
    this._quat.setFromRotationMatrix(this._matrix);

    camera.position.lerpVectors(this.tween.fromPos, this._pos, blend);
    camera.quaternion.slerpQuaternions(this.tween.fromQuat, this._quat, blend);
    camera.fov = this.tween.fromFov + (CCTV_FOV - this.tween.fromFov) * blend;
    camera.updateProjectionMatrix();
  }

  /** Обновление позы и прямоугольников кадра. Зовётся каждый кадр. */
  update(dt) {
    if (!this.active) return;

    this.time += dt;

    let blend = 1;
    if (this.tween.active) {
      this.tween.t += dt / this.tween.duration;
      blend = easeInOutCubic(Math.min(1, this.tween.t));
      if (this.tween.t >= 1) this.tween.active = false;
    }

    this.rect = frameRect(window.innerWidth, window.innerHeight);
    this.views.length = 0;

    const defs = this.activeDefs;

    if (!this.multi) {
      // Одиночный вид ведёт главную камеру сцены
      this.#applyPose(this.app.camera, defs[0], blend);
      this.views.push({ def: defs[0], camera: this.app.camera, rect: this.rect });
      return;
    }

    // Четыре вида: тот же кадр 16:9, поделённый на четыре части.
    // Каждая часть сама 16:9 — соотношение сторон сохраняется.
    const halfW = Math.floor(this.rect.w / 2);
    const halfH = Math.floor(this.rect.h / 2);

    for (let i = 0; i < defs.length; i += 1) {
      const def = defs[i];
      const camera = this.#cameraFor(def);
      const rect = {
        x: this.rect.x + (i % 2) * halfW,
        y: this.rect.y + Math.floor(i / 2) * halfH,
        w: halfW,
        h: halfH
      };

      this.#applyPose(camera, def, 1);
      this.views.push({ def, camera, rect });
    }

    // Главная камера стоит там же, где первый вид: по ней толпа
    // раздаёт детализацию, и ближние к CAM-01 люди остаются полными.
    this.#applyPose(this.app.camera, defs[0], blend);
  }

  /**
   * Отрисовка кадра наблюдения.
   *
   * Сначала чёрное окно целиком — это рамка монитора, потом каждый
   * вид в свой прямоугольник с включённым scissor, иначе рендерер
   * затирал бы соседние виды фоном сцены.
   */
  renderFrame(renderer, scene) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();

    for (const view of this.views) {
      const { rect, camera } = view;
      // В three.js начало координат вьюпорта — снизу
      const y = h - rect.y - rect.h;

      renderer.setViewport(rect.x, y, rect.w, rect.h);
      renderer.setScissor(rect.x, y, rect.w, rect.h);
      renderer.setScissorTest(true);
      renderer.render(scene, camera);
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  // ---------- свет верхних этажей ----------

  /**
   * Лампы над площадками этажей, которые показывает мульти-камера.
   *
   * В обычной сцене свет стоит только в холле первого этажа и в
   * кабинах: выше смотреть было незачем. Для комнаты охраны свет
   * нужен, но насовсем его добавлять нельзя — это четыре лишних
   * источника в каждом кадре обычного режима.
   */
  #addFloorLights() {
    if (this.lights.length) return;

    for (const def of CAMERAS) {
      if (def.floor === 1) continue;      // первый этаж освещён и так

      const light = new THREE.PointLight(
        PALETTE.cabinLight, LIGHT.hallSpotIntensity, 10, 2
      );
      light.position.set(-0.6, floorY(def.floor) + HALL.height - 0.45, 0);
      light.name = `cctv-light-${def.id}`;

      this.app.scene.add(light);
      this.lights.push(light);
    }
  }

  #removeFloorLights() {
    for (const light of this.lights) {
      light.removeFromParent();
      light.dispose();
    }
    this.lights.length = 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
