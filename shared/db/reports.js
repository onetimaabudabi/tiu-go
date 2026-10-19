/**
 * TIU GO — жалобы на лифты.
 *
 * Пришло на смену shared/data/reports.json: файл лежал на эфемерном диске
 * Render и пропадал при каждом передеплое вместе со всеми жалобами.
 *
 * Хранение: хеш 'tiu:reports', поле — id жалобы, значение — сама жалоба.
 *
 * Кэша здесь нет намеренно. Пишут жалобы редко — человек нажимает кнопку
 * в мини-аппе, — а читает их только админка. Держать ради этого копию
 * в памяти и следить за её свежестью значило бы усложнить код там, где
 * экономить нечего.
 */

const crypto = require('crypto');
const { getClient } = require('./redis');

const KEY = 'tiu:reports';

const REASON_MAX = 64;
const COMMENT_MAX = 500;

/**
 * Сколько жалоб храним. Ручка приёма публичная: без потолка один скрипт
 * за ночь набил бы базу под завязку, а бесплатный тариф Upstash — 256 МБ.
 */
const MAX_REPORTS = 500;

/**
 * Добавляет жалобу.
 *
 * @param {{elevatorId: number, reason: string, comment?: string}} report
 * @returns {Promise<object>} сохранённая жалоба
 */
async function addReport(report) {
  const saved = {
    // Случайный хвост обязателен: без него две жалобы на один лифт,
    // отправленные в одну миллисекунду, получают одинаковый id —
    // а это одно и то же поле хеша, и вторая молча затёрла бы первую
    id: 'r_' + Date.now() + '_' + report.elevatorId + '_' +
      crypto.randomBytes(3).toString('hex'),
    timestamp: new Date().toISOString(),
    elevatorId: report.elevatorId,
    reason: String(report.reason || '').slice(0, REASON_MAX),
    comment: String(report.comment || '').slice(0, COMMENT_MAX)
  };

  const entries = {};
  entries[saved.id] = saved;

  await getClient().hset(KEY, entries);
  await pruneOld();

  return saved;
}

/** Все жалобы, новые сверху. */
async function getReports() {
  const stored = await getClient().hgetall(KEY);
  if (!stored) return [];

  return Object.keys(stored)
    .map((id) => stored[id])
    .filter((item) => item && typeof item === 'object')
    // При равных метках времени сортируем по id: иначе порядок двух жалоб
    // из одной миллисекунды зависел бы от того, как их вернула база
    .sort((a, b) => (
      String(b.timestamp).localeCompare(String(a.timestamp)) ||
      String(b.id).localeCompare(String(a.id))
    ));
}

/** Сколько всего — одна команда вместо выгрузки всего хеша. */
async function countReports() {
  return Number(await getClient().hlen(KEY)) || 0;
}

/** Выбрасывает самые старые жалобы сверх потолка. */
async function pruneOld() {
  const client = getClient();
  const total = Number(await client.hlen(KEY)) || 0;

  if (total <= MAX_REPORTS) return 0;

  const extra = (await getReports()).slice(MAX_REPORTS);
  if (!extra.length) return 0;

  await client.hdel(KEY, extra.map((item) => item.id));
  console.log('[reports] Вычищено старых жалоб:', extra.length);

  return extra.length;
}

module.exports = {
  KEY,
  REASON_MAX,
  COMMENT_MAX,
  MAX_REPORTS,
  addReport,
  getReports,
  countReports,
  pruneOld
};
