/**
 * TIU GO — генерация Word-документов.
 *
 * Создаёт три файла в docs/:
 *   Бизнес_расчеты_TIU_GO.docx   — расчёты с таблицами и графиками
 *   Опрос_студентов_TIU_GO.docx  — анкета, готовая к печати на A4
 *   Презентация_TIU_GO.docx      — 13 разделов по слайду на страницу
 *
 * Графики берутся из docs/ (их готовит npm run docs:charts).
 * Если графика или скриншота нет — вместо картинки встанет пометка,
 * документ всё равно соберётся.
 *
 * Запуск:  npm run docs:word
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, LevelFormat,
  PageBreak, LineRuleType
} = require('docx');

const D = require('./data');

const FONT = 'Times New Roman';
const SIZE = 24;        // 12 pt
const LINE = 360;       // полуторный интервал
const TABLE_WIDTH = 9600;
const ACCENT = '1F4E9C';
const GREY_FILL = 'EDEFF3';

let calc = D.calc();

// ---------- Чтение необязательных markdown-источников ----------

/**
 * Пытается вытащить из markdown числа для известных параметров.
 * Ищем строки вида «Ожидание без системы: 90» в любом оформлении.
 * Файла нет или чисел не нашлось — работаем на встроенных данных.
 */
function applyMarkdownOverrides() {
  const md = D.readMarkdown('БИЗНЕС_РАСЧЕТЫ.md');
  if (!md) {
    console.log('[word] БИЗНЕС_РАСЧЕТЫ.md не найден — беру встроенные данные');
    return;
  }

  const rules = [
    [/лифтов\D{0,20}(\d+)/i, 'elevators'],
    [/этаж\w*\D{0,20}(\d+)/i, 'floors'],
    [/студент\w*\D{0,20}(\d[\d\s]*)/i, 'students'],
    [/поездок\D{0,20}(\d[\d\s]*)/i, 'tripsPerDay'],
    [/без системы\D{0,20}(\d+)/i, 'waitBefore'],
    [/с системой\D{0,20}(\d+)/i, 'waitAfter'],
    [/учебных дней\D{0,20}(\d+)/i, 'studyDays']
  ];

  const applied = [];
  rules.forEach(([re, key]) => {
    const m = md.match(re);
    if (!m) return;
    const value = Number(String(m[1]).replace(/\s/g, ''));
    if (Number.isFinite(value) && value > 0) {
      D.INPUT[key] = value;
      applied.push(`${key}=${value}`);
    }
  });

  calc = D.calc(); // пересчитываем всё под новые входные данные
  console.log(applied.length
    ? `[word] Из БИЗНЕС_РАСЧЕТЫ.md взял: ${applied.join(', ')}`
    : '[word] В БИЗНЕС_РАСЧЕТЫ.md не нашёл чисел — беру встроенные данные');
}

// ---------- Строительные блоки ----------

const p = (text, opts = {}) => new Paragraph({
  alignment: opts.align || AlignmentType.JUSTIFIED,
  spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: opts.after === undefined ? 120 : opts.after },
  indent: opts.indent === false ? undefined : { firstLine: 709 },
  children: [new TextRun({
    text,
    font: FONT,
    size: opts.size || SIZE,
    bold: !!opts.bold,
    italics: !!opts.italics,
    color: opts.color
  })]
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 320, after: 200, line: LINE, lineRule: LineRuleType.AUTO },
  children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: ACCENT })]
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 220, after: 140, line: LINE, lineRule: LineRuleType.AUTO },
  children: [new TextRun({ text, font: FONT, size: 26, bold: true })]
});

/** Формула — отдельной строкой, курсивом, по центру. */
const formula = (text) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 120, after: 160, line: LINE, lineRule: LineRuleType.AUTO },
  children: [new TextRun({ text, font: FONT, size: SIZE, italics: true })]
});

const bullet = (text, size = SIZE) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 80 },
  children: [new TextRun({ text, font: FONT, size })]
});

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

