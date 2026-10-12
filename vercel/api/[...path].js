/**
 * Единственная serverless-функция проекта.
 *
 * Почему одна. Бесплатный тариф Vercel разрешает не больше двенадцати
 * функций на деплой, а маршрутов у нас тринадцать: состояние, жалобы,
 * планировщик, здоровье, пять ручек админки, подписка, два вебхука и
 * рассылка. Раньше каждый лежал отдельным файлом — деплой упирался
 * в лимит и не проходил.
 *
 * Разносить по файлам было и незачем: вся логика и так живёт в одном
 * Express-приложении (lib/server-core.js — перенесённый сервер с Render),
 * а файлы в api/ были двухстрочными обёртками вокруг него. Теперь
 * обёртка одна, и правило Vercel «файл = функция» даёт ровно одну
 * функцию на весь проект.
 *
 * Маршрутизацию внутри ведёт Express, как и на прежнем сервере:
 *   GET  /api/status                  POST /api/report
 *   POST /api/planner                 GET  /api/health
 *   GET  /api/admin/elevators         POST /api/admin/elevator/:id
 *   POST /api/admin/reset             POST /api/admin/all-working
 *   POST /api/admin/test-notification POST /api/notifications/subscribe
 *   POST /api/telegram-webhook        POST /api/max-webhook
 *   GET  /api/cron/notify
 *
 * Про имя файла. Это перехватывающий маршрут Vercel: `[...path]` ловит
 * любой адрес вида /api/что-угодно/сколько-угодно-сегментов и отдаёт его
 * сюда. Правило rewrite при этом не нужно — и это не косметика. Схема
 * «один index.js плюс rewrite на /api/index» держится на допущении, что
 * Vercel сохранит для функции исходный путь, иначе Express увидит
 * /api/index и ответит 404 на всё. У перехватывающего маршрута такого
 * допущения нет: путь сохраняется по определению, из него же берутся
 * параметры маршрута.
 */

const express = require('express');

const { app: coreApp, core: serverCore, hydrate, persist } = require('../lib/app');
const { handleTelegramUpdate, handleMaxUpdate } = require('../lib/bots');

// ---------- Внешнее приложение ----------
//
// Вебхуки и рассылка — не часть перенесённого сервера, они появились
// вместе с serverless. Поэтому они живут снаружи, а всё остальное
// по-прежнему обрабатывает core.

const app = express();

// Тело вебхуков разбираем здесь: у перенесённого сервера свой
// express.json(), но до него эти маршруты не доходят.
const json = express.json({ limit: '64kb' });

/**
 * Рассылка уведомлений.
 *
 * На Render это был цикл setInterval раз в тридцать секунд. Здесь
 * постоянного процесса нет, поэтому рассылку запускает планировщик
 * Vercel (раздел "crons") или внешний пингер.
 */
app.all('/api/cron/notify', async (req, res) => {
  const secret = process.env.CRON_SECRET;

  if (secret && req.headers.authorization !== 'Bearer ' + secret) {
    console.error('[cron] чужой вызов рассылки');
    return res.status(401).json({ ok: false, error: 'Нужен заголовок Authorization' });
  }

  try {
    const sent = await serverCore.runNotificationCycle();
    console.log('[cron] рассылка: отправлено', sent);
    return res.json({ ok: true, sent });
  } catch (err) {
    console.error('[cron] рассылка упала:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Вебхук Telegram.
 *
 * Отвечаем 200 всегда, даже когда обработка не удалась: при другом коде
 * Telegram считает доставку неуспешной и присылает то же обновление
 * снова — человек получает дубли ответов.
 */
app.all('/api/telegram-webhook', json, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Только POST' });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    console.error('[TG] чужой запрос на вебхук: секрет не совпал');
    return res.status(401).json({ ok: false, error: 'Неверный секрет' });
  }

  try {
    console.log('[TG] вебхук:', await handleTelegramUpdate(req.body || {}));
  } catch (err) {
    console.error('[TG] обработка обновления упала:', err.message);
  }

  return res.json({ ok: true });
});

/** Вебхук MAX. Та же логика и та же причина всегда отвечать 200. */
app.all('/api/max-webhook', json, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Только POST' });
  }

  const secret = process.env.MAX_WEBHOOK_SECRET;

  if (secret && req.headers['x-max-webhook-secret'] !== secret) {
    console.error('[MAX] чужой запрос на вебхук: секрет не совпал');
    return res.status(401).json({ ok: false, error: 'Неверный секрет' });
  }

  try {
    console.log('[MAX] вебхук:', await handleMaxUpdate(req.body || {}));
  } catch (err) {
    console.error('[MAX] обработка обновления упала:', err.message);
  }

  return res.json({ ok: true });
});

// Всё остальное — перенесённый сервер: состояние, жалобы, планировщик,
// админка, подписки. Код тот же, что работал на Render.
app.use(coreApp);

// ---------- Обёртка serverless ----------

/** Промис, который разрешается, когда ответ полностью ушёл клиенту. */
function runRequest(req, res) {
  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    res.on('error', reject);

    try {
      app(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Порядок здесь важен и неслучаен:
 *
 *   1. поднять состояние из KV и догнать симуляцию до текущего времени;
 *   2. отдать запрос Express;
 *   3. дождаться, пока ответ уйдёт, и только потом записать состояние.
 *
 * Третий шаг обязателен: Vercel замораживает инстанс сразу после того,
 * как функция вернула управление. Если запись в KV не дождаться, она
 * может не доехать — подписка «сохранится» в ответе, но пропадёт на деле.
 */
module.exports = async function handler(req, res) {
  // Предварительный запрос браузера. Отвечаем до Express: если мини-апп
  // и API разведены по разным доменам, без этого ответа браузер
  // не отправит ни одного POST.
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.statusCode = 204;
    return res.end();
  }

  let context = null;

  try {
    context = await hydrate();
  } catch (err) {
    // Состояние не поднялось — отвечаем на том, что есть в памяти:
    // это лучше, чем пятисотка на весь мини-апп.
    console.error('[handler] не удалось поднять состояние:', err.message);
  }

  try {
    await runRequest(req, res);
  } catch (err) {
    console.error('[handler] запрос упал:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  }

  if (context) {
    try {
      await persist(context);
    } catch (err) {
      console.error('[handler] не удалось сохранить состояние:', err.message);
    }
  }
};

// Приложение отдаём наружу для локального сервера и тестов
module.exports.app = app;
