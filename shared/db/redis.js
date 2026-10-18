/**
 * TIU GO — подключение к Upstash Redis.
 *
 * Зачем вообще база: на Render файловая система эфемерная — при каждом
 * передеплое контейнер поднимается с нуля, и всё, что писалось в файлы,
 * пропадает. Плюс бот и сервер развёрнуты отдельными сервисами, у каждого
 * свой диск: бот записал пользователя у себя, а админка читает пустой файл
 * у себя. Redis — общая память для всех трёх процессов.
 *
 * Если переменных окружения нет, поднимается хранилище в памяти процесса.
 * Это НЕ запасной вариант на случай сбоя, а режим для локальной разработки:
 * данные живут до остановки процесса и между процессами не видны. Сервер
 * при старте пишет об этом прямо, чтобы такой режим нельзя было
 * не заметить на боевом сервере.
 *
 * Про формат значений. Клиент Upstash сам превращает объекты в JSON при
 * записи и обратно при чтении. Хранилище в памяти ведёт себя так же
 * (через копию объекта), поэтому остальной код не знает, с чем работает,
 * и ветвлений «если Redis» нигде больше нет.
 */

const URL_ENV = 'UPSTASH_REDIS_REST_URL';
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';

/**
 * Хранилище в памяти. Реализует ровно те команды, которые использует
 * проект, — не весь Redis. Добавили новую команду в db/* — добавьте
 * её и сюда, иначе локальный запуск упадёт там, где боевой работает.
 */
function createMemoryStore() {
  const data = new Map();

  // Копия, а не ссылка: иначе вызывающий код мог бы молча поменять
  // «сохранённое» значение у себя, и локально всё работало бы иначе,
  // чем с настоящим Redis
  const copy = (value) => (
    value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  );

  const hash = (key) => {
    if (!(data.get(key) instanceof Map)) data.set(key, new Map());
    return data.get(key);
  };

  return {
    isMemory: true,

    async get(key) {
      return data.has(key) ? copy(data.get(key)) : null;
    },

    async set(key, value) {
      data.set(key, copy(value));
      return 'OK';
    },

    async mget(keys) {
      return keys.map((key) => (data.has(key) ? copy(data.get(key)) : null));
    },

    async incrby(key, amount) {
      const next = (Number(data.get(key)) || 0) + Number(amount);
      data.set(key, next);
      return next;
    },

    async hset(key, entries) {
      const store = hash(key);
      let added = 0;

      Object.keys(entries).forEach((field) => {
        if (!store.has(field)) added += 1;
        store.set(field, copy(entries[field]));
      });

      return added;
    },

    async hlen(key) {
      return hash(key).size;
    },

    async hgetall(key) {
      const store = hash(key);
      if (!store.size) return null; // как у Redis: пустой хеш — это null

      const result = {};
      store.forEach((value, field) => { result[field] = copy(value); });
      return result;
    },

    async hdel(key, ...fields) {
      const store = hash(key);
      let removed = 0;
      fields.flat().forEach((field) => { if (store.delete(field)) removed += 1; });
      return removed;
    },

    async expire(key) {
      // Срок жизни ключа в памяти не нужен: процесс и так умрёт раньше.
      // Метод есть, чтобы код сброса статистики шёл одним путём с Redis.
      return data.has(key) ? 1 : 0;
    },

    async ping() {
      return 'PONG';
    }
  };
}

let client = null;
let usingMemory = false;
let fallbackReason = null;

/**
 * Значение переменной окружения: без пробелов по краям и без кавычек.
 *
 * Кавычки — самая частая ошибка при настройке хостинга. В файле .env
 * запись KEY="значение" законна, и dotenv кавычки снимает сам. А в панели
 * Render поле значения берётся как есть, и вставленные туда кавычки
 * становятся частью адреса: получается ключ "https://..." с кавычками
 * внутри, и клиент Upstash отказывается с ним работать.
 */
function envValue(name) {
  let value = (process.env[name] || '').trim();

  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);

  if (value.length >= 2 && first === last && (first === '"' || first === "'")) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

/** Переходим на память процесса и громко объясняем почему. */
function fallBack(reason) {
  usingMemory = true;
  fallbackReason = reason;
  client = createMemoryStore();
  return client;
}

/**
 * Клиент: настоящий Redis или хранилище в памяти. Создаётся один раз.
 *
 * Эта функция НЕ БРОСАЕТ исключений — ни при каких настройках. Её зовут
 * из обработчиков запросов и из колбэка app.listen, где исключение валит
 * весь процесс: ровно так сервер и умирал при адресе, вставленном
 * в Render вместе с кавычками. Плохие настройки базы не должны ронять
 * мини-апп: показывать лифты важнее, чем копить статистику.
 */
function getClient() {
  if (client) return client;

  const url = envValue(URL_ENV);
  const token = envValue(TOKEN_ENV);

  if (!url || !token) {
    return fallBack('переменные ' + URL_ENV + ' и ' + TOKEN_ENV + ' не заданы');
  }

  if (!/^https:\/\//i.test(url)) {
    console.error('[база] ' + URL_ENV + ' должен начинаться с https:// — получено: ' + url);
    console.error('[база] Проверьте, что в значении нет кавычек и пробелов.');
    return fallBack(URL_ENV + ' не похож на адрес (' + url + ')');
  }

  try {
    // require внутри функции, а не наверху файла: без переменных окружения
    // библиотека не нужна вовсе, и проект должен подниматься даже там,
    // где её не успели поставить
    const { Redis } = require('@upstash/redis');

    client = new Redis({ url: url, token: token });
    usingMemory = false;
    fallbackReason = null;

    return client;
  } catch (err) {
    console.error('[база] Не удалось создать клиент Redis:', err.message);
    return fallBack('клиент не создался: ' + err.message);
  }
}

/** Работаем с настоящим Redis или с памятью процесса? */
function isMemory() {
  getClient();
  return usingMemory;
}

/** Одна строка о состоянии базы — её печатает сервер при старте. */
function describe() {
  if (isMemory()) {
    return 'в памяти процесса (' + (fallbackReason || 'причина неизвестна') + ') — ' +
      'данные пропадут при остановке и не видны другим сервисам';
  }

  // Адрес показываем без токена: в логах Render его видит кто угодно,
  // у кого есть доступ к дашборду
  return 'Upstash Redis, ' + envValue(URL_ENV).replace(/^https?:\/\//, '');
}

/** Живая ли база. Нужна серверу при старте, чтобы не узнать о проблеме позже. */
async function check() {
  try {
    await getClient().ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  URL_ENV,
  TOKEN_ENV,
  envValue,
  getClient,
  isMemory,
  fallbackReason: () => fallbackReason,
  describe,
  check,
  createMemoryStore
};