/** Ячейка таблицы. */
function cell(text, width, opts = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: opts.head
      ? { type: ShadingType.CLEAR, fill: GREY_FILL, color: 'auto' }
      : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { line: 240, lineRule: LineRuleType.AUTO, after: 0 },
      children: [new TextRun({ text: String(text), font: FONT, size: 22, bold: !!opts.head })]
    })]
  });
}

/** Таблица с границами и серой шапкой. */
function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'B6BCC8' };

  return new Table({
    columnWidths: widths,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border,
               insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, widths[i], { head: true }))
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((v, i) => cell(v, widths[i], {
          align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT
        }))
      }))
    ]
  });
}

/**
 * Картинка по центру с подписью «Рисунок N. Название».
 * Файла нет — вместо него строка-заглушка, документ не ломается.
 */
let figureNo = 0;
function figure(file, title, width = 600, height = 360) {
  figureNo += 1;
  const full = D.docsPath(file);

  if (!D.exists(full)) {
    console.warn(`[word] Нет файла ${file} — вставляю заглушку`);
    return [
      p(`[график: ${title} — запустите npm run docs:charts]`, { align: AlignmentType.CENTER, indent: false, italics: true }),
      caption(title)
    ];
  }

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 80 },
      children: [new ImageRun({
        data: fs.readFileSync(full),
        type: 'png',
        transformation: { width, height }
      })]
    }),
    caption(title)
  ];
}

function caption(title) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200, line: LINE, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text: `Рисунок ${figureNo}. ${title}`, font: FONT, size: 20, italics: true })]
  });
}

/** Общие настройки документа: шрифт, интервал, маркеры списка. */
function docOptions(title, children) {
  return {
    creator: 'TIU GO',
    title,
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 260 } } }
        }]
      }]
    },
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE } }
      }
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
      children
    }]
  };
}

async function save(doc, fileName) {
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(D.docsPath(fileName), buf);
  console.log(`[word] Сохранил ${fileName} (${Math.round(buf.length / 1024)} КБ)`);
}

