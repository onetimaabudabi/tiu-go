/**
 * Общая обёртка всех serverless-функций.
 *
 * Файл начинается с подчёркивания — Vercel такие не превращает в ручки,
 * так что это именно общий модуль, а не ещё один маршрут.
 *
 * Делает три вещи по порядку:
 *   1. поднимает состояние из KV и догоняет симуляцию до текущего времени;
 *   2. отдаёт запрос перенесённому Express-приложению;
 *   3. дожидается, пока ответ уйдёт, и записывает состояние обратно.
 *
 * Третий шаг обязателен именно в таком виде: Vercel замораживает инстанс
 * сразу после того, как функция вернула управление. Если запись в KV не
 * дождаться, она может не доехать — подписка «сохранится» в ответе, но
 * пропадёт на деле.
 */

const { app, hydrate, persist } = require('../lib/app');

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

module.exports = async function handler(req, res) {
  // Предварительный запрос браузера. Отвечаем здесь, а не в Express:
  // если мини-апп и API разведены по разным доменам, без этого ответа
  // браузер не отправит ни одного POST.
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
    console.error('[handler] не удалось поднять состояние:', err.message);
    // Состояние не поднялось — отвечаем на том, что есть в памяти,
    // это лучше, чем пятисотка на весь мини-апп.
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
