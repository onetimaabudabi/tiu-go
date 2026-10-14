/**
 * TIU GO — оформление презентации.
 *
 * Палитра взята один в один из тёмной темы приложения
 * (shared/public/style.css, блок :root), чтобы слайды и мини-апп
 * выглядели одним продуктом. Правится только здесь.
 */

// ---------- Цвета ----------
// В pptxgenjs цвет пишется без решётки, поэтому и храним так.

const colors = {
  bg: '0B0D12',        // --color-bg      фон слайда
  card: '161A22',      // --color-card    подложка карточки
  cardSoft: '1D2230',  // чуть светлее карточки: вложенные блоки
  line: '232833',      // --color-line    разделители и рамки

  label: 'FFFFFF',     // --label         основной текст
  label2: '9CA3AF',    // --label-2       второстепенный текст
  label3: '6B7280',    // --label-3       подписи, сноски

  accent: '5B8DEF',    // --color-accent  акцент 1
  accent2: '229ED9',   // --tg            акцент 2 (фирменный синий Telegram)
  ok: '22C55E',        // --color-ok      успех
  busy: 'F59E0B',      // --color-busy    предупреждение
  full: 'EF4444'       // --color-full    ошибка, проблема
};

// ---------- Шрифт ----------
//
// В приложении стоит системный шрифт: SF Pro на технике Apple, Segoe UI
// на Windows. Для PowerPoint берём Segoe UI — он есть там, где презентацию
// чаще всего открывают, а на macOS подменяется гарнитурой по умолчанию.

const fonts = {
  head: 'Segoe UI',
  body: 'Segoe UI',
  mono: 'Consolas'
};

// ---------- Сетка ----------
// Слайд 13.333 × 7.5 дюйма — это ровно 1920 × 1080 при 144 dpi.

const grid = {
  width: 13.333,
  height: 7.5,

  left: 0.75,
  right: 12.583,
  get contentWidth() { return this.right - this.left; },  // 11.833

  titleY: 0.52,
  titleH: 0.7,
  ledeY: 1.26,
  ledeH: 0.42,
  bodyY: 1.98,
  bodyBottom: 6.66,
  footerY: 6.94,
  footerH: 0.32,

  gap: 0.26          // зазор между карточками
};

// ---------- Типографика ----------

const type = {
  title: 34,
  lede: 16,
  cardTitle: 17,
  body: 14,
  small: 12,
  caption: 10.5,
  metric: 46,
  metricSmall: 34,
  hero: 78
};

// ---------- Геометрия карточек ----------

const shape = {
  radius: 0.035,       // доля от меньшей стороны: примерно 20 px как в приложении
  radiusSmall: 0.06,
  lineWidth: 1
};

const footerText = 'TIU GO · корпус 7, Мельникайте 70 · 2026';

module.exports = { colors, fonts, grid, type, shape, footerText };
