/**
 * Боты в режиме вебхуков.
 *
 * На Render боты жили отдельными процессами и сами опрашивали серверы
 * (long polling). В serverless постоянного процесса нет, поэтому схема
 * переворачивается: Telegram и MAX сами присылают обновления на наш
 * адрес, функция отвечает и завершается.
 *
 * Тексты, кнопка и логика ответов — те же, что в "tiu go tg/index.js"
 * и "tiu go max/index.js": бот должен вести себя одинаково независимо
 * от того, как он получил сообщение. Те версии остаются для локальной
 * разработки, здесь — боевая.
 */

const axios = require('axios');

const WEBAPP_URL = () => process.env.WEBAPP_URL || '';

/** Telegram открывает мини-апп кнопкой web_app только по HTTPS. */
function isHttps(url) {
  return /^https:\/\//i.test(url);
}

const WELCOME_LINES = [
  'TIU GO — лифты ТИУ под контролем 🛗',
  '',
  'Шесть лифтов университета в реальном времени:',
  '• на каком этаже сейчас каждый лифт',
  '• сколько человек в кабине',
  '• сколько людей ждут в холле у лифта',
  '',
  'А приложение подскажет — ждать лифт или идти по лестнице.'
];

const HELP_TEXT = 'Команды:\n/start — открыть TIU GO\n/help — справка\n\n' +
  'Данные пока тестовые: камеры подключим позже.';

// ══════════════════════════════════════════════════════════════
// Telegram
// ══════════════════════════════════════════════════════════════

const TG_WELCOME = ['*TIU GO* — лифты ТИУ под контролем 🛗'].concat(WELCOME_LINES.slice(1)).join('\n');

/** Клавиатура с кнопкой запуска мини-приложения. */
function telegramKeyboard() {
  const url = WEBAPP_URL();

  const button = isHttps(url)
    ? { text: '🛗 Открыть TIU GO', web_app: { url } }
    : { text: '🛗 Открыть TIU GO', url };

  return { inline_keyboard: [[button]] };
}

async function telegramSend(chatId, text, markdown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[TG] TELEGRAM_BOT_TOKEN не задан — ответить нечем');
    return false;
  }

  try {
    await axios.post('https://api.telegram.org/bot' + token + '/sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: markdown ? 'Markdown' : undefined,
      reply_markup: telegramKeyboard()
    }, { timeout: 8000 });

    return true;
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('[TG] Не удалось отправить сообщение:', detail);
    return false;
  }
}

/**
 * Разбор обновления Telegram. Нас интересуют только текстовые сообщения:
 * на всё остальное бот не реагирует и на Render.
 */
async function handleTelegramUpdate(update) {
  const message = (update && (update.message || update.edited_message)) || null;
  if (!message || !message.chat) return 'пропущено';

  const chatId = message.chat.id;
  const text = typeof message.text === 'string' ? message.text.trim() : '';

  if (/^\/start\b/.test(text)) {
    await telegramSend(chatId, TG_WELCOME, true);
    return '/start';
  }

  if (/^\/help\b/.test(text)) {
    await telegramSend(chatId, HELP_TEXT, false);
    return '/help';
  }

  if (text && !text.startsWith('/')) {
    await telegramSend(chatId, 'Открыть статус лифта:', false);
    return 'сообщение';
  }

  return 'пропущено';
}

// ══════════════════════════════════════════════════════════════
// MAX
// ══════════════════════════════════════════════════════════════

const MAX_WELCOME = WELCOME_LINES.join('\n');

// TODO: уточнить базовый адрес API в документации https://dev.max.ru/docs
const MAX_API_BASE = () => process.env.MAX_API_BASE || 'https://platform-api2.max.ru';

/**
 * Кнопка запуска мини-приложения.
 * TODO: если в MAX появится отдельный тип кнопки для мини-аппов,
 *       заменить 'link' на него — см. https://dev.max.ru/docs
 */
function maxAttachment() {
  return [{
    type: 'inline_keyboard',
    payload: { buttons: [[{ type: 'link', text: '🛗 Открыть TIU GO', url: WEBAPP_URL() }]] }
  }];
}

async function maxSend({ chatId, userId, text }) {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) {
    console.error('[MAX] MAX_BOT_TOKEN не задан — ответить нечем');
    return false;
  }

  const params = { access_token: token };
  if (chatId !== undefined && chatId !== null) params.chat_id = chatId;
  else if (userId !== undefined && userId !== null) params.user_id = userId;

  try {
    await axios.post(MAX_API_BASE() + '/messages',
      { text, attachments: maxAttachment() },
      { params, timeout: 8000 });

    return true;
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('[MAX] Не удалось отправить сообщение:', detail);
    return false;
  }
}

/**
 * Разбор события MAX — тот же, что в polling-версии.
 * TODO: сверить структуру события с https://dev.max.ru/docs
 */
function parseMaxUpdate(update) {
  const message = (update && update.message) || {};
  const recipient = message.recipient || {};
  const sender = message.sender || (update && update.user) || {};
  const body = message.body || {};

  return {
    type: (update && (update.update_type || update.type)) || '',
    text: String(body.text || (update && update.message_text) || '').trim(),
    chatId: recipient.chat_id !== undefined ? recipient.chat_id : (update && update.chat_id),
    userId: sender.user_id !== undefined ? sender.user_id : (update && update.user_id)
  };
}

async function handleMaxUpdate(update) {
  const event = parseMaxUpdate(update);

  // Новый пользователь нажал «Начать» — это тоже повод показать приложение
  if (event.type === 'bot_started' || /^\/start\b/.test(event.text)) {
    await maxSend({ chatId: event.chatId, userId: event.userId, text: MAX_WELCOME });
    return '/start';
  }

  if (/^\/help\b/.test(event.text)) {
    await maxSend({ chatId: event.chatId, userId: event.userId, text: HELP_TEXT });
    return '/help';
  }

  if (event.text) {
    await maxSend({ chatId: event.chatId, userId: event.userId, text: 'Открыть статус лифта:' });
    return 'сообщение';
  }

  return 'пропущено';
}

module.exports = {
  TG_WELCOME,
  MAX_WELCOME,
  HELP_TEXT,
  telegramKeyboard,
  telegramSend,
  handleTelegramUpdate,
  maxSend,
  parseMaxUpdate,
  handleMaxUpdate
};
