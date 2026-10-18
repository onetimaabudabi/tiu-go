/**
 * TIU GO — счётчик обращений к API.
 *
 * Считает запросы к /api/status: всего за всё время и по часам.
 * Нужен ровно для вкладки «Статистика» в админке.
 *
 * Хранение: shared/data/stats.json, ключ ячейки — местный час
 * в виде 'ГГГГ-ММ-ДД ЧЧ'. Местный, а не UTC: админ смотрит график
 * «по часам» своими глазами и ждёт там своё время.
 *
 * На диск пишем не чаще раза в 15 секунд — иначе каждый запрос
 * мини-приложения (а оно опрашивает сервер раз в несколько секунд
 * у каждого открытого экрана) превращался бы в запись на диск.
 * Поэтому несколько последних обращений при жёстком падении процесса
 * могут потеряться — для счётчика показов это допустимо.
 *
 * Старые ячейки чистим: держим неделю, этого хватает на любой график.
 */

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'stats.json');

const SAVE_MS = 15 * 1000;          // не чаще раза в 15 секунд
const KEEP_HOURS = 7 * 24;          // глубина хранения ячеек

let store = null;                   // { total, hours: { 'ГГГГ-ММ-ДД ЧЧ': n } }
let dirty = false;
let savedAt = 0;

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** Ключ ячейки по местному времени. */
function hourKey(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' + pad(date.getHours());
}

function emptyStore() {
  return { total: 0, hours: {} };
}

function load() {
  if (store) return store;

  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));

    store = {
      total: Number(raw && raw.total) || 0,
      hours: raw && typeof raw.hours === 'object' && raw.hours ? raw.hours : {}
    };
  } catch (err) {
    store = emptyStore();
  }

  return store;
}

/** Выбрасывает ячейки старше недели — файл не должен расти бесконечно. */
function prune(now) {
  const data = load();
  const limit = new Date(now.getTime() - KEEP_HOURS * 3600 * 1000);
  const edge = hourKey(limit);

  Object.keys(data.hours).forEach((key) => {
    // Ключи сравнимы как строки: формат фиксированной длины от старшего к младшему
    if (key < edge) delete data.hours[key];
  });
}

function save(now = Date.now(), force = false) {
  if (!dirty) return;
  if (!force && now - savedAt < SAVE_MS) return;

  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(load()), 'utf8');
    dirty = false;
    savedAt = now;
  } catch (err) {
    console.error('[stats] Не удалось сохранить stats.json:', err.message);
  }
}

/** Плюс один запрос к API. Вызывается из обработчика /api/status. */
function hit(at = new Date()) {
  const data = load();
  const key = hourKey(at);

  data.total += 1;
  data.hours[key] = (data.hours[key] || 0) + 1;
  dirty = true;

  prune(at);
  save(at.getTime());

  return data.total;
}

/**
 * Данные для админки.
 *
 * hours — ровно 24 ячейки, от «23 часа назад» до текущего часа
 * включительно, даже если в какие-то часы запросов не было: график
 * с дырками выглядел бы так, будто сервер лежал.
 */
function snapshot(now = new Date()) {
  const data = load();
  const hours = [];
  let today = 0;

  const todayPrefix = hourKey(now).slice(0, 10);

  Object.keys(data.hours).forEach((key) => {
    if (key.slice(0, 10) === todayPrefix) today += data.hours[key];
  });

  for (let back = 23; back >= 0; back -= 1) {
    const moment = new Date(now.getTime() - back * 3600 * 1000);
    const key = hourKey(moment);

    hours.push({
      hour: moment.getHours(),
      label: pad(moment.getHours()) + ':00',
      count: data.hours[key] || 0
    });
  }

  return {
    total: data.total,
    today: today,
    hours: hours
  };
}

// Последние необнулённые обращения дописываем при нормальном завершении
process.on('exit', () => save(Date.now(), true));

module.exports = {
  STATS_FILE,
  hourKey,
  hit,
  snapshot,
  save
};
