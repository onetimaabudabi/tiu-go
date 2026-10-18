/**
 * TIU GO — общий клиент Bot API мессенджера MAX.
 *
 * Зачем отдельный модуль: отправка из бота и отправка из рассылки разъехались.
 * Бот слал на platform-api2.max.ru с токеном в заголовке Authorization,
 * а сервер — на botapi.max.ru с токеном в query-параметре access_token.
 * Бот работал, рассылка молча не доходила. Теперь адрес, авторизация
 * и формат тела живут в одном месте, и разойтись им больше негде.
 *
 * TODO: сверить endpoint'ы, имена параметров и формат вложений
 *       с документацией — https://dev.max.ru/docs
 *       Схема ниже подтверждена практикой: именно так бот успешно
 *       отвечает на /start.
 */

const https = require('https');
const axios = require('axios');

/** Адрес API. Переопределяется переменной MAX_API_BASE. */
function apiBase() {
  return process.env.MAX_API_BASE || 'https://platform-api2.max.ru';
}

/**
 * Токен пригоден к работе? В шаблоне .env стоит «поменяю сам позже»,
 * и слать запросы с такой строкой бессмысленно — отличаем её по пробелам.
 */
function usableToken(value) {
  return typeof value === 'string' && value.trim().length > 10 && !/\s/.test(value.trim());
}

function token() {
  const value = process.env.MAX_BOT_TOKEN;
  return usableToken(value) ? value.trim() : null;
}

/**
 * Проверка TLS-сертификата.
 *
 * ВНИМАНИЕ: в проекте она отключена — с пометкой «временно для теста».
 * Отключённая проверка означает, что соединение можно подменить по дороге:
 * токен бота и тексты сообщений увидит тот, кто встанет посередине.
 *
 * Оставлено как было, чтобы не сломать работающего бота вслепую: проверить
 * сертификат MAX отсюда не удалось, их хост недоступен. Как только будет
 * возможность — поставьте MAX_STRICT_TLS=true и убедитесь, что всё работает.
 * После этого отключение стоит убрать совсем.
 */
function agent() {
  if (process.env.MAX_STRICT_TLS === 'true') return undefined;
  return new https.Agent({ rejectUnauthorized: false });
}

/** Общий HTTP-клиент. Создаётся на каждый вызов: токен может смениться. */
function client(timeoutMs) {
  return axios.create({
    baseURL: apiBase(),
    timeout: timeoutMs || 15000,
    headers: {
      Authorization: token(),
      'Content-Type': 'application/json'
    },
    httpsAgent: agent()
  });
}

/**
 * Кнопки-ссылки под сообщением.
 *
 * @param {Array<{text: string, url: string}>} buttons
 * @returns {Array|null} вложение inline_keyboard или null, если кнопок нет
 */
function linkButtons(buttons) {
  const rows = (buttons || [])
    .filter((item) => item && item.text && item.url)
    // Каждая кнопка своей строкой: длинные подписи в ряд не помещаются
    .map((item) => [{ type: 'link', text: String(item.text), url: String(item.url) }]);

  if (!rows.length) return null;

  return [{ type: 'inline_keyboard', payload: { buttons: rows } }];
}

/**
 * Кому адресовать. В личке MAX видит только отправителя, и chat_id там
 * пустой — тогда писать нужно по user_id. Перепутать их значит отправить
 * сообщение в пустоту.
 */
function targetParams(target) {
  const params = {};

  if (target && typeof target === 'object') {
    if (target.chatId !== undefined && target.chatId !== null) params.chat_id = target.chatId;
    else if (target.userId !== undefined && target.userId !== null) params.user_id = target.userId;
  } else if (target !== undefined && target !== null) {
    params.chat_id = target;
  }

  return params;
}

/** Строка для логов — без токена и без текста сообщения. */
function label(target) {
  const params = targetParams(target);
  if (params.chat_id !== undefined) return 'chat ' + params.chat_id;
  if (params.user_id !== undefined) return 'user ' + params.user_id;
  return 'без адресата';
}

/**
 * Отправка сообщения.
 *
 * @param {object|number} target — {chatId} / {userId} / просто chat_id
 * @param {string} text
 * @param {{buttons?: Array, attachments?: Array, timeoutMs?: number}} [options]
 * @returns {Promise<boolean>} дошло ли
 */
async function sendMessage(target, text, options) {
  if (!token()) return false;

  const opts = options || {};
  const params = targetParams(target);

  if (params.chat_id === undefined && params.user_id === undefined) {
    console.error('[MAX] Некому отправлять: нет ни chat_id, ни user_id');
    return false;
  }

  const body = { text: text };

  const attachments = opts.attachments || linkButtons(opts.buttons);
  if (attachments) body.attachments = attachments;

  try {
    await client(opts.timeoutMs).post('/messages', body, { params: params });
    return true;
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('[MAX]', label(target), '—', detail);
    return false;
  }
}

module.exports = {
  apiBase,
  usableToken,
  token,
  client,
  linkButtons,
  targetParams,
  label,
  sendMessage
};
