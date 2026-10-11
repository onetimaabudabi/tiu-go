/**
 * TIU GO — проверка согласованности параметров.
 *
 * Берёт shared/params.json за эталон и смотрит, видят ли то же самое
 * три потребителя: техническая модель, математическая модель и данные
 * приложения. Расхождение здесь означает, что на защите две модели
 * посчитают разный объект.
 *
 * Четвёртый потребитель — 3D-визуализация — отдельной колонки не имеет:
 * она не читает shared/params.json сама, а целиком получает
 * tech-model/params.js через виртуальный модуль Vite (3d-sim/vite.config.mjs).
 * Поэтому колонка tech отвечает и за неё.
 *
 * Запуск: npm run check:params
 */

const path = require('path');

const base = require('../shared/params.json');
const tech = require('../tech-model/params.js');
const math = require('../math-model/params.js');
const mock = require('../shared/data/mockData.js');

// ---------- Оформление ----------

const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const OFF = '\u001b[0m';

const colorOn = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colorOn ? code + text + OFF : text);

/** Ширина строки без управляющих последовательностей. */
function width(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '').length;
}

function pad(text, n, right = false) {
  const gap = ' '.repeat(Math.max(0, n - width(text)));
  return right ? gap + text : text + gap;
}

// ---------- Что сравниваем ----------
//
// Для каждого параметра: как его достать из эталона и из каждого
// потребителя. null означает «этот потребитель про такой параметр
// ничего не знает» — это не расхождение.

const mockLifts = mock.getAdminElevators();

const CHECKS = [
  {
    name: 'floors',
    base: () => base.building.floors,
    tech: () => tech.building.floors,
    math: () => math.PARAMS.floors,
    mock: () => mock.FLOORS
  },
  {
    name: 'elevators.total',
    base: () => base.elevators.total,
    tech: () => tech.elevators.total,
    math: () => math.PARAMS.elevatorsTotal,
    mock: () => mockLifts.length
  },
  {
    name: 'elevators.working.length',
    base: () => base.elevators.working.length,
    tech: () => tech.elevators.working.length,
    math: () => math.PARAMS.elevators,
    mock: () => mockLifts.filter((l) => l.status === 'working').length
  },
  {
    name: 'elevators.capacityRealPeak',
    base: () => base.elevators.capacityRealPeak,
    tech: () => tech.elevators.capacityRealPeak,
    math: () => math.PARAMS.capacity,
    mock: () => mock.CAPACITY
  },
  {
    name: 'people.students',
    base: () => base.people.students,
    tech: () => tech.people.students,
    math: () => null,   // социальная модель считает население одним числом
    mock: () => null    // приложению население неизвестно
  },
  {
    name: 'people.staff',
    base: () => base.people.staff,
    tech: () => tech.people.staff,
    math: () => null,
    mock: () => null
  },
  {
    name: 'people.students + staff',
    base: () => base.people.students + base.people.staff,
    tech: () => tech.people.students + tech.people.staff,
    math: () => math.PARAMS.studentsInBuilding,
    mock: () => null
  },
  {
    name: 'people.tripsPerPersonPerDay',
    base: () => base.people.tripsPerPersonPerDay,
    tech: () => tech.people.tripsPerPersonPerDay,
    math: () => math.PARAMS.tripsPerStudentPerDay,
    mock: () => null
  },
  {
    name: 'elevators.speed',
    base: () => base.elevators.speed,
    tech: () => tech.elevators.speed,
    math: () => math.PARAMS.elevatorSpeed,
    mock: () => null
  },
  {
    name: 'elevators.acceleration',
    base: () => base.elevators.acceleration,
    tech: () => tech.elevators.acceleration,
    // Социальная модель держит не само ускорение, а потерю времени
    // на разгон и торможение: v/a. При v = a это то же число.
    math: () => math.PARAMS.elevatorSpeed / math.PARAMS.accelerationTime,
    mock: () => null
  },
  {
    name: 'двери: цикл остановки',
    base: () => base.elevators.doorOpenTime + base.elevators.doorHoldTime +
      base.elevators.doorCloseTime,
    tech: () => tech.elevators.doorOpenTime + tech.elevators.doorHoldTime +
      tech.elevators.doorCloseTime,
    math: () => math.PARAMS.doorCycleTime,
    mock: () => null
  },
  {
    name: 'elevators.boardingTimePerPerson',
    base: () => base.elevators.boardingTimePerPerson,
    tech: () => tech.elevators.boardingTimePerPerson,
    math: () => math.PARAMS.boardingTimePerPerson,
    mock: () => null
  },
  {
    name: 'elevators.doorWidth',
    base: () => base.elevators.doorWidth,
    tech: () => tech.elevators.doorWidth,
    math: () => null,   // ширина проёма нужна только геометрии
    mock: () => null
  },
  {
    name: 'people.stairsTimePerFloor',
    base: () => base.people.stairsTimePerFloor,
    tech: () => tech.people.stairsTimePerFloor,
    math: () => math.PARAMS.stairsTimePerFloor,
    mock: () => null
  },
  {
    name: 'people.walkSpeed',
    base: () => base.people.walkSpeed,
    tech: () => tech.people.walkSpeed,
    math: () => null,   // скорость шага нужна 3D-визуализации
    mock: () => null
  },
  {
    name: 'people.patienceSeconds',
    base: () => base.people.patienceSeconds,
    tech: () => tech.people.patienceSeconds,
    math: () => null,
    mock: () => null
  }
];

