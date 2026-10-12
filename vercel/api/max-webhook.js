/**
 * Вебхук MAX.
 *
 * Адрес указывается в кабинете бота на business.max.ru:
 *
 *   https://<домен>/api/max-webhook
 *
 * TODO: сверить способ подписки и формат события с https://dev.max.ru/docs —
 * та же оговорка, что и в polling-версии бота.
 *
 * Отвечаем 200 в любом случае — по той же причине, что и в Telegram:
 * ошибка доставки обычно приводит к повтору и дублям.
 */

const { handleMaxUpdate } = require('../lib/bots');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Только POST' });
  }

  const secret = process.env.MAX_WEBHOOK_SECRET;

  if (secret && req.headers['x-max-webhook-secret'] !== secret) {
    console.error('[MAX] Чужой запрос на вебхук: секрет не совпал');
    return res.status(401).json({ ok: false, error: 'Неверный секрет' });
  }

  try {
    const action = await handleMaxUpdate(req.body || {});
    console.log('[MAX] вебхук:', action);
  } catch (err) {
    console.error('[MAX] обработка обновления упала:', err.message);
  }

  return res.status(200).json({ ok: true });
};
