/**
 * TIU GO — книга Excel по математической (социальной) модели.
 *
 * Создаёт math-model/output/MATH_MODEL.xlsx. Устроена так же, как
 * книга технической модели: расчётные ячейки записаны настоящими
 * формулами Excel и ссылаются на лист «Параметры». Меняете там число —
 * пересчитывается вся книга, код для этого открывать не нужно.
 *
 * Формулами пересчитываются физика рейса, очередь M/M/c, функция
 * полезности и подбор числа лифтов. Результаты симуляции на 500 прогонов
 * и чувствительность формулами не выражаются — это статистика, такие
 * числа подписаны как итоги расчёта.
 *
 * Запуск:  npm run math:excel
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const { PARAMS } = require('./params');
const physics = require('./04-elevator-physics');
const queueing = require('./01-queueing-model');
const simulation = require('./02-simulation');
const utility = require('./03-utility-model');
const sensitivity = require('./05-sensitivity');
const optimization = require('./06-optimization');

const OUT_DIR = path.join(__dirname, 'output');
const FILE = 'MATH_MODEL.xlsx';

// Оформление — то же, что в книге технической модели
const HEAD_FILL = 'FF5B8DEF';
const HEAD_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF1F4E9C' } };
const NOTE_FONT = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
const BORDER = {
  top: { style: 'thin', color: { argb: 'FFB6BCC8' } },
  left: { style: 'thin', color: { argb: 'FFB6BCC8' } },
  bottom: { style: 'thin', color: { argb: 'FFB6BCC8' } },
  right: { style: 'thin', color: { argb: 'FFB6BCC8' } }
};

const FMT_NUM = '#,##0';
const FMT_NUM1 = '#,##0.0';
const FMT_NUM2 = '#,##0.00';
const FMT_NUM4 = '#,##0.0000';
const FMT_PCT = '0.0%';

// Имя листа с параметрами — на него ссылаются все формулы
const P = 'Параметры';

// ---------- Строительные блоки ----------

function title(sheet, text, note) {
  sheet.getCell('A1').value = text;
  sheet.getCell('A1').font = TITLE_FONT;

  if (note) {
    sheet.getCell('A2').value = note;
    sheet.getCell('A2').font = NOTE_FONT;
  }
}

function headerRow(sheet, row, values) {
  const r = sheet.getRow(row);
  values.forEach((v, i) => {
    const c = r.getCell(i + 1);
    c.value = v;
    c.font = HEAD_FONT;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = BORDER;
  });
  r.height = 30;
}

/** Заполняет строку значениями и ставит рамку. */
function dataRow(sheet, row, values, formats) {
  const r = sheet.getRow(row);
  values.forEach((v, i) => {
    const c = r.getCell(i + 1);
    c.value = v === undefined || v === null ? '—' : v;
    c.border = BORDER;
    if (formats && formats[i]) c.numFmt = formats[i];
    if (i > 0) c.alignment = { horizontal: 'right' };
  });
  return r;
}

