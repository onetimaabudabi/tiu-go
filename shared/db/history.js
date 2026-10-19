/**
 * TIU GO — почасовая копилка наблюдений для планировщика выхода.
 *
 * Пришло на смену shared/data/history.json. Эти наблюдения копятся
 * неделями: планировщик начинает верить среднему только после тридцати
 * замеров в ячейке. На эфемерном диске Render копилка обнулялась при
 * каждом передеплое, и планировщик навсегда оставался на расчёте
 * по расписанию пар.
 *
 * Хранение: один ключ 'tiu:history' со всей копилкой целиком.
 *   { 'деньНедели-час': { samples, waitSum, queueSum } }
 *
 * Это полтора килобайта на всю неделю, и читать их по частям незачем.
 *
 * ── Почему пишем раз в пять минут ────────────────────────────────
 *
 * Замер снимается раз в десять секунд — это 8640 записей в сутки,
 * при месячной квоте в 500 тысяч команд. Поэтому копилка живёт в памяти,
 * а в базу уезжает целиком раз в пять минут.
 *
 * Чем платим: при аварийной остановке теряется до тридцати замеров.
 * Для среднего, которое набирается неделями, это незаметно — а при
 * штатной остановке копилка дописывается.
 */

const { getClient } = require('./redis');

const KEY = 'tiu:history';

/** Как часто сбрасываем накопленное. */
const FLUSH_MS = 5 * 60 * 1000;

let store = null;
let dirty = false;
let timer = null;
let flushing = null;

/** 'день-час' — ключ ячейки. */
function cellKey(day, hour) {
  return day + '-' + hour;
}

/** Читает копилку из базы. Зовётся один раз при старте сервера. */
async function load() {
  try {
    const raw = await getClient().get(KEY);
    store = raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    console.error('[история] Не удалось прочитать:', err.message);
    store = store || {};
  }

  return store;
}

/** Копилка в памяти. Синхронная: её читают на каждый расчёт планировщика. */
function all() {
  if (!store) store = {};
  return store;
}

/** Ячейка дня и часа или null, если её нет. */
function cell(day, hour) {
  return all()[cellKey(day, hour)] || null;
}

/** Записывает ячейку целиком. Расчёт среднего остаётся на стороне сервера. */
function setCell(day, hour, value) {
  all()[cellKey(day, hour)] = value;
  dirty = true;
}

/** Отправляет копилку в базу, если она менялась. */
async function flush() {
  if (flushing) return flushing;
  if (!dirty || !store) return;

  const snapshot = JSON.parse(JSON.stringify(store));
  dirty = false;

  flushing = (async () => {
    try {
      await getClient().set(KEY, snapshot);
    } catch (err) {
      console.error('[история] Не удалось сохранить:', err.message);
      dirty = true; // попробуем в следующий раз
    } finally {
      flushing = null;
    }
  })();

  return flushing;
}

function start() {
  if (timer) return timer;

  timer = setInterval(() => {
    flush().catch((err) => console.error('[история] Сброс упал:', err.message));
  }, FLUSH_MS);

  timer.unref?.();
  return timer;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = {
  KEY,
  FLUSH_MS,
  cellKey,
  load,
  all,
  cell,
  setCell,
  flush,
  start,
  stop
};
