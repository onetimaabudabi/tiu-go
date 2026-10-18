/**
 * TIU GO — общий бэкенд для Telegram и MAX.
 *
 * Отдаёт:
 *   GET  /api/status                 — состояние всех шести лифтов (JSON)
 *   POST /api/report                 — жалоба на лифт
 *   POST /api/notifications/subscribe — подписка на push-уведомления
 *   GET  /api/health                 — проверка живости сервиса
 *   GET  /                           — мини-приложение из shared/public
 *
 * Админка (нужны переменные ADMIN_USERNAME и ADMIN_PASSWORD):
 *   GET  /admin                      — страница админки
 *   POST /api/admin/login            — вход, отдаёт токен сессии
 *   GET  /api/admin/elevators        — состояние лифтов для формы
 *   POST /api/admin/elevators/:id    — статус, пояснение и показания лифта
 *   POST /api/admin/reset            — вернуть случайные значения
 *   POST /api/admin/all-working      — снять все поломки
 *   GET  /api/admin/stats            — пользователи и обращения к API
 *   GET  /api/admin/reports          — жалобы на лифты из мини-аппа
 *   POST /api/admin/broadcast        — рассылка всем пользователям ботов
 *   GET  /api/admin/broadcast        — ход текущей рассылки
 *   POST /api/admin/broadcast/cancel — остановить рассылку
 *   POST /api/admin/test-notification
 *
 * Все ручки, кроме /login, требуют заголовок Authorization: Bearer <token>.
 *
 * Вся расчётная логика живёт здесь — фронтенд только отображает:
 * статус кабины, рекомендация, прогноз ожидания диапазоном,
 * сравнение с лестницей и расписание пиковых часов.
 *
 * Запуск:  npm run start:server
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');

// .env лежит в корне проекта, на уровень выше папки shared
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mock = require('./data/mockData');

// Хранилище. На Render диск эфемерный и у каждого сервиса свой, поэтому
// пользователи, счётчики и статусы лифтов живут в Redis, а не в файлах.
const db = require('./db/redis');
const users = require('./db/users');          // пользователи ботов
const stats = require('./db/stats');          // счётчик обращений к API
const elevatorStore = require('./db/elevators'); // статусы работы лифтов

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Константы расчёта времени ----------

const SECONDS_PER_FLOOR = 3;         // секунд на проезд одного этажа
const SECONDS_PER_PASSENGER = 2;     // секунд на посадку/выход одного человека
const SECONDS_PER_STAIRS_FLOOR = 12; // секунд на один этаж по лестнице

// Штрафа за попутные остановки в расчёте больше нет. Он требовал знать,
// на каких промежуточных этажах кто-то ждёт, а камеры теперь стоят только
// в холле первого этажа — таких данных у системы просто не существует.
// Выдумывать их было бы ложной точностью.

// Насколько прогноз «размазан» в обе стороны от центрального значения.
// 0.25 — это ±25 %: диапазон «~25-40 сек» вместо обманчиво точного «32 сек».
const FORECAST_SPREAD = 0.25;

// Этаж назначения по умолчанию. Пользователь выбирает его на экране лифта,
// и фронтенд передаёт выбор параметром ?destination=
const DEFAULT_DESTINATION = 1;

// Куда складываем жалобы на лифты и подписки на уведомления
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'data', 'subscriptions.json');

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

/** Работает ли лифт физически (не сломан и не на обслуживании). */
function isAvailable(lift) {
  return lift.workStatus === 'working';
}

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
 * Для неработающего лифта вариант один — лестница.
 *
 * @param {object} times — результат computeTimes()
 */
