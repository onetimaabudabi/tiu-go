/**
 * Человек: загрузка FBX из Mixamo, анимации, ходьба.
 *
 * Как устроено:
 *   • один файл Idle.fbx даёт меш со скелетом — он же эталон для клонов;
 *   • из трёх файлов берутся клипы idle / walk / enter;
 *   • каждый экземпляр — SkeletonUtils.clone(), обычный clone() ломает
 *     привязку мешей к костям и персонаж складывается в точку;
 *   • переключение состояний идёт только через crossFadeTo — резких
 *     подмен поз в сцене нет.
 *
 * Движение: человек всегда идёт к цели с постоянной скоростью, корпус
 * доворачивается отдельно и плавно. Скорость шага анимации привязана
 * к реальной скорости (timeScale = v / WALK.reference), поэтому ноги
 * не «скользят» по полу.
 *
 * Если FBX не загрузился, вместо него собирается программный человечек
 * из цилиндров и сфер — с руками, ногами и анимацией шага.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import { WALK, PERF } from '../logic/params.js';
import { blobShadowTexture } from './textures.js';

// Mixamo отдаёт модели в сантиметрах — ориентир для перевода в метры.
// Фактический масштаб всё равно считается по росту: единицы в FBX
// зависят от настроек экспорта и на них нельзя полагаться.
const MIXAMO_SCALE = 0.01;

// Рост персонажа в сцене. Это размер картинки, а не параметр модели:
// в tech-model/params.js роста нет, там человек описан площадью силуэта.
const PERSON_HEIGHT = 1.75;

const FILES = {
  // Idle.fbx идёт со скином: он же модель, он же анимация стояния
  model: new URL('../assets/people/Idle.fbx', import.meta.url).href,
  walk: new URL('../assets/people/Walking With Shopping Bag.fbx', import.meta.url).href,
  enter: new URL('../assets/people/Standing Up.fbx', import.meta.url).href
};

// ======================= Загрузка =======================

/**
 * Убирает из клипа перемещение корня по горизонтали.
 *
 * Mixamo пишет в дорожку mixamorig:Hips.position реальный проход
 * персонажа вперёд. Позицией человека в сцене управляем мы сами,
 * поэтому смещение по X и Z нужно обнулить — иначе персонаж уезжает
 * вдвое быстрее и по дуге. Вертикальную составляющую оставляем:
 * это покачивание корпуса при шаге.
 */
function makeInPlace(clip) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    if (!/Hips/i.test(track.name)) continue;

    const values = track.values;
    const x0 = values[0];
    const z0 = values[2];

    for (let i = 0; i < values.length; i += 3) {
      values[i] = x0;
      values[i + 2] = z0;
    }
  }
  return clip;
}

/**
 * Phong из FBX → Standard.
 *
 * Отдельно важна прозрачность. FBXLoader помечает прозрачными все
 * материалы Mixamo, хотя дырки есть только у волос и ресниц. Полупрозрачные
 * меши рисуются в отдельном проходе с сортировкой и без раннего отсечения
 * по глубине — на сорока персонажах это сотни лишних миллисекунд. Поэтому
 * тело, одежда и обувь делаются непрозрачными, а волосы переводятся
 * на alphaTest: дырка остаётся, а проход — обычный, непрозрачный.
 */
function toStandard(material) {
  const hasAlpha = Boolean(material.alphaMap);

  if (material.isMeshStandardMaterial) {
    material.roughness = 0.8;
    material.metalness = 0.0;
    material.transparent = false;
    material.alphaTest = hasAlpha ? 0.5 : 0;
    return material;
  }

  const next = new THREE.MeshStandardMaterial({
    name: material.name,
    color: material.color ? material.color.clone() : new THREE.Color(0xcccccc),
    map: material.map || null,
    normalMap: material.normalMap || null,
    alphaMap: material.alphaMap || null,
    transparent: false,
    alphaTest: hasAlpha ? 0.5 : 0,
    side: material.side,
    roughness: 0.8,
    metalness: 0.0
  });

  if (next.map) next.map.colorSpace = THREE.SRGBColorSpace;
  material.dispose();
  return next;
}

/**
 * Грузит модель и три клипа.
 * @param {THREE.LoadingManager} manager  для прогресс-бара
 * @returns {Promise<{model: THREE.Group, clips: object, source: 'fbx'}>}
 */
