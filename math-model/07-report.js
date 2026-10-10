/**
 * Отчёт по математической модели.
 *
 * Запускает все шесть моделей, собирает их результаты и графики
 * в документ Word: math-model/output/MATH_MODEL_REPORT.docx
 *
 * Запуск:  npm run math:report
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, LevelFormat,
  PageBreak, LineRuleType
} = require('docx');

const { PARAMS } = require('./params');
const physics = require('./04-elevator-physics');
const queueing = require('./01-queueing-model');
const simulation = require('./02-simulation');
const utility = require('./03-utility-model');
const sensitivity = require('./05-sensitivity');
const optimization = require('./06-optimization');

const OUT_DIR = path.join(__dirname, 'output');
const CHARTS_DIR = path.join(OUT_DIR, 'charts');
const FILE = 'MATH_MODEL_REPORT.docx';

const FONT = 'Times New Roman';
const SIZE = 24;       // 12 pt
const LINE = 360;      // полуторный интервал
const TABLE_WIDTH = 9600;
const ACCENT = '1F4E9C';
const GREY_FILL = 'EDEFF3';

let formulaNo = 0;
let figureNo = 0;

// ---------- Строительные блоки ----------

const p = (text, opts = {}) => new Paragraph({
  alignment: opts.align || AlignmentType.JUSTIFIED,
  spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: opts.after === undefined ? 120 : opts.after },
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
      children: [new TextRun({ text: String(text), font: FONT, size: 20, bold: !!opts.head })]
    })]
  });
}

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
        children: r.map((v, i) => cell(v, widths[i], { align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT }))
      }))
    ]
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
      children: [new ImageRun({ data: fs.readFileSync(full), type: 'png', transformation: { width, height } })]
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

const n = (v, d = 1) => Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Сборка документа ----------
function buildDocument(R) {
  const P = PARAMS;
  const children = [];
  const push = (...items) => items.forEach((x) => children.push(x));

  // ===== Титул =====
  push(
    new Paragraph({ spacing: { before: 2200 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Математическая модель системы TIU GO', font: FONT, size: 44, bold: true, color: ACCENT })] }),
    p('Мониторинг загруженности лифтов Тюменского индустриального университета',
      { align: AlignmentType.CENTER, indent: false, size: 28 }),
    p('Корпус 7, ул. Мельникайте, 70', { align: AlignmentType.CENTER, indent: false }),
    p('Проектная команда TIU GO', { align: AlignmentType.CENTER, indent: false }),
    p(String(new Date().getFullYear()), { align: AlignmentType.CENTER, indent: false }),
    pageBreak()
  );

  // ===== 1. Аннотация =====
  push(
    h1('1. Аннотация'),
    p(`Построена математическая модель лифтового узла корпуса 7: ${P.elevators} кабин, ` +
      `${P.floors} этажей, поток около ${P.studentsInBuilding * P.tripsPerStudentPerDay} поездок в учебный день. ` +
      'Использованы четыре взаимодополняющих метода: аналитическая модель массового обслуживания M/M/c, ' +
      'дискретно-событийная имитация методом Монте-Карло, модель дискретного выбора на основе функции ' +
      'полезности и физическая модель движения кабины.'),
    p('Цель — проверить количественно, даёт ли информирование пассажира измеримый эффект и за счёт чего ' +
      'именно. Модель показала, что лифты физически не способны обслужить пиковый поток, система ' +
      'саморегулируется уходом части людей на лестницу, и основная потеря времени приходится не на поездку, ' +
      'а на ожидание перед отказом от неё. Именно эту потерю устраняет приложение.')
  );

  // ===== 2. Постановка задачи =====
  push(
    h1('2. Постановка задачи'),
    h2('2.1. Описание системы'),
    bullet(`${P.elevators} лифтов вместимостью ${P.capacity} человек обслуживают ${P.floors}-этажный корпус.`),
    bullet(`В корпусе ${P.studentsInBuilding} человек, каждый совершает в среднем ${P.tripsPerStudentPerDay} поездки в день.`),
    bullet(`${Math.round(P.peakTrafficShare * 100)}% поездок приходится на четыре пика, привязанных к расписанию пар.`),
    bullet(`Альтернатива лифту — лестница: ${P.stairsTimePerFloor} секунд на этаж.`),

    h2('2.2. Цели моделирования'),
    bullet('Определить пропускную способность системы и сопоставить её с фактическим спросом.'),
    bullet('Оценить время ожидания в пиковые и спокойные часы.'),
    bullet('Предсказать, как люди распределяются между лифтом и лестницей.'),
    bullet('Измерить эффект информирования и найти оптимальное распределение потока.'),

    h2('2.3. Допущения'),
    bullet('Поток заявок — пуассоновский с интенсивностью, зависящей от времени суток.'),
    bullet('Этажи назначения независимы, нижние выбираются чаще (вес обратно пропорционален корню из номера этажа).'),
    bullet('Ускорение и торможение кабины учтены постоянной надбавкой к времени проезда этажа.'),
    bullet('Человек уходит на лестницу, когда ожидание делает её выгоднее лифта по функции полезности.'),
    bullet('Межэтажные перемещения не рассматриваются: все поездки начинаются с первого этажа.')
  );

  // ===== 3. Физическая модель =====
  const full = R.physics.full;
  push(
    pageBreak(),
    h1('3. Модель 1. Физика движения кабины'),
    p('Время проезда одного этажа складывается из равномерного хода и потерь на разгон и торможение:'),
    formula(`t_эт = h / v + t_раз = ${P.floorHeight} / ${P.elevatorSpeed} + ${P.accelerationTime} = ${n(R.physics.floorTime, 2)} с`),
    p('Число остановок зависит от того, сколько разных этажей выбрала группа пассажиров. ' +
      'Вероятность, что на этаже f никто не выйдет, равна (1 − p_f)^P, откуда ожидаемое число остановок:'),
    formula('S(P) = Σ_f [ 1 − (1 − p_f)^P ]'),
    p('Кабина поднимается до самого верхнего из выбранных этажей, поэтому в расчёт входит ожидаемый максимум:'),
    formula('E[H] = Σ_f f · [ F(f)^P − F(f−1)^P ]'),
    p('Полное время рейса — подъём и возврат, работа дверей на каждой остановке и посадка с высадкой:'),
    formula('T_рейс = 2 · (E[H] − 1) · t_эт + (S + 1) · t_дв + 2 · P · t_пас'),
    table(
      ['Пассажиров', 'Остановок', 'Верхний этаж', 'Рейс, с', 'Один лифт, чел/ч', 'Система, чел/ч'],
      R.physics.rows.map((r) => [r.passengers, n(r.stops, 2), n(r.highest), n(r.cycle), Math.round(r.perElevator), Math.round(r.system)]),
      [1700, 1600, 1900, 1500, 1500, 1400]
    ),
    ...figure('physics_cycle_time.png', 'Время рейса и пропускная способность системы'),
    p(`При полной кабине рейс занимает ${n(full.cycle)} секунд. Пропускная способность шести лифтов — ` +
      `${Math.round(full.system)} человек в час. Это ключевая величина: с ней сравнивается весь дальнейший спрос.`)
  );

  // ===== 4. Массовое обслуживание =====
  const q = R.queue;
  push(
    pageBreak(),
    h1('4. Модель 2. Массовое обслуживание (M/M/c)'),
    p(`Лифтовый холл рассматривается как система с c = ${q.c} каналами. Интенсивность обслуживания одного ` +
      'канала берётся из физической модели. Существенная деталь: в кабине едет сразу несколько человек, ' +
      'поэтому μ считается на пассажира, а не на рейс:'),
    formula(`μ = P / T_рейс = ${P.capacity} / ${n(full.cycle)} = ${n(q.mu, 4)} чел/с`),
    p('Вероятность застать все кабины занятыми даёт формула Эрланга C:'),
    formula('C(c, a) = [ a^c / (c!·(1−ρ)) ] / [ Σ_{k=0}^{c−1} a^k/k! + a^c / (c!·(1−ρ)) ],  a = λ/μ,  ρ = a/c'),
    p('Длина очереди, время ожидания и полное время в системе:'),
    formula('L_q = C · ρ / (1 − ρ),   W_q = L_q / λ,   W = W_q + 1/μ'),
    table(
      ['Интервал', 'λ, чел/ч', 'ρ', 'P_ожид', 'L_q', 'W_q, с'],
      q.rows.map((r) => [
        r.label,
        Math.round(r.lambda * 3600),
        n(r.res.rho, 2),
        r.res.stable ? n(r.res.pWait, 3) : '1,000',
        r.res.stable ? n(r.res.Lq, 2) : '∞',
        r.res.stable ? n(r.res.Wq) : `≈ ${Math.round(r.fluid.avgWait)}*`
      ]),
      [2600, 1500, 1200, 1400, 1400, 1500]
    ),
    p('* При ρ ≥ 1 формулы Эрланга неприменимы: стационарного режима не существует. Для таких интервалов ' +
      'показано среднее ожидание по детерминированной модели накопления очереди в предположении, что ' +
      'из очереди никто не уходит.', { size: 20 }),
    ...figure('queue_wq_vs_lambda.png', 'Рост очереди при приближении интенсивности к критической'),
    p(`Критическая интенсивность λ* = c·μ = ${n(q.nu, 4)} чел/с, то есть ${Math.round(q.nu * 3600)} человек в час. ` +
      `Вне пика поток составляет ${Math.round(q.rows[0].lambda * 3600)} чел/ч, и система устойчива: ρ = ${n(q.rows[0].res.rho, 2)}. ` +
      `В утренний пик поток достигает ${Math.round(q.rows[1].lambda * 3600)} чел/ч и превышает критический ` +
      `в ${n(q.rows[1].lambda / q.nu, 1)} раза.`),
    p('Главный вывод модели: шесть кабин физически не способны обслужить пиковый поток. Это не недостаток ' +
      'расчёта, а свойство объекта — и именно поэтому часть людей обязана уходить на лестницу. ' +
      'Вопрос не в том, пойдут ли они пешком, а в том, потеряют ли они время перед этим решением.')
  );

  // ===== 5. Имитационная модель =====
  const base = R.sim.base;
  const app = R.sim.app;
  push(
    pageBreak(),
    h1('5. Модель 3. Имитационное моделирование (Монте-Карло)'),
    h2('5.1. Алгоритм'),
    bullet(`Моменты прихода генерируются методом прореживания для неоднородного пуассоновского потока λ(t).`),
    bullet('Каждому человеку разыгрывается этаж назначения и порог терпения.'),
    bullet(`Лифт забирает из очереди до ${P.capacity} человек, время рейса считается по фактическим этажам группы.`),
    bullet('Человек, чьё ожидание превысило порог терпения, уходит на лестницу.'),
    bullet(`Проведено ${base.days} независимых прогонов учебного дня для каждого сценария.`),
    p('Порог терпения выводится из функции полезности приравниванием полезностей лифта и лестницы:'),
    formula('T_терп = T_лестн − T_поездки − T_посадки + (T_ref / w_t) · (w_к·ΔK − w_з·ΔЗ)'),

    h2('5.2. Результаты'),
    table(
      ['Показатель', 'Без приложения', 'С приложением', 'Изменение'],
      [
        ['Среднее ожидание ехавших, с', n(base.avgWait), n(app.avgWait), n(app.avgWait - base.avgWait)],
        ['Полное время подъёма, с/чел', n(base.avgTotalTime), n(app.avgTotalTime), n(app.avgTotalTime - base.avgTotalTime)],
        ['Потеряно в очереди впустую, с/чел', n(base.wastedPerPerson), n(app.wastedPerPerson), n(app.wastedPerPerson - base.wastedPerPerson)],
        ['Ушли на лестницу, %', n(base.stairsShare * 100), n(app.stairsShare * 100), n((app.stairsShare - base.stairsShare) * 100)],
        ['…из них сразу, без ожидания, %', n(base.immediateShare * 100), n(app.immediateShare * 100), n((app.immediateShare - base.immediateShare) * 100)],
        ['Максимальная очередь, чел', n(base.maxQueue), n(app.maxQueue), n(app.maxQueue - base.maxQueue)],
        ['Загрузка лифтов, %', n(base.utilization * 100), n(app.utilization * 100), n((app.utilization - base.utilization) * 100)]
      ],
      [3400, 2100, 2100, 2000]
    ),
    ...figure('sim_wait_distribution.png', `Распределение среднего ожидания по ${base.days} смоделированным дням`),
    table(
      ['Перцентиль', 'Без приложения, с', 'С приложением, с'],
      [
        ['P50', n(base.p50), n(app.p50)],
        ['P90', n(base.p90), n(app.p90)],
        ['P95', n(base.p95), n(app.p95)],
        ['P99', n(base.p99), n(app.p99)]
      ],
      [3200, 3200, 3200]
    ),
    p(`В 95% смоделированных дней среднее ожидание не превышает ${n(base.p95)} секунды без приложения ` +
      `и ${n(app.p95)} секунды с ним. Разброс между днями мал: при шести тысячах поездок в день ` +
      'среднее по дню устойчиво по центральной предельной теореме.'),
    ...figure('sim_queue_timeline.png', 'Длина очереди в течение дня'),
    p(`Очередь воспроизводит расписание пар: четыре всплеска в те же интервалы, что заложены в модель. ` +
      `Приложение снижает пиковую очередь с ${n(base.maxQueue)} до ${n(app.maxQueue)} человек. ` +
      `Главный эффект — не ускорение лифта, а то, что ${n(app.immediateShare * 100)}% людей принимают ` +
      `решение сразу, а не после ${n(base.wastedPerPerson)} секунд бесполезного ожидания.`)
  );

  // ===== 6. Функция полезности =====
  push(
    pageBreak(),
    h1('6. Модель 4. Функция полезности и выбор'),
    p('Человек сравнивает альтернативы по трём критериям: время, комфорт и польза для здоровья. ' +
      'Время нормируется на эталон T_ref, иначе слагаемые несопоставимы по масштабу — секунды ' +
      'исчисляются сотнями, а комфорт и здоровье заданы долями единицы:'),
    formula('U = − w_t · (T / T_ref) + w_к · K + w_з · З'),
    p('Выбор стохастический и описывается логит-моделью с температурой τ: чем меньше τ, тем ' +
      'последовательнее человек выбирает лучшую альтернативу.'),
    formula('P(лифт) = exp(U_лифт/τ) / [ exp(U_лифт/τ) + exp(U_лестн/τ) ]'),
    table(
      ['Этаж', 'T лифт, с', 'T лестница, с', 'U лифт', 'U лестница', 'P(лифт) вне пика', 'P(лифт) в пик'],
      R.utility.table.map((r) => [
        r.floor, n(r.tElevator), Math.round(r.tStairs), n(r.uElevator, 3), n(r.uStairs, 3),
        n(r.pOff * 100) + '%', n(r.pPeak * 100) + '%'
      ]),
      [900, 1400, 1700, 1300, 1500, 1500, 1300]
    ),
    ...figure('utility_choice_by_floor.png', 'Вероятность выбрать лифт в зависимости от этажа'),
    p('Серая штриховая линия — поведение без приложения: человек не знает реальной очереди и исходит ' +
      `из оптимистичной оценки в ${P.perceivedWaitNoApp} секунд. Красная линия — тот же человек, но видящий ` +
      'фактический прогноз. Расстояние между линиями и есть то, что добавляет приложение: оно не меняет ' +
      'предпочтений, оно меняет информированность.'),
    table(
      ['Следуют совету', 'Поток на лифты до, %', 'После, %', 'Снижение нагрузки, %'],
      R.utility.effects.map((e) => [
        Math.round(e.share * 100) + '%', n(e.withoutApp * 100), n(e.withApp * 100), n(e.reduction * 100)
      ]),
      [2400, 2600, 2300, 2300]
    ),
    ...figure('utility_load_reduction.png', 'Снижение нагрузки на лифты в пик')
  );

  // ===== 7. Чувствительность =====
  push(
    pageBreak(),
    h1('7. Анализ чувствительности'),
    p(`Каждый параметр варьировался в заданном диапазоне, остальные фиксировались. Показателем ` +
      `служило полное время подъёма на человека. Размах показателя внутри диапазона, отнесённый ` +
      `к базовому значению, служит мерой влияния параметра.`),
    table(
      ['Параметр', 'Диапазон', 'Размах показателя, %'],
      R.sensitivity.sorted.map((r) => [
        r.title,
        `${r.points[0].value} … ${r.points[r.points.length - 1].value}`,
        n(r.spread * 100)
      ]),
      [4200, 2700, 2700]
    ),
    ...figure('sens_tornado.png', 'Влияние параметров на время подъёма'),
    ...figure('sens_follow.png', 'Чувствительность к доле следующих рекомендации'),
    ...figure('sens_elevators.png', 'Чувствительность к числу лифтов'),
    p(`Самый влиятельный параметр — ${R.sensitivity.critical.title.toLowerCase()}. ` +
      'Этот результат важен для проекта: поведение людей управляет результатом сильнее, чем оборудование. ' +
      `Увеличение числа кабин с четырёх до восьми меняет показатель всего на ` +
      `${n(R.sensitivity.results.find((x) => x.key === 'elevators').spread * 100)}%, тогда как рост доли ` +
      `следующих совету с нуля до 90% — на ${n(R.sensitivity.results.find((x) => x.key === 'recommendationFollowRate').spread * 100)}%.`),
    p('Запас прочности по нагрузке у системы есть: при росте числа людей в корпусе с 1000 до 2500 ' +
      'время подъёма меняется слабо, потому что система саморегулируется — чем длиннее очередь, ' +
      'тем больше людей уходит на лестницу. Платой за эту устойчивость служит именно то время, ' +
      'которое они теряют перед уходом.')
  );

  // ===== 8. Оптимизация =====
  const opt = R.optimization;
  push(
    pageBreak(),
    h1('8. Оптимизация распределения потока'),
    p('Задача: распределить пиковый поток между лифтами и лестницей так, чтобы суммарное время ' +
      'подъёма было минимальным.'),
    formula('F(x) = N·x·T̄_лестн(x) + N·(1−x)·[ W(λ(1−x)) + T̄_поездки(x) ] → min'),
    p('Ожидание W оценивается единой формулой, работающей и при перегрузке, и в устойчивом режиме: ' +
      'детерминированная составляющая отвечает за накопление очереди, стохастическая — за колебания ' +
      'при докритической загрузке.'),
    formula('W(λ) = (λ − ν)·D / (2ν) при λ > ν,  плюс  W_q( min(λ, 0,95·ν) )'),
    table(
      ['Доля на лестницу, %', 'Ожидание, с', 'Время на человека, с', 'Суммарно, чел·ч'],
      [0, 0.2, 0.4, 0.6, 0.7, 0.77, 0.9].map((x) => {
        const r = optimization.totalTime(x, { smart: true });
        return [Math.round(x * 100), n(r.wait), n(r.perPerson), n(r.total / 3600)];
      }),
      [2600, 2300, 2400, 2300]
    ),
    ...figure('optimization_flow_split.png', 'Суммарное время подъёма при разных долях потока на лестнице'),
    p(`Оптимум достигается при ${Math.round(opt.best.share * 100)}% потока на лестнице, что соответствует ` +
      `правилу «пешком идут все, кому не выше ${Math.round(opt.best.thresholdFloor)}-го этажа». ` +
      `Время подъёма на человека составляет ${n(opt.best.perPerson)} секунды.`),
    p('Существенно, что оптимум системы лежит дальше, чем точка индивидуального безразличия: человек, ' +
      'уходящий на лестницу последним, проигрывает лично, но сокращает ожидание всем остальным. ' +
      'Это классическое расхождение пользовательского равновесия и системного оптимума, и оно означает, ' +
      'что добровольное информирование само по себе до оптимума не доводит — советы должны быть адресными.'),
    p(`Проверка правила отбора: если отправлять на лестницу случайных людей вместо тех, кто едет невысоко, ` +
      `лучший достижимый результат ухудшается с ${n(opt.best.perPerson)} до ${n(opt.random.best.perPerson)} секунды. ` +
      'Отсюда прямая рекомендация для приложения: советовать лестницу не всем подряд, а по этажу назначения — ' +
      'именно так и устроен экран лифта в TIU GO.')
  );

  // ===== 9. Выводы =====
  push(
    pageBreak(),
    h1('9. Общие выводы'),
    bullet(`Пропускная способность шести лифтов — ${Math.round(full.system)} чел/ч, тогда как спрос в утренний пик ` +
           `достигает ${Math.round(q.rows[1].lambda * 3600)} чел/ч. Дефицит пропускной способности составляет ` +
           `${n(q.rows[1].lambda / q.nu, 1)} раза и не устраняется организационными мерами.`),
    bullet('Система уже саморегулируется: люди уходят на лестницу, когда ожидание становится невыносимым. ' +
           'Но делают это вслепую, потеряв время на ожидание.'),
    bullet(`Имитация показывает, что информирование сокращает полное время подъёма с ${n(base.avgTotalTime)} ` +
           `до ${n(app.avgTotalTime)} секунд на человека (−${n(base.avgTotalTime - app.avgTotalTime)} с), ` +
           `а бесполезное ожидание — с ${n(base.wastedPerPerson)} до ${n(app.wastedPerPerson)} секунд.`),
    bullet('Анализ чувствительности показывает, что поведение людей влияет на результат сильнее, ' +
           'чем число кабин: вложения в информирование окупаются лучше, чем в оборудование.'),
    bullet(`Теоретический оптимум — ${Math.round(opt.best.share * 100)}% потока на лестнице с отбором по этажу; ` +
           'приложение приближает систему к нему, давая каждому персональный расчёт.'),
    h2('Рекомендации для внедрения'),
    bullet('Советовать лестницу адресно — по этажу назначения, а не всем подряд.'),
    bullet('Предупреждать о приближении пика заранее: сдвиг выхода на несколько минут эффективнее, чем выбор лестницы.'),
    bullet(`Добиваться доли следующих рекомендации выше ${Math.round(P.recommendationFollowRate * 100)}%: это главный управляемый параметр.`),
    bullet('Точность детекции выше 0,9 достаточна — дальнейшее её улучшение почти не влияет на результат.'),
    bullet('Проверить ключевые допущения натурными замерами: интенсивность потока, время подъёма по лестнице и терпение людей.')
  );

  // ===== 10. Приложение =====
  push(
    pageBreak(),
    h1('10. Приложение. Параметры модели'),
    table(
      ['Параметр', 'Значение', 'Единица'],
      [
        ['Этажей в корпусе', P.floors, 'эт'],
        ['Лифтов', P.elevators, 'шт'],
        ['Вместимость кабины', P.capacity, 'чел'],
        ['Высота этажа', P.floorHeight, 'м'],
        ['Скорость кабины', P.elevatorSpeed, 'м/с'],
        ['Разгон и торможение', P.accelerationTime, 'с'],
        ['Работа дверей', P.doorOpenTime, 'с'],
        ['Посадка одного человека', P.boardingTimePerPerson, 'с'],
        ['Подъём на этаж пешком', P.stairsTimePerFloor, 'с'],
        ['Людей в корпусе', P.studentsInBuilding, 'чел'],
        ['Поездок на человека в день', P.tripsPerStudentPerDay, 'шт'],
        ['Доля поездок в пики', Math.round(P.peakTrafficShare * 100) + '%', ''],
        ['Вес времени', P.utilityWeightTime, ''],
        ['Вес комфорта', P.utilityWeightComfort, ''],
        ['Вес здоровья', P.utilityWeightHealth, ''],
        ['Температура логита τ', P.rationality, ''],
        ['Эталон времени T_ref', P.referenceTime, 'с'],
        ['Оценка ожидания без приложения', P.perceivedWaitNoApp, 'с'],
        ['Точность детекции камер', P.cameraAccuracy, ''],
        ['Доля следующих рекомендации', P.recommendationFollowRate, ''],
        ['Прогонов Монте-Карло', P.simulationDays, 'дней']
      ],
      [4600, 2500, 2500]
    ),
    p('Все параметры собраны в файле math-model/params.js. Изменение значения там пересчитывает ' +
      'все шесть моделей и перестраивает отчёт.', { after: 0 })
  );

  return new Document({
    creator: 'TIU GO',
    title: 'Математическая модель TIU GO',
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 260 } } }
        }]
      }]
    },
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
      children
    }]
  });
}

// ---------- Запуск ----------
async function main() {
  fs.mkdirSync(CHARTS_DIR, { recursive: true });

  console.log('[report] Запускаю все модели…');
  console.log('');

  const R = {};
  R.physics = await physics.run();
  console.log('');
  R.queue = await queueing.run();
  console.log('');
  R.utility = await utility.run();
  console.log('');
  R.sim = await simulation.run();
  console.log('');
  R.sensitivity = await sensitivity.run();
  console.log('');
  R.optimization = await optimization.run();

  console.log('');
  console.log('[report] Собираю документ…');

  const doc = buildDocument(R);
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT_DIR, FILE), buf);

  console.log(`[report] Сохранил ${FILE} (${Math.round(buf.length / 1024)} КБ, формул: ${formulaNo}, рисунков: ${figureNo})`);
  console.log('✅ Готово! Результаты в math-model/output/');
}

module.exports = { buildDocument };

if (require.main === module) {
  main().catch((err) => { console.error('[report] Ошибка:', err.message); process.exit(1); });
}