function computeRecommendation(times) {
  if (times.waitTime === null) return 'stairs';
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

/** '~25-40 сек' — обе границы одной строкой, по-русски. */
function formatRange(min, max) {
  if (min === null || max === null) return null;
  return formatSeconds(min) + ' – ' + formatSeconds(max).replace('~', '');
}

/**
 * Обстановка по корпусу целиком: она влияет на прогноз каждого лифта.
 * Считается один раз на запрос, а не для каждого лифта отдельно.
 */
function buildContext(elevators) {
  let brokenCount = 0;
  let queueAtFirstFloor = 0;

  elevators.forEach((lift) => {
    if (!isAvailable(lift)) brokenCount += 1;
    else queueAtFirstFloor += queueOf(lift);
  });

  return {
    total: elevators.length,
    brokenCount,
    queueAtFirstFloor
  };
}

/**
 * Насколько уверенно мы можем обещать время.
 *   high   — все лифты на ходу и очередь короткая;
 *   low    — сломано три лифта и больше либо очередь длиннее семи человек;
 *   medium — всё, что между.
 */
function computeConfidence(lift, context) {
  const queue = queueOf(lift);
  if (context.brokenCount >= 3 || queue > 7) return 'low';
  if (context.brokenCount === 0 && queue < 3) return 'high';
  return 'medium';
}

/**
 * Прогноз ожидания диапазоном — сколько ждать человеку, стоящему
 * в холле первого этажа.
 *
 *   pickupTime      — кабине нужно спуститься за вами на первый этаж;
 *   boardingTime    — высадка тех, кто уже в кабине;
 *   waitingBoarding — посадка очереди, которая стоит перед вами;
 *   brokenPenalty   — нагрузка от сломанных лифтов ложится на рабочие.
 *
 * Отсчёт идёт от первого этажа, а не от этажа назначения: камеры стоят
 * внизу, и человек, который смотрит в приложение, стоит там же.
 *
 * Сумма даёт центральное значение, вокруг него строится диапазон ±25 %.
 * Неработающий лифт прогноза не имеет — возвращаются null.
 */
function computeForecast(lift, destination, context) {
  if (!isAvailable(lift)) {
    return {
      waitTime: null,
      waitTimeMin: null,
      waitTimeMax: null,
      waitTimeText: null,
      waitRangeText: null,
      confidence: 'low'
    };
  }

  const pickupTime = Math.abs(lift.currentFloor - mock.CAMERA_FLOOR) * SECONDS_PER_FLOOR;
  const boardingTime = lift.occupancy * SECONDS_PER_PASSENGER;
  const waitingBoarding = queueOf(lift) * SECONDS_PER_PASSENGER;
  const brokenPenalty = (context.brokenCount / Math.max(context.total, 1)) * pickupTime;

  const central = pickupTime + boardingTime + waitingBoarding + brokenPenalty;
  const spread = central * FORECAST_SPREAD;

  const waitTimeMin = Math.max(Math.round(central - spread), 0);
  const waitTimeMax = Math.round(central + spread);
  const waitTime = Math.round(central);

  return {
    waitTime,
    waitTimeMin,
    waitTimeMax,
    waitTimeText: formatSeconds(waitTime),
    waitRangeText: formatRange(waitTimeMin, waitTimeMax),
    confidence: computeConfidence(lift, context)
  };
}

/**
 * Сравнение лифта с лестницей для конкретного этажа назначения.
 * И лифт, и лестница считаются от первого этажа — человек стоит внизу.
 */
function computeTimes(lift, destination, context) {
  const forecast = computeForecast(lift, destination, context);
  const stairsTime = Math.abs(destination - 1) * SECONDS_PER_STAIRS_FLOOR;

  // Неработающий лифт не с чем сравнивать: остаётся лестница
  if (forecast.waitTime === null) {
    return Object.assign({}, forecast, {
      elevatorTotal: null,
      elevatorTotalText: null,
      stairsTime,
      stairsTimeText: formatSeconds(stairsTime),
      fasterOption: 'stairs',
      savedSeconds: null
    });
  }

  // Ожидание внизу плюс сам подъём с первого этажа до нужного
  const elevatorTotal = forecast.waitTime +
    Math.abs(destination - mock.CAMERA_FLOOR) * SECONDS_PER_FLOOR;

  let fasterOption = 'equal';
  if (elevatorTotal < stairsTime) fasterOption = 'elevator';
  else if (stairsTime < elevatorTotal) fasterOption = 'stairs';

  return Object.assign({}, forecast, {
    elevatorTotal,
    elevatorTotalText: formatSeconds(elevatorTotal),
    stairsTime,
    stairsTimeText: formatSeconds(stairsTime),
    fasterOption,
    savedSeconds: Math.abs(elevatorTotal - stairsTime)
  });
}

/**
 * Очередь у одного лифта.
 *
 * Поле называется по-разному в двух местах: в сыром снимке симуляции это
 * waitingAtFirstFloor, а в ответе API — waitingFirstFloor. Функции ниже
 * работают и с тем, и с другим, поэтому чтение вынесено сюда.
 */
function queueOf(lift) {
  const value = lift.waitingFirstFloor !== undefined
    ? lift.waitingFirstFloor
    : lift.waitingAtFirstFloor;

  return Number(value) || 0;
}

/**
 * Сколько всего людей ждёт лифты в холле первого этажа — сумма показаний
 * всех камер. Неработающие лифты не считаем: их очередь уже разошлась.
 */
function firstFloorQueue(elevators) {
  return elevators.reduce((sum, lift) => (
    isAvailable(lift) ? sum + queueOf(lift) : sum
  ), 0);
}

/** Лифт с самой длинной очередью внизу — к нему стоять дольше всего. */
function busiestLift(elevators) {
  return elevators
    .filter(isAvailable)
    .reduce((a, b) => (!a || queueOf(b) > queueOf(a) ? b : a), null);
}

// ---------- История наблюдений и прогноз ----------
//
// Камера отдаёт только мгновенный снимок: сколько человек в кабине и
// сколько стоит внизу. Чтобы сказать «через пять минут очередь вырастет
// до двенадцати», нужна не одна точка, а их ряд. Поэтому сервер ведёт
// скользящее окно наблюдений и считает по нему тенденцию.
//
// История живёт в памяти процесса. Это сознательный выбор: показания
// лифтов нужны ровно до тех пор, пока по ним считается тренд, и писать
// их на диск незачем. Для планировщика выхода, которому нужна картина
// за несколько дней, рядом копятся почасовые средние — они как раз
// сохраняются (см. HOURLY_FILE).

const HISTORY_WINDOW_MS = 30 * 60 * 1000;  // глубина окна наблюдений
const HISTORY_SAMPLE_MS = 10 * 1000;       // как часто снимаем показания
const TREND_POINTS = 10;                   // по скольким последним точкам тренд

// Ниже этого наклона тенденции нет — это дрожание данных, а не рост.
// Для отдельного лифта и для всего холла пороги разные: в холле
// складываются очереди трёх кабин, и шум там втрое выше.
const TREND_DEADZONE_LIFT = 0.3;   // чел/мин
const TREND_DEADZONE_HALL = 0.8;   // чел/мин

// Горизонты прогноза, минуты
const FORECAST_HORIZONS = [5, 10];

/** id лифта -> массив точек { t, occupancy, waiting } */
const history = new Map();

/** Записывает текущие показания всех лифтов в историю. */
function recordHistory(now = Date.now()) {
  const elevators = mock.getElevators();

  elevators.forEach((lift) => {
    const points = history.get(lift.id) || [];

    points.push({
      t: now,
      occupancy: Number(lift.occupancy) || 0,
      waiting: isAvailable(lift) ? queueOf(lift) : 0
    });

    // Выбрасываем всё, что старше окна: память не должна расти
    while (points.length && now - points[0].t > HISTORY_WINDOW_MS) points.shift();

    history.set(lift.id, points);
  });

  recordHourly(elevators, now);
  return elevators;
}

/**
 * Наклон прямой наименьших квадратов по последним TREND_POINTS точкам,
 * в единицах поля за минуту.
 *
 * Берём именно МНК, а не разность «последняя точка минус первая»:
 * разность целиком зависит от двух случайных значений, а наклон
 * использует весь ряд и устойчив к одиночному выбросу.
 */
function trendPerMinute(points, field) {
  const last = points.slice(-TREND_POINTS);
  if (last.length < 3) return 0;

  const t0 = last[0].t;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;

  last.forEach((point) => {
    const x = (point.t - t0) / 60000;   // минуты от начала отрезка
    const y = Number(point[field]) || 0;

    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  });

  const n = last.length;
  const denominator = n * sumXX - sumX * sumX;

  // Все точки пришлись на один момент времени — наклона нет
  if (Math.abs(denominator) < 1e-9) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/** Словесная оценка наклона: растёт, падает или держится. */
function trendLabel(slope, deadzone) {
  if (slope > deadzone) return 'growing';
  if (slope < -deadzone) return 'falling';
  return 'stable';
}

/** Проекция значения на horizon минут вперёд с ограничением сверху и снизу. */
function project(base, slope, minutes, max) {
  const value = Math.round(base + slope * minutes);
  return Math.min(Math.max(value, 0), max);
}

/**
 * Прогноз по одному лифту. У неработающего прогноза нет: кабина стоит,
 * очередь к ней уже разошлась, и экстраполировать нечего.
 */
function forecastLift(lift) {
  if (!isAvailable(lift)) return null;

  const points = history.get(lift.id) || [];
  const occupancySlope = trendPerMinute(points, 'occupancy');
  const waitingSlope = trendPerMinute(points, 'waiting');

  const occupancy = Number(lift.occupancy) || 0;
  const waiting = queueOf(lift);
  const capacity = Number(lift.capacity) || mock.CAPACITY;

  const result = {
    samples: points.length,
    trendOccupancy: Number(occupancySlope.toFixed(2)),
    trendWaiting: Number(waitingSlope.toFixed(2))
  };

  FORECAST_HORIZONS.forEach((minutes) => {
    result['in' + minutes + 'min'] = {
      occupancy: project(occupancy, occupancySlope, minutes, capacity),
      waiting: project(waiting, waitingSlope, minutes, mock.MAX_WAITING),
      trend: trendLabel(waitingSlope, TREND_DEADZONE_LIFT)
    };
  });

  return result;
}

/**
 * Прогноз по холлу целиком: столько человек будет стоять внизу у всех
 * работающих лифтов вместе. Именно это число видит человек на главном
 * экране — к какому конкретно лифту он встанет, он решает уже на месте.
 *
 * Загруженность в холле усредняется по кабинам: сумма мест по шести
 * лифтам ничего не значит, а средняя наполненность — значит.
 */
function forecastHall(elevators) {
  const working = elevators.filter(isAvailable);

  if (!working.length) return null;

  let waitingSlope = 0;
  let occupancySlope = 0;
  let waiting = 0;
  let occupancy = 0;
  let capacity = 0;
  let samples = 0;

  working.forEach((lift) => {
    const points = history.get(lift.id) || [];

    waitingSlope += trendPerMinute(points, 'waiting');
    occupancySlope += trendPerMinute(points, 'occupancy');
    waiting += queueOf(lift);
    occupancy += Number(lift.occupancy) || 0;
    capacity += Number(lift.capacity) || mock.CAPACITY;
    samples = Math.max(samples, points.length);
  });

  const count = working.length;
  const result = {
    samples,
    trendOccupancy: Number((occupancySlope / count).toFixed(2)),
    trendWaiting: Number(waitingSlope.toFixed(2))
  };

  FORECAST_HORIZONS.forEach((minutes) => {
    result['in' + minutes + 'min'] = {
      occupancy: project(
        Math.round(occupancy / count), occupancySlope / count, minutes,
        Math.round(capacity / count)
      ),
      waiting: project(waiting, waitingSlope, minutes, mock.MAX_WAITING * count),
      trend: trendLabel(waitingSlope, TREND_DEADZONE_HALL)
    };
  });

  return result;
}

// ---------- Почасовая статистика ----------
//
// Прогноз на пять минут живёт в оперативной памяти, а планировщику выхода
// нужна картина за несколько дней: «по вторникам в 9:40 ждут около сорока
// секунд». Хранить ради этого все снимки не нужно — достаточно средних
// по часу и дню недели, а это полтора килобайта на всю неделю.
//
// Копится честно: среднее по тем наблюдениям, которые сервер реально
// видел. Пока наблюдений мало, планировщик так и говорит — считает
// по расписанию пар, а не по истории.

const HOURLY_FILE = path.join(__dirname, 'data', 'history.json');

// Сколько наблюдений в ячейке считаем достаточным, чтобы верить среднему
const HOURLY_MIN_SAMPLES = 30;

// Потолок счётчика: дальше среднее обновляется скользящим окном и
// свежие дни постепенно вытесняют старые.
const HOURLY_MAX_SAMPLES = 20000;

let hourly = null;        // { 'день-час': { samples, waitSum, queueSum } }
let hourlyDirty = false;
let hourlySavedAt = 0;

// Чаще раза в минуту на диск не пишем
const HOURLY_SAVE_MS = 60 * 1000;

function hourlyKey(day, hour) {
  return day + '-' + hour;
}

function readHourly() {
  if (hourly) return hourly;

  try {
    const raw = JSON.parse(fs.readFileSync(HOURLY_FILE, 'utf8'));
    hourly = raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    hourly = {};
  }

  return hourly;
}

function saveHourly(now = Date.now()) {
  if (!hourlyDirty || now - hourlySavedAt < HOURLY_SAVE_MS) return;

  try {
    fs.writeFileSync(HOURLY_FILE, JSON.stringify(hourly), 'utf8');
    hourlyDirty = false;
    hourlySavedAt = now;
  } catch (err) {
    console.error('[история] не удалось сохранить:', err.message);
  }
}

/**
 * Добавляет текущий момент в почасовую копилку.
 * Среднее ожидание берём по работающим лифтам — именно его человек
 * и почувствует, встав в холле.
 */
function recordHourly(elevators, now = Date.now()) {
  const working = elevators.filter(isAvailable);
  if (!working.length) return;

  const context = buildContext(elevators);
  const waits = working.map((lift) => computeForecast(lift, 1, context).waitTime);
  const avgWait = waits.reduce((sum, value) => sum + value, 0) / waits.length;

  const date = new Date(now);
  const key = hourlyKey(date.getDay(), date.getHours());
  const store = readHourly();
  const cell = store[key] || { samples: 0, waitSum: 0, queueSum: 0 };

  // Переполнение: ужимаем накопленное вдвое, сохраняя среднее
  if (cell.samples >= HOURLY_MAX_SAMPLES) {
    cell.samples = Math.round(cell.samples / 2);
    cell.waitSum = cell.waitSum / 2;
    cell.queueSum = cell.queueSum / 2;
  }

  cell.samples += 1;
  cell.waitSum += avgWait;
  cell.queueSum += firstFloorQueue(elevators);

  store[key] = cell;
  hourlyDirty = true;
  saveHourly(now);
}

/**
 * Что известно про этот день недели и час.
 * @returns {{waitTime: number, queue: number, samples: number}|null}
 */
function hourlyStats(day, hour) {
  const cell = readHourly()[hourlyKey(day, hour)];
  if (!cell || cell.samples < HOURLY_MIN_SAMPLES) return null;

  return {
    waitTime: cell.waitSum / cell.samples,
    queue: cell.queueSum / cell.samples,
    samples: cell.samples
  };
}

// ---------- Планировщик выхода ----------

const PLANNER_BUFFER_SEC = 120;     // запас, который закладываем всегда
const PLANNER_BOARDING = 10;        // посадка и высадка, с
const PLANNER_RELAXED_MIN = 10;     // больше этого до выхода — «есть время»
const PLANNER_SOON_MIN = 3;         // меньше этого — «пора выходить»

// Во сколько раз дольше ждать в час пик, если истории ещё нет.
// Оценка грубая и помечена в ответе как source: 'schedule'.
const PLANNER_PEAK_FACTOR = 1.8;

// За сколько минут до начала пика поток уже заметен
const PLANNER_PEAK_LEAD = 5;

function clampFloor(value) {
  const floor = Math.round(Number(value));
  if (!Number.isFinite(floor)) return 1;
  return Math.min(Math.max(floor, 1), mock.FLOORS);
}

/** 'ЧЧ:ММ' -> минуты от начала суток, либо null, если строка не та. */
function parseHhmm(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatHhmm(date) {
  return String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

/**
 * Ближайший момент, когда наступит указанный день недели и время.
 * Сегодняшнее время, которое уже прошло, уезжает на следующую неделю —
 * иначе планировщик советовал бы выйти вчера.
 */
function nextOccurrence(dayOfWeek, minutesOfDay, now = new Date()) {
  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60);

  let shift = (dayOfWeek - now.getDay() + 7) % 7;
  if (shift === 0 && target.getTime() <= now.getTime()) shift = 7;

  target.setDate(target.getDate() + shift);
  return target;
}

/** Среднее ожидание по работающим лифтам прямо сейчас. */
function currentAverageWait() {
  const elevators = mock.getElevators();
  const context = buildContext(elevators);
  const working = elevators.filter(isAvailable);

  if (!working.length) return 0;

  const total = working.reduce((sum, lift) => (
    sum + computeForecast(lift, 1, context).waitTime
  ), 0);

  return total / working.length;
}

/** Попадает ли время в пиковый интервал учебного дня. */
function isPeakMinute(minutesOfDay) {
  return PEAK_HOURS.some((peak) => (
    minutesOfDay >= toMinutes(peak.start) - PLANNER_PEAK_LEAD &&
    minutesOfDay < toMinutes(peak.end)
  ));
}

/**
 * Сколько ждать лифта в этот день недели и час.
 * Сначала смотрим в накопленную статистику, и только если её мало —
 * считаем по расписанию пар от текущей загрузки.
 */
function estimateWait(dayOfWeek, hour) {
  const stats = hourlyStats(dayOfWeek, hour);

  if (stats) {
    return { waitTime: stats.waitTime, source: 'history', samples: stats.samples };
  }

  const base = currentAverageWait();
  const peak = isPeakMinute(hour * 60);

  return {
    waitTime: peak ? base * PLANNER_PEAK_FACTOR : base,
    source: 'schedule',
    samples: 0
  };
}

/** Запускает съём показаний. Возвращает таймер — пригодится тестам. */
function startHistory() {
  recordHistory();
  const timer = setInterval(() => recordHistory(), HISTORY_SAMPLE_MS);
  timer.unref?.();
  return timer;
}

/**
 * Полная выкладка по всем лифтам для заданного этажа назначения.
 *
 * @param {number} destination — этаж, куда едет человек
 * @param {object} [options]
 * @param {boolean} [options.includePeak] — класть ли в ответ сведения
 *        о пиковых часах. Мини-приложению они больше не нужны: плашки
 *        про пары убраны. Рассылке уведомлений — нужны, она просит их явно.
 */
function buildStatus(destination, options) {
  const raw = mock.getElevators();
  const context = buildContext(raw);

  const elevators = raw.map((lift) => {
    // Выше своего верхнего этажа лифт не поедет
    const reachable = Math.min(destination, lift.floors);
    const times = computeTimes(lift, reachable, context);

    return Object.assign({
      id: lift.id,
      forecast: forecastLift(lift),
      number: lift.number,      // номер для подписи «Лифт N» на нужном языке
      cameraFloor: lift.cameraFloor, // всегда 1: камеры стоят только внизу
      floors: lift.floors, // всего этажей в корпусе — нужно фронту для шахты
      currentFloor: lift.currentFloor,
      occupancy: lift.occupancy,
      capacity: lift.capacity,
      waitingFirstFloor: lift.waitingAtFirstFloor, // что видит камера внизу
      workStatus: lift.workStatus,   // 'working' | 'broken' | 'maintenance'
      statusNote: lift.statusNote,
      available: isAvailable(lift),
      status: computeStatus(lift.occupancy, lift.capacity),
      recommendation: computeRecommendation(times)
    }, times);
  });

  // Поля пиков остаются в ответе ради совместимости, но по умолчанию пустые:
  // плашки «Сейчас после первой пары» убраны из интерфейса.
  const peak = options && options.includePeak
    ? getPeakInfo()
    : { isPeak: false, peakSoon: false, minutesUntilPeak: null, peakLabel: null, peakKey: null };

  return Object.assign({
    timestamp: new Date().toISOString(),
    address: mock.ADDRESS, // адрес один на все лифты
    floors: mock.FLOORS,   // фронтенд строит по этому числу выбор этажа
    cameraFloor: mock.CAMERA_FLOOR, // этаж, где стоят камеры
    destination,
    refreshMs: mock.TICK_MS,
    total: elevators.length,
    working: elevators.filter((lift) => lift.available).length,
    queueAtFirstFloor: firstFloorQueue(elevators),
    // Прогноз по холлу: сколько человек будет стоять внизу через 5 и 10 минут
    forecast: forecastHall(raw),
    // Ссылка на канал проекта — берётся из .env, фронтенд её только открывает
    // Канал у проекта есть всегда, поэтому запасное значение — он сам.
    // Переменная нужна, только чтобы подменить адрес, не трогая код.
    channelUrl: process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/tiu_go',
    // Публичный адрес мини-аппа: из него собирается ссылка «поделиться»
    appUrl: process.env.WEBAPP_URL || null,
    elevators
  }, peak);
}

// ---------- Файлы с данными ----------

/** Создаёт файл, если его ещё нет. Пустое значение — валидный JSON. */
function ensureFile(file, empty) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, empty + '\n', 'utf8');
  } catch (err) {
    console.error('[data] Не удалось создать', path.basename(file) + ':', err.message);
  }
}

