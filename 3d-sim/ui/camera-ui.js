/**
 * Оверлеи режима наблюдения: счётчики, запись, время, мини-карта,
 * панель управления кадром.
 *
 * Модуль не знает, как устроена сцена: он спрашивает у app.cameraView,
 * какие виды сейчас в кадре, отдаёт их DetectionOverlay и подписывает
 * то, что получилось. Счётчики очередей берутся прямо у симулятора —
 * из тех же объектов, по которым считается панель «Что происходит»,
 * поэтому цифры в кадре и в статистике сходятся по определению.
 *
 * Про частоту обновления. Рамки рисуются каждый кадр, иначе они
 * отстают от людей. Текст в оверлее — четыре раза в секунду: цифра,
 * меняющаяся 60 раз в секунду, не читается, а перерисовка DOM на
 * каждом кадре отъедает кадровый бюджет. Мини-карта — 20 раз.
 */

import { DetectionOverlay } from '../scene/detection-overlay.js';
import {
  ELEVATORS, HALL, tech, floorY, liftAnchor, frontOf
} from '../logic/params.js';
import { posePlan } from '../scene/camera-view.js';

const CAM = tech.camera;

// Как часто обновляется текст и мини-карта, с
const TEXT_PERIOD = 0.25;
const MAP_PERIOD = 0.05;

// Мини-карта
const MAP_W = 200;
const MAP_H = 150;
const MAP_PAD = 8;

const MAP_COLOR = {
  floor: 'rgba(255, 255, 255, 0.05)',
  zone: 'rgba(232, 195, 58, 0.26)',
  zoneLine: 'rgba(232, 195, 58, 0.55)',
  door: '#8d979f',
  doorWorking: '#d8e2ec',
  person: '#4b8cf7',
  entrance: '#4ad991',
  camera: '#ff5a52',
  fov: 'rgba(255, 90, 82, 0.16)'
};

