/**
 * TIU GO — счётчик обращений к API в Redis.
 *
 * Ключи:
 *   tiu:stats:total          — за всё время
 *   tiu:stats:ГГГГ-ММ-ДД     — за день
 *   tiu:stats:h:ГГГГ-ММ-ДД-ЧЧ — за час, для графика в админке
 *
 * ── Почему не INCR на каждый запрос ───────────────────────────────
 *
 * Мини-апп опрашивает /api/status раз в 3 секунды у каждого открытого
 * экрана. Это 1200 запросов в час с одного человека. Два INCR на запрос —
 * 2400 команд в час, а бесплатный тариф Upstash даёт 500 000 команд
 * В МЕСЯЦ. То есть квота кончилась бы примерно за 208 человеко-часов:
 * десяток студентов с открытым приложением съели бы месячный лимит
 * за один день, а дальше начинается оплата за каждые 100 тысяч команд.
 *
 * Поэтому считаем в памяти, а в Redis отправляем накопленное раз в минуту
 * командой INCRBY. Расход перестаёт зависеть от числа пользователей:
 * три-четыре команды в минуту, около 150 тысяч в месяц при любой нагрузке.
 *
 * Чем платим: при аварийной остановке процесса теряется до минуты
 * счётчика показов. Для цифры «сколько раз открыли экран» это не та
 * точность, ради которой стоит платить деньгами.
 */

const { getClient } = require('./redis');

const PREFIX = 'tiu:stats:';
const TOTAL_KEY = PREFIX + 'total';

/** Как часто сбрасываем накопленное в базу. */
const FLUSH_MS = 60 * 1000;

/** Сколько живут почасовые ключи: график показывает сутки, недели хватает. */
const HOUR_TTL_SEC = 8 * 24 * 3600;

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** 'ГГГГ-ММ-ДД' по местному времени — админ смотрит график своими глазами. */
function dayKeyOf(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function hourKeyOf(date) {
  return dayKeyOf(date) + '-' + pad(date.getHours());
}

// ---------- Накопитель в памяти ----------

let pending = { total: 0, days: {}, hours: {} };

// Ключам, которым уже выставили срок жизни, второй раз его не ставим
const expired = new Set();

let timer = null;
let flushing = null;

function emptyPending() {
  return { total: 0, days: {}, hours: {} };
}

/**
 * Плюс один запрос к API. Синхронная: вызывается из обработчика маршрута,
 * и ждать сети там незачем — в базу число уедет следующим сбросом.
 */
function incrementRequestCount(at = new Date()) {
  const day = dayKeyOf(at);
  const hour = hourKeyOf(at);

  pending.total += 1;
  pending.days[day] = (pending.days[day] || 0) + 1;
  pending.hours[hour] = (pending.hours[hour] || 0) + 1;
}

/**
 * Отправляет накопленное в базу.
 *
 * Снимок забираем ДО первой сетевой команды, чтобы запросы, пришедшие
 * во время отправки, не потерялись и не улетели дважды. Если отправка
 * не удалась — возвращаем числа обратно в накопитель и пробуем в следующий
 * раз: падение сети не должно стоить статистики.
 */
async function flush() {
  if (flushing) return flushing;

  const snapshot = pending;
  if (!snapshot.total) return;

  pending = emptyPending();

  flushing = (async () => {
    const client = getClient();

    try {
      await client.incrby(TOTAL_KEY, snapshot.total);

      for (const day of Object.keys(snapshot.days)) {
        await client.incrby(PREFIX + day, snapshot.days[day]);
      }

      for (const hour of Object.keys(snapshot.hours)) {
        const key = PREFIX + 'h:' + hour;
        await client.incrby(key, snapshot.hours[hour]);

        if (!expired.has(key)) {
          expired.add(key);
          if (client.expire) await client.expire(key, HOUR_TTL_SEC);
        }
      }
    } catch (err) {
      console.error('[stats] Не удалось сохранить счётчики:', err.message);

      // Возвращаем потерянное обратно, не затирая то, что накопилось заново
      pending.total += snapshot.total;
      Object.keys(snapshot.days).forEach((day) => {
        pending.days[day] = (pending.days[day] || 0) + snapshot.days[day];
      });
      Object.keys(snapshot.hours).forEach((hour) => {
        pending.hours[hour] = (pending.hours[hour] || 0) + snapshot.hours[hour];
      });
    } finally {
      flushing = null;
    }
  })();

  return flushing;
}

/** Запускает периодический сброс. Вызывается сервером при старте. */
function start() {
  if (timer) return timer;

  timer = setInterval(() => {
    flush().catch((err) => console.error('[stats] Сброс упал:', err.message));
  }, FLUSH_MS);

  timer.unref?.();
  return timer;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

// ---------- Чтение ----------

function asNumber(value) {
  return Number(value) || 0;
}

/** Всего запросов. К сохранённому добавляем то, что ещё не уехало. */
async function getTotalCount() {
  return asNumber(await getClient().get(TOTAL_KEY)) + pending.total;
}

/** Запросов сегодня. */
async function getTodayCount(at = new Date()) {
  const day = dayKeyOf(at);
  return asNumber(await getClient().get(PREFIX + day)) + (pending.days[day] || 0);
}

/**
 * Двадцать четыре ячейки для графика: от «23 часа назад» до текущего часа.
 * Пустые часы тоже возвращаем — график с дырками выглядел бы так, будто
 * сервер в это время лежал.
 */
async function getHours24(at = new Date()) {
  const moments = [];

  for (let back = 23; back >= 0; back -= 1) {
    moments.push(new Date(at.getTime() - back * 3600 * 1000));
  }

  // MGET: одна команда на все двадцать четыре ключа
  const keys = moments.map((moment) => PREFIX + 'h:' + hourKeyOf(moment));
  const stored = await getClient().mget(keys);

  return moments.map((moment, index) => {
    const hour = hourKeyOf(moment);

    return {
      hour: moment.getHours(),
      label: pad(moment.getHours()) + ':00',
      count: asNumber(stored[index]) + (pending.hours[hour] || 0)
    };
  });
}

/** Всё, что нужно вкладке «Статистика», разом. */
async function snapshot(at = new Date()) {
  const [total, today, hours] = await Promise.all([
    getTotalCount(),
    getTodayCount(at),
    getHours24(at)
  ]);

  return { total, today, hours };
}

module.exports = {
  PREFIX,
  TOTAL_KEY,
  FLUSH_MS,
  dayKeyOf,
  hourKeyOf,
  incrementRequestCount,
  flush,
  start,
  stop,
  getTotalCount,
  getTodayCount,
  getHours24,
  snapshot
};