function ensureReportsFile() {
  ensureFile(REPORTS_FILE, '[]');
}

function ensureSubscriptionsFile() {
  ensureFile(SUBSCRIPTIONS_FILE, '[]');
}

/** Читает массив из JSON-файла; при битом файле начинаем с пустого списка. */
function readList(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function writeList(file, list) {
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

function readReports() {
  return readList(REPORTS_FILE);
}

/** Дописывает отчёт в файл. */
function saveReport(report) {
  const list = readReports();
  list.push(report);
  writeList(REPORTS_FILE, list);
  return report;
}

function readSubscriptions() {
  return readList(SUBSCRIPTIONS_FILE);
}

// ---------- Push-уведомления ----------

// Как часто проверяем обстановку и рассылаем уведомления
const NOTIFY_INTERVAL_MS = 30000;

// Чтобы одно и то же событие не прилетало каждые полминуты,
// по каждому типу держим паузу. Пик объявляем реже — он длится дольше.
const NOTIFY_COOLDOWN_MS = { peak: 30 * 60 * 1000, default: 10 * 60 * 1000 };

// Когда считаем, что «лифт вот-вот подойдёт», секунды
const ARRIVING_FROM = 60;
const ARRIVING_TO = 120;

const NOTIFY_TYPES = ['crowd', 'arriving', 'peak', 'broken', 'full'];

// Порог уведомления об очереди считается по всему холлу первого этажа,
// а не по одному лифту, поэтому вилка шире прежней
const THRESHOLD_MIN = 5;
const THRESHOLD_MAX = 30;

/** Настройки по умолчанию: подписка молчит, пока человек сам её не включит. */
const DEFAULT_NOTIFY_SETTINGS = {
  enabled: false,
  threshold: 12,
  types: { crowd: true, arriving: true, peak: true, broken: true, full: false }
};

// Языки, на которых умеем писать подписчику
const PUSH_LANGS = ['ru', 'en', 'zh'];

/** Язык подписки с запасным вариантом: незнакомое значение — русский. */
function pushLang(value) {
  return PUSH_LANGS.indexOf(value) !== -1 ? value : 'ru';
}

/**
 * Подписи пиков на языке подписчика. Русские живут в PEAK_HOURS и здесь
 * не дублируются — для них сработает запасная ветка.
 */
const PEAK_LABELS = {
  en: {
    morning: 'Morning peak',
    afterFirst: 'After first class',
    afterSecond: 'After second class',
    afterThird: 'After third class'
  },
  zh: {
    morning: '早高峰',
    afterFirst: '第一节课后高峰',
    afterSecond: '第二节课后高峰',
    afterThird: '第三节课后高峰'
  }
};

function peakLabel(lang, key) {
  const dict = PEAK_LABELS[lang];
  if (dict && dict[key]) return dict[key];

  const peak = PEAK_HOURS.find((item) => item.key === key);
  return peak ? peak.label : '';
}

/**
 * Тексты уведомлений. Без эмодзи: часть клиентов показывает их
 * в заголовке списка чатов как мусор, а смысл несёт только текст.
 */
const PUSH_TEXTS = {
  ru: {
    crowd: 'На 1 этаже очередь: лифты ждут {n} человек. Возможно, быстрее по лестнице.',
    arriving: 'Лифт {number} подойдёт вниз примерно через {min}-{max} сек.',
    peak: 'Через {n} мин начнётся {label}. Лифты будут загружены.',
    broken: 'Лифт {number} не работает.{note}',
    full: 'Лифт {number} переполнен: {occupancy} из {capacity}.',
    test: 'Тестовое уведомление TIU GO. Рассылка настроена верно.'
  },
  en: {
    crowd: 'Queue on floor 1: {n} people waiting for the elevators. Stairs may be faster.',
    arriving: 'Elevator {number} arrives downstairs in about {min}-{max} sec.',
    peak: '{label} starts in {n} min. Elevators will be busy.',
    broken: 'Elevator {number} is out of order.{note}',
    full: 'Elevator {number} is full: {occupancy} of {capacity}.',
    test: 'TIU GO test notification. Delivery works.'
  },
  zh: {
    crowd: '1 层有 {n} 人在等电梯。走楼梯可能更快。',
    arriving: '{number} 号电梯约 {min}-{max} 秒后到达一层。',
    peak: '{label}将在 {n} 分钟后开始，电梯会比较拥挤。',
    broken: '{number} 号电梯无法运行。{note}',
    full: '{number} 号电梯已满载：{occupancy}/{capacity}。',
    test: 'TIU GO 测试通知。推送配置正常。'
  }
};

function pushText(lang, key, params) {
  const dict = PUSH_TEXTS[lang] || PUSH_TEXTS.ru;
  const template = dict[key] || PUSH_TEXTS.ru[key] || key;

  return template.replace(/\{(\w+)\}/g, (match, name) => (
    params && params[name] !== undefined ? params[name] : ''
  ));
}

/**
 * Токен из .env пригоден к работе? В шаблоне стоит «поменяю сам позже»,
 * и слать запросы с такой строкой бессмысленно — отличаем её по пробелам.
 */
function usableToken(value) {
  return typeof value === 'string' && value.trim().length > 10 && !/\s/.test(value.trim());
}

/** Отправка в Telegram через Bot API. */
function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!usableToken(token)) return Promise.resolve(false);

  return axios.post('https://api.telegram.org/bot' + token.trim() + '/sendMessage', {
    chat_id: chatId,
    text: text,
    disable_notification: false
  }, { timeout: 8000 })
    .then(() => true)
    .catch((err) => {
      console.error('[push] Telegram', chatId, '—', err.message);
      return false;
    });
}

