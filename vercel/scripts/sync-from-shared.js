/**
 * Перенос кода из shared/ в vercel/.
 *
 * Зачем скрипт, а не разовое копирование: на Vercel корнем проекта
 * указывается папка vercel/, и файлы за её пределами в деплой не попадают.
 * Значит, копии в vercel/ нужны обязательно. А раз копии неизбежны, то
 * единственный способ не дать им разойтись с оригиналом — пересобирать их
 * командой, а не руками.
 *
 * Правки описаны ниже списком. Каждая проверяется: если в shared/ что-то
 * поменялось и правка не нашла своё место, скрипт падает и называет её.
 * Это и есть защита от тихого расхождения двух версий.
 *
 *   node scripts/sync-from-shared.js
 */

const fs = require('fs');
const path = require('path');

const VERCEL = path.resolve(__dirname, '..');
const ROOT = path.resolve(VERCEL, '..');
const SHARED = path.join(ROOT, 'shared');

let failed = 0;

// На Vercel корнем проекта указана папка vercel/, и shared/ в деплой
// не попадает — синхронизировать там не из чего и не нужно: копии
// лежат в репозитории. Поэтому это не ошибка сборки, а штатный случай.
if (!fs.existsSync(SHARED)) {
  console.log('Папки shared/ рядом нет — работаем с копиями, которые уже в vercel/.');
  process.exit(0);
}

/** Заменяет кусок текста и ругается, если куска не нашлось. */
function patch(source, from, to, label) {
  if (source.indexOf(from) === -1) {
    console.error('  ✗ не легла правка:', label);
    console.error('    исходник в shared/ изменился — поправьте скрипт синхронизации');
    failed += 1;
    return source;
  }
  return source.replace(from, to);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  console.log('  →', path.relative(VERCEL, file));
}

// ══════════════════════════════════════════════════════════════
// 1. Параметры корпуса — копия без изменений
// ══════════════════════════════════════════════════════════════

console.log('Параметры:');
write(path.join(VERCEL, 'lib', 'params.json'),
  fs.readFileSync(path.join(SHARED, 'params.json'), 'utf8'));

// ══════════════════════════════════════════════════════════════
// 2. Симуляция лифтов
// ══════════════════════════════════════════════════════════════
//
// Правки: путь к параметрам и три функции для serverless — состояние
// нужно уметь поднять из хранилища, выгрузить обратно и догнать до
// текущего момента, потому что фонового таймера здесь нет.

console.log('Симуляция лифтов:');
let mock = fs.readFileSync(path.join(SHARED, 'data', 'mockData.js'), 'utf8');

mock = patch(mock,
  "require('../params.json')",
  "require('./params.json')",
  'путь к params.json');

mock = patch(mock,
  `module.exports = {
  ADDRESS,`,
  `// ---------- Serverless: состояние снаружи, а не в процессе ----------
//
// На постоянном сервере состояние жило в этом модуле и двигалось
// таймером. В serverless процесс умирает между запросами, поэтому
// состояние приходит из хранилища, прокручивается на столько шагов,
// сколько прошло времени, и возвращается обратно.

/** Поднимает состояние из хранилища. Мусор игнорируем и начинаем заново. */
function hydrate(saved) {
  if (!Array.isArray(saved) || saved.length !== state.length) return false;

  saved.forEach((item, i) => {
    if (item && typeof item === 'object') Object.assign(state[i], item);
  });

  return true;
}

/** Снимок состояния для записи в хранилище. */
function snapshot() {
  return state.map((lift) => ({ ...lift }));
}

// Дальше этого числа шагов не прокручиваем: после долгого простоя
// догонять тысячи тиков бессмысленно и дорого — хватает того, что
// картина станет свежей.
const MAX_CATCHUP_TICKS = 40;

/**
 * Прокручивает симуляцию на время, прошедшее с прошлого вызова.
 * @param {number} sinceMs  отметка времени прошлого тика
 * @returns {number} сколько шагов сделали
 */
function tickTo(sinceMs, now = Date.now()) {
  if (!sinceMs) { tick(); return 1; }

  const steps = Math.min(Math.floor((now - sinceMs) / TICK_MS), MAX_CATCHUP_TICKS);
  for (let i = 0; i < steps; i += 1) tick();
  return steps;
}

module.exports = {
  hydrate,
  snapshot,
  tickTo,
  ADDRESS,`,
  'функции hydrate/snapshot/tickTo');

