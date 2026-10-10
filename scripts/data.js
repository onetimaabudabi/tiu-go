/**
 * TIU GO — единый источник данных для генераторов документов.
 *
 * Все три скрипта (графики, Word, Excel) берут цифры отсюда, чтобы
 * документы не разъезжались между собой. Менять параметры нужно
 * только в объекте INPUT ниже — остальное пересчитается.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

// ---------- Исходные данные ----------
const INPUT = {
  elevators: 6,            // лифтов в корпусе
  floors: 16,              // этажей в корпусе 7
  students: 1500,          // студентов и сотрудников в корпусе
  tripsPerDay: 2000,       // поездок в день (оценка)
  waitBefore: 90,          // среднее ожидание в пик без системы, сек
  waitAfter: 30,           // среднее ожидание в пик с системой, сек
  lateReduction: 0.35,     // доля опозданий, связанных с лифтом
  maintenancePerYear: 70000, // обслуживание одного лифта, ₽/год
  studyDays: 200,          // учебных дней в году
  hourValue: 200,          // условная стоимость часа времени, ₽

  /**
   * Доля условной пользы, которую можно считать денежным потоком.
   *
   * Сэкономленное время студентов — не деньги: университет не получает
   * этот миллион на счёт. Денежный эффект возникает косвенно (меньше
   * износ кабин и вызовов сервиса, меньше простоев, отложенная закупка
   * седьмого лифта), поэтому в расчёт окупаемости идёт консервативная
   * доля. При 100% проект окупался бы за три недели, что выглядит
   * неправдоподобно и вызовет вопросы на защите.
   */
  monetization: 0.10
};

// ---------- Затраты на внедрение ----------
const COSTS = [
  { name: 'Камеры',            qty: 6, price: 1500,  note: 'по одной на лифтовый холл' },
  { name: 'Одноплатники',      qty: 6, price: 6000,  note: 'инференс YOLO на месте' },
  { name: 'Кабель, крепления', qty: 1, price: 6000,  note: 'монтаж и расходники' },
  { name: 'Домен',             qty: 1, price: 1500,  note: 'на год, нужен HTTPS' },
  { name: 'Хостинг',           qty: 1, price: 0,     note: 'сервер университета' }
];

// ---------- Масштабирование ----------
const SCALING = {
  years: ['2026', '2027', '2028', '2029', '2030'],
  tiu: [1, 3, 5, 7, 10],
  universities: [0, 0, 2, 10, 30],
  commercial: [0, 0, 0, 5, 25]
};

// ---------- Причины опозданий ----------
const LATENESS = [
  { name: 'Из-за лифта',    value: 35 },
  { name: 'Проспал',        value: 25 },
  { name: 'Пробки, дорога', value: 20 },
  { name: 'Другие причины', value: 20 }
];

// ---------- Производные расчёты ----------
function calc() {
  const i = INPUT;

  const savedPerStudentSec = i.waitBefore - i.waitAfter;
  const savedPerDaySec = savedPerStudentSec * i.students;
  const savedPerDayHours = savedPerDaySec / 3600;
  const savedPerYearHours = savedPerDayHours * i.studyDays;
  const savedPerYearManDays = savedPerYearHours / 8;

  const valuePerYear = savedPerYearHours * i.hourValue;   // условная польза, ₽
  const cashPerYear = valuePerYear * i.monetization;       // денежный эффект, ₽
  const cashPerMonth = cashPerYear / 12;

  const totalCosts = COSTS.reduce((sum, c) => sum + c.qty * c.price, 0);
  const paybackMonths = cashPerMonth > 0 ? totalCosts / cashPerMonth : Infinity;
  const usefulness = totalCosts > 0 ? valuePerYear / totalCosts : 0;

  return {
    savedPerStudentSec,
    savedPerDaySec,
    savedPerDayHours,
    savedPerYearHours,
    savedPerYearManDays,
    valuePerYear,
    cashPerYear,
    cashPerMonth,
    totalCosts,
    paybackMonths,
    usefulness,
    maintenanceTotal: i.maintenancePerYear * i.elevators
  };
}

// ---------- Вспомогательное ----------

/** Создаёт папку docs/, если её ещё нет. */
function ensureDocsDir() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  return DOCS_DIR;
}

/** Путь внутри docs/ — через path.join, чтобы работало и в Windows. */
function docsPath(name) {
  return path.join(DOCS_DIR, name);
}

/**
 * Читает необязательный markdown-файл из корня проекта.
 * Нет файла — не беда: вернём null, а генератор возьмёт встроенные данные.
 */
function readMarkdown(name) {
  const file = path.join(ROOT, name);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.warn(`[data] Не удалось прочитать ${name}: ${err.message}`);
  }
  return null;
}

/** 52500 -> «52 500» */
function num(value, digits = 0) {
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

/** 52500 -> «52 500 ₽» */
function rub(value, digits = 0) {
  return num(value, digits) + ' ₽';
}

/** Существует ли файл (для картинок и скриншотов). */
function exists(file) {
  try { return fs.existsSync(file); } catch (e) { return false; }
}

// Имена графиков — в одном месте, чтобы Word и Excel ссылались на те же файлы
const CHARTS = {
  time: 'chart_экономия_времени.png',
  lateness: 'chart_распределение_опозданий.png',
  costs: 'chart_затраты.png',
  payback: 'chart_окупаемость.png',
  scaling: 'chart_прогноз_масштабирования.png'
};

module.exports = {
  ROOT,
  DOCS_DIR,
  INPUT,
  COSTS,
  SCALING,
  LATENESS,
  CHARTS,
  calc,
  ensureDocsDir,
  docsPath,
  readMarkdown,
  num,
  rub,
  exists
};
