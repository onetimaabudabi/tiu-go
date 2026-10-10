/**
 * Отчёт по технической модели.
 *
 * Собирает результаты всех семи моделей в документ Word:
 * tech-model/output/TECH_MODEL_REPORT.docx
 *
 * Результаты берутся из output/data/*.json — их складывают туда сами
 * модели. Если какого-то файла нет, соответствующая модель запускается
 * прямо отсюда, поэтому отчёт можно собрать и в одиночку.
 *
 * Запуск:  npm run tech:report
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, LevelFormat,
  PageBreak, LineRuleType
} = require('docx');

const PARAMS = require('./params');
const io = require('./io');

const OUT_DIR = path.join(__dirname, 'output');
const CHARTS_DIR = path.join(OUT_DIR, 'charts');
const FILE = 'TECH_MODEL_REPORT.docx';

const FONT = 'Times New Roman';
const SIZE = 24;       // 12 pt
const LINE = 360;      // полуторный интервал
const TABLE_WIDTH = 9600;
const ACCENT = '1F4E9C';
const GREY_FILL = 'EDEFF3';

let formulaNo = 0;
let figureNo = 0;
let tableNo = 0;

// ---------- Строительные блоки ----------

const p = (text, opts = {}) => new Paragraph({
  alignment: opts.align || AlignmentType.JUSTIFIED,
  spacing: {
    line: LINE, lineRule: LineRuleType.AUTO,
    after: opts.after === undefined ? 120 : opts.after
  },
  indent: opts.indent === false ? undefined : { firstLine: 709 },
  children: [new TextRun({
    text, font: FONT, size: opts.size || SIZE,
    bold: !!opts.bold, italics: !!opts.italics, color: opts.color
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

/** Формула отдельной строкой, курсивом, с номером справа. */
function formula(text) {
  formulaNo += 1;
  return new Paragraph({
    spacing: { before: 140, after: 160, line: LINE, lineRule: LineRuleType.AUTO },
    tabStops: [{ type: 'right', position: 9000 }],
    children: [
      new TextRun({ text: '\t' + text + '\t', font: FONT, size: SIZE, italics: true }),
      new TextRun({ text: `(${formulaNo})`, font: FONT, size: SIZE })
    ]
  });
}

const bullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 80 },
  children: [new TextRun({ text, font: FONT, size: SIZE })]
});

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function cell(text, width, opts = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: opts.head ? { type: ShadingType.CLEAR, fill: GREY_FILL, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { line: 240, lineRule: LineRuleType.AUTO, after: 0 },
      children: [new TextRun({
        text: String(text === null || text === undefined ? '—' : text),
        font: FONT, size: 20, bold: !!opts.head
      })]
    })]
  });
}

function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'B6BCC8' };
  return new Table({
    columnWidths: widths,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    borders: {
      top: border, bottom: border, left: border, right: border,
      insideHorizontal: border, insideVertical: border
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, widths[i], { head: true }))
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((v, i) => cell(v, widths[i],
          { align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT }))
      }))
    ]
  });
}

/** Подпись к таблице — ставится ПЕРЕД ней, как требует ГОСТ. */
function tableCaption(title) {
  tableNo += 1;
  return new Paragraph({
    spacing: { before: 200, after: 80, line: LINE, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text: `Таблица ${tableNo} — ${title}`, font: FONT, size: 20 })]
  });
}

function caption(title) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200, line: LINE, lineRule: LineRuleType.AUTO },
    children: [new TextRun({
      text: `Рисунок ${figureNo}. ${title}`, font: FONT, size: 20, italics: true
    })]
  });
}

/** График по центру с подписью. Нет файла — ставим пометку, отчёт не ломается. */
function figure(file, title, width = 600, height = 360) {
  figureNo += 1;
  const full = path.join(CHARTS_DIR, file);

  if (!fs.existsSync(full)) {
    console.warn(`[report] Нет графика ${file} — вставляю пометку`);
    return [
      p(`[график: ${title}]`, { align: AlignmentType.CENTER, indent: false, italics: true }),
      caption(title)
    ];
  }

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 80 },
      children: [new ImageRun({
        data: fs.readFileSync(full), type: 'png', transformation: { width, height }
      })]
    }),
    caption(title)
  ];
}

const n = (v, d = 1) => (v === null || v === undefined ? '—'
  : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));

const pct = (v, d = 1) => (v === null || v === undefined ? '—' : n(v * 100, d) + ' %');

/** Относительное изменение со знаком: «+10,4 %» или «−17,2 %». */
const change = (before, after) => {
  if (!before) return '—';
  const delta = (after / before - 1) * 100;
  return (delta >= 0 ? '+' : '−') + n(Math.abs(delta)) + ' %';
};

// ---------- Сборка документа ----------

