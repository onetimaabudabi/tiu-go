/**
 * TIU GO — Telegram-бот.
 *
 * Отвечает на /start и отдаёт кнопку «Открыть TIU GO», которая запускает
 * мини-приложение (shared/public) внутри Telegram.
 *
 * Запуск:  npm run start:telegram
 * Токен:   только из process.env.TELEGRAM_BOT_TOKEN
 */

const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// .env лежит в корне проекта, на уровень выше папки "tiu go tg"
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

// ---------- Проверки окружения ----------
if (!TOKEN) {
  console.error('[TG] Не задан TELEGRAM_BOT_TOKEN в .env — бот не запущен.');
  process.exit(1);
}

if (!WEBAPP_URL || !/^https?:\/\//i.test(WEBAPP_URL)) {
  console.error('[TG] Не задан корректный WEBAPP_URL в .env (нужен полный адрес с https://).');
  console.error('[TG] Пример: WEBAPP_URL=https://tiu-go.example.com');
  process.exit(1);
}

// Telegram открывает мини-апп кнопкой web_app только по HTTPS.
// Для локального http:// делаем обычную ссылку — чтобы можно было тестировать.
const isHttps = /^https:\/\//i.test(WEBAPP_URL);

const bot = new TelegramBot(TOKEN, { polling: true });

/** Клавиатура с кнопкой запуска мини-приложения. */
function openAppKeyboard() {
  const button = isHttps
    ? { text: '🛗 Открыть TIU GO', web_app: { url: WEBAPP_URL } }
    : { text: '🛗 Открыть TIU GO', url: WEBAPP_URL };

  return { reply_markup: { inline_keyboard: [[button]] } };
}

const WELCOME = [
  '*TIU GO* — лифты ТИУ под контролем 🛗',
  '',
  'Шесть лифтов университета в реальном времени:',
  '• на каком этаже сейчас каждый лифт',
  '• сколько человек в кабине',
  '• сколько людей ждут в холле у лифта',
  '',
  'А приложение подскажет — ждать лифт или идти по лестнице.'
].join('\n');

// ---------- Команды ----------
bot.onText(/^\/start\b/, (msg) => {
  bot.sendMessage(msg.chat.id, WELCOME, {
    parse_mode: 'Markdown',
    ...openAppKeyboard()
  });
});

bot.onText(/^\/help\b/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Команды:\n/start — открыть TIU GO\n/help — эта справка\n\nДанные пока тестовые: камеры подключим позже.',
    openAppKeyboard()
  );
});

// На любое другое сообщение тоже предлагаем открыть мини-апп
bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  bot.sendMessage(msg.chat.id, 'Открыть статус лифта:', openAppKeyboard());
});

// ---------- Служебное ----------
bot.on('polling_error', (err) => {
  console.error('[TG] Ошибка опроса:', err.message);

  // Неверный токен — нет смысла долбить Telegram дальше, выходим с понятным текстом
  if (/401|unauthorized/i.test(err.message)) {
    console.error('[TG] Похоже, TELEGRAM_BOT_TOKEN в .env неверный. Бот остановлен.');
    bot.stopPolling().finally(() => process.exit(1));
  }
});

console.log('[TG] Бот TIU GO запущен.');
console.log('[TG] Мини-апп:', WEBAPP_URL, isHttps ? '(кнопка web_app)' : '(обычная ссылка, нужен HTTPS для web_app)');
console.log('[TG] Напишите боту /start в Telegram.');
