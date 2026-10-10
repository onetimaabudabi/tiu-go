/**
 * TIU GO — генерация Excel-книги с расчётами.
 *
 * Создаёт docs/Бизнес_расчеты_TIU_GO.xlsx с пятью листами. Все значения,
 * кроме исходных данных, записаны настоящими формулами Excel: меняете
 * число на листе «Исходные данные» — пересчитывается вся книга.
 *
 * Запуск:  npm run docs:excel
 */

const ExcelJS = require('exceljs');
const D = require('./data');

const FILE = 'Бизнес_расчеты_TIU_GO.xlsx';

// Оформление
const HEAD_FILL = 'FF5B8DEF';
const HEAD_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF1F4E9C' } };
const BORDER = {
  top:    { style: 'thin', color: { argb: 'FFB6BCC8' } },
  left:   { style: 'thin', color: { argb: 'FFB6BCC8' } },
  bottom: { style: 'thin', color: { argb: 'FFB6BCC8' } },
  right:  { style: 'thin', color: { argb: 'FFB6BCC8' } }
};

const FMT_RUB = '#,##0 "₽"';
const FMT_NUM = '#,##0';
const FMT_NUM1 = '#,##0.0';

// Имя листа с пробелом в формуле нужно брать в кавычки
const SRC = "'Исходные данные'";

/** Шапка таблицы: жирный белый текст на синей заливке. */
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
  r.height = 28;
  return r;
}

/** Заголовок листа. */
function title(sheet, text, span) {
  sheet.getCell('A1').value = text;
  sheet.getCell('A1').font = TITLE_FONT;
  sheet.mergeCells(1, 1, 1, span);
  sheet.getRow(1).height = 24;
}

/** Рамки всем ячейкам в прямоугольнике. */
function border(sheet, fromRow, toRow, cols) {
  for (let r = fromRow; r <= toRow; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      sheet.getRow(r).getCell(c).border = BORDER;
    }
  }
}

/** Ширина колонок по самому длинному значению. */
function autoWidth(sheet, min = 10, max = 48) {
  sheet.columns.forEach((col) => {
    let longest = min;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const text = v && typeof v === 'object' && v.formula ? String(v.result || v.formula) : String(v === null || v === undefined ? '' : v);
      text.split('\n').forEach((line) => { longest = Math.max(longest, line.length + 2); });
    });
    col.width = Math.min(longest, max);
  });
}

/** Вставка графика под таблицей — если картинки нет, просто пропускаем. */
function addChart(workbook, sheet, file, row, width = 640, height = 384) {
  const full = D.docsPath(file);
  if (!D.exists(full)) {
    console.warn(`[excel] Нет файла ${file} — лист соберётся без картинки`);
    sheet.getCell(`A${row}`).value = `[график ${file} — запустите npm run docs:charts]`;
    sheet.getCell(`A${row}`).font = { italic: true, color: { argb: 'FF6B7280' } };
    return;
  }

  const id = workbook.addImage({ filename: full, extension: 'png' });
  sheet.addImage(id, { tl: { col: 0.2, row: row - 1 }, ext: { width, height } });
}