write(path.join(VERCEL, 'lib', 'mockData.js'), mock);

// ══════════════════════════════════════════════════════════════
// 3. Сервер
// ══════════════════════════════════════════════════════════════
//
// Логика целиком переезжает как есть — все расчёты ожидания, прогноза,
// планировщика и текстов уведомлений. Меняются только те места, которые
// физически не работают в serverless: запись в файлы и раздача статики.

console.log('Сервер:');
let server = fs.readFileSync(path.join(SHARED, 'server.js'), 'utf8');

// ── Стоп-кран: админ-панель ещё не перенесена в serverless ──
//
// В shared/server.js появились модули shared/data/users.js и stats.js
// (пользователи ботов и счётчик обращений к API), а вместе с ними —
// рассылка сообщений всем пользователям. В vercel/ ничего этого нет,
// и просто скопировать нельзя:
//
//   users.js / stats.js — пишут в файлы, здесь файловая система только
//     на чтение. Нужен перенос в storage.js, как сделано для подписок.
//   Токен сессии — генерируется при старте процесса. На Vercel процессов
//     много и живут они недолго: токен, выданный одним, другой не узнает.
//     Нужно общее хранилище сессий.
//   Рассылка — крутится в фоне после ответа клиенту. В serverless функцию
//     убивают сразу после ответа, цикл оборвётся на первом же получателе.
//     Нужна очередь, а не цикл в памяти.
//
// Пока этого нет, скрипт останавливается здесь: собрать копию он может,
// но она упадёт при первом же запросе на require('./data/users'). Лучше
// честная остановка, чем сломанный деплой.
if (server.indexOf("require('./data/users')") !== -1) {
  console.error('');
  console.error('  ✗ Остановлено: админ-панель из shared/ не переносится в serverless.');
  console.error('');
  console.error('    В shared/server.js появились users.js, stats.js и рассылка.');
  console.error('    Им нужны запись на диск, общий токен сессии и фоновая задача —');
  console.error('    всего этого в serverless-функции нет. Подробности в комментарии');
  console.error('    к этой проверке в scripts/sync-from-shared.js.');
  console.error('');
  console.error('    Что можно сделать:');
  console.error('      1. перенести users/stats в lib/storage.js (как подписки);');
  console.error('      2. хранить токен сессии там же, а не в памяти процесса;');
  console.error('      3. рассылку либо убрать из vercel-версии, либо вынести в очередь;');
  console.error('      4. после этого снять эту проверку.');
  console.error('');
  console.error('    Копии в vercel/ остались прежними — деплой рабочий,');
  console.error('    просто без админ-панели нового образца.');
  process.exit(1);
}

server = patch(server,
  "const mock = require('./data/mockData');",
  "const mock = require('./mockData');\nconst storage = require('./storage');",
  'путь к mockData + подключение хранилища');

// --- почасовая статистика: файл → хранилище ---

server = patch(server,
  `function readHourly() {
  if (hourly) return hourly;

  try {
    const raw = JSON.parse(fs.readFileSync(HOURLY_FILE, 'utf8'));
    hourly = raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    hourly = {};
  }

  return hourly;
}`,
  `function readHourly() {
  // На Vercel статистика лежит в KV, а не в файле: файловая система
  // здесь только на чтение. Значение уже загружено обёрткой запроса.
  hourly = storage.get('hourly') || {};
  return hourly;
}`,
  'чтение почасовой статистики');

server = patch(server,
  `function saveHourly(now = Date.now()) {
  if (!hourlyDirty || now - hourlySavedAt < HOURLY_SAVE_MS) return;

  try {
    fs.writeFileSync(HOURLY_FILE, JSON.stringify(hourly), 'utf8');
    hourlyDirty = false;
    hourlySavedAt = now;
  } catch (err) {
    console.error('[история] не удалось сохранить:', err.message);
  }
}`,
  `function saveHourly(now = Date.now()) {
  if (!hourlyDirty) return;

  // Запись уходит в KV после ответа клиенту (api/_handler.js), поэтому
  // здесь только помечаем ключ изменённым. Ограничения «раз в минуту»
  // не нужно: в serverless одна запись на запрос и так редкость.
  storage.set('hourly', hourly);
  hourlyDirty = false;
  hourlySavedAt = now;
}`,
  'сохранение почасовой статистики');

// --- жалобы и подписки: файлы → хранилище ---

