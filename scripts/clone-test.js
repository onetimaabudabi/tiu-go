#!/usr/bin/env node
/**
 * TIU GO — копия проекта для тестов.
 *
 *   npm run clone-test
 *
 * Делает рядом с проектом папку «TIU GO TEST», куда можно ломать что угодно:
 * боевой бот и его код остаются нетронутыми.
 *
 * Другое имя или место — аргументом:
 *   npm run clone-test -- "../TIU GO EXP"
 *
 * Почему не простой `cp -r`:
 *   node_modules   — сотни мегабайт, ставятся одной командой npm install;
 *   .git           — вся история; копия не должна иметь общего прошлого,
 *                    иначе легко сделать коммит не в той папке;
 *   .env           — там боевой токен бота. В тестовой копии нужен ДРУГОЙ
 *                    токен другого бота, иначе два процесса будут драться
 *                    за один long polling, и сообщения начнут теряться;
 *   shared/data/*  — чужие chatId и накопленная статистика.
 *
 * Существующую папку скрипт не трогает: удалять чей-то каталог командой,
 * запущенной «на всякий случай», — последнее, что здесь нужно.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.resolve(__dirname, '..');

const TARGET = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(SOURCE, '..', 'TIU GO TEST');

// Имена, которые не копируем на любой глубине: vercel/ носит собственные
// node_modules на 150 МБ и свой .git, и без этого правила копия выходила
// втрое тяжелее исходника
const SKIP_ANYWHERE = ['node_modules', '.git', '.DS_Store'];

// Что не копируем. Пути сравниваем от корня проекта.
const SKIP = [
  '.env',
  '.env.example',   // переписываем сами, вычистив секреты
  'shared/data/subscriptions.json',
  'shared/data/history.json',
  'shared/data/reports.json',
  'docs',
  'math-model/output',
  'tech-model/output',
  '3d-sim/dist',
  'presentation/output',
  'screenshots',
  'videos'
];

function relative(file) {
  return path.relative(SOURCE, file).split(path.sep).join('/');
}

function allowed(file) {
  const rel = relative(file);
  if (!rel) return true; // сам корень

  if (SKIP_ANYWHERE.indexOf(path.basename(file)) !== -1) return false;

  return !SKIP.some((skip) => rel === skip || rel.startsWith(skip + '/'));
}

if (fs.existsSync(TARGET)) {
  console.error('Папка уже существует:');
  console.error('  ' + TARGET);
  console.error('');
  console.error('Удалите или переименуйте её сами и запустите команду снова —');
  console.error('скрипт намеренно ничего не перезаписывает.');
  process.exit(1);
}

console.log('Копирую проект...');
console.log('  из: ' + SOURCE);
console.log('  в:  ' + TARGET);

fs.cpSync(SOURCE, TARGET, { recursive: true, filter: allowed });

// .env не копируем, но подкладываем заготовку — чтобы было куда вписать токен.
//
// Именно заготовку, а не копию .env.example: в шаблоне может лежать рабочий
// токен основного бота, и тогда тестовая копия стартовала бы с ним. Два
// процесса на одном токене отбирают друг у друга long polling, часть /start
// теряется, а пользователи тестовых прогонов попадают в статистику основного
// бота. Поэтому все секреты здесь вычищаются принудительно.

const SECRETS = ['TELEGRAM_BOT_TOKEN', 'MAX_BOT_TOKEN', 'ADMIN_PASSWORD', 'UPSTASH_REDIS_REST_TOKEN'];

const HEADER = [
  '# Настройки ТЕСТОВОЙ копии TIU GO.',
  '#',
  '# Токены намеренно пустые: тестовому боту нужен СВОЙ токен из BotFather.',
  '# С токеном основного бота копия работать не должна — два процесса на одном',
  '# токене теряют сообщения, а тестовые пользователи попадут в статистику',
  '# основного бота.',
  ''
].join('\n');

const source = path.join(SOURCE, '.env.example');

if (fs.existsSync(source)) {
  // Чистим шаблон целиком, а не только .env: в .env.example основного
  // проекта вполне может лежать рабочий токен, и тащить его в тестовую
  // копию незачем — там он всё равно не нужен.
  const clean = fs.readFileSync(source, 'utf8').split('\n').map((line) => {
    const name = (line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/) || [])[1];
    return name && SECRETS.indexOf(name) !== -1 ? name + '=' : line;
  }).join('\n');

  fs.writeFileSync(path.join(TARGET, '.env.example'), clean, 'utf8');
  fs.writeFileSync(path.join(TARGET, '.env'), HEADER + clean, 'utf8');
}

console.log('');
console.log('Готово. Дальше:');
console.log('');
console.log('  1. cd "' + TARGET + '"');
console.log('  2. npm install');
console.log('  3. создайте в BotFather нового бота (например, TIU GO TEST BOT)');
console.log('  4. впишите его токен в .env — в переменную TELEGRAM_BOT_TOKEN');
console.log('     (там пусто: токены в копию не переносятся специально)');
console.log('  5. npm run start:server   (в одном терминале)');
console.log('  6. npm run start:telegram (в другом)');
console.log('');
console.log('Боевой бот и боевой .env при этом не затронуты.');
console.log('Токены в копию НЕ попали — это сделано нарочно.');
console.log('Статистика копии тоже своя: у тестового бота другой токен,');
console.log('и его пользователи в цифры основного бота не войдут.');
