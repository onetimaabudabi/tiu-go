/**
 * TIU GO — 3D-визуализация холла корпуса 7.
 *
 * Здесь собирается всё: рендерер, сцена, камера, фиксированный шаг
 * логики и отрисовка с интерполяцией. Сам сюжет (кто куда идёт, какой
 * лифт едет) живёт в logic/, модели — в scene/, панели — в ui/.
 *
 * Про шаг времени. Логика считается шагами по SIM.fixedStep реального
 * времени: так поведение не зависит от частоты кадров. Между шагами
 * позиции интерполируются — иначе на мониторе 120 Гц кабина двигалась бы
 * ступеньками по 60 Гц.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  BUILDING, CABIN, HALL, PALETTE, SIM, PERF, ELEVATORS, BANKS,
  liftAnchor, frontOf, floorY
} from './logic/params.js';
import { Lighting } from './scene/lighting.js';
import { Building } from './scene/building.js';
import { Hall } from './scene/hall.js';
import { Elevator, easeInOutCubic } from './scene/elevator.js';
import { CameraViewController } from './scene/camera-view.js';

// ======================= Рендерер и сцена =======================

const canvas = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.sky, 55, 130);

// Окружение для металла: без него зеркало в кабине и полированные
// створки рендерятся почти чёрными — отражать нечего.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(
  52, window.innerWidth / window.innerHeight, 0.1, 400
);
camera.position.set(12, 3.6, 8.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 1.5, 0);
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 2.5;
controls.maxDistance = 120;

// ======================= Объекты сцены =======================

const lighting = new Lighting(scene);
const building = new Building(scene);
const hall = new Hall(scene);

const elevators = [];
for (let n = 1; n <= ELEVATORS.total; n += 1) {
  const broken = ELEVATORS.broken.includes(n);
  const lift = new Elevator(n, broken);
  scene.add(lift.group);
  elevators.push(lift);
}

console.log(
  `[сцена] здание ${BUILDING.floors} эт. × ${BUILDING.floorHeight} м, ` +
  `лифтов ${ELEVATORS.total} (работают ${ELEVATORS.working.join(', ')}; ` +
  `не работают ${ELEVATORS.broken.join(', ')})`
);
console.log(
  `[сцена] группы шахт друг против друга: ${BANKS.left.label} — ` +
  `${BANKS.left.numbers.join(', ')}; ${BANKS.right.label} — ` +
  `${BANKS.right.numbers.join(', ')}; коридор ${HALL.corridor} м`
);

// ======================= Переходы камеры =======================

const VIEWS = {
  hall: {
    label: 'Холл',
    // Взгляд от входа вдоль коридора: в кадре сразу обе группы шахт.
    // Камера стоит в вестибюле (x меньше линии входа) и выше голов —
    // иначе ближний человек закрывает полкадра.
    position: new THREE.Vector3(4.9, 2.72, 0.55),
    target: new THREE.Vector3(-4.4, 0.95, -0.1)
  },
  section: {
    label: 'Разрез',
    // Отойти нужно почти на полсотни метров: при угле обзора 52°
    // здание высотой 48 м влезает в кадр только с такой дистанции.
    position: new THREE.Vector3(33, 30, 33),
    target: new THREE.Vector3(0, 23, 0)
  },
  top: {
    label: 'Сверху',
    position: new THREE.Vector3(0.0, 15.5, 4.4),
    target: new THREE.Vector3(-0.6, 0, -0.4),
    // Сверху смотрим только на холл: перекрытия выше срезаются
    cutaway: 1
  },
  camera: {
    // Вид с камеры наблюдения: позу, угол обзора и кадр 16:9 ведёт
    // scene/camera-view.js — там же числа технической модели.
    label: '📹 С камеры 1 этажа',
    cctv: 'CAM-01'
  },
  free: {
    // Камера остаётся где есть и отдаётся зрителю
    label: '🕹 Свободный полёт',
    free: true
  }
};

const cameraTween = {
  active: false,
  t: 0,
  duration: 0.8,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget: new THREE.Vector3()
};

let followLift = null;   // номер лифта, за которым едет камера

/** Плавный перелёт камеры за 0.8 с с easeInOutCubic. */
function flyTo(position, target, duration = 0.8) {
  cameraTween.fromPos.copy(camera.position);
  cameraTween.toPos.copy(position);
  cameraTween.fromTarget.copy(controls.target);
  cameraTween.toTarget.copy(target);
  cameraTween.t = 0;
  cameraTween.duration = duration;
  cameraTween.active = true;
}

