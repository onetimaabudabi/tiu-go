/**
 * Хранилище состояния для serverless.
 *
 * На Render сервер жил одним процессом: данные лежали в памяти и в файлах
 * рядом с кодом. На Vercel так нельзя — файловая система только на чтение,
 * а каждый вызов функции может попасть на другой инстанс, который ничего
 * не помнит.
 *
 * Поэтому здесь два слоя:
 *
 *   1. Постоянный — Vercel KV (Upstash Redis). Включается сам, если в
 *      окружении есть KV_REST_API_URL и KV_REST_API_TOKEN.
 *   2. Запасной — обычный объект в памяти процесса. Работает, пока инстанс
 *      жив, и пропадает при холодном старте. Нужен для `vercel dev` и для
 *      деплоя без базы: приложение не падает, просто забывает.
 *
 * Снаружи хранилище выглядит синхронным (get/set), потому что обработчики
 * маршрутов перенесены с Render как есть и ничего не знают про await.
 * Сетевая часть вынесена в две асинхронные точки: load() перед запросом
 * и flush() после ответа. Обе зовёт обёртка в api/_handler.js.
 */

// ---------- Ключи ----------

const KEYS = {
  reports: 'tiu:reports',               // жалобы на лифты
  subscriptions: 'tiu:subscriptions',   // подписки на уведомления
  hourly: 'tiu:hourly',                 // почасовая статистика для планировщика
  elevators: 'tiu:elevators',           // состояние шести лифтов
  history: 'tiu:history'                // окно наблюдений для прогноза
};

// Значение по умолчанию для каждого ключа — им инициализируется пустое хранилище
const EMPTY = {
  reports: [],
  subscriptions: [],
  hourly: {},
  elevators: null,
  history: null
};

// ---------- Клиент KV ----------

let kv = null;
let kvChecked = false;

/**
 * Клиент KV или null, если база не подключена.
 *
 * Пакет грузим лениво и в try: без базы он не нужен, а в окружении,
 * где его не установили, падать из-за этого нельзя.
 */
function client() {
  if (kvChecked) return kv;
  kvChecked = true;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.log('[storage] KV не настроен — состояние живёт в памяти инстанса');
    return null;
  }

  try {
    const { createClient } = require('@vercel/kv');
    kv = createClient({ url, token });
    return kv;
  } catch (err) {
    console.error('[storage] не удалось поднять клиент KV:', err.message);
    return null;
  }
}

/** Подключено ли постоянное хранилище. Показывается в /api/health. */
function isPersistent() {
  return Boolean(client());
}

// ---------- Кэш запроса ----------

// Кэш живёт на уровне модуля: на тёплом инстансе он переживает вызовы,
// и тогда load() только обновляет его из KV.
const cache = {};
const dirty = new Set();

function copy(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Синхронное чтение. Вызывается из перенесённого кода маршрутов. */
function get(name) {
  if (cache[name] === undefined) cache[name] = copy(EMPTY[name]);
  return cache[name];
}

/** Синхронная запись: кладём в кэш и помечаем, что ключ нужно сохранить. */
function set(name, value) {
  cache[name] = value;
  dirty.add(name);
  return value;
}

/** Отметить ключ изменённым, если его правили по ссылке. */
function touch(name) {
  dirty.add(name);
}

// ---------- Загрузка и сохранение ----------

/**
 * Подтягивает значения из KV перед обработкой запроса.
 *
 * Читаем все ключи разом: это один round-trip вместо пяти, а объём
 * мизерный — подписки и почасовая статистика умещаются в килобайты.
 */
async function load(names = Object.keys(KEYS)) {
  const db = client();
  if (!db) {
    names.forEach((name) => { if (cache[name] === undefined) cache[name] = copy(EMPTY[name]); });
    return cache;
  }

  try {
    const values = await db.mget(...names.map((name) => KEYS[name]));

    names.forEach((name, i) => {
      const value = values[i];
      cache[name] = value === null || value === undefined ? copy(EMPTY[name]) : value;
    });
  } catch (err) {
    console.error('[storage] чтение из KV не удалось:', err.message);
    names.forEach((name) => { if (cache[name] === undefined) cache[name] = copy(EMPTY[name]); });
  }

  dirty.clear();
  return cache;
}

/**
 * Пишет изменённые ключи обратно в KV.
 *
 * Зовётся после того, как ответ уже ушёл клиенту, но до того, как
 * serverless-функция завершится, — иначе Vercel заморозит инстанс
 * с незавершённой записью.
 */
async function flush() {
  if (!dirty.size) return 0;

  const db = client();
  const names = [...dirty];
  dirty.clear();

  if (!db) return names.length;   // без базы данные и так уже в памяти

  try {
    await Promise.all(names.map((name) => db.set(KEYS[name], cache[name])));
    return names.length;
  } catch (err) {
    console.error('[storage] запись в KV не удалась:', err.message);
    return 0;
  }
}

/** Полная очистка — нужна тестам и ручке сброса. */
function reset() {
  Object.keys(cache).forEach((key) => delete cache[key]);
  dirty.clear();
}

module.exports = {
  KEYS,
  get,
  set,
  touch,
  load,
  flush,
  reset,
  isPersistent
};