/**
 * Отправка в MAX.
 *
 * Получателя принимаем в двух видах: числом (это chat_id, так зовёт
 * рассылка уведомлений) или объектом {chatId, userId} — в личке бот MAX
 * видит только отправителя, и тогда адресовать приходится по user_id.
 *
 * TODO: сверить адрес метода, имя параметра получателя и формат тела
 *       с документацией — https://dev.max.ru/docs
 */
function sendMax(target, text) {
  const token = process.env.MAX_BOT_TOKEN;
  if (!usableToken(token)) return Promise.resolve(false);

  const params = { access_token: token.trim() };
  let label;

  if (target && typeof target === 'object') {
    if (target.chatId !== undefined && target.chatId !== null) {
      params.chat_id = target.chatId;
      label = 'chat ' + target.chatId;
    } else {
      params.user_id = target.userId;
      label = 'user ' + target.userId;
    }
  } else {
    params.chat_id = target;
    label = 'chat ' + target;
  }

  return axios.post('https://botapi.max.ru/messages', { text: text }, {
    params: params,
    timeout: 8000
  })
    .then(() => true)
    .catch((err) => {
      console.error('[push] MAX', label, '—', err.message);
      return false;
    });
}

function sendPush(subscription, text) {
  if (subscription.platform === 'max') return sendMax(subscription.chatId, text);
  return sendTelegram(subscription.chatId, text);
}

// Когда в последний раз отправляли уведомление данного типа данному человеку.
// Живёт в памяти: при перезапуске сервера паузы сбрасываются, и это нормально.
const lastSentAt = new Map();

function cooldownPassed(subscription, type, now) {
  const key = subscription.platform + ':' + subscription.chatId + ':' + type;
  const pause = NOTIFY_COOLDOWN_MS[type] || NOTIFY_COOLDOWN_MS.default;
  const previous = lastSentAt.get(key);

  if (previous !== undefined && now - previous < pause) return false;

  lastSentAt.set(key, now);
  return true;
}

/** Включён ли у подписчика конкретный тип уведомлений. */
function wants(subscription, type) {
  const settings = subscription.settings || {};
  if (!settings.enabled) return false;

  const types = settings.types || {};
  return types[type] !== false;
}