export async function loadPeopleAssets(manager) {
  const loader = new FBXLoader(manager);
  const load = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

  const [base, walkFile, enterFile] = await Promise.all([
    load(FILES.model), load(FILES.walk), load(FILES.enter)
  ]);

  // ---- модель ----
  const model = base;

  // Сначала меряем модель как есть: единицы в FBX зависят от настроек
  // экспорта, и слепо умножать на 0.01 нельзя — получится великан
  // или муравей. Поэтому нормируем по росту.
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);

  const raw = new THREE.Box3().setFromObject(model);
  const rawSize = raw.getSize(new THREE.Vector3());

  const scale = rawSize.y > 0 ? PERSON_HEIGHT / rawSize.y : MIXAMO_SCALE;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  // Ноги строго на полу: иначе персонаж либо парит, либо тонет
  model.position.y -= box.min.y;
  const size = box.getSize(new THREE.Vector3());

  console.log(
    `[люди] исходный размер ${rawSize.x.toFixed(1)} × ${rawSize.y.toFixed(1)} × ` +
    `${rawSize.z.toFixed(1)} ед., масштаб ${scale.toFixed(4)} ` +
    `(ожидаемый для Mixamo — ${MIXAMO_SCALE})`
  );

  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = false;

    node.material = Array.isArray(node.material)
      ? node.material.map(toStandard)
      : toStandard(node.material);

    // Ограничивающую сферу считаем один раз на эталоне и раздаём клонам.
    // Иначе three пересчитывает её для каждого скина по всем вершинам —
    // это заметный провал кадра при появлении человека. Радиус с запасом:
    // анимация выводит руки и ноги за пределы позы привязки.
    if (node.isSkinnedMesh) {
      node.computeBoundingSphere();
      if (node.boundingSphere) node.boundingSphere.radius *= 1.6;
      node.userData.sharedSphere = node.boundingSphere;
    }
  });

  // ---- клипы ----
  const pick = (file, label) => {
    const list = file.animations || [];
    console.log(
      `[люди] «${label}»: анимаций ${list.length}` +
      (list.length ? `, дорожек ${list.map((c) => c.tracks.length).join('/')}` : '')
    );

    // Берём первый непустой клип: Mixamo иногда кладёт в файл пустую
    // заготовку стека перед настоящей анимацией
    const clip = list.find((c) => c.tracks.length > 0) || list[0];
    if (!clip) throw new Error(`в файле «${label}» нет ни одной анимации`);

    clip.name = label;
    return makeInPlace(clip);
  };

  const clips = {
    idle: pick(base, 'idle'),
    walk: pick(walkFile, 'walk'),
    enter: pick(enterFile, 'enter')
  };

  // Клипы взяты — меши из двух вспомогательных файлов больше не нужны
  disposeTree(walkFile);
  disposeTree(enterFile);

  let meshCount = 0;
  model.traverse((n) => { if (n.isMesh) meshCount += 1; });

  console.log(
    `[люди] модель загружена: ${meshCount} мешей, рост ${size.y.toFixed(2)} м`
  );
  for (const [name, clip] of Object.entries(clips)) {
    console.log(
      `[люди] клип «${name}»: ${clip.tracks.length} дорожек, ` +
      `${clip.duration.toFixed(2)} с`
    );
  }

  return { model, clips, source: 'fbx' };
}

/** Освобождает геометрию и материалы поддерева. */
function disposeTree(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) m?.dispose();
    }
  });
}

// ======================= Запасной персонаж =======================

const fallbackShared = {};

function fbGeo(key, factory) {
  if (!fallbackShared[key]) fallbackShared[key] = factory();
  return fallbackShared[key];
}

/**
 * Программный человечек: голова, корпус, две руки, две ноги.
 * Включается, только если FBX не загрузился. Не куб — у него есть
 * суставы, и он шагает.
 */
