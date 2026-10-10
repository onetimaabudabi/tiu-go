/**
 * TIU GO — книга Excel по технической модели.
 *
 * Создаёт tech-model/output/TECH_MODEL.xlsx с семью листами. Расчётные
 * ячейки записаны настоящими формулами Excel и ссылаются на лист
 * «Параметры»: меняете там число — пересчитывается вся книга. Так
 * модель можно проверить и покрутить, не открывая код.
 *
 * Результаты симуляции и оптимизации формулами не пересчитываются —
 * это статистика по сотням прогонов, её не выразить в ячейке. Такие
 * числа подписаны как итоги расчёта.
 *
 * Запуск:  npm run tech:excel
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const PARAMS = require('./params');
const io = require('./io');

const OUT_DIR = path.join(__dirname, 'output');
const FILE = 'TECH_MODEL.xlsx';

// Оформление
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

function note(sheet, row, text) {
  sheet.getCell(`A${row}`).value = text;
  sheet.getCell(`A${row}`).font = NOTE_FONT;
}

/** Подгоняет ширину колонок под содержимое. */
function autoWidth(sheet, min = 10, max = 46) {
  sheet.columns.forEach((col) => {
    let width = min;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const text = v && typeof v === 'object' && v.formula
        ? String(v.result === undefined ? v.formula : v.result)
        : String(v === null || v === undefined ? '' : v);
      width = Math.max(width, Math.min(text.length + 2, max));
    });
    col.width = width;
  });
}

// ---------- Лист 1. Параметры ----------

/**
 * Все исходные числа модели. Ячейки этого листа — единственное место,
 * где стоят константы; на остальных листах только формулы.
 */
function sheetParams(wb, R) {
  const s = wb.addWorksheet(P);
  title(s, 'Параметры технической модели TIU GO',
    'Меняйте значения в колонке B — остальные листы пересчитаются.');

  let row = 4;
  const rows = {}; // имя параметра -> адрес ячейки, чтобы строить формулы

  const block = (caption, items) => {
    s.getCell(`A${row}`).value = caption;
    s.getCell(`A${row}`).font = { bold: true, size: 12 };
    row += 1;
    headerRow(s, row, ['Параметр', 'Значение', 'Единица']);
    row += 1;

    items.forEach(([name, value, unit, key]) => {
      dataRow(s, row, [name, value, unit],
        [null, typeof value === 'number' ? FMT_NUM2 : null, null]);
      if (key) rows[key] = `${P}!$B$${row}`;
      row += 1;
    });

    row += 1;
  };

  block('Здание', [
    ['Этажей', PARAMS.building.floors, 'шт', 'floors'],
    ['Высота этажа', PARAMS.building.floorHeight, 'м', 'floorHeight']
  ]);

  block('Лифты', [
    ['Всего лифтов', PARAMS.elevators.total, 'шт', 'total'],
    ['Работают', PARAMS.elevators.working.length, 'шт', 'working'],
    ['Вместимость по паспорту', PARAMS.elevators.capacityPassport, 'чел', 'capPassport'],
    ['Вместимость в пик', PARAMS.elevators.capacityRealPeak, 'чел', 'capacity'],
    ['Грузоподъёмность', PARAMS.elevators.payloadKg, 'кг', 'payload'],
    ['Скорость', PARAMS.elevators.speed, 'м/с', 'speed'],
    ['Ускорение', PARAMS.elevators.acceleration, 'м/с²', 'accel'],
    ['Открытие дверей', PARAMS.elevators.doorOpenTime, 'с', 'doorOpen'],
    ['Удержание дверей', PARAMS.elevators.doorHoldTime, 'с', 'doorHold'],
    ['Закрытие дверей', PARAMS.elevators.doorCloseTime, 'с', 'doorClose'],
    ['Посадка одного человека', PARAMS.elevators.boardingTimePerPerson, 'с', 'boarding']
  ]);

  block('Камера и детектор', [
    ['Угол обзора по горизонтали', PARAMS.camera.fovDegrees, '°', 'fov'],
    ['Высота установки', PARAMS.camera.mountingHeight, 'м', 'mount'],
    ['Частота кадров', PARAMS.camera.fps, 'FPS', 'fps'],
    ['mAP50 детектора', PARAMS.camera.map50, 'доля', 'map50'],
    ['Ложные срабатывания', PARAMS.camera.falsePositiveRate, 'доля', 'fp'],
    ['Пропуски людей', PARAMS.camera.falseNegativeRate, 'доля', 'fn'],
    ['Штраф за перекрытия', PARAMS.camera.occludedPersonPenalty, 'доля', 'occl'],
    ['Штраф за слабый свет', PARAMS.camera.darknessPenalty, 'доля', 'dark'],
    ['Штраф за толпу (за человека сверх 7)', PARAMS.camera.crowdPenalty, 'доля', 'crowd']
  ]);

  block('Кабина', [
    ['Ширина', PARAMS.cabin.width, 'м', 'cabinW'],
    ['Глубина', PARAMS.cabin.depth, 'м', 'cabinD'],
    ['Рост человека', PARAMS.cabin.personHeight, 'м', 'personH'],
    ['Вес человека', PARAMS.people.avgWeightKg, 'кг', 'weight'],
    ['Площадь силуэта в кадре', PARAMS.people.avgAreaM2, 'м²', 'area']
  ]);

  block('Поток людей', [
    ['Студентов', PARAMS.people.students, 'чел', 'students'],
    ['Сотрудников', PARAMS.people.staff, 'чел', 'staff'],
    ['Поездок на человека за день', PARAMS.simulation.tripsPerPersonPerDay, 'шт', 'trips'],
    ['Запас мест в правиле решения', R.opt.optimum, 'чел', 'margin']
  ]);

  note(s, row, 'Запас мест подобран моделью 7 (09-optimization). Это единственный ' +
    'настраиваемый параметр логики.');

  autoWidth(s);
  return rows;
}

