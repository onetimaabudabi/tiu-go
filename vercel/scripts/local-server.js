/**
 * Локальный запуск serverless-версии без Vercel CLI.
 *
 * `vercel dev` требует установленной и залогиненной CLI, а проверить
 * перенос хочется и без неё. Этот скрипт поднимает обычный сервер,
 * который ведёт себя как Vercel: статика из public/, API — через ту же
 * обёртку, что и в бою (поднять состояние → ответить → сохранить).
 *
 *   node scripts/local-server.js
 *   npm run serve
 */

const path = require('path');
const express = require('express');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const handler = require('../api/[...path].js');

const PORT = Number(process.env.PORT) || 3000;
const server = express();

// Весь /api — одна функция, как и на Vercel после rewrite
server.all('/api/*', (req, res) => handler(req, res));

// Статика — как её отдаёт Vercel из public/
server.use(express.static(path.join(__dirname, '..', 'public')));

// Прямая ссылка на мини-апп
server.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log('TIU GO — локальный прогон serverless-версии');
  console.log('  Мини-апп:   http://localhost:' + PORT);
  console.log('  API:        http://localhost:' + PORT + '/api/status');
  console.log('  Рассылка:   http://localhost:' + PORT + '/api/cron/notify');
  console.log('  Вебхуки:    /api/telegram-webhook, /api/max-webhook');
  console.log('  Функций:    1 — все маршруты внутри api/[...path].js');
  console.log('  Хранилище:  ' + (require('../lib/storage').isPersistent()
    ? 'Vercel KV'
    : 'память инстанса (KV не настроен)'));
});