// ---------- Сравнение ----------

function read(fn) {
  try {
    const v = fn();
    return v === null || v === undefined ? null : v;
  } catch (err) {
    return { error: err.message };
  }
}

const rows = CHECKS.map((check) => {
  const expected = read(check.base);
  const actual = {
    tech: read(check.tech),
    math: read(check.math),
    mock: read(check.mock)
  };

  // Сравниваем только там, где потребитель вообще знает про параметр
  const mismatched = Object.entries(actual)
    .filter(([, v]) => v !== null)
    .filter(([, v]) => (v && v.error) || v !== expected)
    .map(([who]) => who);

  return { name: check.name, expected, ...actual, mismatched };
});

// ---------- Вывод ----------

function show(value) {
  if (value === null) return paint(DIM, '—');
  if (value && value.error) return paint(RED, 'ошибка');
  return String(value);
}

const cols = {
  name: Math.max(9, ...rows.map((r) => r.name.length)),
  base: Math.max(6, ...rows.map((r) => String(r.expected).length)),
  val: 6
};

console.log('');
console.log(paint(BOLD, 'Согласованность параметров TIU GO'));
console.log(paint(DIM, 'эталон — shared/params.json'));
console.log('');
console.log(
  '  ' + pad('параметр', cols.name) + ' │ ' +
  pad('эталон', cols.base, true) + ' │ ' +
  pad('tech', cols.val, true) + ' │ ' +
  pad('math', cols.val, true) + ' │ ' +
  pad('mock', cols.val, true) + ' │ совпадает'
);
console.log(
  '  ' + '─'.repeat(cols.name) + '─┼─' + '─'.repeat(cols.base) +
  '─┼─' + '─'.repeat(cols.val) + '─┼─' + '─'.repeat(cols.val) +
  '─┼─' + '─'.repeat(cols.val) + '─┼──────────'
);

for (const r of rows) {
  const ok = r.mismatched.length === 0;
  console.log(
    '  ' + pad(r.name, cols.name) + ' │ ' +
    pad(String(r.expected), cols.base, true) + ' │ ' +
    pad(show(r.tech), cols.val, true) + ' │ ' +
    pad(show(r.math), cols.val, true) + ' │ ' +
    pad(show(r.mock), cols.val, true) + ' │ ' +
    (ok ? paint(GREEN, '✓') : paint(RED, '✗ ' + r.mismatched.join(', ')))
  );
}

console.log('');

// ---------- Проверка живой связи ----------
//
// Таблица выше сама по себе ничего не доказывает: раз все трое читают
// один файл, колонки совпадут всегда — даже если потребитель на самом
// деле держит число у себя в коде. Поэтому подменяем базу в памяти
// на заведомо другие значения, перезагружаем потребителей и смотрим,
// поехали ли их числа следом. Не поехали — значит, число захардкожено.

