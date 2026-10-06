/**
 * TIU GO — бот для мессенджера MAX.
 *
 * Работает на официальном Bot API MAX через обычные HTTP-запросы (axios),
 * никакой сторонней библиотеки не требуется. Схема — long polling:
 * бот периодически спрашивает у сервера новые события и отвечает на /start
 * кнопкой «Открыть TIU GO».
 *
 * Запуск:  npm run start:max
 * Токен:   только из process.env.MAX_BOT_TOKEN
 *
 * TODO: сверить точные endpoint'ы, названия полей и типы кнопок
 *       с актуальной документацией — https://dev.max.ru/docs
 *       (здесь используется схема: GET /updates, POST /messages,
 *        attachment типа inline_keyboard с кнопкой типа link).
 */
const https = require('https');
const path = require('path');
const axios = require('axios');

// .env лежит в корне проекта, на уровень выше папки "tiu go max"
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.MAX_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

// TODO: уточнить базовый адрес API в документации https://dev.max.ru/docs
const API_BASE = process.env.MAX_API_BASE || 'https://platform-api2.max.ru';

const POLL_TIMEOUT_SEC = 30; // сколько сервер держит соединение без событий
const RETRY_DELAY_MS = 5000; // пауза перед повтором после сетевой ошибки

// ---------- Проверки окружения ----------
if (!TOKEN || TOKEN.indexOf('поменяю') === 0) {
  console.error('[MAX] Не задан MAX_BOT_TOKEN в .env — бот не запущен.');
  process.exit(1);
}

if (!WEBAPP_URL || !/^https?:\/\//i.test(WEBAPP_URL)) {
  console.error('[MAX] Не задан корректный WEBAPP_URL в .env (нужен полный адрес с https://).');
  process.exit(1);
}

// Общий HTTP-клиент: токен MAX передаётся параметром access_token
// Общий HTTP-клиент: токен MAX передаётся в заголовке Authorization (без Bearer)
const api = axios.create({
  baseURL: API_BASE,
  timeout: (POLL_TIMEOUT_SEC + 15) * 1000,
  headers: {
    'Authorization': TOKEN,
    'Content-Type': 'application/json'
  },
  // Временное отключение проверки сертификата для теста
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const WELCOME = [
  'TIU GO — лифты ТИУ под контролем 🛗',
  '',
  'Шесть лифтов университета в реальном времени:',
  '• на каком этаже сейчас каждый лифт',
  '• сколько человек в кабине',
  '• сколько людей ждут в холле у лифта',
  '',
  'А приложение подскажет — ждать лифт или идти по лестнице.'
].join('\n');

/**
 * Кнопка запуска мини-приложения.
 * TODO: если в MAX появится отдельный тип кнопки для мини-аппов,
 *       заменить 'link' на него — см. https://dev.max.ru/docs
 */
function openAppAttachment() {
  return [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [{ type: 'link', text: '🛗 Открыть TIU GO', url: WEBAPP_URL }]
        ]
      }
    }
  ];
}

/**
 * Отправка сообщения пользователю или в чат.
 * TODO: сверить параметры user_id / chat_id с документацией.
 */
async function sendMessage({ chatId, userId, text }) {
  const params = {};
  if (chatId !== undefined && chatId !== null) params.chat_id = chatId;
  else if (userId !== undefined && userId !== null) params.user_id = userId;

  try {
    await api.post('/messages', { text, attachments: openAppAttachment() }, { params });
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('[MAX] Не удалось отправить сообщение:', detail);
  }
}

/**
 * Разбор одного события. Формат MAX: события приходят с полем update_type,
 * текстовые сообщения — в update.message.body.text.
 * TODO: сверить структуру события с https://dev.max.ru/docs
 */
function parseUpdate(update) {
  const message = update.message || {};
  const recipient = message.recipient || {};
  const sender = (message.sender) || (update.user) || {};
  const body = message.body || {};

  return {
    type: update.update_type || update.type,
    text: (body.text || update.message_text || '').trim(),
    chatId: recipient.chat_id !== undefined ? recipient.chat_id : update.chat_id,
    userId: sender.user_id !== undefined ? sender.user_id : update.user_id
  };
}

/** Реакция на событие. */
async function handleUpdate(update) {
  const event = parseUpdate(update);

  // Новый пользователь нажал «Начать» — это тоже повод показать приложение
  const isStartEvent = event.type === 'bot_started';
  const isStartCommand = /^\/start\b/.test(event.text);

  if (isStartEvent || isStartCommand) {
    console.log('[MAX] /start от пользователя', event.userId || event.chatId);
    await sendMessage({ chatId: event.chatId, userId: event.userId, text: WELCOME });
    return;
  }

  if (/^\/help\b/.test(event.text)) {
    await sendMessage({
      chatId: event.chatId,
      userId: event.userId,
      text: 'Команды:\n/start — открыть TIU GO\n/help — справка\n\nДанные пока тестовые: камеры подключим позже.'
    });
    return;
  }

  // Любое другое сообщение — предлагаем открыть мини-апп
  if (event.text) {
    await sendMessage({
      chatId: event.chatId,
      userId: event.userId,
      text: 'Открыть статус лифта:'
    });
  }
}

/**
 * Основной цикл long polling.
 * marker — указатель на последнее обработанное событие, его возвращает сервер.
 * TODO: сверить имя параметра (marker / offset) с https://dev.max.ru/docs
 */
async function pollLoop() {
  let marker = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const params = { timeout: POLL_TIMEOUT_SEC, limit: 100 };
      if (marker !== null) params.marker = marker;

      const { data } = await api.get('/updates', { params });
      const updates = (data && data.updates) || [];

      for (const update of updates) {
        await handleUpdate(update);
      }

      if (data && data.marker !== undefined && data.marker !== null) {
        marker = data.marker;
      }
    } catch (err) {
      const detail = err.response
        ? `${err.response.status} ${JSON.stringify(err.response.data)}`
        : err.message;
      console.error('[MAX] Ошибка опроса:', detail);
      console.error('[MAX] Повтор через', RETRY_DELAY_MS / 1000, 'с. Проверьте токен и endpoint (https://dev.max.ru/docs).');
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

console.log('[MAX] Бот TIU GO запущен.');
console.log('[MAX] API:', API_BASE);
console.log('[MAX] Мини-апп:', WEBAPP_URL);
console.log('[MAX] Напишите боту /start в MAX.');

pollLoop();