/**
 * Какие уведомления сейчас заслужил конкретный подписчик.
 * Возвращает массив { type, text } — отправкой занимается вызывающий код.
 */
function collectNotifications(subscription, status) {
  const lang = pushLang(subscription.lang);
  const floor = Number(subscription.floor) || 1;
  const settings = subscription.settings || {};
  const threshold = Number(settings.threshold) || DEFAULT_NOTIFY_SETTINGS.threshold;
  const out = [];

  // 1. Очередь в холле первого этажа.
  //    Этаж подписчика здесь ни при чём: камеры стоят только внизу,
  //    и данных по другим этажам в системе нет.
  if (wants(subscription, 'crowd')) {
    const queue = firstFloorQueue(status.elevators);
    if (queue >= threshold) {
      out.push({ type: 'crowd', text: pushText(lang, 'crowd', { n: queue }) });
    }
  }

  // 2. Лифт подходит через одну-две минуты
  if (wants(subscription, 'arriving')) {
    const arriving = status.elevators.find((lift) => (
      lift.available &&
      lift.waitTime !== null &&
      lift.waitTime >= ARRIVING_FROM &&
      lift.waitTime <= ARRIVING_TO
    ));

    if (arriving) {
      out.push({
        type: 'arriving',
        text: pushText(lang, 'arriving', {
          number: arriving.number,
          min: arriving.waitTimeMin,
          max: arriving.waitTimeMax
        })
      });
    }
  }

  // 3. Начинается час пик
  if (wants(subscription, 'peak') && status.peakSoon) {
    // Подпись пика переводим: в ответе API она русская, потому что
    // предназначена тем, кто читает API напрямую
    out.push({
      type: 'peak',
      text: pushText(lang, 'peak', {
        n: status.minutesUntilPeak,
        label: peakLabel(lang, status.peakKey)
      })
    });
  }

  // 4. Лифт сломался. Привязки к этажу здесь больше нет: вставший лифт
  //    одинаково касается всех, кто его ждёт, на любом этаже.
  if (wants(subscription, 'broken')) {
    const broken = status.elevators.find((lift) => !lift.available);

    if (broken) {
      out.push({
        type: 'broken',
        text: pushText(lang, 'broken', {
          number: broken.number,
          note: broken.statusNote ? ' ' + broken.statusNote : ''
        })
      });
    }
  }

  // 5. Лифт переполнен
  if (wants(subscription, 'full')) {
    const full = status.elevators.find((lift) => (
      lift.available && lift.status === 'full'
    ));

    if (full) {
      out.push({
        type: 'full',
        text: pushText(lang, 'full', {
          number: full.number,
          occupancy: full.occupancy,
          capacity: full.capacity
        })
      });
    }
  }

  return out;
}

/**
 * Один проход рассылки: смотрим обстановку и отправляем то,
 * что прошло по настройкам и не упало в паузу.
 */
function runNotificationCycle() {
  const subscriptions = readSubscriptions();
  if (!subscriptions.length) return Promise.resolve(0);

  const now = Date.now();
  const jobs = [];

  subscriptions.forEach((subscription) => {
    if (!subscription || !subscription.chatId) return;

    // Статус зависит от этажа подписчика: для него это и есть пункт назначения.
    // Сведения о пиках просим явно — в ответе /api/status их больше нет.
    const floor = Number(subscription.floor) || 1;
    const status = buildStatus(Math.min(Math.max(floor, 1), mock.FLOORS), { includePeak: true });

    collectNotifications(subscription, status).forEach((item) => {
      if (!cooldownPassed(subscription, item.type, now)) return;
      jobs.push(sendPush(subscription, item.text));
    });
  });

  if (!jobs.length) return Promise.resolve(0);

  return Promise.all(jobs).then((results) => results.filter(Boolean).length);
}

function startNotifications() {
  const timer = setInterval(() => {
    runNotificationCycle().catch((err) => {
      console.error('[push] Цикл рассылки упал:', err.message);
    });
  }, NOTIFY_INTERVAL_MS);

  timer.unref?.();
  return timer;
}

// ---------- Статусы лифтов из базы в симуляцию ----------

/**
 * Переносит сохранённые статусы в mockData.
 *
 * Разделение такое: в базе лежит то, что поставил человек (статус работы
 * и комментарий), в памяти — то, что считает симуляция (этаж, кабина,
 * очередь). Здесь первое накладывается на второе.
 *
 * Числовые поля намеренно не трогаем: setElevator замораживает лифт,
 * которому выставили цифры руками, и симуляция перестала бы его двигать.
 */
function applyElevatorStatuses(statuses) {
  Object.keys(statuses || {}).forEach((id) => {
    const record = statuses[id];

    mock.setElevator(id, {
      status: record.status,
      statusNote: record.statusNote === null ? '' : record.statusNote
    });
  });
}

// ---------- Middleware ----------

// Мини-апп открывается внутри webview Telegram/MAX — разрешаем кросс-доменные запросы
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Тело отчёта и подписки приходит JSON-ом и всегда маленькое
app.use(express.json({ limit: '16kb' }));

// ---------- Админка ----------

/**
 * Админка закрыта логином и паролем из .env:
 *
 *   ADMIN_USERNAME=admin
 *   ADMIN_PASSWORD=...
 *
 * Пока переменных нет, страницы и ручек просто не существует — 404.
 * Это важнее удобства: с этой страницы можно переключить статусы лифтов
 * и разослать сообщение всем пользователям бота.
 *
 * ADMIN_ENABLED=false — жёсткий выключатель поверх пароля: на боевом
 * сервере админку можно убрать совсем, не удаляя логин с паролем.
 */

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Пароль из шаблона .env.example. Запуск с ним не запрещаем — иначе
// первое знакомство с проектом начиналось бы с ошибки, — но в консоли
// про это пишем прямо.
const DEFAULT_ADMIN_PASSWORD = 'change_me_please';

/**
 * Токен сессии. Генерируется один раз при старте процесса и живёт только
 * в памяти: перезапуск сервера разлогинивает админку. Так и задумано —
 * украденный токен перестаёт работать сам, без всякой логики истечения.
 */
const ADMIN_TOKEN = crypto.randomBytes(24).toString('hex');

/** Логин и пароль заданы? */
function adminConfigured() {
  return ADMIN_USERNAME.length > 0 && ADMIN_PASSWORD.length > 0;
}

/** Админка доступна? */
function adminEnabled() {
  if (process.env.ADMIN_ENABLED === 'false') return false;
  return adminConfigured();
}

function adminOff(res) {
  return res.status(404).json({
    success: false,
    error: 'Админка недоступна. Задайте ADMIN_USERNAME и ADMIN_PASSWORD — ' +
      'локально в .env, на хостинге в переменных окружения сервиса — ' +
      'и перезапустите сервер.'
  });
}

/**
 * Сравнение секретов за постоянное время. Обычное === выдаёт длину
 * и первый несовпавший символ через время ответа; для пароля это лишнее.
 */
function sameSecret(expected, received) {
  const left = Buffer.from(String(expected), 'utf8');
  const right = Buffer.from(String(received), 'utf8');

  // timingSafeEqual требует одинаковую длину, поэтому длину сверяем отдельно.
  // Её утечка безобидна: подобрать пароль по длине всё равно нельзя.
  if (left.length !== right.length) return false;

  return crypto.timingSafeEqual(left, right);
}

// ---------- Защита от перебора пароля ----------

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // окно подсчёта попыток
const LOGIN_MAX_TRIES = 10;             // столько неудач — и адрес ждёт

// Ключ — req.ip. За обратным прокси (Render, nginx) все запросы приходят
// с одного адреса, и счётчик фактически становится общим: десять неудач
// подряд закроют вход на 15 минут для всех. Доверять X-Forwarded-For вместо
// этого нельзя — заголовок подделывается, и ограничение обходилось бы
// сменой одной строки в запросе.
const loginTries = new Map(); // ip -> { count, resetAt }

/** Чистим просроченные записи, чтобы карта не росла бесконечно. */
function pruneLoginTries(now) {
  loginTries.forEach((entry, ip) => {
    if (entry.resetAt <= now) loginTries.delete(ip);
  });
}

function loginBlocked(ip, now) {
  const entry = loginTries.get(ip);
  return Boolean(entry && entry.resetAt > now && entry.count >= LOGIN_MAX_TRIES);
}