function buildDocument(R) {
  const E = PARAMS.elevators;
  const C = PARAMS.camera;
  const children = [];
  const push = (...items) => items.forEach((x) => children.push(x));

  // ===== Титул =====
  push(
    new Paragraph({
      spacing: { before: 2000 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'Математическая модель технической части системы TIU GO',
        font: FONT, size: 40, bold: true, color: ACCENT
      })]
    }),
    p('Камера в кабине и алгоритм диспетчеризации лифтов',
      { align: AlignmentType.CENTER, indent: false, size: 30 }),
    p('Тюменский индустриальный университет, корпус 7, ул. Мельникайте, 70',
      { align: AlignmentType.CENTER, indent: false }),
    p('Проектная команда TIU GO', { align: AlignmentType.CENTER, indent: false }),
    p(String(new Date().getFullYear()), { align: AlignmentType.CENTER, indent: false }),
    pageBreak()
  );

  // ===== 1. Аннотация =====
  push(
    h1('1. Аннотация'),
    p(`Построена математическая модель технической части системы TIU GO — камеры ` +
      `с детектором ${C.model} внутри кабины лифта и алгоритма, который по её ` +
      `показаниям решает, останавливаться ли на промежуточном этаже. Модель охватывает ` +
      `геометрию обзора камеры, статистику ошибок детекции, логику принятия решения, ` +
      `физику движения кабины и эффективность системы в целом.`),
    p(`Объект моделирования — лифтовый узел корпуса 7: ${E.total} лифтов, из которых ` +
      `работают ${E.working.length} (номера ${E.working.join(', ')}), ${PARAMS.building.floors} этажей, ` +
      `около ${R.sim.plan.total} поездок за учебный день. Четверть потока приходится ` +
      `на сорокаминутный обеденный пик.`),
    p(`Основной результат: система повышает пропускную способность в пиковый час ` +
      `на ${n(R.sim.gainPercent)} ± ${n(R.sim.gainSd)} %, сокращает среднее ожидание ` +
      `на ${n(R.sim.waitGainPercent)} % и убирает ${pct(1 - R.sim.withSystem.uselessStops / Math.max(R.sim.withoutSystem.uselessStops, 1), 0)} ` +
      `бесполезных остановок. Оптимальный запас мест в правиле принятия решения — ` +
      `${R.opt.optimum}.`),
    p('Социальная часть проекта — мобильное приложение, прогноз ожидания для пользователя ' +
      'и выбор между лифтом и лестницей — в этой работе не рассматривается и вынесена ' +
      'в отдельную модель.'),
    pageBreak()
  );

  // ===== 2. Постановка задачи =====
  push(
    h1('2. Постановка задачи'),
    h2('2.1. Описание системы'),
    p('В каждом работающем лифте под потолком кабины установлена камера, направленная ' +
      'вниз вдоль диагонали. Детектор считает людей в кабине. Когда лифт идёт мимо ' +
      'этажа, на котором горит вызов, система сравнивает оценку заполненности ' +
      'с вместимостью и решает:'),
    bullet('есть место — лифт останавливается, человек входит;'),
    bullet('мест нет — лифт проезжает мимо, не тратя время на бесполезную остановку.'),
    p('Смысл системы в том, что остановка стоит дорого. Полный цикл дверей занимает ' +
      `${R.physics.doorCycle} секунд, что сопоставимо с проездом ` +
      `${n(R.physics.doorCycle / R.physics.floorTravelTime)} этажей. Остановка у полной ` +
      'кабины не привозит ни одного человека, но отнимает это время у всех, кто уже едет.'),

    h2('2.2. Допущения'),
    bullet('Поток пассажиров пуассоновский внутри каждого пикового интервала.'),
    bullet('Этажи назначения независимы и распределены по наблюдённым долям.'),
    bullet('Камера читает счёт раз в секунду, усредняя показания по 30 кадрам.'),
    bullet('Детектор подтверждает человека тремя подряд идущими кадрами — так работают ' +
      'стандартные трекеры ByteTrack и DeepSORT.'),
    bullet('Перекрытия считаются постоянными в пределах секунды: человек, заслонённый ' +
      'соседом, заслонён во всех кадрах окна.'),
    bullet(`Вместимость кабины в расчётах принята равной ${E.capacityRealPeak} человек — ` +
      `это наблюдаемый пик, а не паспортные ${E.capacityPassport}.`),
    bullet('Лифты не координируются между собой: каждый принимает решения самостоятельно.'),

    h2('2.3. Обозначения'),
    tableCaption('Основные обозначения модели'),
    table(['Символ', 'Смысл', 'Значение'], [
      ['n', 'реально людей в кабине', '0…' + (E.capacityRealPeak + 2)],
      ['d', 'людей по оценке камеры', 'случайная величина'],
      ['C', 'вместимость кабины', String(E.capacityRealPeak)],
      ['m', 'запас мест в правиле решения', '0…4'],
      ['mAP₅₀', 'точность детектора', String(C.map50)],
      ['q_сист', 'доля систематически пропущенных людей', 'функция от n'],
      ['q_мерц', 'доля сорванных рамок за кадр', 'функция от n'],
      ['T_дв', 'полный цикл дверей, с', String(R.physics.doorCycle)],
      ['v, a', 'скорость и ускорение кабины', `${E.speed} м/с, ${E.acceleration} м/с²`]
    ], [1400, 5400, 2800]),
    pageBreak()
  );

  // ===== 3. Модель 1. Камера =====
  const cam = R.camera;
  push(
    h1('3. Модель 1. Камера в кабине'),
    h2('3.1. Геометрия обзора'),
    p(`Кабина лифта грузоподъёмностью ${E.payloadKg} кг имеет размеры ` +
      `${PARAMS.cabin.width} × ${PARAMS.cabin.depth} м, площадь пола ${n(cam.cabin.floorArea, 2)} м². ` +
      `Камера установлена на высоте ${C.mountingHeight} м, горизонтальный угол обзора ` +
      `${cam.fov.horizontal}°. Вертикальный угол выводится из соотношения сторон матрицы ` +
      `${C.resolution}:`),
    formula('tg(α_в / 2) = tg(α_г / 2) · (h_пикс / w_пикс) → α_в = ' + n(cam.fov.vertical) + '°'),
    p('Ключевая особенность геометрии: считать надо не пол, а плоскость голов на высоте ' +
      `${PARAMS.cabin.personHeight} м. До пола от камеры ${C.mountingHeight} м, а до голов — ` +
      `всего ${n(C.mountingHeight - PARAMS.cabin.personHeight, 1)} м, и тот же угол обзора ` +
      'покрывает там заметно меньшую площадь. Именно это, а не разрешение матрицы, ' +
      'ограничивает возможности счёта.'),
    p(`Подбор наклона оптической оси даёт оптимум ${cam.tilt.best}° вниз от горизонта: ` +
      `при нём камера видит ${pct(cam.tilt.headCoverage)} плоскости голов ` +
      `и ${pct(cam.tilt.floorCoverage)} пола. Слепая зона по головам — ` +
      `${pct(1 - cam.tilt.headCoverage)}, и приходится она на углы кабины у самой камеры.`),
    ...figure('camera_coverage_vs_tilt.png', 'Покрытие кабины в зависимости от наклона камеры'),

    h2('3.2. Вместимость кабины'),
    p('Сколько человек физически помещается в кабину, ограничивают три независимых фактора:'),
    tableCaption('Пределы вместимости кабины'),
    table(['Ограничение', 'Человек', 'Комментарий'], [
      [`Грузоподъёмность (${E.payloadKg} кг / ${PARAMS.people.avgWeightKg} кг)`,
        cam.capacity.byPayload, 'физический предел'],
      [`Давка (${cam.capacity.crushDensity} чел/м² × ${n(cam.capacity.floorArea, 2)} м²)`,
        cam.capacity.byCrush, 'физический предел'],
      [`Площадь силуэта (${PARAMS.people.avgAreaM2} м²/чел)`,
        cam.capacity.bySilhouette, `${cam.capacity.silhouetteDensity} чел/м² — нефизично`],
      ['Паспорт лифта', cam.capacity.declaredPassport, 'норматив'],
      ['Наблюдаемый пик', cam.capacity.declaredPeak, 'из наблюдений корпуса 7']
    ], [4200, 1800, 3600]),
    p(`Параметр средней площади силуэта (${PARAMS.people.avgAreaM2} м²) описывает человека ` +
      `В КАДРЕ, а не след на полу: как оценка вместимости он даёт ` +
      `${cam.capacity.silhouetteDensity} чел/м², что вдвое с лишним превышает предел давки. ` +
      `Связывающее ограничение — ${cam.capacity.binding} человек, и наблюдаемый пик ` +
      `в ${cam.capacity.declaredPeak} человек в него укладывается. Дальше в расчётах ` +
      `используется именно наблюдаемое значение.`),

    h2('3.3. Уверенность детекции'),
    p('Уверенность детектора падает с ростом числа людей по трём причинам: растут ' +
      'перекрытия, растёт теснота кадра, и постоянно мешает слабое освещение кабины:'),
    formula('conf(n) = mAP₅₀ − k_толпа·(n − 7)⁺ − k_перекр·(1 − e^(−(n−1)/3)) − k_свет'),
    p(`Поправка «n − 1» в показателе экспоненты существенна. В исходной постановке ` +
      `задачи стояло «n», из-за чего один человек в пустой кабине получал штраф ` +
      `за перекрытие, хотя перекрывать его там некому, и модель выходила ` +
      `пессимистичнее реальной. Переключатель остался в параметрах ` +
      `(camera.useCorrectedOcclusion).`),
    ...figure('camera_confidence.png', 'Уверенность детекции в зависимости от числа людей'),
    ...figure('camera_confidence_breakdown.png', 'Из чего складывается потеря точности'),
    p(`Вывод: надёжный счёт держится до ${cam.reliable.at70} человек (уверенность ≥ 0.70) ` +
      `и до ${cam.reliable.at60} человек на пороге 0.60. При большей загрузке счёт ` +
      `по кадру перестаёт быть измерением, и решение должно опираться на запас мест, ` +
      `а не на точное число.`),
    pageBreak()
  );

  // ===== 4. Модель 2. Ошибки детекции =====
  const err = R.errors;
  const full = err.distribution.find((d) => d.people === err.capacity) || err.distribution[err.distribution.length - 1];

  push(
    h1('4. Модель 2. Ошибки детекции'),
    p('Камера не измеряет число людей, а оценивает его, и ошибается в обе стороны. ' +
      'Ложное срабатывание (FP) заставит систему решить, что кабина полная, и проехать ' +
      'мимо ждущих. Пропуск человека (FN) заставит решить, что место есть, и ' +
      'остановиться там, где войти уже некуда.'),

    h2('4.1. Два источника ошибок'),
    p('Ошибки имеют принципиально разное происхождение, и это главное в модели.'),
    bullet('Перекрытия. Человек за спиной соседа не виден ни в одном кадре секунды. ' +
      'Ошибка систематическая.'),
    bullet('Мерцание. В тесной кабине уверенность падает, и рамка то появляется, ' +
      'то пропадает от кадра к кадру. Ошибка случайная.'),
    p(`Поэтому способ чтения счёта важнее самого детектора. Наивное усреднение числа ` +
      `рамок по ${err.framesPerWindow} кадрам смещает оценку вниз: мерцание ` +
      `вычитается из среднего. Трекинг с подтверждением (${err.trackMinHits} кадра подряд) ` +
      `мерцание гасит почти полностью — чтобы потерять человека, рамка должна ни разу ` +
      `не продержаться три кадра подряд за всю секунду.`),
    ...figure('errors_miss_split.png', 'Два источника ошибок ведут себя по-разному'),
    ...figure('errors_count_bias.png', 'Способ чтения счёта важнее самого детектора'),
    p(`При полной кабине (${full.people} человек) трекинг даёт смещение ${n(full.bias, 2)} ` +
      `человека против ${n(full.biasAveraged, 2)} у наивного усреднения — разница ` +
      `более чем вдвое. Остаточное смещение вызвано перекрытиями, и устранить его ` +
      `обработкой кадров невозможно.`),

    h2('4.2. Матрица ошибок'),
    p('Положительным классом считается «кабина полная, надо проезжать»:'),
    tableCaption('Матрица ошибок при равномерной загрузке кабины'),
    table(['', 'Решение «полная»', 'Решение «есть место»'], [
      ['Реально полная', `${n(err.matrix.TP, 4)} (TP)`, `${n(err.matrix.FN, 4)} (FN)`],
      ['Реально есть место', `${n(err.matrix.FP, 4)} (FP)`, `${n(err.matrix.TN, 4)} (TN)`]
    ], [3200, 3200, 3200]),
    ...figure('errors_decision_probability.png',
      'Ошибка решения максимальна у самого порога вместимости'),
    p(`Доля верных решений без запаса мест — ${pct(err.matrix.accuracy)}. Чаще чем ` +
      `в 5 % случаев система ошибается при загрузке ${err.errorOver5PercentAt.join(', ')} человек, ` +
      `то есть у самого порога: там отклонение оценки на одного человека переворачивает ` +
      `решение целиком. Отсюда главный вывод модели — сравнивать показания камеры ` +
      `с вместимостью напрямую нельзя, нужен запас мест.`),
    pageBreak()
  );

  // ===== 5. Модель 3. Алгоритм решения =====
  const dec = R.decision;
  push(
    h1('5. Модель 3. Алгоритм принятия решения'),
    h2('5.1. Правило'),
    formula('d + m ≥ C  →  проехать;   иначе  →  остановиться'),
    p(`где d — оценка камеры, m — запас мест, C = ${dec.capacity} — вместимость. ` +
      'Запас нужен не для красоты: модель 2 показала, что камера систематически ' +
      'недосчитывает людей. Без запаса система почти никогда не распознаёт полную ' +
      'кабину и тормозит там, где войти уже некому.'),

    h2('5.2. Разбор сценариев'),
    tableCaption('Поведение правила в характерных ситуациях (запас мест 0)'),
    table(['Реально', 'Камера', 'C', 'Решение', 'Итог'],
      dec.scenarios.map((s) => [s.real, s.detected, s.capacity, s.action,
        s.correct ? 'верно' : 'ошибка']),
      [1800, 1800, 1400, 2600, 2000]),
    p('Эталон здесь явный: останавливаться стоит тогда и только тогда, когда в кабину ' +
      'реально влезет хотя бы один человек. По нему девять человек из десяти — ещё ' +
      'не полная кабина, и проезд мимо засчитывается как ошибка, даже если на практике ' +
      'это разумный выбор. Ровно этот компромисс и настраивается запасом мест.'),

    h2('5.3. Пограничная зона'),
    p('Когда оценка колеблется вокруг порога, решение переворачивается от секунды ' +
      'к секунде, и лифт начинает «метаться». Сравнение трёх способов с этим справиться:'),
    tableCaption('Способы пройти пограничную зону'),
    table(['Правило', 'Точность', 'Ошибка FP', 'Ошибка FN', 'Дребезг'],
      dec.rules.map((r) => [r.label, n(r.accuracy, 3), n(r.wrongPass, 3),
        n(r.wrongStop, 3), n(r.flipRate, 3)]),
      [2800, 1700, 1700, 1700, 1700]),
    ...figure('decision_rules_compare.png',
      'Монетка в пограничной зоне дребезг создаёт, а не гасит'),
    p('Результат заслуживает отдельного внимания. Розыгрыш решения монеткой внутри ' +
      'пограничной зоны, предложенный в исходной постановке, дребезг не гасит, ' +
      'а создаёт: каждое попадание в зону — это новый бросок. Настоящий гистерезис ' +
      'в той же зоне СОХРАНЯЕТ предыдущее решение и переключается, только когда ' +
      `оценка выходит за её границу. Дребезг падает с ${n(dec.rules[1].flipRate, 3)} ` +
      `до ${n(dec.rules[2].flipRate, 3)} — более чем на порядок. Во всех дальнейших ` +
      'расчётах используется гистерезис.'),

    h2('5.4. Какая точность камеры нужна'),
    ...figure('decision_vs_map50.png', 'Камеру и запас мест нужно настраивать вместе'),
    tableCaption('Точность решений в зависимости от качества детектора'),
    table(['mAP₅₀', 'Запас подобран', 'Запас зафиксирован'],
      dec.quality.map((q) => [q.map50, n(q.accuracy, 3), n(q.accuracyFixedMargin, 3)]),
      [3200, 3200, 3200]),
    p(`При подобранном под камеру запасе порог в 95 % верных решений достигается ` +
      `уже при mAP₅₀ = ${dec.enoughAt ?? '—'}, то есть требования к детектору умеренные. ` +
      'Второй столбец показывает обратное: при зафиксированном запасе точность ' +
      'с ростом качества камеры не растёт, а падает. Это не парадокс — запас подобран ' +
      'под недосчёт конкретного детектора, и камеру с запасом надо настраивать вместе.'),
    pageBreak()
  );

  // ===== 6. Модель 4. Физика =====
  const ph = R.physics;
  const peakMode = ph.modes[ph.modes.length - 1];
  push(
    h1('6. Модель 4. Физика движения с учётом решений'),
    h2('6.1. Кинематика'),
    p('Время проезда считается по трапецеидальному профилю скорости: разгон, ' +
      'движение с номинальной скоростью, торможение.'),
    formula('t = (d − v²/a) / v + 2·v/a,   при d ≥ v²/a'),
    formula('t = 2·√(d/a),   при d < v²/a (кабина не успевает разогнаться)'),
    p(`Один этаж (${PARAMS.building.floorHeight} м) проезжается за ` +
      `${n(ph.floorTravelTime, 1)} с. Полный цикл дверей — ${ph.doorCycle} с. ` +
      `Иначе говоря, одна остановка стоит столько же, сколько проезд ` +
      `${n(ph.doorCycle / ph.floorTravelTime)} этажей, и если она пришлась ` +
      'на полную кабину, то не привозит никого.'),

    h2('6.2. Время рейса'),
    formula('T_рейс = T_движение + N_ост · T_дв + P · t_посадка · 2'),
    ...figure('physics_trip_breakdown.png', 'Время рейса: двери дороже движения'),

    h2('6.3. Пропускная способность'),
    formula('Q = C / T_рейс · N_лифтов · 3600'),
    tableCaption('Сравнение режимов при разной загрузке кабины'),
    table(['Загрузка', 'Рейс без, с', 'Рейс с, с', 'Без, чел/ч', 'С системой, чел/ч', 'Прирост'],
      ph.modes.map((m) => [m.meanOccupancy, n(m.without.total), n(m.withSystem.total),
        n(m.throughputWithout, 0), n(m.throughputWith, 0), n(m.gainPercent) + ' %']),
      [1400, 1700, 1600, 1700, 1700, 1500]),
    ...figure('physics_throughput.png', 'Пропускная способность трёх лифтов'),
    p(`Вне пика система почти не вмешивается: мест хватает, проезжать мимо незачем. ` +
      `В пик при загрузке ${peakMode.meanOccupancy} человек она отсекает ` +
      `${n(peakMode.skippedPerTrip, 2)} бесполезных остановок за рейс и поднимает ` +
      `пропускную способность на ${n(peakMode.gainPercent)} % — ` +
      `с ${n(peakMode.throughputWithout, 0)} до ${n(peakMode.throughputWith, 0)} чел/ч ` +
      `на ${ph.workingElevators} работающих лифта.`),
    ...figure('physics_gain_vs_calls.png',
      'Выигрыш растёт вместе с числом промежуточных вызовов'),
    pageBreak()
  );

  // ===== 7. Модель 5. Эффективность =====
  const eff = R.effect;
  push(
    h1('7. Модель 5. Эффективность системы'),
    p('Решение «проехать мимо» — бинарная классификация, и оценивать её надо ' +
      'соответствующими метриками:'),
    formula('precision = TP / (TP + FP),   recall = TP / (TP + FN),   F1 = 2PR / (P + R)'),
    tableCaption('Метрики по условиям работы'),
    table(['Условие', 'Полная кабина', 'Accuracy', 'Precision', 'Recall', 'F1'],
      eff.conditions.map((c) => [c.label, n(c.baseRate, 3), n(c.accuracy, 3),
        c.interpretable ? n(c.precision, 3) : '—',
        c.interpretable ? n(c.recall, 3) : '—',
        c.interpretable ? n(c.f1, 3) : '—']),
      [2600, 1800, 1300, 1300, 1300, 1300]),
    p('Столбец «полная кабина» показывает, как часто она вообще бывает полной. ' +
      'Вне пика это доли процента: положительного класса практически нет, и ' +
      'precision, recall и F1 там считать не от чего. Такие условия честнее ' +
      'оценивать точностью и долей ложных проездов — и по ним система вне пика ' +
      'практически не вмешивается, что и требуется.'),
    ...figure('effect_metrics_by_condition.png', 'Качество решений в разных условиях'),

    h2('7.1. Цена ошибок'),
    p('Ошибки стоят по-разному, и это определяет настройку системы.'),
    tableCaption('Цена ошибочных решений'),
    table(['Ошибка', 'Что происходит', 'Цена'], [
      ['FN', 'остановились у полной кабины',
        `${eff.errorCost.falseNegativeSeconds} с для всех, кто внутри`],
      ['FP', 'проехали мимо свободного места',
        `≈ ${eff.errorCost.falsePositiveSeconds} с ожидания следующего рейса`]
    ], [1400, 4600, 3600]),
    p(`Цена ложного проезда примерно в ${n(eff.errorCost.falsePositiveSeconds / eff.errorCost.falseNegativeSeconds, 0)} ` +
      'раз выше цены лишней остановки. Отсюда правило настройки: при сомнении лучше ' +
      'остановиться, то есть precision здесь важнее recall.'),
    ...figure('effect_time_saving.png', 'Время рейса: весь выигрыш приходится на пик'),
    pageBreak()
  );

  // ===== 8. Симуляция дня =====
  const sim = R.sim;
  push(
    h1('8. Симуляция учебного дня'),
    p(`Три работающих лифта возят людей с ${PARAMS.simulation.dayStart}:00 ` +
      `до ${PARAMS.simulation.dayEnd}:00. Поток неравномерный: четверть всех ` +
      `${sim.plan.total} поездок приходится на сорокаминутный обеденный пик. ` +
      `Каждый день разыгрывается дважды — с системой и без неё — на одних и тех же ` +
      `приходах людей, так что разница объясняется только правилом остановки. ` +
      `Всего ${sim.runs} прогонов.`),
    tableCaption('Результаты ' + sim.runs + ' прогонов учебного дня'),
    table(['Показатель', 'Без системы', 'С системой', 'Изменение'], [
      ['Пропускная способность в пиковый час, чел',
        n(sim.withoutSystem.peakThroughput.mean, 0), n(sim.withSystem.peakThroughput.mean, 0),
        change(sim.withoutSystem.peakThroughput.mean, sim.withSystem.peakThroughput.mean)],
      ['Среднее ожидание, с', n(sim.withoutSystem.avgWait), n(sim.withSystem.avgWait),
        change(sim.withoutSystem.avgWait, sim.withSystem.avgWait)],
      ['Ожидание, 95-й перцентиль, с', n(sim.withoutSystem.p95Wait), n(sim.withSystem.p95Wait),
        change(sim.withoutSystem.p95Wait, sim.withSystem.p95Wait)],
      ['Самая длинная очередь, чел', sim.withoutSystem.maxQueue, sim.withSystem.maxQueue,
        change(sim.withoutSystem.maxQueue, sim.withSystem.maxQueue)],
      ['Остановок за день', sim.withoutSystem.stops, sim.withSystem.stops,
        change(sim.withoutSystem.stops, sim.withSystem.stops)],
      ['Бесполезных остановок за день', sim.withoutSystem.uselessStops,
        sim.withSystem.uselessStops,
        change(sim.withoutSystem.uselessStops, sim.withSystem.uselessStops)]
    ], [3800, 1900, 1900, 2000]),
    p(`За сутки все ${sim.plan.total} поездок увозятся в обоих режимах: средний спрос ` +
      `${n(sim.withoutSystem.dayThroughput, 0)} чел/ч, и за двенадцать часов очередь ` +
      'рассасывается даже без системы. Поэтому суточное среднее ничего не говорит ' +
      'о возможностях лифтов — смотреть надо на пиковый час, длину очереди и ожидание.'),
    ...figure('sim_throughput_hist.png',
      'Распределение пропускной способности в пиковый час за ' + sim.runs + ' дней'),
    ...figure('sim_decisions_by_hour.png',
      'Решения системы по часам: проезды концентрируются в пиках'),
    tableCaption('Решения системы за день'),
    table(['Показатель', 'Значение'], [
      ['Проездов мимо этажа', sim.withSystem.passes],
      ['из них обоснованных', sim.withSystem.passCorrect],
      ['из них ошибочных (FP)', sim.withSystem.passWrong],
      ['Доля обоснованных проездов', pct(sim.passAccuracy)],
      ['Бесполезных остановок (FN)', sim.withSystem.uselessStops]
    ], [6400, 3200]),
    pageBreak()
  );

  // ===== 9. Оптимизация =====
  const opt = R.opt;
  push(
    h1('9. Подбор запаса мест'),
    p('Запас мест — единственный настраиваемый параметр логики. Чем он больше, тем ' +
      'увереннее система распознаёт полные кабины и тем чаще проезжает мимо тех, кто ' +
      'ещё мог бы войти.'),
    tableCaption('Операционные показатели при разном запасе мест'),
    table(['Запас', 'Ожидание всего, с', 'с 1-го этажа, с', 'с промежуточных, с',
      'Пиковый час', 'Очередь'],
      opt.operational.map((r) => [r.margin, n(r.avgWait), n(r.avgWaitLobby),
        n(r.avgWaitUpper), r.peakThroughput, r.maxQueue]),
      [1200, 2000, 1900, 2100, 1300, 1100]),
    p('Критерий выбора требует оговорки. Общее среднее ожидание с ростом запаса падает ' +
      'монотонно, но падает оно за счёт первого этажа, где лифт берёт всех подряд ' +
      'и никого не проезжает. Страдает ровно противоположная группа — те, кто ждёт ' +
      'на промежуточных этажах, и в общем среднем их беда тонет. Поэтому запас ' +
      'оценивается по той группе, судьбу которой он и решает.'),
    ...figure('optimize_wait_throughput.png',
      'Запас мест: первый этаж выигрывает, промежуточные — нет'),
    tableCaption('Ошибочные решения при разном запасе мест'),
    table(['Запас', 'Проездов', 'Зря проехал (FP)', 'Зря встал (FN)', 'Доля верных проездов'],
      opt.operational.map((r) => [r.margin, r.passes, r.wrongPasses, r.uselessStops,
        pct(r.passAccuracy)]),
      [1400, 1900, 2300, 2100, 2300]),
    ...figure('optimize_error_tradeoff.png', 'Запас мест меняет один вид ошибок на другой'),
    p(`Оптимум: запас мест = ${opt.optimum}. При нём ожидание на промежуточных этажах ` +
      `минимально (${n(opt.optimumDetails.avgWaitUpper)} с против ` +
      `${n(opt.baseline.avgWaitUpper)} с без запаса), пропускная способность в пиковый час ` +
      `не проседает (${opt.optimumDetails.peakThroughput} чел), бесполезных остановок ` +
      `остаётся ${opt.optimumDetails.uselessStops} вместо ${opt.baseline.uselessStops}, ` +
      `а доля обоснованных проездов составляет ${pct(opt.optimumDetails.passAccuracy)}.`),
    pageBreak()
  );

  // ===== 10. Выводы =====
  push(
    h1('10. Итоговые выводы'),
    h2('10.1. Что даёт система'),
    bullet(`Пропускная способность в пиковый час растёт на ${n(sim.gainPercent)} ± ${n(sim.gainSd)} %: ` +
      `с ${n(sim.withoutSystem.peakThroughput.mean, 0)} до ${n(sim.withSystem.peakThroughput.mean, 0)} человек.`),
    bullet(`Среднее ожидание сокращается на ${n(sim.waitGainPercent)} % — ` +
      `с ${n(sim.withoutSystem.avgWait)} до ${n(sim.withSystem.avgWait)} секунд.`),
    bullet(`Бесполезных остановок становится ${sim.withSystem.uselessStops} вместо ` +
      `${sim.withoutSystem.uselessStops} за день.`),
    bullet(`Доля обоснованных проездов — ${pct(sim.passAccuracy)}.`),

    h2('10.2. Чем ограничена система'),
    bullet('Перекрытия в кабине — главное ограничение. Никакая обработка кадров их ' +
      'не убирает: заслонённый человек заслонён во всех тридцати кадрах секунды.'),
    bullet(`Точность счёта падает быстро: вероятность ошибиться превышает 10 % ` +
      `уже при ${err.errorOver10Percent ?? '—'} людях в кабине.`),
    bullet('Весь выигрыш приходится на пик. Вне пика система корректно не вмешивается, ' +
      'но и пользы не приносит — там узкое место не в остановках, а в числе лифтов.'),
    bullet(`Три работающих лифта из ${E.total} не справляются с обеденным пиком ` +
      `ни с системой, ни без неё: очередь достигает ${sim.withSystem.maxQueue} человек. ` +
      'Система смягчает перегрузку, но не устраняет её причину.'),

    h2('10.3. Рекомендации по настройке'),
    bullet(`Наклон камеры ${cam.tilt.best}° вниз от горизонта: при нём в кадр попадает ` +
      `${pct(cam.tilt.headCoverage)} плоскости голов.`),
    bullet(`Читать счёт трекингом с подтверждением ${err.trackMinHits} кадра подряд, ` +
      'а не усреднением числа рамок: смещение оценки уменьшается более чем вдвое.'),
    bullet('Применять гистерезис в пограничной зоне, а не случайный выбор: ' +
      'дребезг решений падает более чем на порядок.'),
    bullet(`Запас мест в правиле решения: ${opt.optimum}.`),
    bullet(`Требования к детектору умеренные: при подобранном запасе достаточно ` +
      `mAP₅₀ = ${dec.enoughAt ?? C.map50}. Вкладываться в более точную модель смысла ` +
      'нет — упирается не детектор, а геометрия перекрытий.'),
    bullet('Вторая камера с другого ракурса устранила бы основную часть перекрытий — ' +
      'это единственный способ существенно поднять точность счёта.'),
    pageBreak()
  );

  // ===== 11. Приложение =====
  push(
    h1('11. Приложение. Параметры модели'),
    tableCaption('Здание и лифты'),
    table(['Параметр', 'Значение'], [
      ['Корпус', PARAMS.building.name],
      ['Этажей', PARAMS.building.floors],
      ['Высота этажа, м', PARAMS.building.floorHeight],
      ['Лифтов всего / работает', `${E.total} / ${E.working.length} (№ ${E.working.join(', ')})`],
      ['Вместимость: паспорт / обычная / пик',
        `${E.capacityPassport} / ${E.capacityRealNormal} / ${E.capacityRealPeak}`],
      ['Грузоподъёмность, кг', E.payloadKg],
      ['Скорость / ускорение', `${E.speed} м/с / ${E.acceleration} м/с²`],
      ['Двери: открытие / удержание / закрытие, с',
        `${E.doorOpenTime} / ${E.doorHoldTime} / ${E.doorCloseTime}`],
      ['Посадка одного человека, с', E.boardingTimePerPerson]
    ], [5600, 4000]),

    tableCaption('Камера и детектор'),
    table(['Параметр', 'Значение'], [
      ['Модель детекции', C.model],
      ['Разрешение / частота кадров', `${C.resolution} / ${C.fps} FPS`],
      ['Угол обзора (гор. / верт.)', `${C.fovDegrees}° / ${n(cam.fov.vertical)}°`],
      ['Высота установки, м', C.mountingHeight],
      ['mAP₅₀', C.map50],
      ['Ложные срабатывания / пропуски', `${pct(C.falsePositiveRate, 0)} / ${pct(C.falseNegativeRate, 0)}`],
      ['Задержка кадра, мс', C.detectionLatency],
      ['Штрафы: перекрытия / темнота / толпа',
        `${C.occludedPersonPenalty} / ${C.darknessPenalty} / ${C.crowdPenalty}`]
    ], [5600, 4000]),

    tableCaption('Поток людей'),
    table(['Параметр', 'Значение'], [
      ['Студентов / сотрудников', `${PARAMS.people.students} / ${PARAMS.people.staff}`],
      ['Поездок на человека за день', PARAMS.simulation.tripsPerPersonPerDay],
      ['Всего поездок за день', sim.plan.total],
      ['Доля поездок с первого этажа', pct(PARAMS.simulation.lobbyShare, 0)],
      ['Средний вес человека, кг', PARAMS.people.avgWeightKg],
      ['Прогонов симуляции', PARAMS.simulation.runs],
      ['Зерно генератора', PARAMS.simulation.randomSeed]
    ], [5600, 4000]),

    tableCaption('Пиковые интервалы'),
    table(['Интервал', 'Время', 'Доля потока', 'Поездок'],
      PARAMS.peakIntervals.map((pk, i) => [pk.label, `${pk.start}–${pk.end}`,
        pct(pk.weight, 0), sim.plan.intervals[i].people]),
      [3800, 2200, 1800, 1800])
  );

  return new Document({
    creator: 'TIU GO',
    title: 'Математическая модель технической части системы TIU GO',
    description: 'Камера в кабине и алгоритм диспетчеризации лифтов',
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '—', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 709, hanging: 283 } } }
        }]
      }]
    },
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE } }
      }
    },
    sections: [{
      properties: {
        page: { margin: { top: 1134, right: 850, bottom: 1134, left: 1701 } }
      },
      children
    }]
  });
}