// ---------- Документ 1: бизнес-расчёты ----------
function businessDoc() {
  figureNo = 0;
  const i = D.INPUT;
  const c = calc;

  const children = [
    // Титул
    new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'TIU GO', font: FONT, size: 72, bold: true, color: ACCENT })] }),
    p('Система мониторинга загруженности лифтов', { align: AlignmentType.CENTER, indent: false, size: 28 }),
    p('Бизнес-расчёты и экономическое обоснование', { align: AlignmentType.CENTER, indent: false, size: 28, bold: true }),
    p('Корпус 7 ТИУ, ул. Мельникайте, 70', { align: AlignmentType.CENTER, indent: false }),
    p('Проектная команда TIU GO · Тюменский индустриальный университет', { align: AlignmentType.CENTER, indent: false }),
    p(String(new Date().getFullYear()), { align: AlignmentType.CENTER, indent: false }),
    pageBreak(),

    h1('1. Исходные данные'),
    p('Расчёты построены на параметрах корпуса 7 и оценках, полученных из расписания занятий. Значения, помеченные как оценка, подлежат уточнению натурными замерами на этапе пилота.'),
    table(
      ['Параметр', 'Значение', 'Единица', 'Комментарий'],
      [
        ['Количество лифтов', i.elevators, 'шт', 'Корпус 7'],
        ['Этажей в корпусе', i.floors, 'эт', 'все лифты ходят на всю высоту'],
        ['Студентов и сотрудников', D.num(i.students), 'чел', 'оценка'],
        ['Поездок в день', D.num(i.tripsPerDay), 'шт', 'оценка'],
        ['Ожидание без системы', i.waitBefore, 'сек', 'среднее в пик'],
        ['Ожидание с системой', i.waitAfter, 'сек', 'после внедрения'],
        ['Обслуживание лифта', D.num(i.maintenancePerYear), '₽/год', 'оценка'],
        ['Учебных дней в году', i.studyDays, 'дн', ''],
        ['Условная стоимость часа', D.num(i.hourValue), '₽/ч', 'для оценки эффекта']
      ],
      [3400, 1800, 1400, 3000]
    ),

    h1('2. Расчёт экономии времени'),
    p('Система не ускоряет лифт — она помогает не стоять в очереди впустую. Человек видит, где кабина и сколько людей ждёт, и либо приходит к лифту позже, либо идёт по лестнице. За счёт этого среднее ожидание в пик сокращается.'),
    formula(`Экономия на человека = ${i.waitBefore} − ${i.waitAfter} = ${c.savedPerStudentSec} сек`),
    formula(`Экономия в день = ${c.savedPerStudentSec} × ${D.num(i.students)} = ${D.num(c.savedPerDaySec)} сек = ${D.num(c.savedPerDayHours, 1)} ч`),
    formula(`Экономия за учебный год = ${D.num(c.savedPerDayHours, 1)} × ${i.studyDays} = ${D.num(c.savedPerYearHours)} ч`),
    table(
      ['Показатель', 'Значение', 'Единица'],
      [
        ['На одного человека в день', c.savedPerStudentSec, 'сек'],
        ['На всех в день', D.num(c.savedPerDaySec), 'сек'],
        ['На всех в день', D.num(c.savedPerDayHours, 1), 'часов'],
        ['За учебный год', D.num(c.savedPerYearHours), 'часов'],
        ['В человеко-днях (8 ч)', D.num(c.savedPerYearManDays), 'дней']
      ],
      [5200, 2400, 2000]
    ),
    ...figure(D.CHARTS.time, 'Среднее время ожидания лифта в пик'),

    h1('3. Снижение опозданий'),
    p(`По предварительной оценке около ${Math.round(i.lateReduction * 100)}% опозданий на первую пару связаны именно с ожиданием лифта: студент приходит в корпус вовремя, но теряет несколько минут в холле. Это единственная доля, на которую проект влияет напрямую, и именно её мы измеряем до и после внедрения.`),
    ...figure(D.CHARTS.lateness, 'Структура причин опозданий студентов'),
    p('Остальные причины — личные и транспортные — вне зоны влияния системы, и приписывать их проекту было бы некорректно.'),

    h1('4. Загруженность лифтов'),
    p(`На ${i.elevators} лифтов приходится около ${D.num(i.tripsPerDay)} поездок в учебный день, то есть примерно ${D.num(Math.round(i.tripsPerDay / i.elevators))} поездок на кабину. Нагрузка распределена крайне неравномерно: в перерывах между парами в холлах скапливаются очереди, в остальное время кабины ходят полупустыми.`),
    bullet('Пиковые интервалы привязаны к расписанию: 08:20–08:50, 13:30–13:50, 15:20–15:40, 17:10–17:30.'),
    bullet('В пик очередь в холле первого этажа доходит до 10–15 человек.'),
    bullet('Вне пика заполненность кабины редко превышает треть вместимости.'),
    p('Система показывает это распределение в реальном времени и предупреждает о приближении пика, позволяя части потока сместиться на несколько минут или уйти на лестницу.', { after: 200 }),

    h1('5. Коэффициент полезности'),
    p('Коэффициент полезности показывает, во сколько раз условная польза превышает затраты на внедрение.'),
    formula(`Польза = ${D.num(c.savedPerYearHours)} ч × ${i.hourValue} ₽/ч = ${D.rub(c.valuePerYear)} в год`),
    formula(`K = ${D.rub(c.valuePerYear)} ÷ ${D.rub(c.totalCosts)} = ${c.usefulness.toFixed(1)}`),
    p(`Каждый вложенный рубль даёт около ${c.usefulness.toFixed(0)} рублей условной пользы. Важно понимать: это оценка стоимости сэкономленного времени, а не денежный поток — университет не получает этот миллион на счёт.`),

    h1('6. Затраты на внедрение'),
    p('Решение рассчитано на существующую инфраструктуру: отдельный сервер не нужен, вмешательства в лифтовое оборудование не требуется, поэтому смета ограничивается камерами и вычислителями.'),
    table(
      ['Статья', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'],
      [
        ...D.COSTS.map((x) => [x.name, x.qty, D.num(x.price), D.num(x.qty * x.price)]),
        ['Итого', '', '', D.num(c.totalCosts)]
      ],
      [4000, 1400, 2000, 2200]
    ),
    ...figure(D.CHARTS.costs, 'Структура затрат на внедрение'),

    h1('7. Срок окупаемости'),
    p('Сэкономленное время студентов — не деньги. Чтобы расчёт окупаемости был честным, в денежный поток берётся консервативная доля условной пользы: она возникает косвенно — через меньший износ кабин, сокращение вызовов сервиса и отложенную закупку дополнительного лифта.'),
    formula(`Денежный эффект = ${D.rub(c.valuePerYear)} × ${Math.round(i.monetization * 100)}% = ${D.rub(c.cashPerYear)} в год`),
    formula(`Окупаемость = ${D.rub(c.totalCosts)} ÷ ${D.rub(Math.round(c.cashPerMonth))} в месяц ≈ ${c.paybackMonths.toFixed(1)} мес.`),
    ...figure(D.CHARTS.payback, 'Накопленная экономия и точка окупаемости'),
    p(`Если считать денежной всю условную пользу, проект окупился бы меньше чем за месяц. Такая оценка выглядит неправдоподобно, поэтому в документе принят осторожный вариант — ${Math.round(i.monetization * 100)}% эффекта.`),

    h1('8. Социальный эффект'),
    bullet('Доступная среда: маломобильные посетители видят свободную кабину заранее и не стоят в толпе.'),
    bullet('Безопасность: меньше давки у дверей в пиковые интервалы.'),
    bullet('Здоровье: часть потока осознанно выбирает лестницу для нижних этажей.'),
    bullet('Прозрачность: служба эксплуатации получает объективную статистику нагрузки вместо жалоб.'),
    bullet('Цифровая культура кампуса: сервис сделан студентами и работает на данных самого университета.'),

    h1('9. Масштабирование'),
    p('Решение не привязано к конкретной марке лифта и работает на обычных камерах, поэтому переносится на другие корпуса почти без доработок: меняются только параметры здания.'),
    table(
      ['Год', 'Корпуса ТИУ', 'Другие вузы', 'Коммерческие объекты'],
      D.SCALING.years.map((y, n) => [y, D.SCALING.tiu[n], D.SCALING.universities[n], D.SCALING.commercial[n]]),
      [2400, 2400, 2400, 2400]
    ),
    ...figure(D.CHARTS.scaling, 'Прогноз масштабирования по годам'),

    h1('10. Выводы'),
    bullet(`Внедрение в корпусе 7 экономит около ${D.num(c.savedPerYearHours)} часов в год — это ${D.num(c.savedPerYearManDays)} человеко-дней.`),
    bullet(`Затраты на запуск — ${D.rub(c.totalCosts)}, при консервативной оценке эффекта проект окупается за ${c.paybackMonths.toFixed(1)} месяца.`),
    bullet(`Коэффициент полезности ${c.usefulness.toFixed(0)} — на каждый вложенный рубль приходится ${c.usefulness.toFixed(0)} рублей условной пользы.`),
    bullet('Решение не требует вмешательства в лифтовое оборудование и работает на существующих камерах.'),
    bullet('Ключевой риск — не техника, а доступ к камерам и согласование обработки данных: этот шаг самый длинный по срокам.'),
    p('Цифры, помеченные как оценка, требуют подтверждения натурными замерами и опросом на этапе пилота. Их уточнение изменит абсолютные значения, но не порядок величин.', { after: 0 })
  ];

  return new Document(docOptions('TIU GO — бизнес-расчёты', children));
}