function noteLoginFail(ip, now) {
  const entry = loginTries.get(ip);

  if (!entry || entry.resetAt <= now) {
    loginTries.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  entry.count += 1;
}

/** Страница и её файлы. Проверка стоит ПЕРЕД express.static — иначе статика
 *  отдала бы admin.html любому, кто знает имя файла. */
app.use((req, res, next) => {
  if (!/^\/admin(\/|\.|$)/.test(req.path)) return next();
  if (!adminEnabled()) return adminOff(res);

  if (req.path === '/admin' || req.path === '/admin/') {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }

  return next(); // admin.css и admin.js отдаст статика
});

// Все ручки управления — за той же проверкой
app.use('/api/admin', (req, res, next) => {
  if (!adminEnabled()) return adminOff(res);
  next();
});

// Статика мини-приложения
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Вход. Отвечает токеном, который фронтенд кладёт в localStorage
 * и присылает в заголовке Authorization: Bearer <token>.
 *
 * Зарегистрирован ДО проверки токена ниже — иначе войти было бы нельзя.
 */
app.post('/api/admin/login', (req, res) => {
  const now = Date.now();
  const ip = req.ip || 'unknown';

  pruneLoginTries(now);

  if (loginBlocked(ip, now)) {
    console.warn('[admin] Слишком много попыток входа с', ip);
    return res.status(429).json({
      success: false,
      error: 'Слишком много попыток. Попробуйте через 15 минут.'
    });
  }

  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  // Обе проверки выполняем всегда, даже если первая уже провалилась:
  // иначе время ответа подсказывало бы, верен ли логин.
  const userOk = sameSecret(ADMIN_USERNAME, username);
  const passOk = sameSecret(ADMIN_PASSWORD, password);

  if (!userOk || !passOk) {
    noteLoginFail(ip, now);
    console.warn('[admin] Неудачный вход с', ip);
    return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
  }

  loginTries.delete(ip);
  console.log('[admin] Вход выполнен с', ip);

  return res.json({ success: true, token: ADMIN_TOKEN });
});

/**
 * Проверка токена для всех остальных ручек /api/admin/*.
 * Нет заголовка или токен чужой — 401, и фронтенд возвращает экран логина.
 */
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login') return next();

  const header = req.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();

  if (!token || !sameSecret(ADMIN_TOKEN, token)) {
    return res.status(401).json({ success: false, error: 'Нужен вход в админку' });
  }

  return next();
});

// ---------- Лифты ----------

app.get('/api/admin/elevators', (req, res) => {
  res.json({
    success: true,
    floors: mock.FLOORS,
    maxWaiting: mock.MAX_WAITING,
    statuses: mock.STATUSES,
    elevators: mock.getAdminElevators()
  });
});

/**
 * Правка одного лифта.
 *
 * Статус и комментарий уезжают в базу — они должны пережить передеплой.
 * Числовые поля остаются в памяти симуляции: это мгновенные показания,
 * хранить которые незачем, а писать их в Redis на каждое изменение —
 * лишние команды при месячной квоте.
 */
async function updateElevator(req, res) {
  const body = req.body || {};

  if (body.status !== undefined || body.statusNote !== undefined) {
    const saved = await elevatorStore.updateElevator(
      req.params.id, body.status, body.statusNote
    );

    if (!saved.ok) return res.status(400).json({ success: false, error: saved.error });
  }

  const result = mock.setElevator(req.params.id, body);

  if (!result.ok) return res.status(400).json({ success: false, error: result.error });

  console.log('[admin] Лифт', req.params.id, '—', JSON.stringify(body));
  res.json({ success: true, elevator: result.elevator });
}

/** Обёртка: ошибку из async-обработчика иначе никто не поймает. */
function handle(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[admin]', req.method, req.path, '—', err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  };
}

// Два адреса на один обработчик: /elevators/:id — текущий, /elevator/:id
// остался от прежней версии админки, чтобы не ломать закладки и скрипты.
app.post('/api/admin/elevators/:id', handle(updateElevator));
app.post('/api/admin/elevator/:id', handle(updateElevator));

app.post('/api/admin/reset', handle(async (req, res) => {
  console.log('[admin] Сброс к случайным значениям');

  // Сначала база, потом память: иначе через полминуты обновление кэша
  // вернуло бы из базы прежние статусы, и кнопка выглядела бы сломанной
  applyElevatorStatuses(await elevatorStore.resetToDefaults());
  res.json({ success: true, elevators: mock.resetRandom() });
}));

app.post('/api/admin/all-working', handle(async (req, res) => {
  console.log('[admin] Все лифты переведены в «работает»');

  applyElevatorStatuses(await elevatorStore.setAllWorking());
  res.json({ success: true, elevators: mock.setAllWorking() });
}));

// ---------- Статистика ----------

app.get('/api/admin/stats', handle(async (req, res) => {
  // Два обращения к базе разом: ждать их по очереди незачем
  const [counts, api] = await Promise.all([
    users.countUsers(),
    stats.snapshot()
  ]);

  const elevators = mock.getAdminElevators();

  res.json({
    success: true,

    // Плоские поля — то, что просит вкладка «Статистика»
    usersCount: counts.total,
    totalRequests: api.total,
    todayRequests: api.today,

    users: counts,
    api: api,
    subscriptions: readSubscriptions().length,
    reports: readReports().length,
    elevators: {
      total: elevators.length,
      working: elevators.filter((lift) => lift.status === 'working').length
    },
    storage: db.isMemory() ? 'memory' : 'redis',
    uptimeSec: Math.round(process.uptime())
  });
}));

// ---------- Сообщения о проблемах ----------

// Сколько жалоб отдаём за раз. Их пишет каждый желающий из мини-аппа,
// так что список растёт сам по себе, а на экране всё равно читают свежие.
const REPORTS_PAGE = 200;

/**
 * Жалобы на лифты — те самые, что люди шлют кнопкой «Сообщить о проблеме».
 *
 * Отдаём свежие сверху плюс две сводки: по лифтам и по причинам. Сводки
 * считаются по ВСЕМ жалобам, а не по отданной странице: иначе «лифт 1 —
 * 12 жалоб» означало бы «12 среди последних двухсот», и цифра врала бы
 * тем сильнее, чем больше накопилось.
 */
app.get('/api/admin/reports', (req, res) => {
  const all = readReports();

  const byElevator = {};
  const byReason = {};

  all.forEach((report) => {
    const id = report.elevatorId;
    const reason = report.reason || 'other';

    byElevator[id] = (byElevator[id] || 0) + 1;
    byReason[reason] = (byReason[reason] || 0) + 1;
  });

  // Файл дописывается в конец, поэтому свежие — в хвосте
  const recent = all.slice(-REPORTS_PAGE).reverse();

  res.json({
    success: true,
    total: all.length,
    shown: recent.length,
    reports: recent,
    byElevator: byElevator,
    byReason: byReason
  });
});

// ---------- Рассылка ----------

// Пауза между сообщениями. Telegram разрешает боту около 30 сообщений
// в секунду на всех получателей; 50 мс — это 20 в секунду, с запасом.
const BROADCAST_DELAY_MS = 50;

// Telegram режет сообщение на 4096 символах — берём с запасом
const BROADCAST_MAX_LENGTH = 3500;

/** Текущая (или последняя завершённая) рассылка. Живёт в памяти. */
let broadcastJob = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Состояние рассылки для UI — без текста получателей и прочего лишнего. */
function broadcastState(job) {
  if (!job) return null;

  return {
    id: job.id,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
    done: job.done,
    cancelled: job.cancelled,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null
  };
}

/**
 * Отправка одному пользователю. Платформу берём из его записи в базе.
 *
 * У MAX идентификатор бывает двух видов: chat_id для групп и user_id
 * для лички, где бот видит только отправителя. Чем адресовать, бот
 * записал в поле addressBy — перепутать их значит отправить в пустоту.
 */
function sendToUser(user, text) {
  if (user.platform !== 'max') return sendTelegram(user.chatId, text);

  return sendMax(
    user.addressBy === 'user'
      ? { userId: user.chatId }
      : { chatId: user.chatId },
    text
  );
}

/**
 * Проход по получателям. Ошибка на одном человеке (заблокировал бота,
 * удалил чат, сеть отвалилась) не должна останавливать рассылку и уж тем
 * более ронять сервер — поэтому каждый вызов обёрнут в try.
 */
