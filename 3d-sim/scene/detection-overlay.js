/**
 * Рамки детекции поверх 3D-сцены.
 *
 * Выбран canvas-оверлей, а не CSS2DRenderer: рамок в кадре десятки,
 * каждая со своей прозрачностью и подписью, и держать на каждую по
 * DOM-узлу — это пересчёт стилей на каждом кадре. Рисование в canvas
 * стоит один проход и даёт полный контроль над проявлением и цветом.
 *
 * Прямоугольник считается проекцией габаритной коробки человека:
 * восемь углов переводятся в экранные координаты, из них берутся
 * крайние. Проецировать одну точку нельзя — рамка получилась бы
 * одинаковой у ближнего и дальнего человека.
 *
 * Детектор намеренно работает с ошибками технической модели:
 *   • falseNegativeRate — человек появляется в кадре, а рамки нет
 *     ещё секунду-две: «детектор его не видит»;
 *   • falsePositiveRate — на пустом месте вспыхивает ложная рамка;
 *   • occludedPersonPenalty — у перекрытого человека уверенность
 *     падает, и рамка желтеет;
 *   • показания обновляются с частотой камеры (camera.fps), а не
 *     каждый кадр: иначе цифры дрожали бы быстрее, чем читаются.
 */

import * as THREE from 'three';
import { CABIN, tech } from '../logic/params.js';

const CAM = tech.camera;

// Пороги цвета рамки
const SURE = 0.8;        // выше — зелёная
const DOUBT = 0.5;       // ниже — красная

const COLOR = {
  sure: '#00ff88',       // 0x00FF88 из постановки
  partial: '#ffd166',
  doubt: '#ff5a52',
  ghost: '#ff5a52'
};

// Ширина силуэта в долях роста: примерно 0,72 м на 1,7 м роста —
// столько занимает человек в кадре вместе с плечами и шагом.
const PERSON_ASPECT = 0.42;

/*
 * Когда человек считается перекрытым.
 *
 * Рамки соседей по очереди пересекаются всегда — люди стоят в полуметре
 * друг от друга, и габаритные коробки задевают одна другую, хотя никто
 * никого не загораживает. Поэтому перекрытием считается только то, что
 * закрывает кто-то, стоящий ЗА ближним планом: ближе к камере минимум
 * на DEPTH_GAP метров и перекрывающий больше OVERLAP_MIN площади рамки.
 */
const OVERLAP_MIN = 0.3;
const DEPTH_GAP = 0.35;

// Насколько сильнее штраф у полностью закрытого по сравнению с едва
// задетым. Вместе с occludedPersonPenalty даёт диапазон 0,60–0,77
// при точности модели 0,92 — то есть жёлтую рамку, как и задумано.
const OCCLUSION_SPREAD = 0.17;

// Сколько секунд рамка проявляется
const FADE_IN = 0.2;

// Через сколько секунд после пропажи из кадра забываем человека
const FORGET = 2.0;

// Ложная рамка живёт полсекунды
const GHOST_TTL = 0.5;

// Разброс показаний уверенности на каждом замере
const JITTER = 0.05;

export class DetectionOverlay {
  /**
   * @param {HTMLCanvasElement} canvas  полноэкранный canvas поверх сцены
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.options = {
      boxes: true,          // рисовать рамки
      ids: true,            // подписывать идентификатор
      confidence: true,     // подписывать уверенность
      base: CAM.map50       // «точность детектора» с ползунка
    };

    // Состояние по каждому человеку: id → { conf, fade, missing, lastSeen }
    this.tracks = new Map();
    // Ложные срабатывания по видам: viewId → [{ x, y, w, h, ttl, conf }]
    this.ghosts = new Map();

    // Замеры идут с частотой камеры, а не кадра
    this.tick = 0;
    this.period = 1 / (CAM.fps || 30);

    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._dpr = 1;
  }

  setOptions(patch) {
    Object.assign(this.options, patch);
  }

  /** Забыть всё: при выходе из режима и при сбросе дня. */
  reset() {
    this.tracks.clear();
    this.ghosts.clear();
    this.clear();
  }

  clear() {
    const { canvas, ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Начало кадра: подгоняем размер под окно, чистим, двигаем время.
   * Возвращает true, если пора пересчитать показания детектора.
   */
  beginFrame(dt) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.canvas.width !== Math.round(w * dpr) ||
        this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }

    this._dpr = dpr;
    this.clear();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.tick += dt;
    const measure = this.tick >= this.period;
    if (measure) this.tick = 0;

    this.#forget(dt);
    return measure;
  }

