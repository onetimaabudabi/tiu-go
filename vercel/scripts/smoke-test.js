/**
 * Проверка переноса: все ручки отвечают тем же, чем на Render.
 *
 * Запускает локальный сервер, дёргает каждый маршрут и сверяет форму
 * ответа. Отдельно проверяет то, ради чего весь перенос и затевался:
 * состояние переживает «холодный старт» (мы его имитируем, сбрасывая
 * кэш хранилища), а симуляция не стоит на месте между запросами.
 *
 *   node scripts/smoke-test.js
 */

const path = require('path');
process.env.ADMIN_ENABLED = 'true';
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const handler = require('../api/[...path].js');
const storage = require('../lib/storage');

const PORT = 3123;
const base = 'http://localhost:' + PORT;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) { passed += 1; console.log('  ✓', name); }
  else { failed += 1; console.log('  ✗', name, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
}

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* не JSON — так и скажем */ }

  return { status: res.status, json, text };
}

// Стенд повторяет Vercel после rewrite: любой /api/* идёт в одну функцию
const app = express();
app.all('/api/*', (req, res) => handler(req, res));

const server = app.listen(PORT, run);

async function run() {
  console.log('Хранилище:', storage.isPersistent() ? 'Vercel KV' : 'память инстанса\n');

  // ---------- 1. Состояние лифтов ----------
  console.log('GET /api/status');
  const status = await call('GET', '/api/status');
  check('отвечает 200', status.status === 200, status.status);
  check('шесть лифтов', status.json && status.json.elevators && status.json.elevators.length === 6,
    status.json && status.json.elevators && status.json.elevators.length);
  check('адрес корпуса на месте', !!(status.json && status.json.address), status.json && status.json.address);
  check('есть расчёт ожидания', !!(status.json && status.json.elevators[0].waitRangeText),
    status.json && status.json.elevators[0].waitRangeText);
  check('есть прогноз', !!(status.json && status.json.forecast));
  check('этаж назначения учитывается',
    (await call('GET', '/api/status?destination=9')).json.destination === 9);

  // ---------- 2. Симуляция идёт между запросами ----------
  console.log('\nСимуляция');
  const first = status.json.elevators.map((e) => e.currentFloor + ':' + e.occupancy).join(',');
  await new Promise((r) => setTimeout(r, 3200));
  const second = (await call('GET', '/api/status')).json.elevators
    .map((e) => e.currentFloor + ':' + e.occupancy).join(',');
  check('показания меняются со временем', first !== second, { first, second });

  // ---------- 3. Жалобы ----------
  console.log('\nPOST /api/report');
  const report = await call('POST', '/api/report', { elevatorId: 1, reason: 'Не открылись двери', comment: 'тест' });
  check('жалоба принята', report.status === 200 && report.json.success === true, report.json);
  const badReport = await call('POST', '/api/report', { elevatorId: 1 });
  check('без причины — 400', badReport.status === 400, badReport.status);

  // ---------- 4. Планировщик ----------
  console.log('\nPOST /api/planner');
  const plan = await call('POST', '/api/planner', { fromFloor: 1, toFloor: 12, targetTime: '13:40', dayOfWeek: 2 });
  check('расчёт пришёл', plan.status === 200 && !!plan.json.exitTime && !!plan.json.waitTime,
    plan.json && Object.keys(plan.json || {}));
  check('указан источник оценки', !!(plan.json && plan.json.source), plan.json && plan.json.source);
  const badPlan = await call('POST', '/api/planner', { fromFloor: 1, toFloor: 5, targetTime: 'нет' });
  check('битое время — 400', badPlan.status === 400, badPlan.status);

  // ---------- 5. Подписка ----------
  console.log('\nPOST /api/notifications/subscribe');
  const sub = await call('POST', '/api/notifications/subscribe',
    { chatId: '424242', platform: 'telegram', floor: 7, lang: 'ru', settings: { enabled: true, threshold: 10 } });
  check('подписка сохранена', sub.status === 200 && sub.json.success === true, sub.json);
  check('этаж записан', sub.json && sub.json.subscription.floor === 7);

  // ---------- 6. Переживает холодный старт ----------
  console.log('\nХолодный старт');
  const beforeReset = (await call('GET', '/api/health')).json;
  storage.reset();                       // имитируем новый инстанс: кэш пуст
  const afterReset = (await call('GET', '/api/health')).json;
  check('health отвечает', afterReset && afterReset.ok === true, afterReset);
  if (storage.isPersistent()) {
    check('подписка на месте после сброса кэша',
      afterReset.subscriptions === beforeReset.subscriptions,
      { было: beforeReset.subscriptions, стало: afterReset.subscriptions });
  } else {
    console.log('  — проверка сохранности пропущена: KV не настроен, состояние и так в памяти');
  }

  // ---------- 7. Админка ----------
  console.log('\nАдминка');
  const admin = await call('GET', '/api/admin/elevators');
  check('список лифтов', admin.status === 200 && admin.json.elevators.length === 6, admin.status);
  const set = await call('POST', '/api/admin/elevator/2', { status: 'broken', statusNote: 'тест' });
  check('статус лифта меняется', set.status === 200 && set.json.success === true,
    set.json && set.json.error);
  const afterSet = await call('GET', '/api/admin/elevators');
  const lift2 = afterSet.json.elevators.find((e) => e.id === 2);
  check('изменение видно в списке', lift2 && lift2.status === 'broken', lift2 && lift2.status);
  const reset = await call('POST', '/api/admin/reset', {});
  check('сброс работает', reset.status === 200 && reset.json.success === true,
    reset.json && reset.json.error);
  const allWorking = await call('POST', '/api/admin/all-working', {});
  check('«все работают» работает',
    allWorking.status === 200 && allWorking.json.success === true
    && allWorking.json.elevators.every((e) => e.status === 'working'),
    allWorking.json && allWorking.json.error);

  // ---------- 8. Рассылка ----------
  console.log('\nGET /api/cron/notify');
  const notify = await call('GET', '/api/cron/notify');
  check('ручка рассылки отвечает', notify.status === 200 && notify.json.ok === true, notify.json);

  // ---------- 9. Неизвестный маршрут ----------
  console.log('\nПрочее');
  const unknown = await call('GET', '/api/нет-такого');
  check('неизвестная ручка — 404 JSON', unknown.status === 404 && unknown.json && unknown.json.success === false,
    unknown.status);
  const options = await call('OPTIONS', '/api/status');
  check('предварительный запрос — 204', options.status === 204, options.status);

  // ---------- 10. Вебхуки ботов ----------
  //
  // Токенов в тесте нет, поэтому отправить ответ бот не сможет — и не должен
  // из-за этого падать: Telegram на любой код, кроме 200, присылает то же
  // обновление снова, и пользователь получает дубли.
  console.log('\nВебхуки ботов');

  const tgGet = await call('GET', '/api/telegram-webhook');
  check('GET на вебхук — 405', tgGet.status === 405, tgGet.status);

  const tgPost = await call('POST', '/api/telegram-webhook', {
    message: { chat: { id: 1 }, text: '/start' }
  });
  check('Telegram: обновление принято', tgPost.status === 200 && tgPost.json.ok === true, tgPost.json);

  const tgEmpty = await call('POST', '/api/telegram-webhook', { foo: 'bar' });
  check('Telegram: мусор не ломает ручку', tgEmpty.status === 200, tgEmpty.status);

  process.env.TELEGRAM_WEBHOOK_SECRET = 'секрет';
  const tgWrong = await call('POST', '/api/telegram-webhook', { message: { chat: { id: 1 }, text: '/start' } });
  check('Telegram: без секрета — 401', tgWrong.status === 401, tgWrong.status);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;

  const maxPost = await call('POST', '/api/max-webhook', {
    update_type: 'message_created',
    message: { sender: { user_id: 7 }, recipient: { chat_id: 7 }, body: { text: '/start' } }
  });
  check('MAX: обновление принято', maxPost.status === 200 && maxPost.json.ok === true, maxPost.json);

  // ---------- 11. Функция действительно одна ----------
  //
  // Ради этого всё и затевалось: на бесплатном тарифе Vercel больше
  // двенадцати функций на деплой не берёт.
  console.log('\nСлияние функций');

  const fs = require('fs');
  const path = require('path');
  const apiDir = path.resolve(__dirname, '..', 'api');

  function countFunctions(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => {
      if (item.isDirectory()) return sum + countFunctions(path.join(dir, item.name));
      // Vercel не считает функциями файлы, чьё имя начинается с подчёркивания
      return sum + (item.name.endsWith('.js') && !item.name.startsWith('_') ? 1 : 0);
    }, 0);
  }

  const functions = countFunctions(apiDir);
  check('в api/ ровно одна функция', functions === 1, functions);
  check('лимит бесплатного тарифа (12) соблюдён', functions <= 12, functions);

  console.log('\nИтог: ' + passed + ' проверок прошло, ' + failed + ' упало');
  server.close();
  process.exit(failed ? 1 : 0);
}