function buildFallbackBody(color) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a98b, roughness: 0.85, metalness: 0 });
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9, metalness: 0 });

  const head = new THREE.Mesh(fbGeo('head', () => new THREE.SphereGeometry(0.105, 16, 12)), skin);
  head.position.y = 1.64;
  group.add(head);

  const torso = new THREE.Mesh(
    fbGeo('torso', () => new THREE.CylinderGeometry(0.16, 0.19, 0.58, 12)), cloth
  );
  torso.position.y = 1.18;
  group.add(torso);

  const hips = new THREE.Mesh(
    fbGeo('hips', () => new THREE.CylinderGeometry(0.18, 0.16, 0.18, 12)), pants
  );
  hips.position.y = 0.88;
  group.add(hips);

  const limbs = {};
  const upperArmGeo = fbGeo('upperArm', () => new THREE.CylinderGeometry(0.045, 0.04, 0.3, 8));
  const foreArmGeo = fbGeo('foreArm', () => new THREE.CylinderGeometry(0.04, 0.035, 0.28, 8));
  const thighGeo = fbGeo('thigh', () => new THREE.CylinderGeometry(0.07, 0.06, 0.42, 8));
  const shinGeo = fbGeo('shin', () => new THREE.CylinderGeometry(0.055, 0.045, 0.42, 8));
  const footGeo = fbGeo('foot', () => new THREE.BoxGeometry(0.1, 0.055, 0.22));

  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';

    // Рука: плечевой сустав как точка поворота
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 1.42, 0);
    const upper = new THREE.Mesh(upperArmGeo, cloth);
    upper.position.y = -0.15;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const fore = new THREE.Mesh(foreArmGeo, skin);
    fore.position.y = -0.14;
    elbow.add(fore);
    shoulder.add(elbow);
    group.add(shoulder);

    // Нога
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0.84, 0);
    const thigh = new THREE.Mesh(thighGeo, pants);
    thigh.position.y = -0.21;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    const shin = new THREE.Mesh(shinGeo, pants);
    shin.position.y = -0.21;
    knee.add(shin);

    const foot = new THREE.Mesh(footGeo, new THREE.MeshStandardMaterial({
      color: 0x24282e, roughness: 0.9, metalness: 0
    }));
    foot.position.set(0, -0.44, 0.05);
    knee.add(foot);
    hip.add(knee);
    group.add(hip);

    limbs[`${key}Shoulder`] = shoulder;
    limbs[`${key}Elbow`] = elbow;
    limbs[`${key}Hip`] = hip;
    limbs[`${key}Knee`] = knee;
  }

  group.traverse((n) => { if (n.isMesh) n.castShadow = true; });

  return { group, limbs };
}

// ======================= Упрощённая модель для дальнего плана =======================

/**
 * Силуэт для дальнего плана: корпус, ноги, голова — три меша вместо
 * тридцати пяти тысяч треугольников. Отдельные ноги нужны не для
 * красоты: одна сплошная капсула на общем плане читается как столбик,
 * а не как человек.
 */
function buildLodBody(color, pantsColor) {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(
    fbGeo('lodTorso', () => new THREE.CapsuleGeometry(0.17, 0.5, 3, 7)),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })
  );
  torso.position.y = 1.16;
  group.add(torso);

  const legs = new THREE.Mesh(
    fbGeo('lodLegs', () => new THREE.CapsuleGeometry(0.145, 0.5, 3, 7)),
    new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.95, metalness: 0 })
  );
  legs.position.y = 0.52;
  group.add(legs);

  const head = new THREE.Mesh(
    fbGeo('lodHead', () => new THREE.SphereGeometry(0.108, 8, 6)),
    new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.9, metalness: 0 })
  );
  head.position.y = 1.6;
  group.add(head);

  return group;
}

// ======================= Person =======================

// Цвета одежды — чтобы толпа не выглядела клонированной.
// Модель Mixamo одна на всех, поэтому различаем людей подкраской
// материалов верха и низа: текстуры у Remy светло-серые, и умножение
// на цвет читается как другая футболка, а не как цветной фильтр.
// Цвет умножается на текстуру, поэтому значения светлые: тёмный тон
// в умножении даёт почти чёрное пятно вместо куртки.
const CLOTHES = [0x9fb8d8, 0xd8a593, 0xa8c9a6, 0xc5a8cc, 0xe0d2a8, 0xb8bec6, 0xd49f9f];
const PANTS = [0x8e9bb0, 0xa89a86, 0x8aa0ad, 0x9c93ae, 0x97a2ab, 0xb0a28e];

// Какие материалы Mixamo подкрашиваем
const TOP_MATERIALS = /top/i;
const BOTTOM_MATERIALS = /bottom|shoe/i;

let personSeq = 0;

