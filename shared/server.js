/**
 * TIU GO — общий бэкенд для Telegram и MAX.
 *
 * Отдаёт:
 *   GET /api/status  — состояние всех шести лифтов (JSON)
 *   GET /api/health  — проверка живости сервиса
 *   GET /            — мини-приложение из shared/public
 *
 * Вся расчётная логика живёт здесь — фронтенд только отображает:
 * статус кабины, рекомендация, прогноз ожидания, сравнение с лестницей
 * и расписание пиковых часов.
 *
 * Запуск:  npm run start:server
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

// .env лежит в корне проекта, на уровень выше папки shared
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mock = require('./data/mockData');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Константы расчёта времени ----------

const SECONDS_PER_FLOOR = 3;         // секунд на проезд одного этажа
const SECONDS_PER_PASSENGER = 2;     // секунд на посадку/выход одного человека
const SECONDS_PER_STAIRS_FLOOR = 12; // секунд на один этаж по лестнице

// Этаж назначения по умолчанию. Пользователь выбирает его на экране лифта,
// и фронтенд передаёт выбор параметром ?destination=
const DEFAULT_DESTINATION = 1;

// Куда складываем жалобы на лифты
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');

// ---------- Расписание пиков ----------

/** Пиковые интервалы учебного дня. */
// key нужен фронтенду, чтобы перевести подпись на английский
const PEAK_HOURS = [
  { start: '08:20', end: '08:50', key: 'morning',     label: 'Утренний пик' },
  { start: '13:30', end: '13:50', key: 'afterFirst',  label: 'После первой пары' },
  { start: '15:20', end: '15:40', key: 'afterSecond', label: 'После второй пары' },
  { start: '17:10', end: '17:30', key: 'afterThird',  label: 'После третьей пары' }
];

// За сколько минут до пика предупреждать
const PEAK_SOON_MINUTES = 10;

