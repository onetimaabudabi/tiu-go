/**
 * TIU GO — сборка презентации для инвесторов.
 *
 *   npm run presentation
 *
 * Результат: presentation/output/TIU_GO_Presentation.pptx
 *
 * Скрипт сначала готовит картинки (логотип без подложки, QR на канал,
 * копии скриншотов и портретов), потом по очереди зовёт двенадцать
 * модулей из slides/. Ни один из них не падает из-за отсутствующего
 * файла: вместо картинки появится заглушка с подписью.
 */

const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const content = require('./content');
const theme = require('./theme');
const { Deck } = require('./lib/layout');
const { ASSETS, buildLogo } = require('./lib/assets');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output');
const OUT_FILE = path.join(OUT_DIR, 'TIU_GO_Presentation.pptx');

const log = (message) => console.log(`[presentation] ${message}`);

// ---------- Подготовка картинок ----------

/** Копируем файл, если он есть и ещё не скопирован. Иначе молча пропускаем. */
function copyIfPresent(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

/**
 * Скриншоты приложения.
 *
 * Берём снимки «телефона» из корневой screenshots/ и раскладываем под
 * именами, которые ждут слайды. Если снимков нет — оставляем то, что
 * уже лежит в assets, а чего нет совсем, заменит заглушка.
 */
function prepareScreenshots() {
  const map = [
    ['phone-main-dark.png', 'phone-main.png'],
    ['phone-detail-dark.png', 'phone-detail.png'],
    ['phone-main-light.png', 'phone-light.png']
  ];

  let copied = 0;
  map.forEach(([from, to]) => {
    const source = path.join(ROOT, 'screenshots', from);
    const target = path.join(ASSETS, 'screenshots', to);
    if (copyIfPresent(source, target)) {
      copied += 1;
      return;
    }
    // Запасной путь: снимок мог быть положен в assets руками.
    copyIfPresent(path.join(ASSETS, to), target);
  });

  return copied;
}

/** Портреты команды: из assets в assets/team под теми же именами. */
function prepareTeam() {
  let found = 0;
  content.slides.team.members.forEach((member) => {
    const target = path.join(ASSETS, 'team', member.file);
    if (fs.existsSync(target)) { found += 1; return; }
    if (copyIfPresent(path.join(ASSETS, member.file), target)) found += 1;
  });
  return found;
}

/** QR-код на канал проекта. Нет библиотеки — слайд нарисует заглушку. */
async function buildQr() {
  let QRCode;
  try {
    QRCode = require('qrcode');
  } catch {
    log('нет библиотеки qrcode — QR пропущен (npm i -D qrcode)');
    return null;
  }

  const file = path.join(ASSETS, 'qr-telegram.png');
  fs.mkdirSync(ASSETS, { recursive: true });

  await QRCode.toFile(file, content.links.channelUrl, {
    width: 600,
    margin: 1,
    color: {
      // Светлый код на подложке карточки: в тёмной колоде инверсия
      // читается сканером так же, но не выжигает глаз белым квадратом.
      dark: `#${theme.colors.label}`,
      light: `#${theme.colors.cardSoft}`
    }
  });

  return file;
}

// ---------- Сборка ----------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  log('Готовлю картинки…');
  const logo = await buildLogo();
  log(logo ? 'логотип: эмблема вырезана из screenshots/ЛОГОТИП.jpg' : 'логотип не найден — слайды обойдутся без него');

  const qr = await buildQr();
  if (qr) log(`QR-код: ${content.links.channelUrl}`);

  const shots = prepareScreenshots();
  log(`скриншоты: ${shots} из 3`);

  const team = prepareTeam();
  log(`портреты команды: ${team} из ${content.slides.team.members.length}`);

  // Что слайды знают о картинках
  const assets = {
    logo,
    qr,
    path: (relative) => path.join(ASSETS, relative)
  };

  const pres = new PptxGenJS();
  pres.author = 'Команда ИСАУБ-26-1';
  pres.company = 'Тюменский индустриальный университет';
  pres.title = 'TIU GO — мониторинг загруженности лифтов';
  pres.subject = 'Презентация для инвесторов';

  const modules = [
    '01-title', '02-problem', '03-solution', '04-how-it-works',
    '05-demo', '06-math-model', '07-impact', '08-survey',
    '09-market', '10-competitors', '11-investment', '12-team'
  ];

  const deck = new Deck(pres, { logo, total: modules.length });

  modules.forEach((name, i) => {
    log(`Слайд ${i + 1}/${modules.length}…`);
    require(path.join(__dirname, 'slides', name))(pres, deck, content, assets);
  });

  await pres.writeFile({ fileName: OUT_FILE });

  const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
  log(`Готово! output/TIU_GO_Presentation.pptx (${size} КБ, ${modules.length} слайдов)`);
}

main().catch((error) => {
  console.error('[presentation] Сборка не удалась:', error.message);
  process.exitCode = 1;
});
