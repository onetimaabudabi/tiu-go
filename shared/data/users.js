/**
 * TIU GO — список пользователей ботов.
 *
 * Боты (Telegram и MAX) дописывают сюда chatId при каждом /start,
 * сервер читает файл для статистики и рассылки из админки.
 *
 * Почему файл, а не память: бот и сервер — три разных процесса
 * (npm run start:server, start:telegram, start:max). Общая память
 * у них одна — диск.
 *
 * Формат shared/data/users.json:
 *   [{ chatId: 123456, platform: 'tg', bot: 'a1b2c3d4e5f6',
 *      date: '2026-10-18T09:40:00.000Z' }]
 *
 * У записей MAX вместо chatId может оказаться userId: бот не всегда видит
 * идентификатор чата — в личке приходит только отправитель. Рассылка умеет
 * и то и другое, поэтому храним что есть.
 *
 * Поле bot — метка бота, который принял /start. Нужна, чтобы статистика
 * основного бота не смешивалась с тестовым: у тестового бота свой токен,
 * значит и метка другая, и его пользователи в цифры не попадают.
 * Метка — короткий необратимый отпечаток токена (sha256, первые 12 знаков).
 * Сам токен в файл не пишется никогда.
 *
 * Запись атомарная: сначала во временный файл, потом rename. Два бота
 * пишут в один файл одновременно, и без этого можно поймать половину
 * JSON-а на диске.
 *
 * ВАЖНО: файл содержит chatId живых людей — в репозиторий он не попадает
 * (прописан в .gitignore рядом с subscriptions.json).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'users.json');

/** Платформы, которые умеем различать. Остальное записываем как 'tg'. */
const PLATFORMS = ['tg', 'max'];

/**
 * Метка бота по его токену: первые 12 знаков sha256.
 *
 * Зачем отпечаток, а не сам токен или id из него: у Telegram id бота —
 * это часть до двоеточия, а формат токена MAX в документации не закреплён
 * (см. TODO в «tiu go max/index.js»). Отпечаток работает для любого формата
 * и, в отличие от токена, ничего не выдаёт, даже если файл кто-то увидит.
 *
 * @returns {string|null} null, если токена нет или он из шаблона .env
 */
function tagOf(token) {
  if (typeof token !== 'string') return null;

  const value = token.trim();

  // Те же правила, что у usableToken в server.js: в шаблоне .env стоит
  // «поменяю сам позже», и метка от этой строки была бы общей у всех,
  // кто не поменял шаблон
  if (value.length <= 10 || /\s/.test(value)) return null;

  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Метки ботов, прописанных в .env этого проекта, — то есть «своих».
 * В тестовой копии токены другие, поэтому и метки будут другие.
 */
function currentTags() {
  return {
    tg: tagOf(process.env.TELEGRAM_BOT_TOKEN),
    max: tagOf(process.env.MAX_BOT_TOKEN)
  };
}

/**
 * Запись сделана нашим ботом?
 *
 * Без метки — считаем своей: такие записи сделаны до того, как появилось
 * разделение по ботам, и ничего лучше о них сказать нельзя.
 *
 * С меткой, но без нашего токена этой платформы — чужая. Если в .env нет
 * MAX_BOT_TOKEN, значит бота MAX мы не запускаем вовсе, и его пользователи
 * пришли к чьему-то чужому боту. Засчитывать их себе было бы приписками.
 */
function isOwn(user, tags) {
  if (!user.bot) return true;

  const mine = tags && tags[user.platform === 'max' ? 'max' : 'tg'];

  return mine ? user.bot === mine : false;
}

/** Только пользователи наших ботов — их видит статистика и рассылка. */
function ownUsers(tags) {
  return readUsers().filter((user) => isOwn(user, tags));
}

/** Создаёт пустой файл, если его ещё нет. */
function ensureUsersFile() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, '[]\n', 'utf8');
    }
  } catch (err) {
    console.error('[users] Не удалось создать users.json:', err.message);
  }
}

/** Читает список. Битый или отсутствующий файл — это пустой список, не падение. */
function readUsers() {
  try {
    const list = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

/** Атомарная запись: tmp + rename, чтобы читатель никогда не увидел полфайла. */
function writeUsers(list) {
  const tmp = USERS_FILE + '.' + process.pid + '.tmp';

  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, USERS_FILE);
}

function normalizePlatform(value) {
  return PLATFORMS.indexOf(value) !== -1 ? value : 'tg';
}

/** Чем будем адресовать сообщение: chatId, а если его нет — userId. */
function identityOf(user) {
  const chatId = user && user.chatId;
  if (chatId !== undefined && chatId !== null && chatId !== '') return String(chatId);

  const userId = user && user.userId;
  if (userId !== undefined && userId !== null && userId !== '') return 'u' + userId;

  return null;
}

/**
 * Запоминает пользователя. Повторный /start от того же человека
 * список не удлиняет — только обновляет дату последнего входа.
 *
 * token — токен бота, который принял /start. В файл он НЕ попадает:
 * сохраняется только его отпечаток (см. tagOf). Нужен, чтобы отличить
 * пользователей основного бота от пользователей тестового.
 *
 * @param {{chatId?, userId?, platform?: string, token?: string}} user
 * @returns {{added: boolean, total: number}}
 */
function addUser(user) {
  const key = identityOf(user);
  if (key === null) return { added: false, total: readUsers().length };

  const platform = normalizePlatform(user.platform);
  const bot = tagOf(user.token);

  // Один и тот же человек у основного и у тестового бота — это две разные
  // записи: chatId у них даже совпадёт, но боты разные, и смешивать их
  // как раз и не нужно.
  const list = readUsers();
  const existing = list.find((item) => (
    item.platform === platform && identityOf(item) === key && (item.bot || null) === bot
  ));

  if (existing) {
    existing.lastSeen = new Date().toISOString();
  } else {
    const record = { platform: platform, date: new Date().toISOString() };

    if (user.chatId !== undefined && user.chatId !== null && user.chatId !== '') {
      record.chatId = user.chatId;
    }
    if (user.userId !== undefined && user.userId !== null && user.userId !== '') {
      record.userId = user.userId;
    }
    if (bot) record.bot = bot;

    list.push(record);
  }

  try {
    writeUsers(list);
  } catch (err) {
    console.error('[users] Не удалось сохранить users.json:', err.message);
    return { added: false, total: list.length };
  }

  return { added: !existing, total: list.length };
}

/**
 * Сколько уникальных пользователей знаем.
 *
 * Считаем только своих ботов — тех, чьи токены лежат в .env этого проекта.
 * Записи тестовых ботов попадают в отдельное поле others и в основные
 * цифры не входят: иначе статистика основного бота росла бы от каждой
 * проверки нового функционала.
 */
function countUsers(tags) {
  const marks = tags || currentTags();
  const all = readUsers();
  const list = all.filter((item) => isOwn(item, marks));

  return {
    total: list.length,
    tg: list.filter((item) => item.platform === 'tg').length,
    max: list.filter((item) => item.platform === 'max').length,
    others: all.length - list.length
  };
}

module.exports = {
  USERS_FILE,
  PLATFORMS,
  ensureUsersFile,
  readUsers,
  addUser,
  identityOf,
  tagOf,
  currentTags,
  isOwn,
  ownUsers,
  countUsers
};
