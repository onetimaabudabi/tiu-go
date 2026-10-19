#!/usr/bin/env node
/**
 * TIU GO — разовый перенос старых файлов данных в Redis.
 *
 *   node scripts/migrate-to-redis.js            — показать, что будет сделано
 *   node scripts/migrate-to-redis.js --apply    — перенести
 *
 * Переносит то, что копилось в файлах до переезда на Redis:
 *   shared/data/reports.json       — жалобы на лифты
 *   shared/data/subscriptions.json — подписки на уведомления
 *   shared/data/history.json       — почасовая копилка планировщика
 *
 * Скрипт идемпотентен: записи, которые уже есть в базе, он не дублирует,
 * а копилку наблюдений не трогает вовсе, если в базе она уже не пустая —
 * там лежат суммы, и сложить их дважды значило бы испортить средние.
 *
 * Файлы после переноса не удаляются: пусть останутся, пока вы не убедитесь,
 * что в админке всё на месте.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../shared/db/redis');
const reports = require('../shared/db/reports');
const subscriptions = require('../shared/db/subscriptions');
const hourly = require('../shared/db/history');

const DATA = path.resolve(__dirname, '..', 'shared', 'data');
const APPLY = process.argv.includes('--apply');

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  } catch (err) {
    return null;
  }
}

async function migrateReports() {
  const list = readJson('reports.json');
  if (!Array.isArray(list) || !list.length) return 'жалоб в файле нет';

  const existing = await reports.getReports();

  // Старые записи без id узнаём по метке времени и номеру лифта
  const known = new Set(existing.map((item) => item.timestamp + '|' + item.elevatorId));
  const fresh = list.filter((item) => !known.has(item.timestamp + '|' + item.elevatorId));

  if (!fresh.length) return `${list.length} жалоб, все уже в базе`;
  if (!APPLY) return `перенесёт ${fresh.length} из ${list.length}`;

  for (const item of fresh) {
    const saved = await reports.addReport({
      elevatorId: item.elevatorId,
      reason: item.reason,
      comment: item.comment
    });

    // Дату сохраняем исходную, а не сегодняшнюю: иначе все старые жалобы
    // встали бы в списке первыми, как будто их написали только что
    saved.timestamp = item.timestamp;
    const entries = {};
    entries[saved.id] = saved;
    await db.getClient().hset(reports.KEY, entries);
  }

  return `перенесено ${fresh.length}`;
}

async function migrateSubscriptions() {
  const list = readJson('subscriptions.json');
  if (!Array.isArray(list) || !list.length) return 'подписок в файле нет';

  await subscriptions.refresh();
  const existing = subscriptions.getSubscriptions();
  const known = new Set(existing.map((item) => item.platform + ':' + item.chatId));
  const fresh = list.filter((item) => !known.has(item.platform + ':' + item.chatId));

  if (!fresh.length) return `${list.length} подписок, все уже в базе`;
  if (!APPLY) return `перенесёт ${fresh.length} из ${list.length}`;

  for (const item of fresh) await subscriptions.saveSubscription(item);

  return `перенесено ${fresh.length}`;
}

async function migrateHistory() {
  const store = readJson('history.json');
  if (!store || typeof store !== 'object') return 'копилки в файле нет';

  const cells = Object.keys(store);
  if (!cells.length) return 'копилка в файле пустая';

  await hourly.load();
  const already = Object.keys(hourly.all()).length;

  // Здесь лежат суммы наблюдений. Сложить их с уже накопленными —
  // значит испортить средние, поэтому переносим только в пустую базу
  if (already) return `в базе уже ${already} ячеек — не трогаю`;
  if (!APPLY) return `перенесёт ${cells.length} ячеек`;

  cells.forEach((key) => {
    const parts = key.split('-');
    hourly.setCell(Number(parts[0]), Number(parts[1]), store[key]);
  });

  await hourly.flush();
  return `перенесено ${cells.length} ячеек`;
}

(async () => {
  console.log('Хранилище:', db.describe());

  if (db.isMemory()) {
    console.error('');
    console.error('База не подключена — переносить некуда.');
    console.error('Задайте UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN в .env.');
    process.exit(1);
  }

  const health = await db.check();
  if (!health.ok) {
    console.error('Нет связи с базой:', health.error);
    process.exit(1);
  }

  console.log(APPLY ? 'Режим: перенос' : 'Режим: просмотр (добавьте --apply, чтобы перенести)');
  console.log('');
  console.log('  Жалобы:    ', await migrateReports());
  console.log('  Подписки:  ', await migrateSubscriptions());
  console.log('  Наблюдения:', await migrateHistory());
  console.log('');

  if (!APPLY) console.log('Ничего не изменено. Запустите с --apply.');
  else console.log('Готово. Файлы в shared/data/ оставлены на всякий случай.');
})();
