/**
 * TIU GO — пользователи ботов в Redis.
 *
 * Пришло на смену shared/data/users.json: файл лежал на эфемерном диске
 * и был у каждого сервиса свой, поэтому админка всегда показывала ноль.
 *
 * Хранение: один хеш 'tiu:users'.
 *   поле     — 'telegram:123456' или 'max:789'
 *   значение — { chatId, platform, bot, date }
 *
 * Почему поле не просто chatId: идентификаторы Telegram и MAX живут
 * в разных пространствах и вполне могут совпасть числом. Без префикса
 * один пользователь затёр бы другого.
 *
 * Почему значение не просто platform: нужна метка bot — отпечаток токена
 * того бота, который принял /start. Без неё пользователи тестового бота
 * попадают в статистику основного, а рассылка пытается писать им чужим
 * ботом и собирает ошибки на ровном месте.
 */

const crypto = require('crypto');
const { getClient } = require('./redis');

const KEY = 'tiu:users';

/** Платформы. Приводим 'tg' к 'telegram': так пишет бот, так и храним. */
const PLATFORMS = ['telegram', 'max'];

function normalizePlatform(value) {
  if (value === 'tg') return 'telegram';
  return PLATFORMS.indexOf(value) !== -1 ? value : 'telegram';
}

/**
 * Метка бота по его токену: первые 12 знаков sha256.
 *
 * Отпечаток, а не сам токен и не id из него: формат токена MAX
 * в документации не закреплён, а отпечаток работает для любого
 * и, в отличие от токена, ничего не выдаёт.
 *
 * @returns {string|null} null, если токена нет или он из шаблона .env
 */
function tagOf(token) {
  if (typeof token !== 'string') return null;

  const value = token.trim();
  if (value.length <= 10 || /\s/.test(value)) return null;

  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** Метки ботов, чьи токены заданы этому процессу, — то есть «свои». */
function currentTags() {
  return {
    telegram: tagOf(process.env.TELEGRAM_BOT_TOKEN),
    max: tagOf(process.env.MAX_BOT_TOKEN)
  };
}

/**
 * Запись сделана нашим ботом?
 *
 * Без метки — считаем своей: такие записи старше самого разделения.
 * С меткой, но без нашего токена этой платформы — чужая: если
 * MAX_BOT_TOKEN не задан, бота MAX мы не запускаем вовсе.
 */
function isOwn(user, tags) {
  if (!user.bot) return true;

  const mine = tags && tags[normalizePlatform(user.platform)];

  return mine ? user.bot === mine : false;
}

function fieldFor(chatId, platform) {
  return normalizePlatform(platform) + ':' + chatId;
}

/**
 * Запоминает пользователя.
 *
 * @param {number|string} chatId — идентификатор, которым будем писать человеку
 * @param {string} platform — 'telegram' или 'max'
 * @param {{token?: string, addressBy?: 'chat'|'user'}} [options]
 *        token — токен бота; в базу не попадает, сохраняется только отпечаток.
 *        addressBy — чем адресовать сообщение. В личке MAX бот видит только
 *        отправителя, и chat_id там пустой: тогда писать нужно по user_id.
 *        По умолчанию 'chat'.
 * @returns {Promise<boolean>} true — пользователь новый
 */
async function addUser(chatId, platform, options) {
  if (chatId === undefined || chatId === null || chatId === '') return false;

  const record = {
    chatId: chatId,
    platform: normalizePlatform(platform),
    date: new Date().toISOString()
  };

  const bot = tagOf(options && options.token);
  if (bot) record.bot = bot;

  if (options && options.addressBy === 'user') record.addressBy = 'user';

  const entries = {};
  entries[fieldFor(chatId, platform)] = record;

  // HSET возвращает число ДОБАВЛЕННЫХ полей: 1 — человек пришёл впервые,
  // 0 — уже был и мы просто обновили дату
  const added = await getClient().hset(KEY, entries);

  return Number(added) > 0;
}

/** Все записи из базы, как есть. */
async function getAllUsers() {
  const stored = await getClient().hgetall(KEY);
  if (!stored) return [];

  return Object.keys(stored).map((field) => {
    const value = stored[field];

    // Подстраховка на случай значений старого формата (строка 'telegram'):
    // поле всё равно содержит и платформу, и chatId
    if (typeof value === 'string') {
      const parts = field.split(':');
      return { chatId: parts.slice(1).join(':'), platform: normalizePlatform(parts[0]) };
    }

    return value;
  });
}

/** Сколько всего записей в базе — одна команда вместо выгрузки всего хеша. */
async function getUsersCount() {
  return Number(await getClient().hlen(KEY)) || 0;
}

/** Только пользователи наших ботов: их видит статистика и рассылка. */
async function ownUsers(tags) {
  const marks = tags || currentTags();
  return (await getAllUsers()).filter((user) => isOwn(user, marks));
}

/**
 * Разбивка для админки. Чужие боты не входят в total и вынесены
 * в others: иначе цифры основного бота росли бы от каждой проверки
 * нового функционала на тестовом.
 */
async function countUsers(tags) {
  const marks = tags || currentTags();
  const all = await getAllUsers();
  const list = all.filter((user) => isOwn(user, marks));

  return {
    total: list.length,
    telegram: list.filter((user) => normalizePlatform(user.platform) === 'telegram').length,
    max: list.filter((user) => normalizePlatform(user.platform) === 'max').length,
    others: all.length - list.length
  };
}

module.exports = {
  KEY,
  PLATFORMS,
  tagOf,
  currentTags,
  isOwn,
  addUser,
  getAllUsers,
  getUsersCount,
  ownUsers,
  countUsers
};
