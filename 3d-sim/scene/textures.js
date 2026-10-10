/**
 * Текстуры, нарисованные на canvas.
 *
 * Отдельный модуль нужен, чтобы ни здание, ни лифты не возились с
 * 2D-контекстом: они просто просят «плитку» или «табло» и получают
 * готовый THREE.CanvasTexture. Все такие текстуры кэшируются там, где
 * картинка одинаковая, — 96 одинаковых табличек «Не работает» смысла
 * рисовать 96 раз нет.
 */

import * as THREE from 'three';

const cache = new Map();

/** Создаёт canvas нужного размера и сразу отдаёт контекст. */
function canvas(width, height) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return { el, ctx: el.getContext('2d') };
}

function toTexture(el, { repeat = null, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;

  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }

  return texture;
}

/** Переводит 0xrrggbb в строку CSS. */
export function css(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/**
 * Напольная плитка: светлые квадраты с тёмным швом.
 * repeat выставляется по реальным размерам пола, чтобы плитка была
 * ровно той стороны, что задана в params (HALL.tile).
 */
export function tileTexture(colorA, colorB, repeatX, repeatY) {
  const key = `tile:${colorA}:${colorB}:${repeatX}:${repeatY}`;
  if (cache.has(key)) return cache.get(key);

  const { el, ctx } = canvas(128, 128);

  ctx.fillStyle = css(colorA);
  ctx.fillRect(0, 0, 128, 128);

  // Лёгкий крап, чтобы плитка не выглядела пластиковой
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `rgba(0,0,0,${0.015 + Math.random() * 0.03})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }

  // Шов по краю квадрата
  ctx.strokeStyle = css(colorB);
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);

  const texture = toTexture(el, { repeat: [repeatX, repeatY] });
  cache.set(key, texture);
  return texture;
}

/** Ровная стена с едва заметным градиентом сверху вниз. */
export function wallTexture(color) {
  const key = `wall:${color}`;
  if (cache.has(key)) return cache.get(key);

  const { el, ctx } = canvas(64, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');

  ctx.fillStyle = css(color);
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  const texture = toTexture(el);
  cache.set(key, texture);
  return texture;
}

/**
 * Статичная надпись на тёмной табличке.
 * Используется для «Не работает», «ВХОД», «ЛЕСТНИЦА», номеров лифтов.
 */
export function signTexture(text, {
  width = 512, height = 160, bg = '#1a1d21', fg = '#f5f7fa',
  font = 'bold 86px system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  border = null, cacheKey = null
} = {}) {
  const key = cacheKey || `sign:${text}:${width}x${height}:${bg}:${fg}:${font}:${border}`;
  if (cache.has(key)) return cache.get(key);

  const { el, ctx } = canvas(width, height);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, width - 8, height - 8);
  }

  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 2);

  const texture = toTexture(el);
  cache.set(key, texture);
  return texture;
}

/**
 * Живое табло: текстура, которую можно перерисовывать каждый кадр.
 * Возвращает объект с texture и методом draw(). Кэшировать такие нельзя —
 * у каждого лифта своё содержимое.
 */
export function createDisplay(width, height, painter) {
  const { el, ctx } = canvas(width, height);
  const texture = toTexture(el);

  let lastKey = null;

  return {
    texture,
    /**
     * Перерисовывает табло. key — отпечаток содержимого: если он
     * не изменился, canvas не трогаем (иначе каждый кадр уходил бы
     * на GPU апдейт текстуры шести табло).
     */
    draw(key, ...args) {
      if (key === lastKey) return;
      lastKey = key;
      ctx.clearRect(0, 0, width, height);
      painter(ctx, width, height, ...args);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    }
  };
}

/** Мягкое круглое пятно — поддельная тень под ногами в упрощённом режиме. */
export function blobShadowTexture() {
  const key = 'blob';
  if (cache.has(key)) return cache.get(key);

  const { el, ctx } = canvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = toTexture(el);
  cache.set(key, texture);
  return texture;
}

/** Чистит кэш — нужен только при полном пересоздании сцены. */
export function disposeTextures() {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
