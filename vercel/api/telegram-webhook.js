/**
 * Вебхук Telegram.
 *
 * После деплоя адрес нужно один раз сообщить Telegram:
 *
 *   curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://<домен>/api/telegram-webhook&secret_token=<СЕКРЕТ>"
 *
 * Дальше Telegram сам присылает сюда каждое сообщение.
 *
 * Отвечаем всегда 200, даже если обработка не удалась: при другом коде
 * Telegram считает доставку неуспешной и шлёт то же обновление снова —
 * пользователь получает дубли ответов.
 */

const { handleTelegramUpdate } = require('../lib/bots');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Только POST' });
  }

  // Секрет из setWebhook — чтобы на адрес не писал кто попало
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    console.error('[TG] Чужой запрос на вебхук: секрет не совпал');
    return res.status(401).json({ ok: false, error: 'Неверный секрет' });
  }

  try {
    const action = await handleTelegramUpdate(req.body || {});
    console.log('[TG] вебхук:', action);
  } catch (err) {
    console.error('[TG] обработка обновления упала:', err.message);
  }

  return res.status(200).json({ ok: true });
};
