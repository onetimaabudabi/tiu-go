/**
 * Рассылка уведомлений по расписанию.
 *
 * На Render это был цикл setInterval раз в тридцать секунд. В serverless
 * постоянного процесса нет, поэтому рассылку запускает планировщик Vercel
 * (раздел "crons" в vercel.json) или любой внешний пингер.
 *
 * Важно про тарифы: на бесплатном плане Vercel задание по расписанию
 * запускается раз в сутки. Этого мало для уведомлений «лифт подходит».
 * Варианты: платный план с минутным расписанием или внешний сервис
 * (cron-job.org и подобные), который дёргает этот адрес каждые пять минут.
 * Подробнее — в README, раздел «Деплой на Vercel».
 */

const { core, hydrate, persist } = require('../../lib/app');

module.exports = async function handler(req, res) {
  // Vercel присылает секрет в заголовке; если секрет задан, чужие вызовы отбиваем
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const header = req.headers.authorization || '';
    if (header !== 'Bearer ' + secret) {
      return res.status(401).json({ ok: false, error: 'Нужен заголовок Authorization' });
    }
  }

  let context = null;

  try {
    context = await hydrate();
    const sent = await core.runNotificationCycle();

    if (context) await persist(context);

    console.log('[cron] рассылка: отправлено', sent);
    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('[cron] рассылка упала:', err.message);

    if (context) {
      try { await persist(context); } catch (e) { /* состояние уже не спасти */ }
    }

    return res.status(500).json({ ok: false, error: err.message });
  }
};