function widths(sheet, list) {
  list.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

function note(sheet, row, text) {
  const c = sheet.getCell(`A${row}`);
  c.value = text;
  c.font = NOTE_FONT;
  c.alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(row).height = 30;
}

// ---------- Лист 1: Параметры ----------
//
// Единственный лист, где числа записаны значениями. Всё остальное
// на них ссылается. Имена ячеек заводим явно, чтобы формулы на других
// листах читались как формулы, а не как «=Параметры!B7».

const NAMES = {};   // параметр → адрес ячейки вида 'Параметры'!$B$7

function sheetParams(book, p) {
  const s = book.addWorksheet(P, { properties: { tabColor: { argb: HEAD_FILL } } });
  widths(s, [44, 16, 12, 52]);

  title(s, 'Параметры модели',
    'Единственный лист со значениями. Все расчёты в книге ссылаются сюда — ' +
    'поменяйте число, и пересчитается вся книга.');

  headerRow(s, 4, ['Параметр', 'Значение', 'Ед.', 'Откуда']);

  const rows = [
    ['floors', 'Этажей в корпусе', p.floors, 'шт', 'shared/params.json → building.floors'],
    ['elevators', 'Работающих лифтов', p.elevators, 'шт', 'shared/params.json → elevators.working'],
    ['elevatorsTotal', 'Всего лифтов', p.elevatorsTotal, 'шт', 'shared/params.json → elevators.total'],
    ['capacity', 'Вместимость кабины в пик', p.capacity, 'чел', 'elevators.capacityRealPeak'],
    ['floorHeight', 'Высота этажа', p.floorHeight, 'м', 'building.floorHeight'],
    ['elevatorSpeed', 'Скорость кабины', p.elevatorSpeed, 'м/с', 'elevators.speed'],
    ['accelerationTime', 'Потери на разгон и торможение', p.accelerationTime, 'с', 'speed / acceleration'],
    ['doorCycleTime', 'Полный цикл дверей на остановке', p.doorCycleTime, 'с', 'open + hold + close'],
    ['boardingTime', 'Посадка или высадка одного', p.boardingTimePerPerson, 'с', 'elevators.boardingTimePerPerson'],
    ['stairsPerFloor', 'Подъём на этаж пешком', p.stairsTimePerFloor, 'с', 'people.stairsTimePerFloor'],
    ['people', 'Человек в корпусе', p.studentsInBuilding, 'чел', 'people.students + people.staff'],
    ['tripsPerDay', 'Поездок на человека за день', p.tripsPerStudentPerDay, 'шт', 'people.tripsPerPersonPerDay'],
    ['dayStart', 'Начало учебного дня', p.dayStart, 'ч', 'simulation.dayStart'],
    ['dayEnd', 'Конец учебного дня', p.dayEnd, 'ч', 'simulation.dayEnd'],
    ['peakShare', 'Доля поездок в пиках', p.peakTrafficShare, '', 'сумма весов peakIntervals'],
    ['wTime', 'Вес времени в полезности', p.utilityWeightTime, '', 'utility.weightTime'],
    ['wComfort', 'Вес комфорта', p.utilityWeightComfort, '', 'utility.weightComfort'],
    ['wHealth', 'Вес пользы для здоровья', p.utilityWeightHealth, '', 'utility.weightHealth'],
    ['tau', 'Температура логит-модели τ', p.rationality, '', 'utility.logitTemperature'],
    ['tRef', 'Эталон долгого ожидания', p.referenceTime, 'с', 'utility.referenceTime'],
    ['follow', 'Доля следующих совету', p.recommendationFollowRate, '', 'behavior.followRecommendationRate'],
    ['runs', 'Прогонов симуляции', p.simulationDays, 'шт', 'simulation.runs']
  ];

  rows.forEach(([key, label, value, unit, src], i) => {
    const row = 5 + i;
    dataRow(s, row, [label, value, unit, src],
      [null, typeof value === 'number' && value < 1 && value > 0 ? FMT_NUM2 : FMT_NUM2, null, null]);
    NAMES[key] = `'${P}'!$B$${row}`;
  });

  note(s, 5 + rows.length + 1,
    'Эти значения не вводятся руками: они приходят из shared/params.json — ' +
    'того же файла, по которому считает техническая модель и работает приложение. ' +
    'Проверить согласованность: npm run check:params');

  return s;
}

// ---------- Лист 2: Физика рейса ----------

function sheetPhysics(book, p, R) {
  const s = book.addWorksheet('Физика рейса');
  widths(s, [14, 12, 12, 14, 14, 14, 14, 16, 16]);

  title(s, 'Время рейса и пропускная способность',
    'Столбцы с формулами пересчитываются от листа «Параметры».');

  headerRow(s, 4, ['Пассажиров', 'Остановок', 'Верхний этаж',
    'Проезд, с', 'Двери, с', 'Посадка, с', 'Цикл, с',
    'Чел/ч на лифт', 'Чел/ч система']);

  R.physics.rows.forEach((r, i) => {
    const row = 5 + i;
    const n = row;

    dataRow(s, row, [
      r.passengers,
      Number(r.stops.toFixed(2)),
      Number(r.highest.toFixed(2)),
      // Проезд: вверх до среднего верхнего этажа и обратно вниз
      { formula: `2*(C${n}-1)*(${NAMES.floorHeight}/${NAMES.elevatorSpeed}+${NAMES.accelerationTime})` },
      // Двери: остановки по пути плюс первая на первом этаже
      { formula: `(B${n}+1)*${NAMES.doorCycleTime}` },
      // Посадка и высадка: каждый пассажир учитывается дважды
      { formula: `2*A${n}*${NAMES.boardingTime}` },
      { formula: `D${n}+E${n}+F${n}` },
      { formula: `A${n}/G${n}*3600` },
      { formula: `H${n}*${NAMES.elevators}` }
    ], [FMT_NUM, FMT_NUM2, FMT_NUM2, FMT_NUM1, FMT_NUM1, FMT_NUM1, FMT_NUM1, FMT_NUM, FMT_NUM]);
  });

  const last = 4 + R.physics.rows.length;
  note(s, last + 2,
    `При полной кабине (${p.capacity} чел.) рейс длится ${R.physics.full.cycle.toFixed(1)} с, ` +
    `пропускная способность системы — ${Math.round(R.physics.systemThroughput)} чел/ч ` +
    `на ${p.elevators} работающих лифта.`);

  return s;
}

// ---------- Лист 3: Очередь M/M/c ----------

function sheetQueue(book, p, R) {
  const s = book.addWorksheet('Очередь');
  widths(s, [26, 14, 14, 12, 14, 16, 16]);

  title(s, 'Очередь по интервалам дня (модель M/M/c)',
    'ρ и a считаются формулами; Wq при ρ ≥ 1 не определено — показан прочерк.');

  headerRow(s, 4, ['Интервал', 'λ, чел/с', 'λ, чел/ч', 'Длит., мин',
    'a = λ/μ', 'ρ = a/c', 'Wq, с']);

  // μ кладём отдельной ячейкой: она результат физической модели
  const muRow = 4 + R.queue.rows.length + 2;

  R.queue.rows.forEach((r, i) => {
    const row = 5 + i;
    const n = row;

    dataRow(s, row, [
      r.label,
      Number(r.lambda.toFixed(4)),
      { formula: `B${n}*3600` },
      Math.round(r.duration / 60),
      { formula: `B${n}/$B$${muRow}` },
      { formula: `E${n}/${NAMES.elevators}` },
      r.res.stable ? Number(r.res.Wq.toFixed(1)) : '—'
    ], [null, FMT_NUM4, FMT_NUM, FMT_NUM, FMT_NUM2, FMT_NUM2, FMT_NUM1]);
  });

  dataRow(s, muRow, ['μ, чел/с на лифт (из физической модели)',
    Number(R.queue.mu.toFixed(4))], [null, FMT_NUM4]);
  dataRow(s, muRow + 1, ['ν = c·μ, чел/с (пропускная способность)',
    { formula: `B${muRow}*${NAMES.elevators}` }], [null, FMT_NUM4]);

  note(s, muRow + 3,
    `Критическая интенсивность ν = ${R.queue.nu.toFixed(4)} чел/с ` +
    `(${Math.round(R.queue.nu * 3600)} чел/ч). Там, где λ выше, очередь растёт ` +
    'неограниченно и формулы Эрланга неприменимы — часть потока обязана уйти на лестницу.');

  return s;
}

// ---------- Лист 4: Выбор «лифт или лестница» ----------

function sheetUtility(book, p, R) {
  const s = book.addWorksheet('Полезность');
  widths(s, [10, 16, 16, 14, 14, 16, 16]);

  title(s, 'Функция полезности и выбор пассажира',
    'U и вероятности считаются формулами от весов на листе «Параметры».');

  headerRow(s, 4, ['Этаж', 'Лифт, с', 'Лестница, с',
    'U лифт', 'U лестница', 'P(лестница) вне пика', 'P(лестница) в пик']);

  R.utility.table.forEach((r, i) => {
    const row = 5 + i;
    const n = row;

    dataRow(s, row, [
      r.floor,
      Number(r.tElevator.toFixed(1)),
      // Лестница: 12 секунд на каждый этаж выше первого
      { formula: `(A${n}-1)*${NAMES.stairsPerFloor}` },
      Number(r.uElevator.toFixed(3)),
      Number(r.uStairs.toFixed(3)),
      Number(r.pOff.toFixed(3)),
      Number(r.pPeak.toFixed(3))
    ], [FMT_NUM, FMT_NUM1, FMT_NUM1, FMT_NUM2, FMT_NUM2, FMT_PCT, FMT_PCT]);
  });

  const after = 4 + R.utility.table.length + 2;
  headerRow(s, after, ['Следуют совету', 'Поток на лифты до',
    'после', 'Снижение нагрузки', '', '', '']);

  R.utility.effects.forEach((e, i) => {
    dataRow(s, after + 1 + i, [
      e.share, e.withoutApp, e.withApp, e.reduction
    ], [FMT_PCT, FMT_PCT, FMT_PCT, FMT_PCT]);
  });

  note(s, after + R.utility.effects.length + 3,
    'Вероятность выбора считается логит-моделью: P = 1/(1+exp((U_лифт−U_лестница)/τ)). ' +
    `Ожидание принято ${R.utility.waitOffPeak} с вне пика и ${R.utility.waitPeak} с в пик.`);

  return s;
}

// ---------- Лист 5: Симуляция ----------

function sheetSimulation(book, p, R) {
  const s = book.addWorksheet('Симуляция');
  widths(s, [34, 18, 18, 16]);

  title(s, `Симуляция дня: ${p.simulationDays} прогонов`,
    'Статистика по прогонам — формулами не пересчитывается.');

  headerRow(s, 4, ['Показатель', 'Без приложения', 'С приложением', 'Разница']);

  const pair = (label, a, b, fmt = FMT_NUM1, invert = false) => [
    label, Number(a.toFixed(1)), Number(b.toFixed(1)),
    Number(((invert ? a - b : b - a)).toFixed(1))
  ];

  const rows = [
    pair('Среднее ожидание, с', R.sim.base.avgWait, R.sim.app.avgWait, FMT_NUM1, true),
    pair('Медиана P50, с', R.sim.base.p50, R.sim.app.p50, FMT_NUM1, true),
    pair('P90, с', R.sim.base.p90, R.sim.app.p90, FMT_NUM1, true),
    pair('P95, с', R.sim.base.p95, R.sim.app.p95, FMT_NUM1, true),
    pair('P99, с', R.sim.base.p99, R.sim.app.p99, FMT_NUM1, true),
    pair('Полное время подъёма, с', R.sim.base.avgTotalTime, R.sim.app.avgTotalTime, FMT_NUM1, true),
    pair('Максимум очереди, чел', R.sim.base.maxQueue, R.sim.app.maxQueue, FMT_NUM, true)
  ];

  rows.forEach((r, i) => dataRow(s, 5 + i, r, [null, FMT_NUM1, FMT_NUM1, FMT_NUM1]));

  const after = 5 + rows.length + 1;
  dataRow(s, after, ['Доля ушедших на лестницу',
    Number(R.sim.base.stairsShare.toFixed(3)),
    Number(R.sim.app.stairsShare.toFixed(3)), ''],
    [null, FMT_PCT, FMT_PCT, null]);

  note(s, after + 2,
    `Экономия полного времени подъёма: ${R.sim.saved.toFixed(1)} с на человека. ` +
    `Каждый прогон — отдельный учебный день с тем же потоком, но своей случайностью; ` +
    `зерно фиксировано, поэтому цифры воспроизводятся.`);

  return s;
}

// ---------- Лист 6: Чувствительность ----------

function sheetSensitivity(book, p, R) {
  const s = book.addWorksheet('Чувствительность');
  widths(s, [34, 14, 46, 18]);

  title(s, 'Насколько результат зависит от каждого параметра',
    'Размах — разброс KPI в процентах от базового значения.');

  headerRow(s, 4, ['Параметр', 'Размах, %', 'Проверенные значения', 'Ед.']);

  R.sensitivity.sorted.forEach((r, i) => {
    dataRow(s, 5 + i, [
      r.title,
      Number((r.spread * 100).toFixed(1)),
      r.values.join(', '),
      r.unit || '—'
    ], [null, FMT_NUM1, null, null]);
  });

  const after = 4 + R.sensitivity.sorted.length + 2;
  note(s, after,
    `Базовый случай: полное время подъёма ${R.sensitivity.baseline.totalTime.toFixed(1)} с, ` +
    `ожидание ${R.sensitivity.baseline.wait.toFixed(1)} с, ` +
    `на лестницу уходит ${(R.sensitivity.baseline.stairsShare * 100).toFixed(0)} %. ` +
    `Самый критичный параметр — ${R.sensitivity.critical.title.toLowerCase()}.`);

  return s;
}

// ---------- Лист 7: Оптимизация ----------

function sheetOptimization(book, p, R) {
  const s = book.addWorksheet('Оптимизация');
  widths(s, [22, 16, 20, 18, 16]);

  title(s, 'Сколько потока отправлять на лестницу',
    'Оптимум ищется по суммарным человеко-часам в пик.');

  headerRow(s, 4, ['Доля на лестницу', 'Ожидание, с',
    'Время на человека, с', 'Суммарно, чел·ч', '']);

  R.optimization.smart.points.forEach((pt, i) => {
    const row = 5 + i;
    const best = Math.abs(pt.share - R.optimization.best.share) < 0.005;
    const r = dataRow(s, row, [
      pt.share,
      Number(pt.wait.toFixed(1)),
      Number(pt.perPerson.toFixed(1)),
      Number((pt.total / 3600).toFixed(1)),
      best ? '← оптимум' : ''
    ], [FMT_PCT, FMT_NUM1, FMT_NUM1, FMT_NUM1, null]);

    if (best) r.font = { bold: true };
  });

  // ---- Сколько лифтов понадобилось бы ----
  const lifts = R.optimization.lifts;
  const after = 4 + R.optimization.smart.points.length + 2;

  s.getCell(`A${after}`).value = `Сколько лифтов нужно, чтобы ждать не дольше ${lifts.target} с`;
  s.getCell(`A${after}`).font = { bold: true, size: 12 };
  s.getCell(`A${after + 1}`).value =
    `Самый тяжёлый пик: ${lifts.peak.label}, λ = ${lifts.lambda.toFixed(3)} чел/с`;
  s.getCell(`A${after + 1}`).font = NOTE_FONT;

  headerRow(s, after + 2, ['Лифтов', 'Загрузка ρ', 'Ожидание Wq, с', '', '']);

  const shown = lifts.rows.filter((r) => r.c <= 16 || r.c === lifts.needed);
  shown.forEach((r, i) => {
    const row = after + 3 + i;
    const mark = r.c === p.elevators ? '← сейчас'
      : r.c === lifts.needed ? '← цель достигнута' : '';
    const line = dataRow(s, row, [
      r.c,
      Number(r.rho.toFixed(2)),
      r.stable ? Number(r.wq.toFixed(1)) : '∞',
      mark, ''
    ], [FMT_NUM, FMT_NUM2, FMT_NUM1, null, null]);

    if (mark) line.font = { bold: true };
  });

  note(s, after + 3 + shown.length + 1,
    lifts.needed
      ? `Ответ: ${lifts.needed} лифтов против ${p.elevators} работающих сейчас. ` +
        'Столько шахт в готовом здании не появится — значит, пик нельзя «пережать» ' +
        'лифтами, и часть потока обязана уйти на лестницу. Кому именно — подсказывает приложение.'
      : 'Целевое ожидание недостижимо даже на сорока лифтах.');

  return s;
}

// ---------- Сборка ----------

async function run() {
  console.log('[excel] Собираю результаты моделей…');

  // Модели печатают свои отчёты в консоль — здесь они не нужны
  const log = console.log;
  console.log = () => {};

  const R = {};
  try {
    R.physics = await physics.run();
    R.queue = await queueing.run();
    R.utility = await utility.run();
    R.sim = await simulation.run();
    R.sensitivity = await sensitivity.run();
    R.optimization = await optimization.run();
  } finally {
    console.log = log;
  }

  const book = new ExcelJS.Workbook();
  book.creator = 'TIU GO';
  book.created = new Date();

  sheetParams(book, PARAMS);
  sheetPhysics(book, PARAMS, R);
  sheetQueue(book, PARAMS, R);
  sheetUtility(book, PARAMS, R);
  sheetSimulation(book, PARAMS, R);
  sheetSensitivity(book, PARAMS, R);
  sheetOptimization(book, PARAMS, R);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, FILE);
  await book.xlsx.writeFile(file);

  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`[excel] Сохранил ${FILE} (${kb} КБ, листов: ${book.worksheets.length})`);

  return { file, sheets: book.worksheets.length };
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => { console.error('[excel] Ошибка:', err.message); process.exit(1); });
}
