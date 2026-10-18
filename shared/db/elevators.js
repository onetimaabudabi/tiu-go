/**
 * TIU GO — статусы работы лифтов в Redis.
 *
 * Ключи: tiu:elevator:1 … tiu:elevator:6
 * Значение: { status: 'working'|'broken'|'maintenance', statusNote: '…'|null }
 *
 * Что здесь хранится, а что нет. В базу попадает ТОЛЬКО то, что ставит
 * руками админ: статус работы и комментарий к нему. Живые показания —
 * этаж, число людей в кабине и очередь в холле — остаются в памяти:
 * симуляция обновляет их раз в три секунды, и запись каждого тика стоила
 * бы 120 команд в минуту при месячной квоте в 500 тысяч. Да и смысла нет:
 * это мгновенные значения, которые незачем переживать перезапуск.
 *
 * Статусы же переживать обязаны: админ отметил «лифт 3 сломан, ремонт
 * до 15:00», сервис передеплоился — и отметка должна остаться.
 *
 * Чтение идёт из памяти процесса, а не из базы на каждый запрос:
 * /api/status зовут раз в 3 секунды с каждого открытого экрана. Кэш
 * обновляется раз в полминуты и сразу после записи.
 */

const params = require('../params.json');
const { getClient } = require('./redis');

const PREFIX = 'tiu:elevator:';

/** Допустимые статусы. Тот же список, что в shared/data/mockData.js. */
const STATUSES = ['working', 'broken', 'maintenance'];

/** Как часто перечитываем базу: вдруг статус поменяли из другого процесса. */
const REFRESH_MS = 30 * 1000;

const TOTAL = params.elevators.total;

/**
 * Статус лифта по умолчанию — из shared/params.json, а не числом в коде.
 * Там же его берут обе математические модели и mockData, и scripts/check-params.js
 * следит, чтобы источник оставался один. Вписать сюда «1, 2, 6 работают»
 * значило бы завести второй, который рано или поздно разойдётся с первым.
 */
function defaultStatus(number) {
  if (params.elevators.broken.includes(number)) return 'broken';
  if (params.elevators.working.includes(number)) return 'working';
  return 'maintenance';
}

function keyFor(id) {
  return PREFIX + id;
}

function ids() {
  return Array.from({ length: TOTAL }, (_, i) => i + 1);
}

// ---------- Кэш ----------

let cache = null;
let refreshedAt = 0;
let timer = null;

function fallbackCache() {
  const result = {};
  ids().forEach((id) => {
    result[id] = { status: defaultStatus(id), statusNote: null };
  });
  return result;
}

/** Приводит запись из базы к ожидаемому виду; мусор заменяем умолчанием. */
function normalize(id, value) {
  if (!value || typeof value !== 'object') {
    return { status: defaultStatus(id), statusNote: null };
  }

  const status = STATUSES.indexOf(value.status) !== -1 ? value.status : defaultStatus(id);
  const note = typeof value.statusNote === 'string' && value.statusNote.trim()
    ? value.statusNote.trim().slice(0, 120)
    : null;

  return { status: status, statusNote: note };
}

/**
 * Перечитывает все статусы из базы. Одна команда MGET на все шесть лифтов.
 * Если база недоступна — оставляем прежний кэш: показывать умолчания
 * вместо «лифт сломан» хуже, чем показывать чуть устаревшее.
 */
async function refresh() {
  try {
    const stored = await getClient().mget(ids().map(keyFor));
    const next = {};

    ids().forEach((id, index) => {
      next[id] = normalize(id, stored[index]);
    });

    cache = next;
    refreshedAt = Date.now();
  } catch (err) {
    console.error('[лифты] Не удалось прочитать статусы:', err.message);
    if (!cache) cache = fallbackCache();
  }

  return cache;
}

/**
 * Первая настройка: записываем умолчания для тех лифтов, которых в базе
 * ещё нет. Уже сохранённые статусы не трогаем — иначе каждый передеплой
 * сбрасывал бы отметки админа, ради сохранения которых всё и затевалось.
 */
async function init() {
  const client = getClient();
  const stored = await client.mget(ids().map(keyFor));
  const created = [];

  for (let index = 0; index < ids().length; index += 1) {
    const id = ids()[index];
    if (stored[index]) continue;

    await client.set(keyFor(id), { status: defaultStatus(id), statusNote: null });
    created.push(id);
  }

  await refresh();
  return created;
}

/** Статусы всех лифтов из кэша. Синхронная: её зовут на каждый /api/status. */
function getElevators() {
  if (!cache) cache = fallbackCache();
  return cache;
}

/** Статус одного лифта. */
function getElevator(id) {
  return getElevators()[Number(id)] || null;
}

/**
 * Сохраняет статус и комментарий.
 *
 * @returns {Promise<{ok: boolean, error?: string, elevator?: object}>}
 */
async function updateElevator(id, status, statusNote) {
  const number = Number(id);

  if (!Number.isInteger(number) || number < 1 || number > TOTAL) {
    return { ok: false, error: 'Лифт не найден' };
  }

  if (status !== undefined && STATUSES.indexOf(status) === -1) {
    return { ok: false, error: 'Неизвестный статус: ' + status };
  }

  const current = getElevator(number) || { status: defaultStatus(number), statusNote: null };

  const record = normalize(number, {
    status: status === undefined ? current.status : status,
    statusNote: statusNote === undefined ? current.statusNote : statusNote
  });

  try {
    await getClient().set(keyFor(number), record);
  } catch (err) {
    console.error('[лифты] Не удалось сохранить статус:', err.message);
    return { ok: false, error: 'База недоступна, статус не сохранён' };
  }

  // Кэш правим сразу: ждать до следующего обновления значило бы показать
  // админу старое значение сразу после того, как он нажал «Сохранить»
  getElevators()[number] = record;

  return { ok: true, elevator: Object.assign({ id: number }, record) };
}

/**
 * Массовая запись статусов — для кнопок «Сбросить» и «Все работают».
 * Без неё кнопка меняла бы только память сервера, а через полминуты
 * обновление кэша вернуло бы из базы прежние значения.
 */
async function setAll(statusOf) {
  const client = getClient();
  const next = {};

  for (const id of ids()) {
    const record = { status: statusOf(id), statusNote: null };
    await client.set(keyFor(id), record);
    next[id] = record;
  }

  cache = next;
  refreshedAt = Date.now();

  return cache;
}

/** Возврат к тому, что записано в shared/params.json. */
function resetToDefaults() {
  return setAll(defaultStatus);
}

/** Снимает поломки и обслуживание со всех лифтов. */
function setAllWorking() {
  return setAll(() => 'working');
}

/**
 * Запускает периодическое обновление кэша.
 *
 * onRefresh зовётся после каждого успешного чтения: сервер этим переносит
 * свежие статусы в симуляцию. Сам модуль про симуляцию ничего не знает —
 * иначе хранилище и мок стали бы зависеть друг от друга.
 */
function start(onRefresh) {
  if (timer) return timer;

  timer = setInterval(() => {
    refresh()
      .then(() => { if (onRefresh) onRefresh(getElevators()); })
      .catch((err) => console.error('[лифты] Обновление упало:', err.message));
  }, REFRESH_MS);

  timer.unref?.();
  return timer;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = {
  PREFIX,
  STATUSES,
  REFRESH_MS,
  TOTAL,
  defaultStatus,
  init,
  refresh,
  getElevators,
  getElevator,
  updateElevator,
  resetToDefaults,
  setAllWorking,
  start,
  stop,
  refreshedAt: () => refreshedAt
};