const PROBE = {
  'building.floors': 99,
  'elevators.capacityRealPeak': 77,
  'elevators.total': 9
};

function probeConsumers() {
  const paramsPath = require.resolve('../shared/params.json');
  const consumers = [
    require.resolve('../tech-model/params.js'),
    require.resolve('../math-model/params.js'),
    require.resolve('../shared/data/mockData.js')
  ];

  const saved = require.cache[paramsPath];
  const fake = JSON.parse(JSON.stringify(base));
  fake.building.floors = PROBE['building.floors'];
  fake.elevators.capacityRealPeak = PROBE['elevators.capacityRealPeak'];
  fake.elevators.total = PROBE['elevators.total'];

  for (const id of [paramsPath, ...consumers]) delete require.cache[id];
  require.cache[paramsPath] = {
    id: paramsPath, filename: paramsPath, loaded: true, exports: fake, children: [], paths: []
  };

  let result;
  try {
    const t = require('../tech-model/params.js');
    const m = require('../math-model/params.js');
    const k = require('../shared/data/mockData.js');

    result = [
      { name: 'building.floors', want: fake.building.floors,
        tech: t.building.floors, math: m.PARAMS.floors, mock: k.FLOORS },
      { name: 'elevators.capacityRealPeak', want: fake.elevators.capacityRealPeak,
        tech: t.elevators.capacityRealPeak, math: m.PARAMS.capacity, mock: k.CAPACITY },
      { name: 'elevators.total', want: fake.elevators.total,
        tech: t.elevators.total, math: m.PARAMS.elevatorsTotal,
        mock: k.getAdminElevators().length }
    ];
  } finally {
    delete require.cache[paramsPath];
    if (saved) require.cache[paramsPath] = saved;
    for (const id of consumers) delete require.cache[id];
  }

  return result;
}

console.log(paint(BOLD, 'Живая связь с базой'));
console.log(paint(DIM, 'подменяем значения в памяти и смотрим, следуют ли потребители'));
console.log('');

const probe = probeConsumers();
const deaf = [];

for (const r of probe) {
  const who = ['tech', 'math', 'mock'].filter((k) => r[k] !== r.want);
  if (who.length) deaf.push({ name: r.name, who, want: r.want, got: r });

  console.log(
    '  ' + pad(r.name, cols.name) + ' │ ' +
    pad('→ ' + r.want, cols.base + 2, true) + ' │ ' +
    pad(String(r.tech), cols.val, true) + ' │ ' +
    pad(String(r.math), cols.val, true) + ' │ ' +
    pad(String(r.mock), cols.val, true) + ' │ ' +
    (who.length ? paint(RED, '✗ не следует: ' + who.join(', ')) : paint(GREEN, '✓ следует'))
  );
}

console.log('');

const broken = rows.filter((r) => r.mismatched.length > 0);

if (broken.length === 0 && deaf.length === 0) {
  console.log(paint(GREEN, '✓ Всё синхронизировано'));
  console.log(paint(DIM, '  Числа совпадают и, что важнее, действительно читаются'));
  console.log(paint(DIM, '  из shared/params.json, а не записаны в коде потребителей.'));
  console.log('');
  process.exit(0);
}

for (const d of deaf) {
  console.log(paint(RED,
    `✗ ${d.name}: база сказала ${d.want}, но ${d.who.join(', ')} не послушался ` +
    `(${d.who.map((k) => k + '=' + d.got[k]).join(', ')})`));
  console.log(paint(DIM, '  Значит, число задано в коде потребителя. Уберите его оттуда.'));
}

if (broken.length) console.log(paint(RED, `✗ Расхождений в таблице: ${broken.length}`));
for (const r of broken) {
  for (const who of r.mismatched) {
    const got = r[who];
    const text = got && got.error ? `ошибка чтения: ${got.error}` : String(got);
    console.log(paint(RED, `  ${r.name}: эталон ${r.expected}, ${who} ${text}`));
  }
}
console.log('');
console.log(paint(DIM, '  Правьте shared/params.json — остальные файлы читают его.'));
console.log(paint(DIM, '  Если число задано в коде потребителя напрямую, уберите его оттуда.'));
console.log('');
process.exit(1);