export class Person {
  /**
   * @param {object|null} assets  { model, clips } или null — тогда запасной человечек
   */
  constructor(assets) {
    this.id = ++personSeq;
    this.color = CLOTHES[this.id % CLOTHES.length];
    this.pantsColor = PANTS[(this.id * 3) % PANTS.length];

    // Корень, который двигает симулятор
    this.root = new THREE.Group();
    this.root.name = `person-${this.id}`;

    // Небольшой разброс роста: толпа из одинаковых людей читается как копипаста
    this.heightScale = 0.94 + ((this.id * 37) % 13) / 100;

    this.currentState = 'idle';
    this.usingFbx = false;
    this.lodFar = false;

    if (assets && assets.model) this.#buildFbx(assets);
    else this.#buildFallback();

    this.#buildLod();
    this.#buildBlobShadow();

    // ---- движение ----
    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.heading = 0;
    this.prevHeading = 0;
    this.targetHeading = 0;

    this.path = [];
    this.speed = WALK.speed + (((this.id * 53) % 21) - 10) / 100 * WALK.speedJitter * 10;
    this.onArrive = null;

    // ---- появление и исчезновение ----
    this.opacity = 0;
    this.fading = 1;          // +1 появляется, −1 исчезает, 0 стабилен
    this.dead = false;

    this.#applyOpacity(0);
  }

  get object3D() { return this.root; }

  // ---------- сборка ----------

  #buildFbx({ model, clips }) {
    // Обычный clone() не копирует привязку скелета: нужен SkeletonUtils
    this.mesh = SkeletonUtils.clone(model);
    this.mesh.scale.multiplyScalar(this.heightScale);

    // Материалы клонируем, чтобы подкрасить одежду и управлять прозрачностью
    this.materials = [];
    this.mesh.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.frustumCulled = true;
      if (node.userData.sharedSphere) node.boundingSphere = node.userData.sharedSphere;

      // Материалы клонируем, чтобы гасить человека по отдельности
      // и подкрашивать одежду. Прозрачность включается только
      // на время появления и ухода.
      const clone = (m) => {
        const c = m.clone();

        if (TOP_MATERIALS.test(c.name)) c.color.setHex(this.color);
        else if (BOTTOM_MATERIALS.test(c.name)) c.color.setHex(this.pantsColor);

        this.materials.push(c);
        return c;
      };