async function runBroadcast(job) {
  for (const user of job.recipients) {
    if (job.cancelled) break;

    try {
      const ok = await sendToUser(user, job.text);
      if (ok) job.sent += 1;
      else job.failed += 1;
    } catch (err) {
      // sendTelegram/sendMax ошибки уже глотают, но страховка дешёвая
      console.error('[admin] Рассылка', user.platform, user.chatId, '—', err.message);
      job.failed += 1;
    }

    await sleep(BROADCAST_DELAY_MS);
  }

  job.done = true;
  job.finishedAt = Date.now();

  console.log('[admin] Рассылка окончена: доставлено', job.sent,
    'из', job.total, '· ошибок', job.failed, job.cancelled ? '· остановлена' : '');
}

/** Запуск рассылки. Отвечает сразу, отправка идёт в фоне. */
app.post('/api/admin/broadcast', handle(async (req, res) => {
  if (broadcastJob && !broadcastJob.done) {
    return res.status(409).json({
      success: false,
      error: 'Рассылка уже идёт',
      progress: broadcastState(broadcastJob)
    });
  }

  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) {
    return res.status(400).json({ success: false, error: 'Текст сообщения пустой' });
  }

  if (text.length > BROADCAST_MAX_LENGTH) {
    return res.status(400).json({
      success: false,
      error: 'Слишком длинное сообщение: ' + text.length + ' символов из ' +
        BROADCAST_MAX_LENGTH
    });
  }

  // Только пользователи ботов из нашего .env. Отправлять основным ботом
  // по chatId, которые выдал тестовый, бессмысленно: Telegram такие чаты
  // не знает, и рассылка собрала бы ошибки на ровном месте.
  const recipients = await users.ownUsers(users.currentTags());

  if (!recipients.length) {
    return res.status(400).json({
      success: false,
      error: 'Получателей нет. Список наполняется, когда люди пишут /start ' +
        'боту, чей токен задан для этого сервера.'
    });
  }

  // Без рабочего токена рассылка молча «отправит» ноль сообщений —
  // честнее сказать об этом сразу, чем показать 0 из 100.
  const needTelegram = recipients.some((user) => user.platform !== 'max');

  const needMax = recipients.some((user) => user.platform === 'max');
  const hasTelegram = usableToken(process.env.TELEGRAM_BOT_TOKEN);
  const hasMax = usableToken(process.env.MAX_BOT_TOKEN);

  if ((needTelegram && !hasTelegram) && (needMax && !hasMax)) {
    return res.status(400).json({
      success: false,
      error: 'В .env нет рабочих токенов ботов — отправлять нечем.'
    });
  }

  broadcastJob = {
    id: crypto.randomBytes(6).toString('hex'),
    text: text,
    recipients: recipients,
    total: recipients.length,
    sent: 0,
    failed: 0,
    done: false,
    cancelled: false,
    startedAt: Date.now(),
    finishedAt: null
  };

  console.log('[admin] Рассылка', broadcastJob.id, '—', recipients.length, 'получателей');

  // Запускаем и не ждём: отправка 100 сообщений по 50 мс займёт пять секунд,
  // держать на это время HTTP-запрос незачем.
  runBroadcast(broadcastJob).catch((err) => {
    console.error('[admin] Рассылка упала целиком:', err.message);
    broadcastJob.done = true;
    broadcastJob.finishedAt = Date.now();
  });

  // Предупреждаем, если часть получателей недостижима из-за токена
  const warnings = [];
  if (needTelegram && !hasTelegram) warnings.push('нет TELEGRAM_BOT_TOKEN');
  if (needMax && !hasMax) warnings.push('нет MAX_BOT_TOKEN');

  res.json({
    success: true,
    progress: broadcastState(broadcastJob),
    warning: warnings.length ? warnings.join(', ') : null
  });
}));

/** Сколько уже отправлено — фронтенд опрашивает эту ручку раз в секунду. */
app.get('/api/admin/broadcast', handle(async (req, res) => {
  res.json({
    success: true,
    recipients: await users.countUsers(),
    progress: broadcastState(broadcastJob)
  });
}));

/** Остановить начатую рассылку: дойдёт текущее сообщение и всё. */
app.post('/api/admin/broadcast/cancel', (req, res) => {
  if (!broadcastJob || broadcastJob.done) {
    return res.json({ success: true, progress: broadcastState(broadcastJob) });
  }

  broadcastJob.cancelled = true;
  console.log('[admin] Рассылка', broadcastJob.id, '— остановлена вручную');

  res.json({ success: true, progress: broadcastState(broadcastJob) });
});

/** Тестовое уведомление всем подписчикам — проверить, что рассылка жива. */
app.post('/api/admin/test-notification', (req, res) => {
  const subscriptions = readSubscriptions();

  if (!subscriptions.length) {
    return res.json({ success: true, sent: 0, total: 0, note: 'Подписок пока нет' });
  }

  Promise.all(subscriptions.map((subscription) => (
    sendPush(subscription, pushText(pushLang(subscription.lang), 'test'))
  )))
    .then((results) => {
      const sent = results.filter(Boolean).length;
      console.log('[admin] Тестовое уведомление:', sent, 'из', subscriptions.length);
      res.json({ success: true, sent, total: subscriptions.length });
    })
    .catch((err) => {
      res.status(500).json({ success: false, error: err.message });
    });
});

// ---------- API ----------

/**
 * Состояние всех лифтов.
 * Необязательный параметр ?destination=4 — этаж, куда едет человек.
 */
app.get('/api/status', (req, res) => {
  // Счётчик для вкладки «Статистика». Синхронный: копится в памяти,
  // в Redis уходит раз в минуту одной командой INCRBY (см. db/stats.js)
  stats.incrementRequestCount();

  const requested = Math.round(Number(req.query.destination));
  const destination = Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_DESTINATION;

  res.json(buildStatus(destination));
});
/**
 * Планировщик выхода: во сколько выходить, чтобы успеть к нужному часу.
 *
 * Тело запроса: { fromFloor, toFloor, targetTime: 'ЧЧ:ММ', dayOfWeek }
 *
 * Ожидание берём из почасовой статистики — сервер копит её сам, пока
 * работает. Если наблюдений за этот час ещё мало, честно считаем по
 * расписанию пар и говорим об этом в поле source: выдавать оценку по
 * двум замерам за наблюдения было бы обманом.
 */