// ---------- Документ 2: анкета ----------
function surveyDoc() {
  const md = D.readMarkdown('ОПРОС_СТУДЕНТОВ.md');
  console.log(md
    ? '[word] Нашёл ОПРОС_СТУДЕНТОВ.md — беру вступление оттуда'
    : '[word] ОПРОС_СТУДЕНТОВ.md не найден — беру встроенный текст');

  const BOX = '☐'; // ☐

  const option = (text) => new Paragraph({
    spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 60 },
    indent: { left: 420 },
    children: [new TextRun({ text: `${BOX}  ${text}`, font: FONT, size: SIZE })]
  });

  const question = (n, text) => new Paragraph({
    spacing: { before: 200, after: 100, line: LINE, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text: `${n}. ${text}`, font: FONT, size: SIZE, bold: true })]
  });

  /** Пустые строки для ответа от руки. */
  const writeLines = (count) => Array.from({ length: count }, () => new Paragraph({
    spacing: { after: 160, line: LINE, lineRule: LineRuleType.AUTO },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' } },
    children: [new TextRun({ text: '', font: FONT, size: SIZE })]
  }));

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
      children: [new TextRun({ text: 'TIU GO — опрос для студентов', font: FONT, size: 36, bold: true, color: ACCENT })] }),
    p('Корпус 7 ТИУ, ул. Мельникайте, 70', { align: AlignmentType.CENTER, indent: false, size: 22 }),

    p('Мы разрабатываем приложение, которое показывает загруженность лифтов корпуса в реальном времени: где кабина, сколько человек внутри и сколько ждёт в холле. Опрос займёт две минуты и поможет понять, нужна ли такая система и какие функции в ней важнее. Ответы анонимны.', { after: 200 }),

    h2('О вас'),
    question(1, 'Кто вы?'),
    option('Студент'), option('Преподаватель'), option('Сотрудник'), option('Другое'),
    question(2, 'На каких этажах у вас чаще всего занятия или рабочее место?'),
    option('1–5'), option('6–10'), option('11–16'), option('По-разному'),

    h2('Текущая ситуация'),
    question(3, 'Как часто вы пользуетесь лифтом в корпусе 7?'),
    option('Несколько раз в день'), option('Раз в день'), option('Несколько раз в неделю'), option('Почти никогда'),
    question(4, 'Сколько примерно вы ждёте лифт в перерыве между парами?'),
    option('Меньше минуты'), option('1–2 минуты'), option('3–5 минут'), option('Больше 5 минут'),
    question(5, 'Случалось ли вам опаздывать на пару из-за лифта?'),
    option('Да, регулярно'), option('Да, несколько раз'), option('Нет'),
    question(6, 'Что вы делаете, когда у лифта очередь?'),
    option('Жду в любом случае'), option('Иду по лестнице'), option('Решаю по ситуации'),

    h2('Оценка идеи'),
    question(7, 'Насколько вам была бы полезна такая система? Оцените от 1 до 5.'),
    option('1 — совсем не нужна'), option('2'), option('3'), option('4'), option('5 — очень нужна'),
    question(8, 'Какие функции для вас важнее? Можно выбрать несколько.'),
    option('Сколько человек ждёт у лифта'), option('На каком этаже кабина'),
    option('Прогноз времени ожидания'), option('Совет: ждать лифт или идти по лестнице'),
    option('Предупреждение о часе пик'),
    question(9, 'Где вам удобнее пользоваться таким сервисом?'),
    option('Telegram'), option('MAX'), option('Отдельное приложение'), option('Экран в холле'),
    question(10, 'Стали бы вы чаще выбирать лестницу, если бы знали, что лифта ждать долго?'),
    option('Да'), option('Скорее да'), option('Скорее нет'), option('Нет'),
    question(11, 'Готовы ли вы сообщать о проблемах с лифтом через приложение?'),
    option('Да'), option('Нет'), option('Зависит от того, реагируют ли на такие сообщения'),

    h2('Открытый вопрос'),
    question(12, 'Что ещё, по-вашему, должно быть в таком приложении?'),
    ...writeLines(4),

    p('Спасибо! Ваши ответы помогут сделать сервис полезным.', { align: AlignmentType.CENTER, indent: false, bold: true, after: 0 })
  ];

  return new Document(docOptions('TIU GO — опрос студентов', children));
}