  /** Убираем из памяти тех, кто давно вне кадра. */
  #forget(dt) {
    for (const [id, track] of this.tracks) {
      track.lastSeen += dt;
      if (track.lastSeen > FORGET) this.tracks.delete(id);
    }
  }

  /**
   * Рамки одного вида.
   *
   * @param {object}  view
   * @param {THREE.Camera} view.camera
   * @param {{x,y,w,h}}    view.rect    прямоугольник вида в CSS-пикселях
   * @param {number}       view.floor   этаж камеры — людей с других не берём
   * @param {Array}        people       список Person из толпы
   * @param {number}       dt
   * @param {boolean}      measure      пора ли пересчитать показания
   * @returns {{inFrame: number, detected: number, boxes: Array}}
   */
  drawView(view, people, dt, measure) {
    const { camera, rect } = view;
    const ctx = this.ctx;

    camera.updateMatrixWorld();
    const inverse = camera.matrixWorldInverse;

    // ---------- кто в кадре ----------

    const seen = [];

    for (const person of people) {
      if (!person.root.visible || person.opacity < 0.15) continue;

      const pos = person.worldPosition(this._v);

      // Камера видит только свой этаж: перекрытия снизу и сверху
      // в проекции не участвуют, поэтому отсекаем по высоте.
      const base = view.floorY;
      if (pos.y < base - 0.4 || pos.y > base + 2.8) continue;

      // Позади камеры и слишком близко — не кадр
      const local = this._c.copy(pos).applyMatrix4(inverse);
      if (local.z > -0.35) continue;

      // Дальность снимаем здесь: вектор _c дальше переиспользует
      // проекция, и после неё в local лежало бы уже другое.
      const distance = -local.z;

      const height = CABIN.personHeight * (person.heightScale || 1);
      const box = this.#project(camera, rect, pos, height);
      if (!box) continue;

      seen.push({ person, box, distance });
    }

    // Ближние рисуются поверх дальних, и перекрытие считается
    // «дальнего ближним», а не наоборот.
    seen.sort((a, b) => a.distance - b.distance);

    // ---------- показания детектора ----------

    for (let i = 0; i < seen.length; i += 1) {
      const item = seen[i];
      item.overlap = 0;

      for (let j = 0; j < i; j += 1) {
        // seen отсортирован по дальности: j ближе к камере, чем i.
        // Загораживает только тот, кто стоит заметно впереди.
        if (seen[j].distance > item.distance - DEPTH_GAP) continue;
        item.overlap = Math.max(item.overlap, overlapShare(item.box, seen[j].box));
      }

      item.track = this.#track(item.person.id, dt, measure, item.overlap);
    }

    const detected = seen.filter((s) => s.track.visible).length;

    // ---------- отрисовка ----------

    if (this.options.boxes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();

      for (const item of seen) {
        if (!item.track.visible) continue;
        this.#drawBox(item.box, item.track.conf, item.person.id, item.track.fade);
      }

      this.#drawGhosts(view, dt, seen.length, measure);
      ctx.restore();
    }

    return { inFrame: seen.length, detected, boxes: seen };
  }

  /**
   * Состояние трека: уверенность, проявление, пропуск детектора.
   *
   * Пропуск разыгрывается один раз на появление человека в кадре —
   * ровно как в технической модели, где falseNegativeRate это
   * вероятность не увидеть человека на замере, а не на кадре.
   */
  #track(id, dt, measure, overlap) {
    let track = this.tracks.get(id);

    if (!track) {
      const missed = Math.random() < CAM.falseNegativeRate;
      track = {
        conf: this.options.base,
        fade: 0,
        // Пропущенный появляется через 1–2 с
        missing: missed ? 1 + Math.random() : 0,
        lastSeen: 0
      };
      this.tracks.set(id, track);
    }

    track.lastSeen = 0;

    if (track.missing > 0) {
      track.missing -= dt;
      track.visible = false;
      return track;
    }

    track.fade = Math.min(1, track.fade + dt / FADE_IN);
    track.visible = true;

    if (measure) {
      // Базовая уверенность — с ползунка (по умолчанию mAP@50 модели).
      // Перекрытие стоит occludedPersonPenalty плюс добавку за то,
      // насколько человек закрыт: чем больше спрятано, тем ниже.
      const hidden = overlap > OVERLAP_MIN
        ? (overlap - OVERLAP_MIN) / (1 - OVERLAP_MIN)
        : 0;
      const penalty = overlap > OVERLAP_MIN
        ? CAM.occludedPersonPenalty + hidden * OCCLUSION_SPREAD
        : 0;

      const jitter = (Math.random() * 2 - 1) * JITTER;
      track.conf = clamp(this.options.base - penalty + jitter, 0.2, 0.99);
    }

    return track;
  }

  /** Ложные срабатывания: вспыхивают на пустом месте и гаснут. */
  #drawGhosts(view, dt, inFrame, measure) {
    const id = view.def ? view.def.id : 'single';
    let list = this.ghosts.get(id);
    if (!list) { list = []; this.ghosts.set(id, list); }

    // Частота как в модели: ложное срабатывание возможно на каждого
    // кандидата в кадре (и ещё одного «лишнего»), поэтому в пустом
    // холле ложных рамок почти не бывает, а в толпе они проскакивают.
    //
    // Ползунок точности участвует здесь же: опустили его ниже mAP@50
    // модели — детектор стал слабее, и ложных рамок становится
    // пропорционально больше потерянной точности.
    const slack = Math.max(0, (CAM.map50 - this.options.base) / Math.max(0.01, CAM.map50));
    const rate = CAM.falsePositiveRate * (1 + slack * 6) * (inFrame + 1);
    if (measure && list.length < 2 && Math.random() < rate * this.period) {
      list.push(makeGhost(view.rect));
    }

    for (let i = list.length - 1; i >= 0; i -= 1) {
      const ghost = list[i];
      ghost.ttl -= dt;
      if (ghost.ttl <= 0) { list.splice(i, 1); continue; }

      // Ложная рамка так же проявляется и так же гаснет
      const fade = Math.min(1, (GHOST_TTL - ghost.ttl) / 0.12, ghost.ttl / 0.2);
      this.#drawBox(ghost, ghost.conf, ghost.id, fade, true);
    }
  }

  /**
   * Рамка человека в экранных координатах.
   *
   * Берётся ось «подошвы — макушка»: две точки проецируются, высота
   * рамки это расстояние между ними, ширина — доля от высоты.
   * Проецировать габаритный параллелепипед нельзя: камера смотрит
   * сверху, и его нижние углы уезжают далеко в стороны — рамка
   * получается вдвое шире человека. Детектор обводит силуэт.
   */
  #project(camera, rect, pos, height) {
    const toScreen = (y, out) => {
      this._c.set(pos.x, y, pos.z).project(camera);
      out.x = rect.x + (this._c.x + 1) / 2 * rect.w;
      out.y = rect.y + (1 - this._c.y) / 2 * rect.h;
      return out;
    };

    const feet = toScreen(pos.y + 0.02, _feet);
    const head = toScreen(pos.y + height, _head);

    const h = feet.y - head.y;

    // Совсем мелкие рамки не рисуем: детектор такого человека
    // не нашёл бы — в кадре от него десяток пикселей.
    if (!(h > 14)) return null;

    const w = h * PERSON_ASPECT;
    const x = (feet.x + head.x) / 2 - w / 2;

    // Целиком за границами вида
    if (x + w < rect.x || x > rect.x + rect.w) return null;
    if (feet.y < rect.y || head.y > rect.y + rect.h) return null;

    return { x, y: head.y, w, h };
  }

  /** Одна рамка с подписью. */
  #drawBox(box, conf, id, fade, ghost = false) {
    const ctx = this.ctx;
    const color = ghost
      ? COLOR.ghost
      : conf >= SURE ? COLOR.sure : conf >= DOUBT ? COLOR.partial : COLOR.doubt;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    roundRect(ctx, box.x, box.y, box.w, box.h, 4);
    ctx.stroke();

    const label = this.#label(id, conf, ghost);
    if (label) {
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const padding = 4;
      const width = ctx.measureText(label).width + padding * 2;
      const height = 15;
      const ly = Math.max(box.y - height - 2, 1);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      roundRect(ctx, box.x, ly, width, height, 3);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, box.x + padding, ly + height / 2 + 0.5);
    }

    ctx.restore();
  }

  #label(id, conf, ghost) {
    const parts = [];
    if (this.options.ids) parts.push(ghost ? 'P-???' : personTag(id));
    if (this.options.confidence) parts.push(conf.toFixed(2));
    return parts.join('  ');
  }

  /** Разделители между видами мульти-камеры. */
  drawDivider(rect) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.restore();
  }

  /** Подпись вида в мульти-камере: номер, этаж, счётчик, точка записи. */
  drawViewLabel(rect, def, counts, blink) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';

    const text = `${def.id} · ${def.name}`;
    const stat = `в кадре ${counts.inFrame} · детектор ${counts.detected}`;
    const width = Math.max(ctx.measureText(text).width, ctx.measureText(stat).width) + 34;

    // Подпись снизу: сверху кадр перекрывает панель режима
    const top = rect.y + rect.h - 52;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    roundRect(ctx, rect.x + 8, top, width, 40, 6);
    ctx.fill();

    if (blink) {
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(rect.x + 19, top + 13, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#d8e2ec';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, rect.x + 29, top + 13);

    ctx.fillStyle = COLOR.sure;
    ctx.fillText(stat, rect.x + 16, top + 30);
    ctx.restore();
  }
}

// ======================= Вспомогательное =======================

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Доля площади a, перекрытая b. */
function overlapShare(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = a.w * a.h;
  return area > 0 ? (x * y) / area : 0;
}

/** Идентификатор человека в формате системы наблюдения: P-017. */
function personTag(id) {
  return `P-${String(id % 1000).padStart(3, '0')}`;
}

/** Ложная рамка: случайное место в кадре, низкая уверенность. */
function makeGhost(rect) {
  const h = 60 + Math.random() * 90;
  return {
    x: rect.x + 30 + Math.random() * Math.max(1, rect.w - 120),
    y: rect.y + rect.h * 0.35 + Math.random() * Math.max(1, rect.h * 0.4 - h / 2),
    w: h * 0.42,
    h,
    ttl: GHOST_TTL,
    conf: 0.3 + Math.random() * 0.18,
    id: 0
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Экранные точки подошв и макушки — чтобы не плодить объекты на кадр
const _feet = { x: 0, y: 0 };
const _head = { x: 0, y: 0 };

export { personTag };