/** '08:20' -> 500 (минут от начала суток) */
function toMinutes(hhmm) {
  const parts = hhmm.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/**
 * Что происходит с нагрузкой прямо сейчас.
 * Время можно передать явно — так удобно проверять логику в тестах.
 *
 * @param {Date} now — момент, для которого считаем
 * @returns {{isPeak: boolean, peakSoon: boolean, minutesUntilPeak: number|null, peakLabel: string|null}}
 */
function getPeakInfo(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();

  // 1. Идёт ли пик прямо сейчас
  for (const peak of PEAK_HOURS) {
    if (minutes >= toMinutes(peak.start) && minutes < toMinutes(peak.end)) {
      return {
        isPeak: true,
        peakSoon: false,
        minutesUntilPeak: 0,
        peakLabel: peak.label,
        peakKey: peak.key
      };
    }
  }

  // 2. Ближайший пик впереди по сегодняшнему дню
  let nearest = null;
  for (const peak of PEAK_HOURS) {
    const delta = toMinutes(peak.start) - minutes;
    if (delta > 0 && (nearest === null || delta < nearest.delta)) {
      nearest = { delta, label: peak.label, key: peak.key };
    }
  }

  if (nearest && nearest.delta <= PEAK_SOON_MINUTES) {
    return {
      isPeak: false,
      peakSoon: true,
      minutesUntilPeak: nearest.delta,
      peakLabel: nearest.label,
      peakKey: nearest.key
    };
  }

  // 3. Спокойное время
  return {
    isPeak: false,
    peakSoon: false,
    minutesUntilPeak: null,
    peakLabel: null,
    peakKey: null
  };
}

// ---------- Правила расчёта по лифту ----------

/**
 * Статус кабины по её заполненности.
 *   occupancy === 0                      → 'ok'    (зелёный)
 *   от 1 до capacity - 1                 → 'busy'  (жёлто-оранжевый)
 *   occupancy >= capacity                → 'full'  (красный)
 */
function computeStatus(occupancy, capacity) {
  if (occupancy <= 0) return 'ok';
  if (occupancy >= capacity) return 'full';
  return 'busy';
}

/**
 * Рекомендация: ждать лифт или идти по лестнице.
 * Считается уже с учётом выбранного этажа назначения:
 *
 *   1. 'wait'   — на лифте выходит быстрее И ждать меньше минуты;
 *   2. 'stairs' — лестница быстрее ИЛИ ждать 90 секунд и дольше;
 *   3. 'wait'   — во всех остальных случаях.
 *
 * @param {object} times — результат computeTimes()
 */
function computeRecommendation(times) {
  if (times.elevatorTotal < times.stairsTime && times.waitTime < 60) return 'wait';
  if (times.stairsTime < times.elevatorTotal || times.waitTime >= 90) return 'stairs';
  return 'wait';
}

/** 27 -> '~27 сек', 80 -> '~1 мин 20 сек' */
function formatSeconds(seconds) {
  if (seconds < 60) return '~' + seconds + ' сек';

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return '~' + minutes + ' мин' + (rest ? ' ' + rest + ' сек' : '');
}

/**
 * Прогноз ожидания: кабина доезжает до нужного этажа, плюс высадка тех,
 * кто уже внутри, и посадка очереди из холла.
 */
function computeWaitTime(lift, destination) {
  return Math.abs(lift.currentFloor - destination) * SECONDS_PER_FLOOR +
    lift.occupancy * SECONDS_PER_PASSENGER +
    lift.waiting * SECONDS_PER_PASSENGER;
}

/**
 * Сравнение лифта с лестницей для конкретного этажа назначения.
 * Лестница считается от первого этажа до destination.
 */
function computeTimes(lift, destination) {
  const waitTime = computeWaitTime(lift, destination);

  const stairsTime = Math.abs(destination - 1) * SECONDS_PER_STAIRS_FLOOR;

  const elevatorTotal = waitTime +
    Math.abs(lift.currentFloor - destination) * SECONDS_PER_FLOOR +
    lift.occupancy * SECONDS_PER_PASSENGER;

  let fasterOption = 'equal';
  if (elevatorTotal < stairsTime) fasterOption = 'elevator';
  else if (stairsTime < elevatorTotal) fasterOption = 'stairs';

  return {
    waitTime,
    waitTimeText: formatSeconds(waitTime),
    elevatorTotal,
    elevatorTotalText: formatSeconds(elevatorTotal),
    stairsTime,
    stairsTimeText: formatSeconds(stairsTime),
    fasterOption,
    savedSeconds: Math.abs(elevatorTotal - stairsTime)
  };
}

// ---------- Жалобы на лифты ----------

/** Создаёт файл с отчётами, если его ещё нет. */
function ensureReportsFile() {
  try {
    if (!fs.existsSync(REPORTS_FILE)) {
      fs.writeFileSync(REPORTS_FILE, '[]\n', 'utf8');
    }
  } catch (err) {
    console.error('[reports] Не удалось создать файл отчётов:', err.message);
  }
}

/** Читает отчёты; при битом файле начинаем с пустого списка. */
function readReports() {
  try {
    const raw = fs.readFileSync(REPORTS_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

/** Дописывает отчёт в файл. */
function saveReport(report) {
  const list = readReports();
  list.push(report);
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
  return report;
}

// ---------- Middleware ----------

// Мини-апп открывается внутри webview Telegram/MAX — разрешаем кросс-доменные запросы
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Тело отчёта о проблеме приходит JSON-ом и всегда маленькое
app.use(express.json({ limit: '16kb' }));

// Статика мини-приложения
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API ----------

/**
 * Состояние всех лифтов.
 * Необязательный параметр ?destination=4 — этаж, куда едет человек.
 */
app.get('/api/status', (req, res) => {
  const requested = Math.round(Number(req.query.destination));
  const destination = Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_DESTINATION;

  const elevators = mock.getElevators().map((lift) => {
    // Выше своего верхнего этажа лифт не поедет
    const reachable = Math.min(destination, lift.floors);
    const times = computeTimes(lift, reachable);

    return Object.assign({
      id: lift.id,
      number: lift.number,      // номер для подписи «Лифт N» на нужном языке
      cameraFloor: lift.cameraFloor,
      floors: lift.floors, // всего этажей в корпусе — нужно фронту для шахты
      currentFloor: lift.currentFloor,
      occupancy: lift.occupancy,
      capacity: lift.capacity,
      waiting: lift.waiting,
      status: computeStatus(lift.occupancy, lift.capacity),
      recommendation: computeRecommendation(times)
    }, times);
  });

  res.json(Object.assign({
    timestamp: new Date().toISOString(),
    address: mock.ADDRESS, // адрес один на все лифты
    destination,
    refreshMs: mock.TICK_MS,
    elevators
  }, getPeakInfo()));
});

/**
 * Жалоба на лифт: { elevatorId, reason, comment }.
 * Отчёты складываются в shared/data/reports.json.
 */
app.post('/api/report', (req, res) => {
  const body = req.body || {};

  const elevatorId = Math.round(Number(body.elevatorId));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';

  if (!Number.isFinite(elevatorId) || !reason) {
    return res.status(400).json({ success: false, error: 'Нужны elevatorId и reason' });
  }

  const report = {
    timestamp: new Date().toISOString(),
    elevatorId,
    reason: reason.slice(0, 64),
    comment: comment.slice(0, 500) // длинные комментарии обрезаем
  };

  try {
    saveReport(report);
  } catch (err) {
    console.error('[reports] Не удалось сохранить отчёт:', err.message);
    return res.status(500).json({ success: false, error: 'Не удалось сохранить отчёт' });
  }

  console.log('[reports] Лифт', elevatorId, '—', report.reason);
  return res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'tiu-go', uptimeSec: Math.round(process.uptime()) });
});

// Любой другой маршрут отдаём мини-апп (удобно при открытии по прямой ссылке)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Старт ----------

// Поднимаем сервер только при прямом запуске (`npm run start:server`).
// При обычном require модуль можно использовать в тестах, ничего не занимая.
if (require.main === module) {
  ensureReportsFile(); // чтобы первая жалоба не упала на отсутствующем файле

  // Запускаем симуляцию тестовых данных (обновление каждые 3 секунды)
  mock.startSimulation();

  app.listen(PORT, () => {
    console.log('TIU GO — сервер мини-приложения');
    console.log(`  Мини-апп:  http://localhost:${PORT}`);
    console.log(`  API:       http://localhost:${PORT}/api/status`);
    console.log(`  Лифтов:    ${mock.getElevators().length}, обновление раз в ${mock.TICK_MS / 1000} c`);
    console.log('');
    console.log('  Для ботов укажите в .env публичный HTTPS-адрес этого сервера');
    console.log('  в переменной WEBAPP_URL (например, туннель ngrok/cloudflared).');
  });
}

module.exports = {
  app,
  PEAK_HOURS,
  ensureReportsFile,
  readReports,
  computeStatus,
  computeRecommendation,
  computeWaitTime,
  computeTimes,
  getPeakInfo,
  formatSeconds
};