// ---------- Лист 2. Камера ----------

function sheetCamera(wb, R, ref) {
  const s = wb.addWorksheet('Камера');
  title(s, 'Геометрия обзора и уверенность детекции',
    'Формулы ссылаются на лист «Параметры».');

  let row = 4;
  headerRow(s, row, ['Показатель', 'Значение', 'Единица', 'Формула']);
  row += 1;

  const geo = [
    ['Площадь пола кабины', { formula: `${ref.cabinW}*${ref.cabinD}` }, 'м²', 'ширина × глубина'],
    ['Высота камеры над головами',
      { formula: `${ref.mount}-${ref.personH}` }, 'м', 'установка − рост'],
    ['Вертикальный угол обзора',
      { formula: `2*DEGREES(ATAN(TAN(RADIANS(${ref.fov}/2))*1080/1920))` }, '°',
      'из соотношения сторон 16:9'],
    ['Предел по грузоподъёмности',
      { formula: `FLOOR(${ref.payload}/${ref.weight},1)` }, 'чел', 'груз ÷ вес человека'],
    ['Предел по давке (5 чел/м²)',
      { formula: `FLOOR(${ref.cabinW}*${ref.cabinD}*5,1)` }, 'чел', 'площадь × 5'],
    ['Предел по площади силуэта',
      { formula: `FLOOR(${ref.cabinW}*${ref.cabinD}/${ref.area},1)` }, 'чел',
      'площадь ÷ силуэт — завышен, см. отчёт'],
    ['Плотность по силуэту', { formula: `1/${ref.area}` }, 'чел/м²',
      'выше физического предела давки']
  ];

  geo.forEach((r) => {
    dataRow(s, row, r, [null, FMT_NUM2, null, null]);
    row += 1;
  });

  row += 1;
  s.getCell(`A${row}`).value = 'Уверенность детекции в зависимости от числа людей';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Людей', 'Штраф толпы', 'Штраф перекрытий', 'Штраф света',
    'Уверенность', 'Из расчёта модели']);
  row += 1;

  R.camera.confidence.forEach((c) => {
    const nCell = `A${row}`;
    dataRow(s, row, [
      c.people,
      { formula: `IF(${nCell}>7,${ref.crowd}*(${nCell}-7),0)` },
      { formula: `${ref.occl}*(1-EXP(-MAX(${nCell}-1,0)/3))` },
      { formula: `${ref.dark}` },
      { formula: `MAX(0.5,${ref.map50}-B${row}-C${row}-D${row})` },
      c.confidence
    ], [FMT_NUM, FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
    row += 1;
  });

  row += 1;
  note(s, row, 'Штраф за перекрытия отсчитывается от ВТОРОГО человека: первому в пустой ' +
    'кабине перекрывать себя нечем. Колонка «Из расчёта модели» — контрольные значения.');

  autoWidth(s);
}

// ---------- Лист 3. Ошибки ----------

function sheetErrors(wb, R, ref) {
  const s = wb.addWorksheet('Ошибки');
  title(s, 'Ошибки детекции: перекрытия, мерцание, матрица решений');

  let row = 4;
  headerRow(s, row, ['Людей', 'Доля перекрытых', 'Систем. пропуск',
    'Мерцание за кадр', 'Ложных рамок за кадр', 'Счёт по трекам', 'Смещение']);
  row += 1;

  R.errors.sources.forEach((src, i) => {
    const d = R.errors.distribution[i];
    const nCell = `A${row}`;
    dataRow(s, row, [
      src.people,
      { formula: `1-EXP(-MAX(${nCell}-1,0)/3)` },
      { formula: `B${row}*${ref.occl}` },
      { formula: `MIN(${ref.fn}+IF(${nCell}>7,${ref.crowd}*(${nCell}-7),0),0.9)` },
      { formula: `${ref.fp}*(${nCell}+1)` },
      d ? d.mean : null,
      d ? d.bias : null
    ], [FMT_NUM, FMT_PCT, FMT_PCT, FMT_PCT, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
    row += 1;
  });

  row += 1;
  note(s, row, 'Мерцание гасится окном из 30 кадров с подтверждением трека. ' +
    'Систематические пропуски от перекрытий не лечатся никакой обработкой — ' +
    'именно они дают остаточное смещение счёта.');
  row += 2;

  s.getCell(`A${row}`).value = 'Матрица ошибок решения «кабина полная»';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['', 'Решение «полная»', 'Решение «есть место»', 'Итого']);
  row += 1;

  const m = R.errors.matrix;
  dataRow(s, row, ['Реально полная', m.TP, m.FN, { formula: `B${row}+C${row}` }],
    [null, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
  row += 1;
  dataRow(s, row, ['Реально есть место', m.FP, m.TN, { formula: `B${row}+C${row}` }],
    [null, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
  row += 1;
  dataRow(s, row, ['Точность решений',
    { formula: `B${row - 2}+C${row - 1}` }, '', ''], [null, FMT_NUM2]);
  row += 2;

  note(s, row, 'TP — полная кабина распознана, FP — проехали мимо свободного места, ' +
    'FN — встали у полной кабины, TN — остановились там, где есть место.');

  autoWidth(s);
}

// ---------- Лист 4. Решения ----------

function sheetDecisions(wb, R, ref) {
  const s = wb.addWorksheet('Решения');
  title(s, 'Алгоритм «остановиться или проехать»',
    'Колонка «Решение» вычисляется формулой — поменяйте запас мест в «Параметрах».');

  let row = 4;
  headerRow(s, row, ['Реально', 'Камера видит', 'Вместимость', 'Надо было',
    'Решение без запаса', 'Верно?', 'Запас мест', 'Решение с запасом', 'Верно?']);
  row += 1;

  // Две колонки решений не для красоты: разбор сценариев в отчёте сделан
  // при нулевом запасе, иначе все пять сводятся к «проехать» и ничего
  // не иллюстрируют. Вторая колонка показывает, что меняет текущий запас.
  R.decision.scenarios.forEach((sc) => {
    dataRow(s, row, [
      sc.real, sc.detected, sc.capacity,
      { formula: `IF(A${row}<C${row},"остановиться","проехать")` },
      { formula: `IF(B${row}>=C${row},"проехать","остановиться")` },
      { formula: `IF(E${row}=D${row},"да","нет")` },
      { formula: `${ref.margin}` },
      { formula: `IF(B${row}+G${row}>=C${row},"проехать","остановиться")` },
      { formula: `IF(H${row}=D${row},"да","нет")` }
    ], [FMT_NUM, FMT_NUM, FMT_NUM, null, null, null, FMT_NUM, null, null]);
    row += 1;
  });

  row += 1;
  s.getCell(`A${row}`).value = 'Поведение правила по всей шкале загрузки';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Людей', 'Надо', 'Вероятность проехать', 'Точность',
    'Ошибка FP', 'Ошибка FN']);
  row += 1;

  R.decision.byLoad.forEach((r) => {
    dataRow(s, row, [r.people, r.truth, r.pPass, r.accuracy, r.wrongPass, r.wrongStop],
      [FMT_NUM, null, FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
    row += 1;
  });

  row += 1;
  s.getCell(`A${row}`).value = 'Три способа пройти пограничную зону';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Правило', 'Точность', 'Ошибка FP', 'Ошибка FN', 'Дребезг решений']);
  row += 1;

  R.decision.rules.forEach((r) => {
    dataRow(s, row, [r.label, r.accuracy, r.wrongPass, r.wrongStop, r.flipRate],
      [null, FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
    row += 1;
  });

  row += 1;
  note(s, row, 'Монетка в пограничной зоне дребезг не гасит, а создаёт. ' +
    'Гистерезис сохраняет предыдущее решение и снижает дребезг более чем на порядок.');

  autoWidth(s);
}

// ---------- Лист 5. Физика ----------

function sheetPhysics(wb, R, ref) {
  const s = wb.addWorksheet('Физика');
  title(s, 'Время рейса и пропускная способность',
    'Все времена пересчитываются из скорости, ускорения и времени дверей.');

  let row = 4;
  headerRow(s, row, ['Показатель', 'Значение', 'Единица', 'Формула']);
  row += 1;

  const base = [
    ['Цикл дверей', { formula: `${ref.doorOpen}+${ref.doorHold}+${ref.doorClose}` }, 'с',
      'открытие + удержание + закрытие'],
    ['Путь разгона и торможения', { formula: `${ref.speed}^2/${ref.accel}` }, 'м', 'v²/a'],
    ['Проезд одного этажа',
      { formula: `IF(${ref.floorHeight}<${ref.speed}^2/${ref.accel},` +
        `2*SQRT(${ref.floorHeight}/${ref.accel}),` +
        `(${ref.floorHeight}-${ref.speed}^2/${ref.accel})/${ref.speed}+2*${ref.speed}/${ref.accel})` },
      'с', 'трапецеидальный профиль'],
    ['Остановка в этажах', { formula: `B${row}/B${row + 2}` }, 'этажей',
      'цикл дверей ÷ проезд этажа']
  ];

  base.forEach((r) => {
    dataRow(s, row, r, [null, FMT_NUM2, null, null]);
    row += 1;
  });

  row += 1;
  s.getCell(`A${row}`).value = 'Из чего складывается рейс';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Пассажиров', 'Верхний этаж', 'Остановок на выход',
    'Движение, с', 'Двери, с', 'Посадка, с', 'Всего, с']);
  row += 1;

  R.physics.trips.forEach((t) => {
    dataRow(s, row, [t.passengers, t.topFloor, t.exitStops, t.travel, t.doors,
      { formula: `A${row}*${ref.boarding}*2` },
      { formula: `D${row}+E${row}+F${row}` }],
      [FMT_NUM, FMT_NUM1, FMT_NUM2, FMT_NUM1, FMT_NUM1, FMT_NUM1, FMT_NUM1]);
    row += 1;
  });

  row += 1;
  s.getCell(`A${row}`).value = 'Пропускная способность с системой и без неё';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Загрузка', 'Доля проездов', 'Рейс без, с', 'Рейс с, с',
    'Без, чел/ч', 'С системой, чел/ч', 'Прирост']);
  row += 1;

  R.physics.modes.forEach((m) => {
    dataRow(s, row, [
      m.meanOccupancy, m.pPass, m.without.total, m.withSystem.total,
      { formula: `A${row}/C${row}*${ref.working}*3600` },
      { formula: `A${row}/D${row}*${ref.working}*3600` },
      { formula: `F${row}/E${row}-1` }
    ], [FMT_NUM, FMT_NUM2, FMT_NUM1, FMT_NUM1, FMT_NUM, FMT_NUM, FMT_PCT]);
    row += 1;
  });

  row += 1;
  note(s, row, 'Формула пропускной способности: вместимость ÷ время рейса × число ' +
    'работающих лифтов × 3600.');

  autoWidth(s);
}

// ---------- Лист 6. Эффективность ----------

function sheetEffectiveness(wb, R) {
  const s = wb.addWorksheet('Эффективность');
  title(s, 'Accuracy, precision, recall и F1 по условиям работы');

  let row = 4;
  headerRow(s, row, ['Условие', 'Полная кабина', 'TP', 'FP', 'FN', 'TN',
    'Accuracy', 'Precision', 'Recall', 'F1']);
  row += 1;

  R.effect.conditions.forEach((c) => {
    dataRow(s, row, [
      c.label, c.baseRate, c.TP, c.FP, c.FN, c.TN,
      { formula: `C${row}+F${row}` },
      c.interpretable ? { formula: `C${row}/(C${row}+D${row})` } : 'н/д',
      c.interpretable ? { formula: `C${row}/(C${row}+E${row})` } : 'н/д',
      c.interpretable ? { formula: `2*H${row}*I${row}/(H${row}+I${row})` } : 'н/д'
    ], [null, FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2,
      FMT_NUM2, FMT_NUM2, FMT_NUM2, FMT_NUM2]);
    row += 1;
  });

  row += 1;
  note(s, row, 'Вне пика полная кабина почти не встречается, положительного класса ' +
    'фактически нет — precision, recall и F1 там не определены.');
  row += 2;

  s.getCell(`A${row}`).value = 'Экономия времени';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Условие', 'Рейс без системы, с', 'Рейс с системой, с',
    'Экономия, с', 'Экономия, %']);
  row += 1;

  R.effect.savings.forEach((sv) => {
    dataRow(s, row, [sv.label, sv.tripWithout, sv.tripWith,
      { formula: `B${row}-C${row}` },
      { formula: `IF(B${row}=0,0,D${row}/B${row})` }],
      [null, FMT_NUM1, FMT_NUM1, FMT_NUM1, FMT_PCT]);
    row += 1;
  });

  row += 1;
  s.getCell(`A${row}`).value = 'Цена ошибок';
  s.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;

  headerRow(s, row, ['Ошибка', 'Что происходит', 'Цена, с']);
  row += 1;
  dataRow(s, row, ['FN', 'встали у полной кабины',
    R.effect.errorCost.falseNegativeSeconds], [null, null, FMT_NUM]);
  row += 1;
  dataRow(s, row, ['FP', 'проехали мимо свободного места',
    R.effect.errorCost.falsePositiveSeconds], [null, null, FMT_NUM]);
  row += 1;
  dataRow(s, row, ['Отношение цен', '',
    { formula: `C${row - 1}/C${row - 2}` }], [null, null, FMT_NUM1]);

  autoWidth(s);
}

// ---------- Лист 7. Оптимизация ----------

function sheetOptimization(wb, R, ref) {
  const s = wb.addWorksheet('Оптимизация');
  title(s, 'Подбор запаса мест',
    'Итоги прогонов симуляции: формулами такие числа не пересчитываются.');

  let row = 4;
  headerRow(s, row, ['Запас мест', 'Ожидание всего, с', 'с 1-го этажа, с',
    'с промежуточных, с', 'Пиковый час, чел', 'Очередь, чел',
    'Проездов', 'Зря проехал', 'Зря встал', 'Верных проездов']);
  row += 1;

  const firstRow = row;
  R.opt.operational.forEach((r) => {
    dataRow(s, row, [r.margin, r.avgWait, r.avgWaitLobby, r.avgWaitUpper,
      r.peakThroughput, r.maxQueue, r.passes, r.wrongPasses, r.uselessStops,
      { formula: `IF(G${row}=0,1,1-H${row}/G${row})` }],
      [FMT_NUM, FMT_NUM1, FMT_NUM1, FMT_NUM1, FMT_NUM, FMT_NUM,
        FMT_NUM, FMT_NUM, FMT_NUM, FMT_PCT]);
    row += 1;
  });
  const lastRow = row - 1;

  row += 1;
  headerRow(s, row, ['Показатель', 'Значение']);
  row += 1;
  dataRow(s, row, ['Лучшая пропускная способность',
    { formula: `MAX(E${firstRow}:E${lastRow})` }], [null, FMT_NUM]);
  row += 1;
  dataRow(s, row, ['Минимальное ожидание на промежуточных этажах',
    { formula: `MIN(D${firstRow}:D${lastRow})` }], [null, FMT_NUM1]);
  row += 1;
  dataRow(s, row, ['Оптимальный запас мест',
    { formula: `INDEX(A${firstRow}:A${lastRow},MATCH(MIN(D${firstRow}:D${lastRow}),` +
      `D${firstRow}:D${lastRow},0))` }], [null, FMT_NUM]);
  row += 1;
  dataRow(s, row, ['Принято в модели', R.opt.optimum], [null, FMT_NUM]);

  row += 2;
  note(s, row, 'Критерий: минимум ожидания на промежуточных этажах при условии, что ' +
    'пропускная способность в пиковый час не проседает больше чем на процент. ' +
    'Именно промежуточные этажи система и проезжает мимо — на первом этаже лифт ' +
    'берёт всех подряд и от запаса только выигрывает.');

  autoWidth(s);
}

// ---------- Сборка ----------

async function need(name, modulePath) {
  const cached = io.loadData(name);
  if (cached) return cached;

  console.log(`[excel] Нет output/data/${name}.json — запускаю модель…`);
  return require(modulePath).run();
}

async function main() {
  console.log('[excel] Собираю результаты моделей…');

  const R = {
    camera: await need('01-camera', './01-camera-model'),
    errors: await need('02-errors', './02-detection-errors'),
    decision: await need('03-decision', './03-decision-logic'),
    physics: await need('04-physics', './04-elevator-physics'),
    effect: await need('05-effectiveness', './05-effectiveness'),
    opt: await need('07-optimization', './07-optimization')
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TIU GO';
  wb.created = new Date();

  const ref = sheetParams(wb, R);
  sheetCamera(wb, R, ref);
  sheetErrors(wb, R, ref);
  sheetDecisions(wb, R, ref);
  sheetPhysics(wb, R, ref);
  sheetEffectiveness(wb, R);
  sheetOptimization(wb, R, ref);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await wb.xlsx.writeFile(path.join(OUT_DIR, FILE));

  const size = Math.round(fs.statSync(path.join(OUT_DIR, FILE)).size / 1024);
  console.log(`[excel] Сохранил ${FILE} (${size} КБ, листов: ${wb.worksheets.length})`);
}

module.exports = { main };

if (require.main === module) {
  main().catch((err) => { console.error('[excel] Ошибка:', err.message); process.exit(1); });
}