app.post('/api/planner', (req, res) => {
  const body = req.body || {};

  const fromFloor = clampFloor(body.fromFloor);
  const toFloor = clampFloor(body.toFloor);
  const parsed = parseHhmm(body.targetTime);

  if (parsed === null) {
    return res.status(400).json({ error: 'targetTime должен быть в формате ЧЧ:ММ' });
  }

  const now = new Date();
  const day = Number.isInteger(Number(body.dayOfWeek))
    ? ((Number(body.dayOfWeek) % 7) + 7) % 7
    : now.getDay();

  const target = nextOccurrence(day, parsed, now);
  const estimate = estimateWait(day, Math.floor(parsed / 60));

  // Дорога: проезд между этажами плюс посадка и высадка
  const travelTime = Math.abs(toFloor - fromFloor) * SECONDS_PER_FLOOR +
    PLANNER_BOARDING;

  const lead = estimate.waitTime + travelTime + PLANNER_BUFFER_SEC;
  const exitAt = new Date(target.getTime() - lead * 1000);
  const minutesLeft = (exitAt.getTime() - now.getTime()) / 60000;

  let status = 'now';
  if (minutesLeft > PLANNER_RELAXED_MIN) status = 'ok';
  else if (minutesLeft >= PLANNER_SOON_MIN) status = 'soon';

  res.json({
    fromFloor,
    toFloor,
    targetTime: formatHhmm(target),
    targetAt: target.toISOString(),
    exitTime: formatHhmm(exitAt),
    exitAt: exitAt.toISOString(),
    waitTime: Math.round(estimate.waitTime),
    travelTime: Math.round(travelTime),
    bufferMinutes: PLANNER_BUFFER_SEC / 60,
    minutesLeft: Math.round(minutesLeft),
    status,
    source: estimate.source,
    samples: estimate.samples
  });
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

/**
 * Подписка на push-уведомления: { chatId, platform, floor, settings, lang }.
 * Повторный вызов с тем же chatId обновляет настройки, а не плодит записи.
 * Подписки лежат в shared/data/subscriptions.json.
 */
app.post('/api/notifications/subscribe', (req, res) => {
  const body = req.body || {};

  const chatId = typeof body.chatId === 'string' || typeof body.chatId === 'number'
    ? String(body.chatId).trim()
    : '';

  if (!chatId) {
    return res.status(400).json({ success: false, error: 'Нужен chatId' });
  }

  const platform = body.platform === 'max' ? 'max' : 'telegram';
  const floor = Math.min(Math.max(Math.round(Number(body.floor)) || 1, 1), mock.FLOORS);

  const incoming = body.settings || {};
  const incomingTypes = incoming.types || {};

  // Собираем настройки по известным ключам: что прислал клиент, кроме них, не храним
  const settings = {
    enabled: incoming.enabled !== false,
    threshold: Math.min(Math.max(
      Math.round(Number(incoming.threshold)) || DEFAULT_NOTIFY_SETTINGS.threshold,
      THRESHOLD_MIN), THRESHOLD_MAX),
    types: {}
  };

  NOTIFY_TYPES.forEach((type) => {
    settings.types[type] = incomingTypes[type] !== undefined
      ? !!incomingTypes[type]
      : DEFAULT_NOTIFY_SETTINGS.types[type];
  });

  const subscription = {
    chatId,
    platform,
    floor,
    lang: pushLang(body.lang),
    settings,
    updatedAt: new Date().toISOString()
  };

  try {
    const list = readSubscriptions();
    const at = list.findIndex((item) => (
      item && String(item.chatId) === chatId && item.platform === platform
    ));

    if (at === -1) list.push(subscription);
    else list[at] = subscription;

    writeList(SUBSCRIPTIONS_FILE, list);
  } catch (err) {
    console.error('[push] Не удалось сохранить подписку:', err.message);
    return res.status(500).json({ success: false, error: 'Не удалось сохранить подписку' });
  }

  console.log('[push] Подписка', platform, chatId, '— этаж', floor,
    settings.enabled ? '(включена)' : '(выключена)');

  return res.json({ success: true, subscription });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'tiu-go',
    uptimeSec: Math.round(process.uptime()),
    admin: adminEnabled(),
    subscriptions: readSubscriptions().length
  });
});

// Любой другой маршрут отдаём мини-апп (удобно при открытии по прямой ссылке)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Старт ----------

/**
 * Подготовка хранилища: проверяем связь и заводим статусы лифтов,
 * если база пустая.
 *
 * Сервер поднимается даже при недоступной базе — мини-апп должен
 * показывать лифты, даже когда Redis прилёг. Но в лог об этом пишем
 * громко: иначе «статистика не копится» выяснится через неделю.
 */
async function prepareStorage() {
  const health = await db.check();

  if (!health.ok) {
    console.error('[база] Нет связи:', health.error);
    console.error('[база] Статистика и пользователи сохраняться не будут.');
    return false;
  }

  try {
    const created = await elevatorStore.init();
    applyElevatorStatuses(elevatorStore.getElevators());

    if (created.length) {
      console.log('[база] Статусы лифтов заведены впервые:', created.join(', '));
    }
  } catch (err) {
    console.error('[база] Не удалось прочитать статусы лифтов:', err.message);
    return false;
  }

  return true;
}

/** Последний сброс счётчиков перед остановкой: Render шлёт SIGTERM. */
function installShutdown() {
  let closing = false;

  const bye = (signal) => {
    if (closing) return;
    closing = true;

    console.log(`[${signal}] Останавливаемся, сбрасываем счётчики...`);

    stats.flush()
      .catch((err) => console.error('[stats] Финальный сброс не удался:', err.message))
      .then(() => process.exit(0));

    // Если база не отвечает, не висим вечно
    setTimeout(() => process.exit(0), 3000).unref?.();
  };

  process.once('SIGTERM', () => bye('SIGTERM'));
  process.once('SIGINT', () => bye('SIGINT'));
}

// Поднимаем сервер только при прямом запуске (`npm run start:server`).
// При обычном require модуль можно использовать в тестах, ничего не занимая.
if (require.main === module) {
  ensureReportsFile();       // чтобы первая жалоба не упала на отсутствующем файле
  ensureSubscriptionsFile(); // то же самое для подписок

  // Запускаем симуляцию тестовых данных (обновление каждые 3 секунды)
  mock.startSimulation();

  // Съём показаний для прогноза: раз в 10 секунд, окно — полчаса
  startHistory();

  // Рассылка уведомлений раз в 30 секунд
  startNotifications();

  // Накопленные счётчики уезжают в базу раз в минуту
  stats.start();

  // Статусы лифтов перечитываем раз в полминуты: их мог поменять
  // другой процесс, а узнать об этом неоткуда
  elevatorStore.start(applyElevatorStatuses);

  installShutdown();

  prepareStorage().then((ready) => {
    app.listen(PORT, async () => {
      console.log('TIU GO — сервер мини-приложения');
      console.log(`  Мини-апп:  http://localhost:${PORT}`);
      console.log(`  API:       http://localhost:${PORT}/api/status`);
      console.log(`  Лифтов:    ${mock.getElevators().length}, обновление раз в ${mock.TICK_MS / 1000} c`);
      console.log(`  Хранилище: ${db.describe()}${ready ? '' : ' — НЕДОСТУПНО'}`);
      console.log(`  Админка:   ${adminEnabled()
        ? 'http://localhost:' + PORT + '/admin (вход: ' + ADMIN_USERNAME + ')'
        : 'недоступна (задайте ADMIN_USERNAME и ADMIN_PASSWORD: локально ' +
          'в .env, на хостинге — в переменных окружения сервиса)'}`);

      try {
        const userCounts = await users.countUsers();
        console.log(`  Пользователей ботов: ${userCounts.total}` +
          (userCounts.others
            ? ` (ещё ${userCounts.others} у других ботов — в счёт не идут)`
            : ''));
      } catch (err) {
        console.log(`  Пользователей ботов: не удалось прочитать (${err.message})`);
      }

      // Пароль из шаблона — не ошибка, но и не пароль. Говорим об этом прямо.
      if (adminEnabled() && ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
        console.warn('');
        console.warn('  ВНИМАНИЕ: ADMIN_PASSWORD остался из шаблона.');
        console.warn('  Поменяйте его перед тем, как открывать сервер наружу.');
      }

      if (db.isMemory()) {
        console.warn('');
        console.warn(`  ВНИМАНИЕ: ${db.URL_ENV} не задан — данные живут в памяти`);
        console.warn('  процесса. Для боевого сервера заведите Upstash Redis,');
        console.warn('  иначе статистика и пользователи пропадут при рестарте.');
      }

      console.log(`  Уведомления: проверка раз в ${NOTIFY_INTERVAL_MS / 1000} c, ` +
        `токен Telegram ${usableToken(process.env.TELEGRAM_BOT_TOKEN) ? 'есть' : 'не задан'}, ` +
        `MAX ${usableToken(process.env.MAX_BOT_TOKEN) ? 'есть' : 'не задан'}`);
      console.log('');
      console.log('  Для ботов укажите публичный HTTPS-адрес этого сервера');
      console.log('  в переменной WEBAPP_URL (например, туннель ngrok/cloudflared).');
    });
  });
}

module.exports = {
  app,
  PEAK_HOURS,
  NOTIFY_TYPES,
  PUSH_TEXTS,
  PUSH_LANGS,
  peakLabel,
  pushLang,
  ensureReportsFile,
  ensureSubscriptionsFile,
  readReports,
  readSubscriptions,
  adminEnabled,
  adminConfigured,
  applyElevatorStatuses,
  sameSecret,
  isAvailable,
  computeStatus,
  computeRecommendation,
  computeConfidence,
  computeForecast,
  computeTimes,
  trendPerMinute,
  trendLabel,
  forecastLift,
  forecastHall,
  recordHistory,
  startHistory,
  hourlyStats,
  parseHhmm,
  nextOccurrence,
  estimateWait,
  currentAverageWait,
  buildContext,
  buildStatus,
  queueOf,
  firstFloorQueue,
  busiestLift,
  collectNotifications,
  runNotificationCycle,
  getPeakInfo,
  formatSeconds,
  formatRange,
  pushText,
  usableToken
};