function setView(key) {
  const view = VIEWS[key];
  if (!view) return;

  // Вид с камеры наблюдения живёт по своим правилам: своя поза, свой
  // угол обзора, свой кадр и выключенная орбита.
  if (view.cctv) {
    cameraView.enter(view.cctv);
    return;
  }

  // Выходим без обратного перелёта: вид, который выбрали, задаст его сам
  if (cameraView.active) cameraView.exit({ fly: false });

  followLift = null;

  // Свободный полёт: камера не переезжает, просто отдаётся зрителю
  if (view.free) {
    cameraTween.active = false;
    building.showAllFloors();
    for (const lift of elevators) {
      lift.setXray(false);
      lift.setTopView(false);
    }
    if (app.crowd) app.crowd.setCeiling(Infinity);
    controls.enabled = true;
    return;
  }

  const plan = Boolean(view.cutaway);
  for (const lift of elevators) {
    lift.setXray(false);
    lift.setTopView(plan);
  }

  building.setCutawayFloor(view.cutaway || BUILDING.floors);

  // В плане показываем только первый этаж — вместе с его людьми
  if (app.crowd) app.crowd.setCeiling(plan ? HALL.height : Infinity);

  flyTo(view.position, view.target);
}

/** Камера едет вдоль шахты вместе с кабиной. */
function setFollow(number) {
  if (cameraView.active) cameraView.exit({ fly: false });

  followLift = number;
  building.showAllFloors();

  // Разрез делаем только у выбранного лифта — остальные остаются целыми
  for (const lift of elevators) {
    lift.setTopView(false);
    lift.setXray(lift.number === number);
  }

  if (app.crowd) app.crowd.setCeiling(Infinity);

  const target = followTarget(number, _targetVec);
  flyTo(followPosition(number, _posVec).clone(), target.clone());
}

// Откуда и куда смотрит камера в режиме слежения
const _posVec = new THREE.Vector3();
const _targetVec = new THREE.Vector3();

function followTarget(number, out) {
  const lift = elevators[number - 1];
  const y = (lift.renderY ?? lift.position) + 1.15;
  // Центр кабины: она стоит за плоскостью створок, то есть в шахте.
  // Отрицательное расстояние у frontOf — это «вглубь от дверей».
  const c = frontOf(number, -(CABIN.depth / 2 + 0.2));
  return out.set(c.x, y, c.z);
}

// Откуда смотрит камера слежения. Створки в этом режиме прозрачные,
// но на первом этаже между камерой и кабиной стоит стена холла — и луч
// обязан попасть в дверной проём, иначе весь вид это стена. Поэтому
// боковой снос считается от ширины проёма: на плоскости створок
// отклонение от оси шахты выходит меньше его половины.
const FOLLOW_DEPTH = HALL.corridor * 0.8;
const FOLLOW_SHIFT = ELEVATORS.doorWidth * 1.5;

function followPosition(number, out) {
  const lift = elevators[number - 1];
  const y = (lift.renderY ?? lift.position) + 1.15;
  // Наискосок через коридор, со стороны входа, почти вровень с кабиной:
  // сверху в кадр лезут площадки этажей, а светильник под потолком
  // засвечивает весь вид.
  const p = frontOf(number, FOLLOW_DEPTH, FOLLOW_SHIFT);
  return out.set(p.x, y + 0.6, p.z);
}

function updateCamera(dt) {
  // Камера наблюдения ведёт себя сама: поза, покачивание подвеса,
  // прямоугольник кадра. Орбита в этом режиме выключена.
  if (cameraView.active) {
    cameraView.update(dt);
    hall.setCeilingVisible(cameraView.probeHeight < HALL.height + 0.2);
    building.setRoofVisible(true);
    return;
  }

  if (cameraTween.active) {
    cameraTween.t += dt / cameraTween.duration;
    const k = easeInOutCubic(Math.min(1, cameraTween.t));

    camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, k);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, k);

    if (cameraTween.t >= 1) cameraTween.active = false;
  } else if (followLift) {
    // Слежение: тянемся за кабиной, но мягко — без рывков на разгоне
    camera.position.lerp(followPosition(followLift, _posVec), Math.min(1, dt * 3));
    controls.target.lerp(followTarget(followLift, _targetVec), Math.min(1, dt * 4));
  }

  controls.update();

  // Потолок холла и кровля мешают сверху: прячем их, когда камера выше.
  hall.setCeilingVisible(camera.position.y < HALL.height + 0.2);
  building.setRoofVisible(camera.position.y < BUILDING.height + 2);
}

// Ручное вращение отменяет слежение и перелёт — камера принадлежит зрителю
controls.addEventListener('start', () => {
  cameraTween.active = false;
  followLift = null;
  if (typeof window.__tiuOnCameraGrab === 'function') window.__tiuOnCameraGrab();
});

// ======================= Цикл =======================

let running = false;
let speed = SIM.defaultSpeed;
let accumulator = 0;
let lastTime = performance.now();

// Счётчик кадров. Пока идёт загрузка FBX, кадры идут рывками, и мерить
// по ним качество бессмысленно — поэтому ждём сигнала готовности.
const fps = {
  frames: 0, since: performance.now(), value: 0, ready: false,
  longest: 0, total: 0
};

// Подбор детализации (logic/quality.js). Появляется после загрузки людей.
let quality = null;