function build() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TIU GO';
  wb.created = new Date();

  const i = D.INPUT;
  const c = D.calc();

  // ───────── Лист 1: исходные данные ─────────
  const s1 = wb.addWorksheet('Исходные данные');
  title(s1, 'TIU GO — исходные данные для расчётов', 4);
  headerRow(s1, 2, ['Параметр', 'Значение', 'Единица', 'Комментарий']);

  const params = [
    ['Количество лифтов', i.elevators, 'шт', 'Корпус 7, Мельникайте 70'],
    ['Этажей в корпусе', i.floors, 'эт', 'все лифты ходят на всю высоту'],
    ['Студентов и сотрудников', i.students, 'чел', 'оценка'],
    ['Поездок в день', i.tripsPerDay, 'шт', 'оценка'],
    ['Ожидание без системы', i.waitBefore, 'сек', 'среднее в пик'],
    ['Ожидание с системой', i.waitAfter, 'сек', 'после внедрения'],
    ['Обслуживание одного лифта', i.maintenancePerYear, '₽/год', 'оценка'],
    ['Учебных дней в году', i.studyDays, 'дн', ''],
    ['Условная стоимость часа', i.hourValue, '₽/ч', 'для оценки эффекта'],
    ['Доля денежного эффекта', i.monetization, 'доля', 'сэкономленное время — не деньги, в поток берём часть']
  ];

  params.forEach((row, n) => {
    const r = s1.getRow(3 + n);
    r.getCell(1).value = row[0];
    r.getCell(2).value = row[1];
    r.getCell(3).value = row[2];
    r.getCell(4).value = row[3];
    r.getCell(2).numFmt = row[0] === 'Доля денежного эффекта' ? '0%' : FMT_NUM;
    r.getCell(2).alignment = { horizontal: 'right' };
  });

  border(s1, 2, 2 + params.length, 4);
  autoWidth(s1);
  s1.getColumn(4).width = 46;

  // ───────── Лист 2: экономия времени ─────────
  const s2 = wb.addWorksheet('Экономия времени');
  title(s2, 'Расчёт экономии времени', 4);
  headerRow(s2, 2, ['Показатель', 'Значение', 'Единица', 'Как считается']);

  const rows2 = [
    ['Экономия на человека в день', { formula: `${SRC}!B7-${SRC}!B8` }, 'сек', 'ожидание без системы минус с системой'],
    ['Экономия на всех в день', { formula: `B3*${SRC}!B5` }, 'сек', 'на человека × число людей'],
    ['То же в часах', { formula: 'B4/3600' }, 'ч', 'секунды ÷ 3600'],
    ['Экономия за учебный год', { formula: `B5*${SRC}!B10` }, 'ч', 'часов в день × учебных дней'],
    ['В человеко-днях', { formula: 'B6/8' }, 'дн', 'часов ÷ 8'],
    ['Условная польза', { formula: `B6*${SRC}!B11` }, '₽/год', 'часов × стоимость часа'],
    ['Денежный эффект', { formula: `B8*${SRC}!B12` }, '₽/год', 'условная польза × доля'],
    ['Денежный эффект в месяц', { formula: 'B9/12' }, '₽/мес', 'год ÷ 12']
  ];

  rows2.forEach((row, n) => {
    const r = s2.getRow(3 + n);
    r.getCell(1).value = row[0];
    r.getCell(2).value = row[1];
    r.getCell(3).value = row[2];
    r.getCell(4).value = row[3];
    r.getCell(2).numFmt = String(row[2]).includes('₽') ? FMT_RUB : FMT_NUM1;
    r.getCell(2).alignment = { horizontal: 'right' };
  });

  border(s2, 2, 2 + rows2.length, 4);
  autoWidth(s2);
  s2.getColumn(4).width = 42;

  // ───────── Лист 3: затраты ─────────
  const s3 = wb.addWorksheet('Затраты');
  title(s3, 'Затраты на внедрение', 5);
  headerRow(s3, 2, ['Статья', 'Количество', 'Цена, ₽', 'Сумма, ₽', 'Комментарий']);

  D.COSTS.forEach((item, n) => {
    const r = s3.getRow(3 + n);
    r.getCell(1).value = item.name;
    r.getCell(2).value = item.qty;
    r.getCell(3).value = item.price;
    r.getCell(4).value = { formula: `B${3 + n}*C${3 + n}` };
    r.getCell(5).value = item.note;
    r.getCell(3).numFmt = FMT_RUB;
    r.getCell(4).numFmt = FMT_RUB;
  });

  const totalRow = 3 + D.COSTS.length;
  const t = s3.getRow(totalRow);
  t.getCell(1).value = 'Итого';
  t.getCell(4).value = { formula: `SUM(D3:D${totalRow - 1})` };
  t.getCell(4).numFmt = FMT_RUB;
  [1, 2, 3, 4, 5].forEach((col) => {
    t.getCell(col).font = { bold: true };
    t.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF3' } };
  });

  border(s3, 2, totalRow, 5);
  autoWidth(s3);
  s3.getColumn(5).width = 36;
  addChart(wb, s3, D.CHARTS.costs, totalRow + 2);

  // ───────── Лист 4: окупаемость ─────────
  const s4 = wb.addWorksheet('Окупаемость');
  title(s4, 'Срок окупаемости по месяцам', 4);
  headerRow(s4, 2, ['Месяц', 'Затраты накопительно, ₽', 'Экономия накопительно, ₽', 'Баланс, ₽']);

  for (let m = 1; m <= 12; m += 1) {
    const row = 2 + m;
    const r = s4.getRow(row);
    r.getCell(1).value = m;
    // Затраты разовые, поэтому накопительно это всегда итог сметы
    r.getCell(2).value = { formula: `Затраты!$D$${totalRow}` };
    r.getCell(3).value = { formula: `'Экономия времени'!$B$10*A${row}` };
    r.getCell(4).value = { formula: `C${row}-B${row}` };
    [2, 3, 4].forEach((col) => { r.getCell(col).numFmt = FMT_RUB; });
  }

  border(s4, 2, 14, 4);

  const outRow = 16;
  s4.getCell(`A${outRow}`).value = 'Срок окупаемости, мес.';
  s4.getCell(`B${outRow}`).value = { formula: `Затраты!$D$${totalRow}/'Экономия времени'!$B$10` };
  s4.getCell(`B${outRow}`).numFmt = FMT_NUM1;

  s4.getCell(`A${outRow + 1}`).value = 'Первый месяц с положительным балансом';
  // Считаем, сколько месяцев баланс ещё отрицательный, и берём следующий
  s4.getCell(`B${outRow + 1}`).value = { formula: 'COUNTIF(D3:D14,"<0")+1' };

  [outRow, outRow + 1].forEach((r) => {
    s4.getCell(`A${r}`).font = { bold: true };
    s4.getCell(`B${r}`).font = { bold: true };
  });

  autoWidth(s4);
  addChart(wb, s4, D.CHARTS.payback, outRow + 3);

  // ───────── Лист 5: коэффициент полезности ─────────
  const s5 = wb.addWorksheet('Коэффициент полезности');
  title(s5, 'Коэффициент полезности проекта', 4);
  headerRow(s5, 2, ['Показатель', 'Значение', 'Единица', 'Как считается']);

  const rows5 = [
    ['Экономия за год', { formula: "'Экономия времени'!B6" }, 'ч', 'с листа «Экономия времени»'],
    ['Стоимость часа', { formula: `${SRC}!B11` }, '₽/ч', 'из исходных данных'],
    ['Условная польза', { formula: 'B3*B4' }, '₽/год', 'часы × стоимость часа'],
    ['Затраты на внедрение', { formula: `Затраты!$D$${totalRow}` }, '₽', 'итог сметы'],
    ['Коэффициент полезности K', { formula: 'B5/B6' }, 'раз', 'польза ÷ затраты']
  ];

  rows5.forEach((row, n) => {
    const r = s5.getRow(3 + n);
    r.getCell(1).value = row[0];
    r.getCell(2).value = row[1];
    r.getCell(3).value = row[2];
    r.getCell(4).value = row[3];
    r.getCell(2).numFmt = String(row[2]).includes('₽') ? FMT_RUB : FMT_NUM1;
    r.getCell(2).alignment = { horizontal: 'right' };
  });

  border(s5, 2, 2 + rows5.length, 4);

  // Веса критериев
  const wRow = 3 + rows5.length + 2;
  s5.getCell(`A${wRow - 1}`).value = 'Веса критериев оценки';
  s5.getCell(`A${wRow - 1}`).font = { bold: true, size: 12 };
  headerRow(s5, wRow, ['Критерий', 'Вес', 'Комментарий', '']);

  const weights = [
    ['Экономия времени', 0.5, 'основной эффект проекта'],
    ['Снижение опозданий', 0.3, 'влияет на учебный процесс'],
    ['Износ оборудования', 0.2, 'меньше холостых поездок']
  ];

  weights.forEach((row, n) => {
    const r = s5.getRow(wRow + 1 + n);
    r.getCell(1).value = row[0];
    r.getCell(2).value = row[1];
    r.getCell(2).numFmt = '0%';
    r.getCell(3).value = row[2];
  });

  const sumRow = wRow + 1 + weights.length;
  s5.getCell(`A${sumRow}`).value = 'Сумма весов';
  s5.getCell(`B${sumRow}`).value = { formula: `SUM(B${wRow + 1}:B${sumRow - 1})` };
  s5.getCell(`B${sumRow}`).numFmt = '0%';
  s5.getCell(`A${sumRow}`).font = { bold: true };
  s5.getCell(`B${sumRow}`).font = { bold: true };

  border(s5, wRow, sumRow, 3);
  autoWidth(s5);
  s5.getColumn(4).width = 38;

  // Напоминание о природе цифр — прямо в книге, чтобы не потерялось
  const noteRow = sumRow + 2;
  s5.getCell(`A${noteRow}`).value =
    `Условная польза (${D.rub(c.valuePerYear)}) — это оценка стоимости сэкономленного времени, а не денежный поток. ` +
    `В расчёте окупаемости используется доля ${Math.round(i.monetization * 100)}% — см. лист «Исходные данные».`;
  s5.getCell(`A${noteRow}`).font = { italic: true, color: { argb: 'FF6B7280' }, size: 10 };
  s5.getCell(`A${noteRow}`).alignment = { wrapText: true, vertical: 'top' };
  s5.mergeCells(noteRow, 1, noteRow + 1, 4);

  return wb;
}

async function main() {
  D.ensureDocsDir();
  console.log('[excel] Собираю книгу с пятью листами…');

  const wb = build();
  const out = D.docsPath(FILE);
  await wb.xlsx.writeFile(out);

  console.log(`[excel] Сохранил ${FILE}`);
  console.log('[excel] Формулы живые: меняйте «Исходные данные» — пересчитается вся книга');
  console.log('✅ Готово! Файлы в папке docs/');
}

main().catch((err) => {
  console.error('[excel] Ошибка:', err.message);
  process.exit(1);
});
