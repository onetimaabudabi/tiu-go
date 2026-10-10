/**
 * TIU GO — сохранение результатов технической модели.
 *
 * Каждый скрипт складывает свои числа в tech-model/output/data/<имя>.json.
 * Это нужно отчёту и Excel: они собирают готовые результаты, а не
 * пересчитывают модели заново. Заодно JSON удобно открыть глазами
 * и проверить, что получилось.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'output', 'data');

/** Записывает результат модели. Возвращает путь к файлу. */
function saveData(name, payload) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const file = path.join(DATA_DIR, name + '.json');
  const body = Object.assign({ generatedAt: new Date().toISOString() }, payload);

  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return file;
}

/**
 * Читает ранее сохранённый результат.
 * Если файла нет — вернёт null, и вызывающий код сам решит,
 * пересчитать модель или честно сказать, что данных нет.
 */
function loadData(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + '.json'), 'utf8'));
  } catch (err) {
    return null;
  }
}

// ---------- Печать таблиц в консоль ----------

/** Ширина строки с поправкой на то, что в консоли символ занимает одну позицию. */
function width(value) {
  return String(value).length;
}

/**
 * Печатает таблицу моноширинно: заголовки, разделитель, строки.
 * Числа прижимаются вправо, текст — влево.
 *
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 */
function table(headers, rows) {
  const widths = headers.map((head, i) => Math.max(
    width(head),
    ...rows.map((row) => width(row[i] === undefined || row[i] === null ? '' : row[i]))
  ));

  const line = (cells) => '  ' + cells.map((cell, i) => {
    const text = cell === undefined || cell === null ? '' : String(cell);
    const pad = ' '.repeat(widths[i] - width(text));
    return typeof rows[0]?.[i] === 'number' ? pad + text : text + pad;
  }).join('  ');

  console.log(line(headers));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  rows.forEach((row) => console.log(line(row)));
}

/** Заголовок блока в консоли. */
function header(title) {
  console.log('');
  console.log('━'.repeat(72));
  console.log('  ' + title);
  console.log('━'.repeat(72));
}

/** Округление до n знаков, но числом, а не строкой. */
function round(value, digits = 3) {
  const k = Math.pow(10, digits);
  return Math.round(value * k) / k;
}

// ---------- Воспроизводимая случайность ----------

/**
 * Генератор mulberry32: быстрый, с равномерным распределением и,
 * главное, повторяемый. Без фиксированного зерна каждый запуск
 * симуляции давал бы свои числа, и отчёт нельзя было бы пересобрать.
 */
function makeRng(seed) {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Испытание Бернулли. */
  next.bernoulli = (p) => next() < p;

  /** Сумма n независимых испытаний. */
  next.binomial = (n, p) => {
    let k = 0;
    for (let i = 0; i < n; i += 1) if (next() < p) k += 1;
    return k;
  };

  /** Целое из [min, max]. */
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));

  return next;
}

/** Среднее, стандартное отклонение и перцентили выборки. */
function stats(values) {
  if (!values.length) return { n: 0, mean: 0, sd: 0, p05: 0, p50: 0, p95: 0 };

  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    Math.max(values.length - 1, 1);

  const at = (q) => sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)];

  return {
    n: values.length,
    mean,
    sd: Math.sqrt(variance),
    p05: at(0.05),
    p50: at(0.50),
    p95: at(0.95)
  };
}

module.exports = { DATA_DIR, saveData, loadData, table, header, round, makeRng, stats };
