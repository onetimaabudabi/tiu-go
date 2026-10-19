/**
 * TIU GO — подписки на push-уведомления.
 *
 * Пришло на смену shared/data/subscriptions.json: файл лежал на эфемерном
 * диске Render, и при каждом передеплое все подписки пропадали — люди
 * переставали получать уведомления и не понимали почему.
 *
 * Хранение: хеш 'tiu:subscriptions', поле — 'telegram:123' или 'max:456'.
 * Префикс платформы обязателен: идентификаторы Telegram и MAX живут
 * в разных пространствах и могут совпасть числом.
 *
 * ── Почему список держится в памяти ──────────────────────────────
 *
 * Цикл рассылки перебирает подписки раз в 30 секунд. Ходить за ними
 * в базу каждый раз — 2880 команд в сутки на ровном месте, при месячной
 * квоте в 500 тысяч. Поэтому список читается при старте, обновляется
 * раз в две минуты и сразу после записи. Подписки меняются редко,
 * задержка в две минуты для них незаметна.
 */

const { getClient } = require('./redis');

const KEY = 'tiu:subscriptions';

/** Как часто перечитываем: вдруг подписку сохранил другой процесс. */
const REFRESH_MS = 2 * 60 * 1000;

let cache = [];
let loaded = false;
let timer = null;

function fieldFor(platform, chatId) {
  return (platform === 'max' ? 'max' : 'telegram') + ':' + chatId;
}

/** Перечитывает подписки из базы. Одна команда HGETALL. */
async function refresh() {
  try {
    const stored = await getClient().hgetall(KEY);

    cache = stored
      ? Object.keys(stored).map((field) => stored[field])
          .filter((item) => item && typeof item === 'object')
      : [];

    loaded = true;
  } catch (err) {
    console.error('[push] Не удалось прочитать подписки:', err.message);
    // Прежний список оставляем: рассылать по устаревшему лучше,
    // чем замолчать совсем
  }

  return cache;
}

/**
 * Текущий список. Синхронная: её зовёт цикл рассылки, и ждать там сеть
 * означало бы растянуть один цикл на время ответа базы.
 */
function getSubscriptions() {
  return cache;
}

/** Сколько подписок знаем. Тоже из памяти — ручку /api/health дёргают часто. */
function count() {
  return cache.length;
}

/** Успели ли прочитать базу хоть раз. */
function isLoaded() {
  return loaded;
}

/**
 * Сохраняет подписку. Повторная от того же человека заменяет прежнюю,
 * а не добавляет вторую.
 *
 * @returns {Promise<object>} сохранённая подписка
 */
async function saveSubscription(subscription) {
  const field = fieldFor(subscription.platform, subscription.chatId);

  const entries = {};
  entries[field] = subscription;

  await getClient().hset(KEY, entries);

  // Кэш правим сразу: ждать до следующего обновления значило бы, что
  // человек включил уведомления, а ближайшие две минуты их не получает
  const at = cache.findIndex((item) => (
    item && String(item.chatId) === String(subscription.chatId) &&
    item.platform === subscription.platform
  ));

  if (at === -1) cache.push(subscription);
  else cache[at] = subscription;

  return subscription;
}

/** Удаляет подписку — пригодится, когда человек заблокировал бота. */
async function removeSubscription(platform, chatId) {
  const field = fieldFor(platform, chatId);

  await getClient().hdel(KEY, field);

  cache = cache.filter((item) => (
    !(String(item.chatId) === String(chatId) && item.platform === platform)
  ));

  return true;
}

/** Запускает периодическое обновление. */
function start() {
  if (timer) return timer;

  timer = setInterval(() => {
    refresh().catch((err) => console.error('[push] Обновление подписок упало:', err.message));
  }, REFRESH_MS);

  timer.unref?.();
  return timer;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = {
  KEY,
  REFRESH_MS,
  refresh,
  getSubscriptions,
  count,
  isLoaded,
  saveSubscription,
  removeSubscription,
  start,
  stop
};
