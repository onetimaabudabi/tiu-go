/**
 * TIU GO — фронтенд мини-приложения.
 *
 * Два экрана без перезагрузки: список из шести лифтов и деталь одного лифта.
 * Данные приходят из GET /api/status раз в 3 секунды; статус, рекомендацию,
 * прогноз ожидания и сравнение с лестницей считает сервер — здесь только
 * отображение.
 *
 * Важно: карточки строятся один раз, дальше обновляются значения в уже
 * существующих узлах. Если перерисовывать разметку целиком, не отработают
 * ни переход кабины в шахте, ни анимация цифр.
 */

(function () {
  'use strict';

  var I18N = window.TIU_I18N;

  // ---------- Ключи в localStorage ----------
  var THEME_KEY = 'tiu-go-theme';
  var FAV_KEY = 'tiu-go-favorites';
  var LANG_KEY = 'tiu-go-lang';
  var DEST_KEY = 'tiu-go-destination';
  var CACHE_KEY = 'tiu-go-cache';

  var THEME_BG = { dark: '#0B0D12', light: '#F7F8FA' };

  // Сколько этажей показывать в выборе назначения
  var DESTINATION_FLOORS = 10;

  // Причины жалобы: ключ уходит на сервер, подпись берётся из словаря
  var REPORT_REASONS = ['broken', 'slow', 'noise', 'dirty', 'other'];

  // ---------- Состояние ----------
  var state = {
    elevators: [],
    address: '',
    openId: null,   // id открытого лифта или null, если мы на главном экране
    refreshMs: 3000,
    loaded: false,  // пришли ли данные хотя бы раз
    failed: false,  // последний запрос не удался и кэша не нашлось
    fromCache: false,
    cachedAt: null,
    peak: null      // сведения о пиковых часах из ответа сервера
  };

  var lang = I18N.DEFAULT;
  var destination = 1;
  var favorites = []; // id избранных лифтов

  var prevFloors = {};   // id лифта -> этаж на прошлом обновлении
  var directions = {};   // id лифта -> '▲' | '▼' | '•'
  var tiles = {};        // id лифта -> ссылки на узлы карточки
  var gridKey = '';      // порядок и состав карточек, по которому собрана сетка
  var detailTicksFor = null; // для какого лифта построены риски крупной шахты
  var timer = null;
  var toastTimer = null;
  var reportReason = null;

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    offline: $('offline'),
    offlineText: $('offline-text'),
    topbar: $('topbar'),
    dot: $('dot'),
    sysBtn: $('sys-status'),
    sysFree: $('sys-free'),
    langToggle: $('lang-toggle'),
    langLabel: $('lang-label'),
    themeToggle: $('theme-toggle'),
    themeIcon: $('theme-icon'),
    themeColor: $('theme-color'),
    home: $('screen-home'),
    detail: $('screen-detail'),
    summary: $('summary'),
    peak: $('peak'),
    peakIcon: $('peak-icon'),
    peakText: $('peak-text'),
    skeleton: $('skeleton'),
    grid: $('grid'),
    empty: $('empty'),
    emptyText: $('empty-text'),
    emptyRetry: $('empty-retry'),
    emptyRetryText: $('empty-retry-text'),
    updated: $('updated'),
    back: $('back'),
    detailTitle: $('detail-title'),
    detailSubtitle: $('detail-subtitle'),
    destination: $('destination'),
    cameraScene: $('camera-scene'),
    cameraBadge: $('camera-badge'),
    cameraCaption: $('camera-caption'),
    dOccupancy: $('d-occupancy'),
    dBar: $('d-bar'),
    dWaiting: $('d-waiting'),
    dWait: $('d-wait'),
    dWaitUnit: $('d-wait-unit'),
    dFloor: $('d-floor'),
    dDirection: $('d-direction'),
    dTicks: $('d-ticks'),
    dCabin: $('d-cabin'),
    dRec: $('d-rec'),
    cmpElevator: $('cmp-elevator'),
    cmpElevatorTime: $('cmp-elevator-time'),
    cmpStairs: $('cmp-stairs'),
    cmpStairsTime: $('cmp-stairs-time'),
    cmpVerdict: $('cmp-verdict'),
    refresh: $('refresh'),
    reportOpen: $('report-open'),
    sheet: $('sheet'),
    sheetBackdrop: $('sheet-backdrop'),
    reportReasons: $('report-reasons'),
    reportComment: $('report-comment'),
    reportCancel: $('report-cancel'),
    reportSubmit: $('report-submit'),
    toast: $('toast')
  };

  var occupancyCard = $('d-occupancy-card');

  // ---------- Переводы ----------

  function t(key, params) {
    return I18N.t(lang, key, params);
  }

  function pl(key, n) {
    return I18N.plural(lang, key, n);
  }

  function readStoredLang() {
    try {
      var saved = window.localStorage.getItem(LANG_KEY);
      return I18N.LANGS.indexOf(saved) !== -1 ? saved : null;
    } catch (e) {
      return null;
    }
  }

  /** Проставляет статические подписи по атрибутам data-i18n. */
  function applyLang() {
    document.documentElement.setAttribute('lang', lang);
    setText(el.langLabel, lang.toUpperCase());

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i += 1) {
      setText(nodes[i], t(nodes[i].dataset.i18n));
    }

    var aria = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < aria.length; j += 1) {
      aria[j].setAttribute('aria-label', t(aria[j].dataset.i18nAria));
    }

    el.reportComment.setAttribute('placeholder', t('report.commentPlaceholder'));

    buildReportReasons();
    buildDestination();
    render(); // динамические строки пересобираем сразу
  }

  function toggleLang() {
    lang = lang === 'ru' ? 'en' : 'ru';
    try { window.localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    applyLang();
    haptic();
  }

  // ---------- Интеграция с Telegram и MAX ----------

  /** Telegram Mini Apps SDK, если мы внутри Telegram. */
  function tgApp() {
    return (window.Telegram && window.Telegram.WebApp) || null;
  }

  /**
   * WebApp-мост MAX, если мы внутри MAX.
   * TODO: сверить имя глобального объекта и набор методов с документацией —
   *       https://dev.max.ru/docs
   */
  function maxApp() {
    return (window.MAX && window.MAX.WebApp) ||
           window.MaxWebApp ||
           (window.max && window.max.WebApp) ||
           null;
  }

  function initHost() {
    var tg = tgApp();
    var mx = maxApp();

    // Обе платформы понимают один и тот же набор базовых вызовов,
    // поэтому дёргаем их одинаково и молча игнорируем отсутствующие методы.
    [tg, mx].forEach(function (host) {
      if (!host) return;
      try {
        if (host.ready) host.ready();
        if (host.expand) host.expand();
      } catch (e) {
        /* старая версия клиента — работаем как обычная веб-страница */
      }
    });

    // Пока пользователь сам не выбрал тему, слушаемся клиента и системы
    var host = tg || mx;
    if (!readStoredTheme() && host && host.colorScheme) {
      applyTheme(host.colorScheme === 'light' ? 'light' : 'dark');
    }

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var follow = function () {
        if (!readStoredTheme()) applyTheme(mq.matches ? 'light' : 'dark');
      };
      if (mq.addEventListener) mq.addEventListener('change', follow);
      else if (mq.addListener) mq.addListener(follow);
    }

    [tg, mx].forEach(function (client) {
      if (client && client.onEvent) {
        try {
          client.onEvent('themeChanged', function () {
            if (!readStoredTheme() && client.colorScheme) {
              applyTheme(client.colorScheme === 'light' ? 'light' : 'dark');
            }
          });
        } catch (e) {}
      }
    });

    // Системная кнопка «назад» в Telegram
    if (tg && tg.BackButton && tg.BackButton.onClick) {
      try { tg.BackButton.onClick(showHome); } catch (e) {}
    }

    applyTheme(currentTheme()); // синхронизируем иконку и цвета клиента
  }

  /** Переключает системную кнопку «назад», если платформа её поддерживает. */
  function toggleHostBackButton(visible) {
    var tg = tgApp();
    if (!tg || !tg.BackButton) return;
    try {
      if (visible) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch (e) {}
  }

  /** Лёгкая тактильная отдача по тапу, если клиент умеет. */
  function haptic() {
    var host = tgApp() || maxApp();
    if (host && host.HapticFeedback && host.HapticFeedback.impactOccurred) {
      try { host.HapticFeedback.impactOccurred('light'); } catch (e) {}
    }
  }

  // ---------- Тема ----------

  function readStoredTheme() {
    try {
      var v = window.localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark';
  }

  /** Применяет тему к документу, иконке тумблера и оболочке клиента. */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Иконка показывает текущую тему: солнце — светлая, луна — тёмная
    el.themeIcon.textContent = theme === 'light' ? '☀' : '🌙';
    if (el.themeColor) el.themeColor.setAttribute('content', THEME_BG[theme]);

    [tgApp(), maxApp()].forEach(function (host) {
      if (!host) return;
      try {
        if (host.setHeaderColor) host.setHeaderColor(THEME_BG[theme]);
        if (host.setBackgroundColor) host.setBackgroundColor(THEME_BG[theme]);
      } catch (e) {}
    });
  }

  /** Тумблер: переключает тему и запоминает выбор. */
  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
    haptic();
  }

  // ---------- Избранное ----------

  function readFavorites() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(FAV_KEY));
      if (!Array.isArray(raw)) return [];
      return raw.map(Number).filter(function (id) { return !isNaN(id); });
    } catch (e) {
      return [];
    }
  }

  function saveFavorites() {
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
    } catch (e) {}
  }

  function isFavorite(id) {
    return favorites.indexOf(id) !== -1;
  }

  function toggleFavorite(id) {
    var at = favorites.indexOf(id);
    if (at === -1) favorites.push(id);
    else favorites.splice(at, 1);

    saveFavorites();
    haptic();
    renderHome(); // порядок карточек мог измениться
  }

  /** Избранные — в начало списка, внутри групп — по id. */
  function sortElevators(list) {
    return list.slice().sort(function (a, b) {
      var favA = isFavorite(a.id) ? 0 : 1;
      var favB = isFavorite(b.id) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      return a.id - b.id;
    });
  }

  // ---------- Этаж назначения ----------

  function readDestination() {
    try {
      var value = parseInt(window.localStorage.getItem(DEST_KEY), 10);
      if (value >= 1 && value <= DESTINATION_FLOORS) return value;
    } catch (e) {}
    return 1;
  }

  /** Кнопки-таблетки с этажами на экране лифта. */
  function buildDestination() {
    var html = '';

    for (var floor = 1; floor <= DESTINATION_FLOORS; floor += 1) {
      html += '<button class="floor-pill' + (floor === destination ? ' is-active' : '') +
        '" type="button" data-floor="' + floor + '">' + floor + '</button>';
    }

    el.destination.innerHTML = html;
  }

  function setDestination(floor) {
    destination = floor;
    try { window.localStorage.setItem(DEST_KEY, String(floor)); } catch (e) {}

    var pills = el.destination.children;
    for (var i = 0; i < pills.length; i += 1) {
      pills[i].classList.toggle('is-active', Number(pills[i].dataset.floor) === floor);
    }

    haptic();
    load(); // весь расчёт зависит от этажа назначения — запрашиваем заново
  }

  // ---------- Мелкие утилиты ----------

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** Пишем в узел, только если текст изменился. */
  function setText(node, value) {
    var text = String(value);
    if (node.textContent !== text) node.textContent = text;
  }

  function findElevator(id) {
    for (var i = 0; i < state.elevators.length; i += 1) {
      if (state.elevators[i].id === id) return state.elevators[i];
    }
    return null;
  }

  /** Псевдослучайное, но стабильное число из seed — чтобы кадр камеры не «дёргался». */
  function seeded(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function elevatorName(lift) {
    return t('tile.elevator') + ' ' + lift.number;
  }

  /** 45 -> «45 сек», 80 -> «1 мин 20 сек» — на языке интерфейса. */
  function formatWaitTime(seconds) {
    var value = Math.max(Math.round(seconds), 0);
    if (value < 60) return value + ' ' + t('time.sec');

    var minutes = Math.floor(value / 60);
    var rest = value % 60;
    return minutes + ' ' + t('time.min') +
      (rest ? ' ' + rest + ' ' + t('time.sec') : '');
  }

  /** Время из метки времени в виде 12:00:03 */
  function formatClock(ms) {
    var date = new Date(ms);
    return String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0') + ':' +
      String(date.getSeconds()).padStart(2, '0');
  }

  // ---------- Микроанимация цифр ----------

  /**
   * Плавно «перекатывает» число в элементе от from к to.
   * Анимация идёт на requestAnimationFrame с замедлением к концу.
   */
  function animateNumber(element, from, to, duration, format) {
    var ms = duration || 400;
    var render = format || String;

    // Прерываем предыдущую анимацию этого же элемента, иначе при обновлении
    // раз в три секунды кадры начнут наслаиваться.
    if (element._numberRaf) {
      cancelAnimationFrame(element._numberRaf);
      element._numberRaf = null;
    }

    if (from === to) {
      element.textContent = render(to);
      return;
    }

    var startedAt = 0;

    var step = function (now) {
      if (!startedAt) startedAt = now;

      var progress = Math.min((now - startedAt) / ms, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out
      var value = Math.round(from + (to - from) * eased);

      element.textContent = render(value);

      if (progress < 1) {
        element._numberRaf = requestAnimationFrame(step);
      } else {
        element._numberRaf = null;
        element.textContent = render(to);
      }
    };

    element._numberRaf = requestAnimationFrame(step);
  }

  /** Короткий «подскок» в момент смены значения. */
  function popNumber(element) {
    element.classList.remove('number-changed');
    void element.offsetWidth; // перезапуск анимации
    element.classList.add('number-changed');
  }

  /**
   * Ставит число в элемент: при изменении — с анимацией и подскоком,
   * при том же значении — молча, чтобы автообновление не дёргало интерфейс.
   */
  function setNumber(element, value, format) {
    var render = format || String;
    var previous = element.dataset.value === undefined ? NaN : Number(element.dataset.value);

    element.dataset.value = value;

    if (isNaN(previous)) {
      element.textContent = render(value);
      return;
    }

    if (previous === value) {
      var text = render(value);
      if (element.textContent !== text) element.textContent = text;
      return;
    }

    popNumber(element);
    animateNumber(element, previous, value, 400, render);
  }

  /** Сбрасывает память о числе — следующая отрисовка пройдёт без анимации. */
  function resetNumber(element) {
    if (element._numberRaf) {
      cancelAnimationFrame(element._numberRaf);
      element._numberRaf = null;
    }
    delete element.dataset.value;
  }

  // ---------- Шахта лифта ----------

  /** Доля пути от первого этажа к последнему: 0 — низ шахты, 1 — верх. */
  function floorRatio(lift) {
    var total = Math.max(lift.floors || 1, 1);
    if (total <= 1) return 0;
    return clamp((lift.currentFloor - 1) / (total - 1), 0, 1);
  }

  /**
   * Смещение кабины от низа шахты. Считаем в calc, чтобы одна и та же
   * формула работала и для маленькой шахты, и для крупной: размер кабины
   * приходит из CSS-переменной --cab.
   */
  function cabinOffset(ratio) {
    return 'calc((100% - var(--cab)) * ' + ratio.toFixed(4) + ')';
  }

  /** Риски этажей — по одной на каждый этаж, на уровне центра кабины. */
  function ticksHtml(floors) {
    var total = Math.max(floors || 1, 1);
    var html = '';

    for (var f = 1; f <= total; f += 1) {
      var ratio = total <= 1 ? 0 : (f - 1) / (total - 1);
      html += '<i class="shaft__tick" style="bottom: calc((100% - var(--cab)) * ' +
        ratio.toFixed(4) + ' + (var(--cab) - 1px) / 2)"></i>';
    }
    return html;
  }

  /** Обновляет стрелку направления: ▲ вверх, ▼ вниз, • стоит. */
  function setDirection(node, glyph) {
    setText(node, glyph);
    node.classList.toggle('is-moving', glyph !== '•');
  }

  /**
   * Направление считаем сами — сравниваем этаж с предыдущим обновлением.
   * Заодно запоминаем новое значение для следующего сравнения.
   */
  function updateDirections(list) {
    list.forEach(function (lift) {
      var prev = prevFloors[lift.id];
      var glyph = '•';

      if (prev !== undefined) {
        if (lift.currentFloor > prev) glyph = '▲';
        else if (lift.currentFloor < prev) glyph = '▼';
      }

      directions[lift.id] = glyph;
      prevFloors[lift.id] = lift.currentFloor;
    });
  }

  // ---------- Иконки ----------

  var PEOPLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/>' +
      '<circle cx="10" cy="7.5" r="3"/>' +
      '<path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3 3 0 0 1 0 5.6"/>' +
    '</svg>';

  var CLOCK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="8.5"/>' +
      '<path d="M12 7.2V12l3.2 1.9"/>' +
    '</svg>';

  var STAR_ICON =
    '<svg viewBox="0 0 24 24" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L12 3.6z"/>' +
    '</svg>';

  // ---------- Главный экран ----------

  function renderSummary() {
    // Пока данных нет, в сводке нечего считать
    if (!state.loaded) {
      setText(el.summary, state.failed ? '' : t('home.loading'));
      return;
    }

    var total = state.elevators.length;
    var free = 0;
    var full = 0;

    state.elevators.forEach(function (lift) {
      if (lift.status === 'ok') free += 1;
      if (lift.status === 'full') full += 1;
    });

    var parts = [
      total + ' ' + pl('summary.elevators', total),
      free + ' ' + pl('summary.free', free)
    ];

    if (full > 0) parts.push(full + ' ' + pl('summary.full', full));

    setText(el.summary, parts.join(' · '));
  }

  /** Иконка лифта в шапке: сколько свободно и каким цветом это показать. */
  function renderSysStatus() {
    var free = 0;
    var busy = 0;

    state.elevators.forEach(function (lift) {
      if (lift.status === 'ok') free += 1;
      else if (lift.status === 'busy') busy += 1;
    });

    var tone = 'full';                // все переполнены
    if (free > 0) tone = 'ok';        // есть хотя бы один свободный
    else if (busy > 0) tone = 'busy'; // свободных нет, но есть просто занятые

    el.sysBtn.dataset.tone = state.elevators.length ? tone : 'ok';
    el.sysBtn.classList.toggle('is-loading', !state.loaded);

    if (state.loaded) setNumber(el.sysFree, free);
    else setText(el.sysFree, '—');
  }

  /** Плашка пиковых часов под шапкой. */
  function renderPeak() {
    var peak = state.peak;

    if (!peak || (!peak.isPeak && !peak.peakSoon)) {
      el.peak.hidden = true;
      return;
    }

    // Подпись пика переводим по ключу, который прислал сервер
    var label = peak.peakKey ? t('peak.' + peak.peakKey) : peak.peakLabel;

    if (peak.isPeak) {
      el.peak.className = 'peak peak--now';
      setText(el.peakIcon, '⚡');
      setText(el.peakText, t('peak.now', { label: label }));
    } else {
      el.peak.className = 'peak peak--soon';
      setText(el.peakIcon, '⏰');
      setText(el.peakText, t('peak.soon', { n: peak.minutesUntilPeak, label: label }));
    }

    el.peak.hidden = false;
  }

  /** Собирает карточку лифта один раз и возвращает ссылки на её узлы. */
  function buildTile(lift) {
    var root = document.createElement('button');
    root.className = 'tile';
    root.type = 'button';
    root.dataset.id = lift.id;

    root.innerHTML = '' +
      '<span class="tile__head">' +
        '<span class="tile__titles">' +
          '<span class="tile__name"></span>' +
          '<span class="tile__loc"></span>' +
        '</span>' +
        '<span class="tile__star" data-star="' + lift.id + '">' + STAR_ICON + '</span>' +
      '</span>' +

      '<span class="tile__floor">' +
        '<span class="shaft">' + ticksHtml(lift.floors) +
          '<span class="shaft__cabin"></span>' +
        '</span>' +
        '<span class="tile__floor-num"><b></b><span></span></span>' +
        '<span class="dir">•</span>' +
      '</span>' +

      '<span class="tile__row"><span></span><b></b></span>' +
      '<span class="bar"><i style="width:0%"></i></span>' +

      '<span class="tile__wait">' +
        '<span class="tile__wait-label">' + PEOPLE_ICON + '<span></span></span>' +
        '<b></b>' +
      '</span>' +

      '<span class="tile__eta">' + CLOCK_ICON + '<b></b></span>' +

      '<span class="pill"></span>';

    return {
      root: root,
      name: root.querySelector('.tile__name'),
      loc: root.querySelector('.tile__loc'),
      star: root.querySelector('.tile__star'),
      floor: root.querySelector('.tile__floor-num b'),
      floorLabel: root.querySelector('.tile__floor-num span'),
      dir: root.querySelector('.dir'),
      cabin: root.querySelector('.shaft__cabin'),
      cabinLabel: root.querySelector('.tile__row span'),
      occupancy: root.querySelector('.tile__row b'),
      bar: root.querySelector('.bar i'),
      waitLabel: root.querySelector('.tile__wait-label span'),
      waiting: root.querySelector('.tile__wait b'),
      eta: root.querySelector('.tile__eta b'),
      pill: root.querySelector('.pill')
    };
  }

  /** Обновляет значения в уже построенной карточке. */
  function updateTile(tile, lift) {
    if (tile.root.dataset.status !== lift.status) {
      tile.root.dataset.status = lift.status;
    }

    var favorite = isFavorite(lift.id);
    tile.root.dataset.fav = favorite ? '1' : '0';
    tile.star.classList.toggle('is-on', favorite);
    tile.star.setAttribute('aria-label', t('tile.favorite'));

    setText(tile.name, elevatorName(lift));
    setText(tile.loc, state.address);     // адрес один на все лифты
    setText(tile.floorLabel, t('tile.floor'));
    setText(tile.cabinLabel, t('tile.inCabin'));
    setText(tile.waitLabel, t('tile.waiting'));
    setText(tile.floor, lift.currentFloor);

    // «2 / 5» — анимируем первую цифру, вместимость подставляем как есть
    setNumber(tile.occupancy, lift.occupancy, function (value) {
      return value + ' / ' + lift.capacity;
    });

    var percent = Math.min(Math.round((lift.occupancy / lift.capacity) * 100), 100);
    tile.bar.style.width = percent + '%';

    setNumber(tile.waiting, lift.waiting);

    // Прогноз ожидания: «~27 сек»
    setNumber(tile.eta, lift.waitTime, function (value) {
      return '~' + formatWaitTime(value);
    });

    setDirection(tile.dir, directions[lift.id] || '•');

    // кабина едет плавно: переход задан в CSS (0.6s ease-in-out)
    tile.cabin.style.bottom = cabinOffset(floorRatio(lift));

    var isWait = lift.recommendation === 'wait';
    var pillClass = 'pill ' + (isWait ? 'pill--wait' : 'pill--stairs');
    if (tile.pill.className !== pillClass) tile.pill.className = pillClass;
    setText(tile.pill, isWait ? t('pill.wait') : t('pill.stairs'));
  }

  function renderGrid() {
    var ordered = sortElevators(state.elevators);

    // Разметку пересобираем, только если изменился состав или порядок карточек
    var key = ordered.map(function (l) { return l.id + ':' + l.floors; }).join(',');

    if (key !== gridKey) {
      el.grid.innerHTML = '';
      tiles = {};

      ordered.forEach(function (lift) {
        var tile = buildTile(lift);
        tiles[lift.id] = tile;
        el.grid.appendChild(tile.root);
      });

      gridKey = key;
    }

    ordered.forEach(function (lift) {
      if (tiles[lift.id]) updateTile(tiles[lift.id], lift);
    });
  }

  /**
   * Что показывать на главном экране: заглушки на первой загрузке,
   * пустой экран при неудаче без кэша или сам список.
   */
  function updateHomeView() {
    var hasData = state.elevators.length > 0;
    var firstLoad = !state.loaded && !state.failed;

    el.skeleton.hidden = !(firstLoad && !hasData);
    el.grid.hidden = !hasData;
    el.empty.hidden = !(!hasData && !firstLoad);

    // Подпись пустого экрана зависит от причины
    setText(el.emptyText, state.loaded ? t('empty.noData') : t('empty.subtitle'));
  }

  function renderHome() {
    updateHomeView();
    renderSummary();
    renderSysStatus();
    renderPeak();

    if (state.elevators.length) renderGrid();

    if (state.loaded) {
      setText(el.updated, t('foot.updatedAt', { time: formatClock(Date.now()) }));
    }
  }

  // ---------- Кадр с камеры ----------

  /** Силуэт человека: голова + корпус. */
  function personShape(x, baseY, scale) {
    var headR = 7 * scale;
    var headY = baseY - 44 * scale;
    var bodyTop = baseY - 35 * scale;
    var bodyW = 9.5 * scale;

    return '' +
      '<circle cx="' + x + '" cy="' + headY + '" r="' + headR + '" fill="#6E6E73"/>' +
      '<rect x="' + (x - bodyW) + '" y="' + bodyTop + '" width="' + (bodyW * 2) + '" ' +
        'height="' + (baseY - bodyTop) + '" rx="' + (6 * scale) + '" fill="#6E6E73"/>';
  }

  /** Рамка детекции ИИ вокруг человека. */
  function detectionBox(x, baseY, scale, index) {
    var w = 32 * scale;
    var top = baseY - 55 * scale;
    var h = baseY - top + 5;
    var left = x - w / 2;
    var labelW = 24;

    return '' +
      '<rect x="' + left + '" y="' + top + '" width="' + w + '" height="' + h + '" ' +
        'rx="3" fill="none" stroke="#0A84FF" stroke-width="1.3"/>' +
      '<rect x="' + left + '" y="' + (top - 10) + '" width="' + labelW + '" height="10" ' +
        'rx="3" fill="#0A84FF"/>' +
      '<text x="' + (left + labelW / 2) + '" y="' + (top - 2.8) + '" font-size="6" fill="#FFFFFF" ' +
        'text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-weight="600">' +
        (lang === 'en' ? 'id ' : 'чел ') + index + '</text>';
  }

  /**
   * Стилизованный кадр с камеры в холле: двери лифта и люди перед ними.
   * Внутрь кабины камера не смотрит — только зона ожидания.
   */
  function renderCamera(lift) {
    var W = 320;
    var H = 180;
    var shown = Math.min(lift.waiting, 6); // больше шести силуэтов кадр не вмещает

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + W + '" height="' + H + '" fill="#2C2C2E"/>' +
      '<rect y="118" width="' + W + '" height="62" fill="#1C1C1E"/>' +
      '<line x1="0" y1="118" x2="' + W + '" y2="118" stroke="#3A3A3C" stroke-width="1"/>' +

      // дверной портал
      '<rect x="112" y="34" width="96" height="86" rx="3" fill="#3A3A3C"/>' +
      '<rect x="118" y="40" width="84" height="80" rx="1" fill="#48484A"/>' +
      '<line x1="160" y1="40" x2="160" y2="120" stroke="#2C2C2E" stroke-width="1.5"/>' +
      '<rect x="150" y="70" width="20" height="3" rx="1.5" fill="#3A3A3C"/>' +

      // табло над дверьми с текущим этажом
      '<rect x="139" y="19" width="42" height="13" rx="4" fill="#1C1C1E"/>' +
      '<text x="160" y="28.5" text-anchor="middle" font-size="8" ' +
        'font-family="-apple-system, system-ui, sans-serif" ' +
        'font-weight="600" fill="#0A84FF">' + lift.currentFloor +
        (lang === 'en' ? ' fl.' : ' эт.') + '</text>' +

      // кнопка вызова
      '<circle cx="222" cy="78" r="3.5" fill="#3A3A3C"/>' +

      // служебная подпись камеры
      '<text x="10" y="17" font-size="7.5" ' +
        'font-family="-apple-system, system-ui, sans-serif" ' +
        'font-weight="500" fill="#8E8E93" opacity="0.75">CAM-0' + lift.id +
        (lang === 'en' ? ' · WAITING AREA' : ' · ЗОНА ОЖИДАНИЯ') + '</text>';

    // Люди в холле. Позиции стабильны для конкретного лифта — кадр не «прыгает».
    // Пока ждущих мало, они стоят прямо у дверей; с ростом очереди холл заполняется.
    var spanStart = shown <= 2 ? 124 : 44;
    var spanEnd = shown <= 2 ? 196 : 276;
    var stepX = shown > 1 ? (spanEnd - spanStart) / (shown - 1) : 0;

    var people = [];
    for (var i = 0; i < shown; i += 1) {
      var r1 = seeded(lift.id * 31 + i * 7);
      var r2 = seeded(lift.id * 17 + i * 13);
      var x = shown === 1 ? 160 : spanStart + stepX * i + (r1 * 14 - 7);

      people.push({
        x: clamp(x, 30, 290),
        baseY: 128 + r2 * 28,
        scale: 0.95 + r2 * 0.4,
        index: i + 1
      });
    }

    // ближние (ниже по кадру) рисуются последними
    people.sort(function (a, b) { return a.baseY - b.baseY; });

    people.forEach(function (p) { svg += personShape(p.x, p.baseY, p.scale); });
    people.forEach(function (p) { svg += detectionBox(p.x, p.baseY, p.scale, p.index); });

    if (lift.waiting > shown) {
      svg += '<text x="' + (W - 10) + '" y="17" text-anchor="end" font-size="7.5" ' +
        'font-family="-apple-system, system-ui, sans-serif" font-weight="600" fill="#0A84FF">+' +
        (lift.waiting - shown) + '</text>';
    }

    svg += '</svg>';

    el.cameraScene.innerHTML = svg;
    setText(el.cameraBadge, t('detail.cameraBadge', { n: lift.waiting }));
    setText(el.cameraCaption, t('detail.cameraCaption', { floor: lift.cameraFloor }));
  }

  // ---------- Экран детали ----------

  /** Карточка «Ожидание»: до минуты — крупная цифра с подписью, дальше — текст. */
  function renderWaitCard(lift) {
    if (lift.waitTime < 60) {
      setNumber(el.dWait, lift.waitTime);
      setText(el.dWaitUnit, pl('detail.seconds', lift.waitTime));
      el.dWaitUnit.hidden = false;
    } else {
      resetNumber(el.dWait); // вернёмся под минуту — покажем без скачка
      setText(el.dWait, formatWaitTime(lift.waitTime));
      el.dWaitUnit.hidden = true;
    }
  }

  /** Карточка «Сравнение»: лифт против лестницы для выбранного этажа. */
  function renderCompare(lift) {
    setText(el.cmpElevatorTime, '~' + formatWaitTime(lift.elevatorTotal));
    setText(el.cmpStairsTime, '~' + formatWaitTime(lift.stairsTime));

    el.cmpElevator.classList.toggle('is-faster', lift.fasterOption === 'elevator');
    el.cmpStairs.classList.toggle('is-faster', lift.fasterOption === 'stairs');

    var verdict = t('compare.equal');
    if (lift.fasterOption === 'stairs') {
      verdict = t('compare.stairsFaster', { time: formatWaitTime(lift.savedSeconds) });
    } else if (lift.fasterOption === 'elevator') {
      verdict = t('compare.elevatorFaster', { time: formatWaitTime(lift.savedSeconds) });
    }

    setText(el.cmpVerdict, verdict);
    el.cmpVerdict.classList.toggle('is-stairs', lift.fasterOption === 'stairs');
    el.cmpVerdict.classList.toggle('is-elevator', lift.fasterOption === 'elevator');
  }

  function renderDetail() {
    var lift = findElevator(state.openId);
    if (!lift) return;

    setText(el.detailTitle, elevatorName(lift));
    setText(el.detailSubtitle, state.address);

    renderCamera(lift);

    var percent = Math.min(Math.round((lift.occupancy / lift.capacity) * 100), 100);
    setNumber(el.dOccupancy, lift.occupancy, function (value) {
      return value + ' / ' + lift.capacity;
    });
    el.dBar.style.width = percent + '%';
    occupancyCard.dataset.status = lift.status;

    setText(el.dWaiting, lift.waiting + ' ' + pl('detail.people', lift.waiting));

    renderWaitCard(lift);

    setNumber(el.dFloor, lift.currentFloor);
    setDirection(el.dDirection, directions[lift.id] || '•');

    // Риски зависят от этажности корпуса — строим их при смене лифта
    if (detailTicksFor !== lift.id) {
      el.dTicks.innerHTML = ticksHtml(lift.floors);
      detailTicksFor = lift.id;
    }
    el.dCabin.style.bottom = cabinOffset(floorRatio(lift));

    var isWait = lift.recommendation === 'wait';
    setText(el.dRec, isWait ? t('rec.wait') : t('rec.stairs'));
    el.dRec.classList.toggle('is-wait', isWait);
    el.dRec.classList.toggle('is-stairs', !isWait);

    renderCompare(lift);
  }

  // ---------- Жалоба на лифт ----------

  function buildReportReasons() {
    var html = '';

    REPORT_REASONS.forEach(function (key) {
      html += '<button class="sheet__option' + (reportReason === key ? ' is-active' : '') +
        '" type="button" data-reason="' + key + '">' + t('report.' + key) + '</button>';
    });

    el.reportReasons.innerHTML = html;
  }

  function openSheet() {
    reportReason = null;
    el.reportComment.value = '';
    buildReportReasons();

    el.sheetBackdrop.hidden = false;
    el.sheet.hidden = false;
    el.sheet.classList.remove('is-closing');
    el.sheetBackdrop.classList.remove('is-closing');
  }

  function closeSheet() {
    el.sheet.classList.add('is-closing');
    el.sheetBackdrop.classList.add('is-closing');

    // Прячем после анимации уезда вниз
    setTimeout(function () {
      el.sheet.hidden = true;
      el.sheetBackdrop.hidden = true;
      el.sheet.classList.remove('is-closing');
      el.sheetBackdrop.classList.remove('is-closing');
    }, 260);
  }

  /** Короткое сообщение внизу экрана. */
  function showToast(message) {
    clearTimeout(toastTimer);

    setText(el.toast, message);
    el.toast.hidden = false;
    el.toast.classList.remove('is-closing');

    toastTimer = setTimeout(function () {
      el.toast.classList.add('is-closing');
      setTimeout(function () {
        el.toast.hidden = true;
        el.toast.classList.remove('is-closing');
      }, 300);
    }, 3000);
  }

  function submitReport() {
    if (!reportReason || state.openId === null) return;

    el.reportSubmit.classList.add('is-busy');
    setText(el.reportSubmit, t('report.sending'));

    fetch('api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elevatorId: state.openId,
        reason: reportReason,
        comment: el.reportComment.value
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () {
        closeSheet();
        showToast(t('report.thanks'));
      })
      .catch(function (err) {
        console.error('TIU GO: не удалось отправить отчёт', err);
        closeSheet();
        showToast(t('report.error'));
      })
      .then(function () {
        el.reportSubmit.classList.remove('is-busy');
        setText(el.reportSubmit, t('report.submit'));
      });
  }

  // ---------- Навигация ----------

  /** Перезапускает анимацию появления экрана (push — вперёд, pop — назад). */
  function animateScreen(node, cls) {
    node.classList.remove('screen--push', 'screen--pop');
    void node.offsetWidth; // перезапуск CSS-анимации
    node.classList.add(cls);

    // Класс обязательно снимаем: пока на экране висит анимация transform,
    // он становится containing block и ломает position: fixed у навбара
    // и нижнего тулбара — они начинают ездить вместе с контентом.
    var cleanup = function () {
      node.classList.remove(cls);
      node.removeEventListener('animationend', cleanup);
      clearTimeout(guard);
    };

    var guard = setTimeout(cleanup, 600); // страховка, если событие не придёт
    node.addEventListener('animationend', cleanup);
  }

  function showDetail(id) {
    state.openId = id;

    // На экране детали цифры начинают отсчёт заново, без анимации от чужих значений
    [el.dOccupancy, el.dFloor, el.dWait].forEach(resetNumber);

    el.home.hidden = true;
    el.detail.hidden = false;
    window.scrollTo(0, 0);
    toggleHostBackButton(true);
    renderDetail();
    animateScreen(el.detail, 'screen--push');
  }

  function showHome() {
    state.openId = null;
    el.detail.hidden = true;
    el.home.hidden = false;
    window.scrollTo(0, 0);
    toggleHostBackButton(false);
    renderHome();
    animateScreen(el.home, 'screen--pop');
    onScroll();
  }

  // ---------- Компактный навбар списка ----------

  // Навбар проявляется ровно в тот момент, когда крупный заголовок
  // уезжает под него — как в списках iOS.
  var titleEdge = 60;

  function measureTitle() {
    var title = document.querySelector('.hero__title');
    if (title) {
      titleEdge = Math.max(title.offsetTop + title.offsetHeight - 46, 24);
    }
  }

  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    el.topbar.classList.toggle('is-visible', y > titleEdge);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () {
    measureTitle();
    onScroll();
  });

  // ---------- Отрисовка по свежим данным ----------
  function render() {
    if (state.openId !== null) renderDetail();
    else renderHome();
  }

  // ---------- Кэш ----------

  function saveCache(data) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        cachedAt: Date.now(),
        data: data
      }));
    } catch (e) { /* приватный режим или нет места — не беда */ }
  }

  function readCache() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(CACHE_KEY));
      if (raw && raw.data && Array.isArray(raw.data.elevators)) return raw;
    } catch (e) {}
    return null;
  }

  /** Плашка «данные из кэша» и сдвиг навбара под неё. */
  function setOffline(isOffline, cachedAt) {
    document.body.classList.toggle('is-offline', isOffline);
    el.offline.hidden = !isOffline;
    el.dot.classList.toggle('is-off', isOffline);

    if (!isOffline) return;

    setText(el.offlineText, t('offline.title', { time: formatClock(cachedAt) }));
    document.documentElement.style.setProperty(
      '--offline-h', el.offline.offsetHeight + 10 + 'px'
    );
  }

  // ---------- Загрузка данных ----------

  /** Раскладывает ответ сервера по состоянию. */
  function applyData(data) {
    state.elevators = data.elevators || [];
    state.address = data.address || state.address;
    state.refreshMs = data.refreshMs || state.refreshMs;
    state.peak = {
      isPeak: !!data.isPeak,
      peakSoon: !!data.peakSoon,
      minutesUntilPeak: data.minutesUntilPeak,
      peakLabel: data.peakLabel,
      peakKey: data.peakKey
    };

    updateDirections(state.elevators);
  }

  function load() {
    el.dot.classList.add('is-blink'); // короткое мигание — данные тянутся

    return fetch('api/status?destination=' + destination, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        applyData(data);
        saveCache(data);

        state.loaded = true;
        state.failed = false;
        state.fromCache = false;

        setOffline(false);
        render();
      })
      .catch(function (err) {
        console.error('TIU GO: не удалось получить статус', err);

        var cached = readCache();

        if (cached) {
          // Показываем последние удачные данные и честно помечаем их временем
          applyData(cached.data);
          state.loaded = true;
          state.failed = false;
          state.fromCache = true;
          state.cachedAt = cached.cachedAt;

          setOffline(true, cached.cachedAt);
        } else {
          // Кэша нет — покажем пустой экран, но индикатор всё равно гасим
          state.failed = true;
          setOffline(false);
          el.dot.classList.add('is-off');
        }

        render();
      })
      .then(function () {
        el.dot.classList.remove('is-blink');
      });
  }

  function startPolling() {
    clearInterval(timer);
    timer = setInterval(load, state.refreshMs);
  }

  // ---------- События ----------

  el.grid.addEventListener('click', function (event) {
    // Звезда не должна открывать карточку
    var star = event.target.closest('.tile__star');
    if (star) {
      event.stopPropagation();
      event.preventDefault();
      toggleFavorite(Number(star.dataset.star));
      return;
    }

    var tile = event.target.closest('.tile');
    if (!tile) return;
    haptic();
    showDetail(Number(tile.dataset.id));
  });

  el.destination.addEventListener('click', function (event) {
    var pill = event.target.closest('.floor-pill');
    if (!pill) return;
    setDestination(Number(pill.dataset.floor));
  });

  el.themeToggle.addEventListener('click', toggleTheme);
  el.langToggle.addEventListener('click', toggleLang);

  // Иконка лифта в шапке — быстрый подъём к началу списка
  el.sysBtn.addEventListener('click', function () {
    haptic();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.emptyRetry.addEventListener('click', function () {
    haptic();
    el.emptyRetry.classList.add('is-busy');
    setText(el.emptyRetryText, t('empty.retrying'));

    load();

    // Кнопку возвращаем через две секунды, как и просили
    setTimeout(function () {
      el.emptyRetry.classList.remove('is-busy');
      setText(el.emptyRetryText, t('empty.retry'));
    }, 2000);
  });

  el.back.addEventListener('click', function () {
    haptic();
    showHome();
  });

  el.refresh.addEventListener('click', function () {
    haptic();
    el.refresh.classList.add('is-busy');
    setText(el.refresh, t('detail.refreshing'));

    load().then(function () {
      el.refresh.classList.remove('is-busy');
      setText(el.refresh, t('detail.refresh'));
    });
  });

  el.reportOpen.addEventListener('click', function () {
    haptic();
    openSheet();
  });

  el.reportReasons.addEventListener('click', function (event) {
    var option = event.target.closest('.sheet__option');
    if (!option) return;

    reportReason = option.dataset.reason;
    haptic();

    var options = el.reportReasons.children;
    for (var i = 0; i < options.length; i += 1) {
      options[i].classList.toggle('is-active', options[i] === option);
    }
  });

  el.reportCancel.addEventListener('click', closeSheet);
  el.sheetBackdrop.addEventListener('click', closeSheet);
  el.reportSubmit.addEventListener('click', submitReport);

  // Пока мини-апп свёрнут — не дёргаем сервер, при возврате обновляемся сразу
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearInterval(timer);
    } else {
      load();
      startPolling();
    }
  });

  // ---------- Старт ----------
  function start() {
    lang = readStoredLang() || I18N.DEFAULT;
    favorites = readFavorites();
    destination = readDestination();

    initHost();
    applyLang(); // заодно строит кнопки этажей и причин жалобы

    measureTitle();
    onScroll();
    load();
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