// ---------- Документ 3: презентация ----------
function presentationDoc() {
  figureNo = 0;
  const i = D.INPUT;
  const c = calc;

  const slideTitle = (text) => new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 280, line: LINE, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text, font: FONT, size: 48, bold: true, color: ACCENT })]
  });

  const point = (text) => bullet(text, 28); // тезисы 14 pt

  /** Скриншот приложения, если он есть в screenshots/. */
  function shot(name, width = 190) {
    const file = path.join(D.ROOT, 'screenshots', name);
    if (!D.exists(file)) return null;
    return new ImageRun({
      data: fs.readFileSync(file),
      type: 'png',
      transformation: { width, height: Math.round(width * 1688 / 780) }
    });
  }

  const shots = ['main-dark.png', 'detail-dark.png', 'main-light.png']
    .map((n) => shot(n)).filter(Boolean);

  if (!shots.length) console.warn('[word] Скриншоты не найдены — в разделе «Демо» будет пометка');

  const demo = shots.length
    ? new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: shots })
    : p('[скриншот]', { align: AlignmentType.CENTER, indent: false, italics: true });

  const slides = [
    [ 'TIU GO', [
      'Мониторинг загруженности лифтов Тюменского индустриального университета',
      'Корпус 7, ул. Мельникайте, 70',
      'Мини-приложение для Telegram и MAX',
      'Проектная команда TIU GO, ' + new Date().getFullYear()
    ]],
    [ '1. Проблема', [
      `${i.elevators} лифтов на ${D.num(i.students)} человек в ${i.floors}-этажном корпусе`,
      'В перерывах между парами в холлах скапливаются очереди',
      'Человек у дверей не знает, где кабина и сколько людей ждёт выше',
      'Решение «ждать или идти пешком» принимается вслепую',
      `Среднее ожидание в пик — около ${i.waitBefore} секунд`,
      `Около ${Math.round(i.lateReduction * 100)}% опозданий на первую пару связаны с лифтом`
    ]],
    [ '2. Решение', [
      'Приложение показывает загруженность всех шести лифтов в реальном времени',
      'Видно: этаж кабины, сколько человек внутри, сколько ждёт в холле',
      'Прогноз времени ожидания в секундах',
      'Сравнение: доехать на лифте или подняться пешком',
      'Прямая рекомендация «Ждать» или «Лестница»',
      'Предупреждение о пиковых интервалах по расписанию пар',
      'Открывается из бота, ничего устанавливать не нужно'
    ]],
    [ '3. Как работает', [
      'Камеры в лифтовых холлах снимают зону ожидания',
      'Нейросеть YOLO считает людей на кадре, изображения не сохраняются',
      'Данные уходят по MQTT на сервер Node.js',
      'Сервер считает прогнозы и отдаёт их через REST API',
      'Мини-приложение обновляет картину раз в 3 секунды',
      'Вмешательство в лифтовое оборудование не требуется'
    ]],
    [ '4. Демо', []],
    [ '5. Целевая аудитория', [
      `Студенты корпуса 7 — около ${D.num(i.students)} человек`,
      'Преподаватели и сотрудники, перемещающиеся между кафедрами',
      'Маломобильные посетители, для которых лестница не альтернатива',
      'Абитуриенты и гости, незнакомые с логистикой корпуса',
      'Служба эксплуатации — получает объективную статистику нагрузки'
    ]],
    [ '6. Экономический эффект', [
      `Экономия ${c.savedPerStudentSec} секунд на человека в день`,
      `${D.num(c.savedPerDayHours, 1)} часов в день на всех пользователей`,
      `${D.num(c.savedPerYearHours)} часов за учебный год`,
      `Это ${D.num(c.savedPerYearManDays)} человеко-дней`,
      `Условная польза — ${D.rub(c.valuePerYear)} в год`,
      `Коэффициент полезности K = ${c.usefulness.toFixed(0)}`
    ]],
    [ '7. Затраты', [
      ...D.COSTS.map((x) => `${x.name}${x.qty > 1 ? ` (${x.qty} шт.)` : ''} — ${D.rub(x.qty * x.price)}`),
      `Итого — ${D.rub(c.totalCosts)}`,
      `Срок окупаемости — ${c.paybackMonths.toFixed(1)} месяца`
    ]],
    [ '8. Социальная значимость', [
      'Доступная среда: маломобильные посетители планируют подъём заранее',
      'Меньше давки у дверей в пиковые интервалы',
      'Часть потока осознанно выбирает лестницу',
      'Снижается износ кабин за счёт более ровной нагрузки',
      'Кампус получает сервис, сделанный собственными студентами'
    ]],
    [ '9. Масштабирование', [
      'Решение не привязано к марке лифта и работает на обычных камерах',
      '2026 — пилот в корпусе 7',
      '2027 — три корпуса ТИУ',
      '2028 — пять корпусов ТИУ и два других вуза',
      '2029 — десять вузов и первые коммерческие объекты',
      '2030 — десять корпусов ТИУ, 30 вузов, 25 коммерческих объектов'
    ]],
    [ '10. Обратная связь', [
      'В приложении есть форма жалобы на лифт',
      'Пять типовых причин: не работает, долго едет, шумит, грязно, другое',
      'Жалобы складываются в журнал на сервере',
      'Служба эксплуатации видит проблемы раньше, чем они станут массовыми',
      'Планируется опрос не менее 150 студентов для проверки гипотез'
    ]],
    [ '11. Дорожная карта', [
      'Этап 1 — натурные замеры, опрос, согласование доступа к камерам',
      'Этап 2 — сбор датасета, обучение и валидация детектора',
      'Этап 3 — контур телеметрии MQTT, пилот на одном лифте',
      'Этап 4 — масштабирование на шесть лифтов, развёртывание на инфраструктуре вуза',
      'Этап 5 — опытная эксплуатация в течение семестра',
      'Этап 6 — отчёт и предложение по тиражированию'
    ]],
    [ '12. Контакты', [
      'Проектная команда TIU GO',
      'Тюменский индустриальный университет',
      'Институт геологии и нефтегазодобычи',
      'Дисциплина «Проектная деятельность»',
      'Репозиторий и документация — в материалах проекта'
    ]]
  ];

  const children = [];
  slides.forEach(([title, points], idx) => {
    if (idx > 0) children.push(pageBreak());
    children.push(slideTitle(title));

    if (title === '4. Демо') {
      children.push(p('Главный экран, экран лифта и светлая тема:', { indent: false, size: 28 }));
      children.push(demo);
      children.push(point('Список лифтов и карточка каждого — в две колонки'));
      children.push(point('Экран лифта: камера, прогноз, сравнение с лестницей'));
      children.push(point('Тёмная и светлая темы, русский и английский языки'));
    } else {
      points.forEach((t) => children.push(point(t)));
    }
  });

  // Приложение с графиками
  children.push(pageBreak());
  children.push(slideTitle('Приложение. Графики'));
  [
    [D.CHARTS.time, 'Среднее время ожидания лифта в пик'],
    [D.CHARTS.lateness, 'Структура причин опозданий'],
    [D.CHARTS.costs, 'Структура затрат на внедрение'],
    [D.CHARTS.payback, 'Накопленная экономия и точка окупаемости'],
    [D.CHARTS.scaling, 'Прогноз масштабирования по годам']
  ].forEach(([file, title]) => {
    figure(file, title, 520, 312).forEach((node) => children.push(node));
  });

  return new Document(docOptions('TIU GO — презентация', children));
}

// ---------- Запуск ----------
async function main() {
  D.ensureDocsDir();
  applyMarkdownOverrides();

  const jobs = [
    ['Бизнес_расчеты_TIU_GO.docx', businessDoc],
    ['Опрос_студентов_TIU_GO.docx', surveyDoc],
    ['Презентация_TIU_GO.docx', presentationDoc]
  ];

  for (let n = 0; n < jobs.length; n += 1) {
    const [file, build] = jobs[n];
    console.log(`[word] Собираю документ ${n + 1}/${jobs.length}: ${file}…`);
    try {
      await save(build(), file);
    } catch (err) {
      console.error(`[word] Не удалось собрать ${file}: ${err.message}`);
    }
  }

  console.log('✅ Готово! Файлы в папке docs/');
}

main().catch((err) => {
  console.error('[word] Ошибка:', err.message);
  process.exit(1);
});