/** Хук симуляции: ставится в stage 4, до этого сцена просто живёт. */
let driver = null;

/** Оверлей режима камеры: ставится из logic/bootstrap.js. */
let overlay = null;

function step(dtSim) {
  for (const lift of elevators) lift.beginStep();
  if (driver && driver.beginStep) driver.beginStep();

  if (driver) driver.update(dtSim);
  for (const lift of elevators) lift.update(dtSim);
}

function frame(now) {
  requestAnimationFrame(frame);

  const rawDt = (now - lastTime) / 1000;
  const realDt = Math.min(0.25, rawDt);
  lastTime = now;

  // Копим длительности кадров: по ним отличается разовая остановка
  // от честно низкой частоты (см. measureFps).
  fps.longest = Math.max(fps.longest, rawDt);
  fps.total += Math.min(rawDt, 2);

  if (running) {
    accumulator += realDt;

    let steps = 0;
    while (accumulator >= SIM.fixedStep && steps < SIM.maxStepsPerFrame) {
      step(SIM.fixedStep * speed);
      accumulator -= SIM.fixedStep;
      steps += 1;
    }

    // Если не успели — выбрасываем остаток, иначе долг растёт лавиной
    if (steps === SIM.maxStepsPerFrame) accumulator = 0;
  } else {
    accumulator = 0;
  }

  const alpha = running ? Math.min(1, accumulator / SIM.fixedStep) : 1;

  for (const lift of elevators) lift.render(alpha);
  if (driver) driver.render(alpha, realDt);

  updateCamera(realDt);
  measureFps(now);

  if (cameraView.active) cameraView.renderFrame(renderer, scene);
  else renderer.render(scene, camera);

  // Рамки детекции и табло рисуются после рендера: проекция считается
  // по тем матрицам, которые рендерер только что обновил.
  if (overlay) overlay.frame(realDt);
}

/**
 * Замер FPS раз в полсекунды.
 *
 * Разовая остановка — переключение вкладки, сборка мусора, догрузка
 * модели — это не просадка производительности, и снижать из-за неё
 * детализацию незачем. Но и объявлять заминкой любой долгий кадр
 * нельзя: при 4 FPS долгими будут ВСЕ кадры, и качество не снизится
 * как раз тогда, когда это нужнее всего.
 *
 * Поэтому заминкой считается один кадр, выпавший из ряда: намного
 * длиннее среднего по интервалу. Если же все кадры одинаково долгие —
 * это и есть настоящая частота, и она идёт в подбор детализации.
 */
function measureFps(now) {
  fps.frames += 1;
  const elapsed = now - fps.since;
  if (elapsed < 500) return;

  const average = fps.total / fps.frames;
  const hiccup = fps.frames > 3 && fps.longest > 0.25 && fps.longest > average * 4;

  fps.value = Math.round((fps.frames * 1000) / elapsed);
  fps.frames = 0;
  fps.longest = 0;
  fps.total = 0;
  fps.since = now;

  if (fps.ready && quality && !hiccup) quality.update(fps.value, elapsed / 1000);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ======================= Внешний интерфейс =======================
//
// ui/ и logic/ общаются со сценой только через этот объект.

export const app = {
  THREE, scene, camera, renderer, controls, elevators, hall, building, lighting,
  get running() { return running; },
  get speed() { return speed; },
  get fps() { return fps.value; },
  get quality() { return quality; },
  get qualityName() { return quality ? quality.current.name : '—'; },
  get degraded() { return Boolean(quality) && quality.level < PERF.levels.length - 1; },

  /** Подключается из logic/bootstrap.js, когда люди загружены. */
  attachQuality(instance) {
    quality = instance;
    fps.ready = true;
    fps.frames = 0;
    fps.longest = 0;
    fps.total = 0;
    fps.since = performance.now();
  },

  /** Оверлей рамок детекции и табло (ui/camera-ui.js). */
  setOverlay(value) { overlay = value; },

  play() { running = true; },
  pause() { running = false; },
  toggle() { running = !running; return running; },
  setSpeed(value) { speed = value; },
  setDriver(value) { driver = value; },

  setView, setFollow, flyTo,
  get followLift() { return followLift; },
  views: VIEWS
};

// Режим наблюдения создаётся после app: контроллер держит на него ссылку
const cameraView = new CameraViewController(app);
app.cameraView = cameraView;

window.tiu = app;           // чтобы можно было покрутить из консоли

requestAnimationFrame(frame);

// Стартовый облёт: камера подлетает к холлу, а не появляется там рывком
camera.position.set(18, 10, 16);
controls.target.set(0, 3, 0);
setTimeout(() => setView('hall'), 120);

// Боевая логика подключается отдельным модулем — так этапы не мешают друг другу
import('./logic/bootstrap.js')
  .then((m) => m.boot(app))
  .catch((err) => console.error('[bootstrap] не загрузился:', err));