      node.material = Array.isArray(node.material)
        ? node.material.map(clone)
        : clone(node.material);
    });

    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.actions = {
      idle: this.mixer.clipAction(clips.idle),
      walk: this.mixer.clipAction(clips.walk),
      enter: this.mixer.clipAction(clips.enter)
    };

    for (const action of Object.values(this.actions)) {
      action.enabled = true;
      action.setEffectiveWeight(0);
    }

    // Рассинхронизируем фазу: иначе вся очередь дышит в такт
    this.actions.idle.time = Math.random() * clips.idle.duration;
    this.actions.idle.setEffectiveWeight(1);
    this.actions.idle.play();

    this.usingFbx = true;
    this.root.add(this.mesh);
  }

  #buildFallback() {
    const { group, limbs } = buildFallbackBody(this.color);
    group.scale.setScalar(this.heightScale);

    this.mesh = group;
    this.limbs = limbs;
    this.materials = [];
    group.traverse((node) => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) this.materials.push(m);
    });

    this.gaitPhase = Math.random() * Math.PI * 2;
    this.usingFbx = false;
    this.root.add(group);
  }

  #buildLod() {
    // Приглушаем цвет: на дальнем плане пастель выглядит белым пятном
    const muted = new THREE.Color(this.color).multiplyScalar(0.72).getHex();
    const pants = new THREE.Color(this.pantsColor).multiplyScalar(0.6).getHex();

    this.lodMesh = buildLodBody(muted, pants);
    this.lodMesh.scale.setScalar(this.heightScale);
    this.lodMesh.visible = false;

    this.lodMaterials = [];
    this.lodMesh.traverse((node) => {
      if (!node.isMesh) return;
      node.material = node.material.clone();
      this.lodMaterials.push(node.material);
    });

    this.root.add(this.lodMesh);
  }

  /** Мягкое пятно под ногами: работает и тогда, когда тени отключены. */
  #buildBlobShadow() {
    const blob = new THREE.Mesh(
      fbGeo('blob', () => new THREE.PlaneGeometry(0.72, 0.72)),
      new THREE.MeshBasicMaterial({
        map: blobShadowTexture(),
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    blob.renderOrder = 2;

    this.blob = blob;
    this.root.add(blob);
  }

  // ---------- состояния ----------

  /**
   * Переключение анимации. Всегда через кроссфейд — это и есть
   * «никаких резких переключений» из постановки задачи.
   */
  setState(name, fadeDuration = WALK.fade) {
    if (this.currentState === name) return;
    if (!this.actions || !this.actions[name]) {
      this.currentState = name;
      return;
    }

    const from = this.actions[this.currentState];
    const to = this.actions[name];

    to.reset();
    to.setEffectiveWeight(1);
    to.play();

    if (from && from !== to) {
      from.setEffectiveWeight(1);
      from.crossFadeTo(to, fadeDuration, true);
    }

    this.currentState = name;
  }

  // ---------- перемещение ----------

  /** Мгновенная установка позиции — только при появлении на сцене. */
  placeAt(x, y, z) {
    this.position.set(x, y, z);
    this.prevPosition.copy(this.position);
    this.root.position.copy(this.position);
  }

  /** Развернуть корпус в сторону точки (мгновенно). */
  faceTo(x, z) {
    this.heading = Math.atan2(x - this.position.x, z - this.position.z);
    this.prevHeading = this.heading;
    this.targetHeading = this.heading;
    this.root.rotation.y = this.heading;
  }

  /** Идти по точкам. Последняя точка — конечная цель. */
  walkPath(points, onArrive = null) {
    this.path = points.map((p) => ({ x: p.x, y: p.y ?? this.position.y, z: p.z }));
    this.onArrive = onArrive;
    if (this.path.length) this.setState('walk');
  }

  /** Идти в одну точку. */
  moveTo(x, z, onArrive = null, y = null) {
    this.walkPath([{ x, z, y: y ?? this.position.y }], onArrive);
  }

  /** Отменить маршрут и встать. */
  stop() {
    this.path.length = 0;
    this.onArrive = null;
    this.setState('idle');
  }

  get walking() { return this.path.length > 0; }

  /**
   * Пересадить человека внутрь кабины.
   *
   * Пока он едет, его положением управляет сама кабина: так движение
   * лифта и пассажиров гарантированно совпадает до пикселя, и никакой
   * рассинхронизации при разгоне быть не может.
   */
  attachTo(parent, local) {
    parent.add(this.root);
    this.root.position.set(local.x, local.y || 0, local.z);
    this.root.rotation.y = 0;          // лицом к дверям, они по +Z кабины
    this.attached = true;
    this.path.length = 0;
    this.setState('idle');
  }

  /** Вернуть человека в мировые координаты у выхода из кабины. */
  detachTo(scene, worldPosition) {
    scene.add(this.root);
    this.attached = false;
    this.placeAt(worldPosition.x, worldPosition.y, worldPosition.z);
    this.root.rotation.y = this.heading;
  }

  /** Плавное исчезновение: человек ушёл за кадр. */
  fadeOut() {
    if (this.fading === -1) return;
    this.fading = -1;
    this.fadeSpeed = 1 / WALK.fadeOut;
  }

  // ---------- шаг ----------

  beginStep() {
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;
  }

  update(dt) {
    if (this.dead) return;

    if (!this.attached) this.#stepMove(dt);
    this.#stepFade(dt);

    if (this.mixer) {
      // Скорость шага привязана к реальной скорости — ноги не скользят
      if (this.actions && this.actions.walk) {
        this.actions.walk.timeScale = this.currentState === 'walk'
          ? Math.max(0.35, this.speed / WALK.reference)
          : 1;
      }
      this.mixer.update(dt);
    } else if (this.limbs) {
      this.#stepFallbackGait(dt);
    }
  }

  #stepMove(dt) {
    if (!this.path.length) {
      if (this.currentState === 'walk') this.setState('idle');
      return;
    }

    const target = this.path[0];
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);

    // Доворот корпуса — отдельно от движения, иначе человек «виляет»
    if (distance > 0.001) {
      this.targetHeading = Math.atan2(dx, dz);
      this.heading = turnTowards(this.heading, this.targetHeading, WALK.turnSpeed * dt);
    }

    // Вертикаль (этаж) подтягиваем мягко: лифт мог сместиться
    if (target.y !== undefined) {
      this.position.y += (target.y - this.position.y) * Math.min(1, dt * 8);
    }

    if (distance <= WALK.arriveEpsilon) {
      this.position.x = target.x;
      this.position.z = target.z;
      this.path.shift();

      if (!this.path.length) {
        this.setState('idle');
        const done = this.onArrive;
        this.onArrive = null;
        if (done) done(this);
      }
      return;
    }

    // Притормаживаем на последнем полуметре — так остановка не резкая
    const slow = this.path.length === 1 ? Math.min(1, 0.35 + distance / 0.6) : 1;
    const stepLength = Math.min(distance, this.speed * slow * dt);

    this.position.x += (dx / distance) * stepLength;
    this.position.z += (dz / distance) * stepLength;

    if (this.currentState !== 'walk') this.setState('walk');
  }

  #stepFade(dt) {
    if (this.fading === 0) return;

    const rate = this.fadeSpeed || (1 / WALK.fadeIn);
    this.opacity = THREE.MathUtils.clamp(this.opacity + this.fading * rate * dt, 0, 1);

    if (this.fading > 0 && this.opacity >= 1) this.fading = 0;
    if (this.fading < 0 && this.opacity <= 0) this.dead = true;
  }

  /** Походка запасного человечка: противофазный мах руками и ногами. */
  #stepFallbackGait(dt) {
    const walking = this.currentState === 'walk';
    const speed = walking ? this.speed / WALK.reference : 0;

    this.gaitPhase += dt * (walking ? 7.5 * speed : 1.6);

    const swing = walking ? Math.sin(this.gaitPhase) * 0.6 : Math.sin(this.gaitPhase) * 0.03;
    const bend = walking ? Math.max(0, -Math.cos(this.gaitPhase)) * 0.7 : 0;

    this.limbs.leftHip.rotation.x = swing;
    this.limbs.rightHip.rotation.x = -swing;
    this.limbs.leftKnee.rotation.x = -bend;
    this.limbs.rightKnee.rotation.x = -Math.max(0, Math.cos(this.gaitPhase)) * 0.7;

    this.limbs.leftShoulder.rotation.x = -swing * 0.7;
    this.limbs.rightShoulder.rotation.x = swing * 0.7;
    this.limbs.leftElbow.rotation.x = -Math.abs(swing) * 0.4;
    this.limbs.rightElbow.rotation.x = -Math.abs(swing) * 0.4;

    // Лёгкое покачивание корпуса
    this.mesh.position.y = walking ? Math.abs(Math.sin(this.gaitPhase)) * 0.025 : 0;
  }

  // ---------- отрисовка ----------

  render(alpha, cameraPosition) {
    if (this.dead) return;

    // Пока человек внутри кабины, его локальная позиция фиксирована,
    // а мировую считает сама кабина — трогать её нельзя.
    if (!this.attached) {
      this.root.position.lerpVectors(this.prevPosition, this.position, alpha);
      this.root.rotation.y = lerpAngle(this.prevHeading, this.heading, alpha);
    }

    this.#applyOpacity(this.opacity);
  }

  /** Мировая позиция — нужна толпе для сортировки по дальности. */
  worldPosition(target) {
    return this.attached
      ? this.root.getWorldPosition(target)
      : target.copy(this.root.position);
  }

  #applyOpacity(value) {
    if (this.lastOpacity === value) return;
    this.lastOpacity = value;

    // transparent переключаем вместе с прозрачностью: пока человек
    // виден полностью, его меши идут обычным непрозрачным проходом.
    const fading = value < 0.999;

    for (const m of this.materials) { m.opacity = value; m.transparent = fading; }
    for (const m of this.lodMaterials) { m.opacity = value; m.transparent = fading; }

    this.blob.material.opacity = value * 0.55;
    this.root.visible = value > 0.01;
  }

  /**
   * Дальний план — упрощённая модель без анимации.
   *
   * Решение принимает толпа: она знает и расстояние, и бюджет полных
   * моделей. Здесь только переключение, и переключается оно мгновенно,
   * но на расстоянии, где подмена силуэта не читается.
   */
  setFar(far) {
    if (far === this.lodFar) return;
    this.lodFar = far;

    this.mesh.visible = !far;
    this.lodMesh.visible = far;

    // Остановленный микшер не тратит время на пересчёт 53 дорожек
    if (this.mixer) this.mixer.timeScale = far ? 0 : 1;
  }

  /** Тень от конкретного человека — включается только для ближних. */
  setShadow(enabled) {
    if (this.shadowOn === enabled) return;
    this.shadowOn = enabled;
    this.mesh.traverse((n) => { if (n.isMesh) n.castShadow = enabled; });
  }

  dispose() {
    if (this.mixer) this.mixer.stopAllAction();
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const m of this.lodMaterials) m.dispose();
  }
}

// ======================= Мелочи =======================

const _tmp = new THREE.Vector3();

/** Доворот угла к цели не длиннее чем на maxStep, по кратчайшей дуге. */
function turnTowards(current, target, maxStep) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;

  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

/** Интерполяция углов по кратчайшей дуге — иначе персонаж крутится волчком. */
function lerpAngle(from, to, alpha) {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}