export function createCameraUi(app, sim) {
  const $ = (id) => document.getElementById(id);

  const canvas = $('detect');
  const frameBox = $('cam-frame');
  const cctv = $('cctv');
  const hud = $('cam-hud');
  const panel = $('panel-cam');
  const mapBox = $('cam-minimap');
  const mapCanvas = $('minimap-canvas');

  const elTitle = $('cam-title');
  const elCount = $('cam-count');
  const elWord = $('cam-count-word');
  const elDetect = $('cam-detect');
  const elQueues = $('cam-queues');
  const elClock = $('cam-clock');
  const elFooter = $('cctv-footer');

  const overlay = new DetectionOverlay(canvas);
  const mapCtx = mapCanvas.getContext('2d');

  let shown = false;
  let textTimer = 0;
  let mapTimer = 0;

  // Строки «Ждут Лифт N» собираются один раз: лифты не появляются
  // и не исчезают по ходу дня.
  const queueCells = new Map();
  for (const number of ELEVATORS.working) {
    const dt = document.createElement('dt');
    dt.textContent = `Ждут Лифт ${number}`;

    const dd = document.createElement('dd');
    dd.textContent = '0';

    elQueues.append(dt, dd);
    queueCells.set(number, dd);
  }

  elFooter.textContent = `REC · ${CAM.fps} FPS · ${CAM.resolution}`;

  // ---------- панель режима ----------

  const toggles = {
    boxes: $('cam-opt-boxes'),
    ids: $('cam-opt-ids'),
    confidence: $('cam-opt-conf'),
    cctv: $('cam-opt-cctv'),
    multi: $('cam-opt-multi')
  };

  const slider = $('cam-confidence');
  const sliderValue = $('cam-confidence-value');

  function applyOptions() {
    overlay.setOptions({
      boxes: toggles.boxes.checked,
      ids: toggles.ids.checked,
      confidence: toggles.confidence.checked,
      base: Number(slider.value) / 100
    });
    cctv.classList.toggle('is-off', !toggles.cctv.checked);
    document.body.classList.toggle('cam-plain', !toggles.cctv.checked);
  }

  for (const key of ['boxes', 'ids', 'confidence', 'cctv']) {
    toggles[key].addEventListener('change', applyOptions);
  }

  toggles.multi.addEventListener('change', () => {
    app.cameraView.setMulti(toggles.multi.checked);
    refreshChrome();
  });

  slider.addEventListener('input', () => {
    sliderValue.textContent = (Number(slider.value) / 100).toFixed(2);
    applyOptions();
  });

  // Ползунок стартует с точности модели — mAP@50 из tech-model
  slider.value = String(Math.round(CAM.map50 * 100));
  sliderValue.textContent = CAM.map50.toFixed(2);
  applyOptions();

  // Выход возвращает обычный вид холла. Зовём через хук панели
  // управления, чтобы подсветка её кнопок не разъехалась с экраном.
  $('cam-exit').addEventListener('click', () => {
    if (typeof window.__tiuSetView === 'function') window.__tiuSetView('hall');
    else app.cameraView.exit();
  });

  // ---------- показ и скрытие ----------

  /** Элементы, которые есть только в одиночном виде. */
  function refreshChrome() {
    const multi = app.cameraView.multi;
    hud.hidden = multi;
    mapBox.hidden = multi;
    cctv.hidden = multi;              // на четырёх видах шум мешает читать
  }

  function show() {
    shown = true;
    canvas.hidden = false;
    frameBox.hidden = false;
    panel.hidden = false;
    document.body.classList.add('cam-mode');
    refreshChrome();
    overlay.reset();
    draw();
  }

  function hide() {
    shown = false;
    canvas.hidden = true;
    frameBox.hidden = true;
    panel.hidden = true;
    document.body.classList.remove('cam-mode');
    overlay.reset();
  }

  /** Прямоугольник кадра переносим на DOM-оверлеи. */
  function placeFrame(rect) {
    frameBox.style.left = `${rect.x}px`;
    frameBox.style.top = `${rect.y}px`;
    frameBox.style.width = `${rect.w}px`;
    frameBox.style.height = `${rect.h}px`;
  }

  // ---------- кадр ----------

  const counts = new Map();     // id вида → { inFrame, detected }

  /**
   * Зовётся из main.js после renderer.render — проекция считается по
   * матрицам, которые рендерер только что обновил.
   */
  function frame(dt) {
    const view = app.cameraView;

    if (!view.active) {
      if (shown) hide();
      return;
    }

    if (!shown) show();

    placeFrame(view.rect);

    const people = app.crowd ? app.crowd.people : [];
    const measure = overlay.beginFrame(dt);
    const blink = Math.floor(performance.now() / 600) % 2 === 0;

    for (const item of view.views) {
      const target = {
        camera: item.camera,
        rect: item.rect,
        def: item.def,
        floorY: floorY(item.def.floor)
      };

      const result = overlay.drawView(target, people, dt, measure);
      counts.set(item.def.id, result);

      if (view.multi) {
        overlay.drawDivider(item.rect);
        overlay.drawViewLabel(item.rect, item.def, result, blink);
      }
    }

    textTimer += dt;
    if (textTimer >= TEXT_PERIOD) {
      textTimer = 0;
      draw(false);
    }

    mapTimer += dt;
    if (!view.multi && mapTimer >= MAP_PERIOD) {
      mapTimer = 0;
      drawMap();
    }
  }

  /** Текст оверлея: заголовок, счётчики, время. */
  function draw() {
    const view = app.cameraView;
    const def = view.current;
    const result = counts.get(def.id) || { inFrame: 0, detected: 0 };

    elTitle.textContent = `${def.id} · ${def.name}`;
    elCount.textContent = String(result.inFrame);
    elWord.textContent = plural(result.inFrame, 'человек', 'человека', 'человек');
    elDetect.textContent = `детектор насчитал: ${result.detected}`;
    elDetect.classList.toggle('is-off', result.detected !== result.inFrame);

    for (const [number, cell] of queueCells) {
      const queue = sim.queues.get(number);
      const value = queue ? String(queue.length) : '—';
      if (cell.textContent !== value) cell.textContent = value;
    }

    elClock.textContent = hhmmss(sim.time);
  }

  // ---------- мини-карта ----------

  /**
   * Вид сверху на зону ожидания.
   *
   * Нужна затем, что угол обзора камеры не покрывает весь холл: по
   * карте видно, кто вышел из кадра, а не исчез. Масштаб считается из
   * геометрии холла, поэтому карта остаётся верной, если поменять
   * длину холла или шаг шахт.
   */
  function drawMap() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (mapCanvas.width !== MAP_W * dpr) {
      mapCanvas.width = MAP_W * dpr;
      mapCanvas.height = MAP_H * dpr;
      mapCanvas.style.width = `${MAP_W}px`;
      mapCanvas.style.height = `${MAP_H}px`;
    }

    const ctx = mapCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // Масштаб: по длине холла и по глубине ядра — что теснее
    const spanX = HALL.length + 3.2;                 // плюс вестибюль у входа
    const spanZ = HALL.corridor + 1.4;
    const scale = Math.min((MAP_W - MAP_PAD * 2) / spanX, (MAP_H - MAP_PAD * 2) / spanZ);

    const cx = MAP_W / 2;
    const cy = MAP_H / 2;
    const px = (x) => cx + x * scale;
    const pz = (z) => cy - z * scale;

    // Пол коридора
    ctx.fillStyle = MAP_COLOR.floor;
    ctx.fillRect(
      px(-HALL.length / 2), pz(HALL.doorPlane),
      HALL.length * scale, HALL.corridor * scale
    );

    // Зоны ожидания и створки
    for (let n = 1; n <= ELEVATORS.total; n += 1) {
      const anchor = liftAnchor(n);
      const working = ELEVATORS.working.includes(n);

      const zone = frontOf(n, HALL.waitZoneGap + HALL.waitZoneDepth / 2);
      ctx.fillStyle = working ? MAP_COLOR.zone : 'rgba(255,255,255,0.05)';
      ctx.fillRect(
        px(zone.x - HALL.waitZoneWidth / 2), pz(zone.z + HALL.waitZoneDepth / 2),
        HALL.waitZoneWidth * scale, HALL.waitZoneDepth * scale
      );

      ctx.fillStyle = working ? MAP_COLOR.doorWorking : MAP_COLOR.door;
      const doorW = ELEVATORS.doorWidth * scale;
      const thickness = Math.max(3, 0.16 * scale);
      ctx.fillRect(
        px(anchor.x) - doorW / 2,
        anchor.side > 0 ? pz(anchor.z) : pz(anchor.z) - thickness,
        doorW, thickness
      );

      ctx.fillStyle = 'rgba(216, 226, 236, 0.75)';
      ctx.font = '9px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        String(n), px(anchor.x),
        anchor.side > 0 ? pz(anchor.z) - 4 : pz(anchor.z) + 12
      );
    }

    // Вход: зелёная стрелка с торца
    const ex = px(HALL.entranceX);
    ctx.strokeStyle = MAP_COLOR.entrance;
    ctx.fillStyle = MAP_COLOR.entrance;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex + 14, cy);
    ctx.lineTo(ex + 2, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex - 4, cy);
    ctx.lineTo(ex + 3, cy - 4);
    ctx.lineTo(ex + 3, cy + 4);
    ctx.closePath();
    ctx.fill();

    // Камера и её сектор обзора
    const def = app.cameraView.current;
    const { position, target } = posePlan(def);
    const angle = Math.atan2(target.z - position.z, target.x - position.x);
    const half = (CAM.fovDegrees / 2) * Math.PI / 180;
    const reach = 7 * scale;

    ctx.fillStyle = MAP_COLOR.fov;
    ctx.beginPath();
    ctx.moveTo(px(position.x), pz(position.z));
    ctx.arc(px(position.x), pz(position.z), reach, -angle - half, -angle + half);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = MAP_COLOR.camera;
    ctx.beginPath();
    ctx.arc(px(position.x), pz(position.z), 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Люди первого этажа
    ctx.fillStyle = MAP_COLOR.person;
    for (const person of sim.people) {
      if (person.state !== 'wait' && person.state !== 'walkIn') continue;
      if (!person.body) continue;

      const pos = person.body.position;
      if (pos.y > HALL.height * 0.5) continue;

      ctx.beginPath();
      ctx.arc(px(pos.x), pz(pos.z), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'left';
  }

  return { frame, overlay, applyOptions, refreshChrome };
}

// ======================= Вспомогательное =======================

/** Модельное время суток с секундами — как на табло наблюдения. */
function hhmmss(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Русское склонение после числа. */
function plural(n, one, few, many) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