server = patch(server,
  `function ensureFile(file, empty) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, empty + '\\n', 'utf8');
  } catch (err) {
    console.error('[data] Не удалось создать', path.basename(file) + ':', err.message);
  }
}`,
  `function ensureFile() {
  // В serverless создавать нечего: пустые значения отдаёт хранилище.
}`,
  'ensureFile');

server = patch(server,
  `function readList(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function writeList(file, list) {
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\\n', 'utf8');
}`,
  `// Имя файла из оригинала служит ключом хранилища: так перенесённый
// код маршрутов не пришлось трогать вообще.
function keyOf(file) {
  return String(file).indexOf('subscriptions') !== -1 ? 'subscriptions' : 'reports';
}

function readList(file) {
  const list = storage.get(keyOf(file));
  return Array.isArray(list) ? list : [];
}

function writeList(file, list) {
  storage.set(keyOf(file), list);
}`,
  'readList/writeList');

// --- статика: её раздаёт сам Vercel ---

server = patch(server,
  `  if (req.path === '/admin' || req.path === '/admin/') {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }`,
  `  if (req.path === '/admin' || req.path === '/admin/') {
    // Сам файл отдаёт статика Vercel, здесь только проверка доступа
    return res.redirect('/admin.html');
  }`,
  'страница админки');

server = patch(server,
  `// Статика мини-приложения
app.use(express.static(path.join(__dirname, 'public')));`,
  `// Статику (мини-апп, админку, планировщик) раздаёт сам Vercel из public/,
// поэтому express.static здесь не нужен.`,
  'раздача статики');

server = patch(server,
  `// Любой другой маршрут отдаём мини-апп (удобно при открытии по прямой ссылке)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});`,
  `// До этого места доходят только запросы к /api/*: всё остальное
// перехватывает статика Vercel. Значит, это действительно неизвестная ручка.
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Неизвестный маршрут ' + req.path });
});`,
  'запасной маршрут');

// --- локальный запуск: на Vercel не выполняется, но пусть будет честным ---

server = patch(server,
  `  // Запускаем симуляцию тестовых данных (обновление каждые 3 секунды)
  mock.startSimulation();`,
  `  // Локально симуляция снова идёт таймером — так ближе к прежнему серверу.
  // На Vercel вместо этого прокрутка по времени, см. lib/app.js.
  mock.startSimulation();`,
  'комментарий про локальный запуск');

// --- health показывает, где лежит состояние ---
//
// На Render вопроса не было: состояние всегда в файлах рядом. Здесь оно
// может лежать в KV, а может — в памяти инстанса, и разница видна только
// по тому, что админка «забывает» статусы. Пусть отвечает прямо.

server = patch(server,
  `    admin: adminEnabled(),
    subscriptions: readSubscriptions().length`,
  `    admin: adminEnabled(),
    storage: storage.isPersistent() ? 'kv' : 'memory',
    subscriptions: readSubscriptions().length`,
  'поле storage в /api/health');

// --- окно наблюдений наружу ---
//
// Прогноз считается по ряду показаний за полчаса. На постоянном сервере
// этот ряд копился сам в памяти процесса; здесь процесса между запросами
// нет, поэтому ряд нужно уметь достать и положить обратно.

server = patch(server,
  `module.exports = {
  app,
  PEAK_HOURS,`,
  `module.exports = {
  app,
  history,        // окно наблюдений: в serverless его сохраняет lib/app.js
  PEAK_HOURS,`,
  'экспорт окна наблюдений');

write(path.join(VERCEL, 'lib', 'server-core.js'), server);

// ══════════════════════════════════════════════════════════════
// 4. Фронтенд — побайтовая копия
// ══════════════════════════════════════════════════════════════
//
// Мини-апп ходит в API относительными путями, поэтому его файлы
// переносятся без единой правки.

console.log('Фронтенд:');
const publicDir = path.join(SHARED, 'public');
let count = 0;

for (const name of fs.readdirSync(publicDir)) {
  const from = path.join(publicDir, name);
  if (!fs.statSync(from).isFile()) continue;

  fs.copyFileSync(from, path.join(VERCEL, 'public', name));
  count += 1;
}
console.log('  →', count, 'файлов в public/');

// ══════════════════════════════════════════════════════════════

if (failed) {
  console.error('\nНе применено правок:', failed, '— копии в vercel/ собраны неполностью.');
  process.exit(1);
}

console.log('\nГотово. Копии в vercel/ собраны из shared/.');
