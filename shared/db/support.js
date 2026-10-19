/**
 * TIU GO — обращения в поддержку.
 *
 * Человек пишет из мини-аппа, админ отвечает из админки, ответ прилетает
 * ему в чат с ботом. Всё живёт в Redis: сервер и боты — разные процессы,
 * а на Render ещё и разные контейнеры со своими дисками.
 *
 * Хранение: один хеш 'tiu:support:tickets'.
 *   поле     — id обращения
 *   значение — { id, chatId, platform, username, message,
 *                status, createdAt, replyText, repliedAt, verified }
 *
 * Поле verified — подтвердил ли сервер, что человек действительно тот,
 * за кого себя выдаёт (см. проверку подписи initData в shared/server.js).
 * Ручка приёма открыта всему интернету, и без этой отметки админ отвечал бы
 * вслепую: ответ ушёл бы по chatId, который прислал кто угодно.
 */

const { getClient } = require('./redis');

const KEY = 'tiu:support:tickets';

/** Длиннее не храним: поле ввода в мини-аппе ограничено тем же числом. */
const MESSAGE_MAX = 1000;

/** И ответ админа тоже — он уходит сообщением в мессенджер. */
const REPLY_MAX = 2000;

/**
 * Сколько обращений держим. Ручка приёма публичная, и без потолка один
 * скрипт за ночь набил бы базу под завязку (на бесплатном тарифе Upstash
 * это 256 МБ). Лишние — самые старые — вычищаются при создании нового.
 */
const MAX_TICKETS = 500;

const STATUSES = ['open', 'replied'];

function clean(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/** Приводим 'tg' к 'telegram': так пишут боты, так и храним. */
function normalizePlatform(value) {
  if (value === 'tg') return 'telegram';
  return value === 'max' ? 'max' : 'telegram';
}

/**
 * Новое обращение.
 *
 * @param {string|number} chatId
 * @param {string} platform — 'telegram' или 'max'
 * @param {string} username — как показывать в админке
 * @param {string} message
 * @param {{verified?: boolean}} [options]
 * @returns {Promise<object>} сохранённое обращение
 */
async function createTicket(chatId, platform, username, message, options) {
  const text = clean(message, MESSAGE_MAX);
  if (!text) throw new Error('Пустое обращение');

  const ticket = {
    id: 't_' + Date.now() + '_' + chatId,
    chatId: String(chatId),
    platform: normalizePlatform(platform),
    username: clean(username, 64) || 'anonymous',
    message: text,
    status: 'open',
    createdAt: new Date().toISOString(),
    replyText: null,
    verified: Boolean(options && options.verified)
  };

  const entries = {};
  entries[ticket.id] = ticket;

  await getClient().hset(KEY, entries);

  // Подчищаем хвост после записи, а не до: новое обращение важнее
  await pruneOld();

  return ticket;
}

/** Все обращения, новые сверху. */
async function getTickets() {
  const stored = await getClient().hgetall(KEY);
  if (!stored) return [];

  return Object.keys(stored)
    .map((id) => stored[id])
    .filter((ticket) => ticket && typeof ticket === 'object')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getTicket(id) {
  const stored = await getClient().hgetall(KEY);
  return (stored && stored[id]) || null;
}

/**
 * Ответ админа.
 *
 * Возвращает обращение целиком — серверу нужны chatId и platform,
 * чтобы понять, куда и каким ботом отправлять ответ.
 *
 * @returns {Promise<{ok: boolean, error?: string, ticket?: object}>}
 */
async function replyToTicket(ticketId, replyText) {
  const text = clean(replyText, REPLY_MAX);
  if (!text) return { ok: false, error: 'Пустой ответ' };

  const ticket = await getTicket(ticketId);
  if (!ticket) return { ok: false, error: 'Обращение не найдено' };

  const updated = Object.assign({}, ticket, {
    status: 'replied',
    replyText: text,
    repliedAt: new Date().toISOString()
  });

  const entries = {};
  entries[ticketId] = updated;

  await getClient().hset(KEY, entries);

  return { ok: true, ticket: updated };
}

/** Сколько всего и сколько без ответа — для счётчика на вкладке. */
async function countTickets() {
  const list = await getTickets();

  return {
    total: list.length,
    open: list.filter((ticket) => ticket.status !== 'replied').length
  };
}

/** Выбрасывает самые старые обращения сверх потолка. */
async function pruneOld() {
  const client = getClient();
  const total = Number(await client.hlen(KEY)) || 0;

  if (total <= MAX_TICKETS) return 0;

  const list = await getTickets();           // новые сверху
  const extra = list.slice(MAX_TICKETS);     // всё, что за потолком

  if (!extra.length) return 0;

  await client.hdel(KEY, extra.map((ticket) => ticket.id));
  console.log('[support] Вычищено старых обращений:', extra.length);

  return extra.length;
}

module.exports = {
  KEY,
  MESSAGE_MAX,
  REPLY_MAX,
  MAX_TICKETS,
  STATUSES,
  createTicket,
  getTickets,
  getTicket,
  replyToTicket,
  countTickets,
  pruneOld
};