// ---------- Сбор результатов ----------

/**
 * Берёт результат модели из output/data, а если его там нет —
 * запускает саму модель. Так отчёт собирается и после tech:all,
 * и в одиночку.
 */
async function need(name, modulePath) {
  const cached = io.loadData(name);
  if (cached) return cached;

  console.log(`[report] Нет output/data/${name}.json — запускаю модель…`);
  return require(modulePath).run();
}

async function main() {
  console.log('[report] Собираю результаты моделей…');

  const R = {
    camera: await need('01-camera', './01-camera-model'),
    errors: await need('02-errors', './02-detection-errors'),
    decision: await need('03-decision', './03-decision-logic'),
    physics: await need('04-physics', './04-elevator-physics'),
    effect: await need('05-effectiveness', './05-effectiveness'),
    sim: await need('06-simulation', './06-simulation'),
    opt: await need('07-optimization', './07-optimization')
  };

  console.log('[report] Собираю документ…');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const doc = buildDocument(R);
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, FILE), buf);

  console.log(`[report] Сохранил ${FILE} (${Math.round(buf.length / 1024)} КБ, ` +
    `формул: ${formulaNo}, рисунков: ${figureNo}, таблиц: ${tableNo})`);
}

module.exports = { buildDocument, main };

if (require.main === module) {
  main().catch((err) => { console.error('[report] Ошибка:', err.message); process.exit(1); });
}
