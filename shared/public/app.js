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
  var ICONS = window.TIU_ICONS;
  var icon = ICONS.icon;

  // ---------- Ключи в localStorage ----------
  var THEME_KEY = 'tiu-go-theme';
  var FAV_KEY = 'tiu-go-favorites';
  var LANG_KEY = 'tiu-go-lang';
  var DEST_KEY = 'tiu-go-destination';
  var CACHE_KEY = 'tiu-go-cache';
  var NOTIF_KEY = 'tiu-go-notifications';

  var THEME_BG = { dark: '#0B0D12', light: '#F7F8FA' };

  // Сколько этажей показывать в выборе назначения. Значение приходит
  // с сервера вместе со статусом; до первого ответа берём высоту корпуса.
  var DESTINATION_FLOORS = 16;

  // Причины жалобы: ключ уходит на сервер, подпись берётся из словаря
  var REPORT_REASONS = ['broken', 'slow', 'noise', 'dirty', 'other'];

  // Типы уведомлений: порядок задаёт порядок чекбоксов в настройках
  var NOTIFY_TYPES = ['crowd', 'arriving', 'peak', 'broken', 'full'];

  // Порог уведомления об очереди. Раньше он считался по одному этажу,
  // теперь — по всей очереди в холле первого этажа, поэтому и границы
  // шире: двенадцать человек внизу это уже заметная очередь.
  var THRESHOLD_MIN = 5;
  var THRESHOLD_MAX = 30;

  // Начальные настройки уведомлений: молчим, пока человек сам не включит
  var DEFAULT_NOTIFICATIONS = {
    enabled: false,
    floor: 1,
    threshold: 12,
    types: { crowd: true, arriving: true, peak: true, broken: true, full: false }
  };

  // ---------- Состояние ----------
  var state = {
    elevators: [],
    address: '',
    openId: null,   // id открытого лифта или null, если мы на главном экране
    refreshMs: 3000,
    floors: DESTINATION_FLOORS,
    total: 0,       // всего лифтов в корпусе
    working: 0,     // из них на ходу
    cameraFloor: 1, // этаж, где стоят камеры — приходит с сервера
    queueAtFirstFloor: 0, // суммарная очередь внизу по всем лифтам
    loaded: false,  // пришли ли данные хотя бы раз
    failed: false,  // последний запрос не удался и кэша не нашлось
    fromCache: false,
    cachedAt: null
  };

  var lang = I18N.DEFAULT;
  var destination = 1;
  var favorites = []; // id избранных лифтов
  var notifications = null; // настройки уведомлений, см. readNotifications()

  var prevFloors = {};   // id лифта -> этаж на прошлом обновлении
  var directions = {};   // id лифта -> 'up' | 'down' | 'idle'
  var tiles = {};        // id лифта -> ссылки на узлы карточки
  var gridKey = '';      // порядок и состав карточек, по которому собрана сетка
  var detailTicksFor = null; // для какого лифта построены риски крупной шахты
  var timer = null;
  var toastTimer = null;
  var reportReason = null;
  var openSheetNode = null;  // какая из нижних модалок сейчас открыта

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
    working: $('working'),
    workingText: $('working-text'),
    floorbar: $('floorbar'),
    floorbarIcon: $('floorbar-icon'),
    floorbarText: $('floorbar-text'),
    floorbarHint: $('floorbar-hint'),
    themeColor: $('theme-color'),
    home: $('screen-home'),
    detail: $('screen-detail'),
    summary: $('summary'),
    skeleton: $('skeleton'),
    grid: $('grid'),
    empty: $('empty'),
    emptyText: $('empty-text'),
    emptyRetry: $('empty-retry'),
    emptyRetryText: $('empty-retry-text'),
    updated: $('updated'),
    brand: $('brand'),
    detailHome: $('detail-home'),
    detailTitle: $('detail-title'),
    detailSubtitle: $('detail-subtitle'),
    destination: $('destination'),
    detailCamera: $('detail-camera'),
    detailDown: $('detail-down'),
    downIcon: $('down-icon'),
    downTitle: $('down-title'),
    downNote: $('down-note'),
    cameraScene: $('camera-scene'),
    cameraBadge: $('camera-badge'),
    dOccupancy: $('d-occupancy'),
    dBar: $('d-bar'),
    dWaiting: $('d-waiting'),
    dWait: $('d-wait'),
    dWaitUnit: $('d-wait-unit'),
    dConfidence: $('d-confidence'),
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
    refreshIcon: $('refresh-icon'),
    refreshText: $('refresh-text'),
    reportOpen: $('report-open'),
    sheet: $('sheet'),
    sheetBackdrop: $('sheet-backdrop'),
    reportReasons: $('report-reasons'),
    reportComment: $('report-comment'),
    reportCancel: $('report-cancel'),
    reportSubmit: $('report-submit'),
    notifOpen: $('notif-open'),
    notifSheet: $('notif-sheet'),
    notifScroll: document.querySelector('#notif-sheet .sheet__scroll'),
    notifEnabled: $('notif-enabled'),
    notifFloors: $('notif-floors'),
    notifTypes: $('notif-types'),
    notifThreshold: $('notif-threshold'),
    notifThresholdLabel: $('notif-threshold-label'),
    notifSave: $('notif-save'),
    notifCancel: $('notif-cancel'),
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
    setText(el.langLabel, I18N.label(lang));

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
    buildNotifTypes();
    syncNotifForm(); // подписи типов и порога тоже переводятся
    render(); // динамические строки пересобираем сразу
  }

  function toggleLang() {
    // Языков больше двух, поэтому кнопка листает их по кругу: RU → EN → 中文
    lang = I18N.nextLang(lang);
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
      try { tg.BackButton.onClick(closeDetail); } catch (e) {}
    }

    // Системная кнопка «назад» в MAX.
    // TODO: сверить имя события и объект с документацией — https://dev.max.ru/docs
    if (mx) {
      try {
        if (mx.BackButton && mx.BackButton.onClick) mx.BackButton.onClick(closeDetail);
        else if (typeof mx.on === 'function') mx.on('back', closeDetail);
      } catch (e) {}
    }

    applyTheme(currentTheme()); // синхронизируем иконку и цвета клиента
  }

  /** Показывает или прячет системную кнопку «назад» клиента. */
  function toggleHostBackButton(visible) {
    [tgApp(), maxApp()].forEach(function (host) {
      if (!host || !host.BackButton) return;
      try {
        if (visible) host.BackButton.show();
        else host.BackButton.hide();
      } catch (e) {}
    });
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
    el.themeIcon.innerHTML = icon(theme === 'light' ? 'sun' : 'moon');
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
      if (value >= 1 && value <= state.floors) return value;
    } catch (e) {}
    return 1;
  }

  /** Лента кнопок с номерами этажей. Используется и для назначения, и для «моего этажа». */
  function floorPills(selected) {
    var html = '';

    for (var floor = 1; floor <= state.floors; floor += 1) {
      html += '<button class="floor-pill' + (floor === selected ? ' is-active' : '') +
        '" type="button" data-floor="' + floor + '">' + floor + '</button>';
    }

    return html;
  }

  /** Отмечает выбранную таблетку в уже построенной ленте. */
  function markFloor(container, floor) {
    var pills = container.children;
    for (var i = 0; i < pills.length; i += 1) {
      pills[i].classList.toggle('is-active', Number(pills[i].dataset.floor) === floor);
    }
  }

  /** Кнопки-таблетки с этажами на экране лифта и в настройках уведомлений. */
  function buildDestination() {
    el.destination.innerHTML = floorPills(destination);
    el.notifFloors.innerHTML = floorPills(notifications ? Number(notifications.floor) : 1);
  }

  /**
   * Подкручивает ленту к выбранному этажу. Вызывается при открытии экрана:
   * пока он скрыт, у кнопок нет геометрии и прокрутка не сработала бы.
   */
  function revealDestination() {
    var active = el.destination.querySelector('.is-active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function setDestination(floor) {
    destination = floor;
    try { window.localStorage.setItem(DEST_KEY, String(floor)); } catch (e) {}

    markFloor(el.destination, floor);

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

  /**
   * Переключает символ у уже существующей иконки <svg class="icon">.
   * Меняем ссылку в <use>, а не весь HTML: так браузер не пересоздаёт
   * узел и не сбрасывает идущие на нём анимации.
   */
  function setIcon(node, name) {
    var use = node.tagName.toLowerCase() === 'use' ? node : node.querySelector('use');
    if (!use) return;

    var href = '#icon-' + name;
    if (use.getAttribute('href') !== href) use.setAttribute('href', href);
  }

  /**
   * Проигрывает анимацию один раз и снимает класс по её окончании.
   *
   * Перезапуск сделан через getBoundingClientRect, а не через offsetWidth:
   * у SVG-элементов offsetWidth нет вообще, и чтение undefined не заставляет
   * браузер пересчитать layout — класс снимался и ставился в одной задаче,
   * браузер смены не замечал, и иконка переставала крутиться со второго раза.
   *
   * Страховка по таймеру нужна на случай, если animationend не придёт:
   * на скрытой вкладке анимации не идут, а класс иначе остался бы навсегда.
   */
  function playOnce(node, cls, duration) {
    if (!node) return;

    node.classList.remove(cls);
    node.getBoundingClientRect(); // форсируем layout — работает и для SVG
    node.classList.add(cls);

    var guard = null;

    var done = function () {
      node.classList.remove(cls);
      node.removeEventListener('animationend', done);
      clearTimeout(guard);
    };

    guard = setTimeout(done, (duration || 800) + 100);
    node.addEventListener('animationend', done);
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
    return t('tile.elevatorName', { n: lift.number });
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

  /**
   * Прогноз диапазоном: «~25–40 сек», «~1 мин 20 сек – 2 мин».
   * Пока обе границы не дотягивают до минуты, единицу пишем один раз —
   * «25–40 сек» читается быстрее, чем «25 сек – 40 сек».
   */
  function formatRange(min, max) {
    if (min === null || min === undefined || max === null || max === undefined) {
      return '—';
    }

    var low = Math.max(Math.round(min), 0);
    var high = Math.max(Math.round(max), low);

    if (high < 60) return '~' + low + '–' + high + ' ' + t('time.sec');

    return '~' + formatWaitTime(low) + ' – ' + formatWaitTime(high);
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

  /**
   * Ставит в элемент диапазон «~25–40 сек». Перекатывать две цифры сразу
   * бессмысленно, поэтому здесь только короткий подскок при смене текста.
   */
  function setRange(element, min, max) {
    resetNumber(element); // диапазон и анимированное число не должны мешать друг другу

    var text = formatRange(min, max);
    if (element.textContent === text) return;

    element.textContent = text;
    popNumber(element);
  }

  /**
   * Прочерк вместо значения. Отдельный класс нужен из-за кегля: крупная
   * цифра этажа набрана 38 пикселями, и тире такого размера выглядит
   * жирной чертой, а не отсутствием данных.
   */
  function setDash(node) {
    resetNumber(node);
    node.classList.add('is-dash');
    setText(node, '—');
  }

  /** Снимает режим прочерка перед выводом настоящего числа. */
  function clearDash(node) {
    node.classList.remove('is-dash');
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

  /** Обновляет стрелку направления: вверх, вниз или прочерк, если стоит. */
  function setDirection(node, direction) {
    var name = ICONS.directionIcon(direction);

    // Первый раз вставляем саму иконку, дальше меняем только ссылку на символ
    if (!node.firstElementChild) node.innerHTML = icon(name);
    else setIcon(node, name);

    node.classList.toggle('is-moving', direction !== 'idle');
  }

  /**
   * Направление считаем сами — сравниваем этаж с предыдущим обновлением.
   * Заодно запоминаем новое значение для следующего сравнения.
   */
  function updateDirections(list) {
    list.forEach(function (lift) {
      var prev = prevFloors[lift.id];
      var direction = 'idle';

      // Неработающая кабина стоит, даже если этаж в данных почему-то съехал
      if (prev !== undefined && lift.available !== false) {
        if (lift.currentFloor > prev) direction = 'up';
        else if (lift.currentFloor < prev) direction = 'down';
      }

      directions[lift.id] = direction;
      prevFloors[lift.id] = lift.currentFloor;
    });
  }

  // ---------- Статус работы лифта ----------

  /** Сломан или на обслуживании — прогнозов и цифр по нему нет. */
  function isDown(lift) {
    return lift.available === false;
  }

  /** Иконка для статуса работы: сломан, обслуживание или всё в порядке. */
  function workIcon(workStatus) {
    if (workStatus === 'broken') return 'status-broken';
    if (workStatus === 'maintenance') return 'status-maintenance';
    return 'check';
  }

  // ---------- Главный экран ----------

  function renderSummary() {
    // Пока данных нет, в сводке нечего считать
    if (!state.loaded) {
      setText(el.summary, state.failed ? '' : t('home.loading'));
      return;
    }

    // Считаем только те лифты, на которых реально можно уехать
    var total = state.elevators.length;
    var free = 0;
    var full = 0;

    state.elevators.forEach(function (lift) {
      if (isDown(lift)) return;
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

  /**
   * Сводка по работе лифтов. Показывается только когда работают не все —
   * «работают 6 из 6» это и так состояние по умолчанию.
   */
  function renderWorking() {
    if (!state.loaded || !state.total || state.working >= state.total) {
      el.working.hidden = true;
      return;
    }

    setText(el.workingText, t('summary.working', {
      working: state.working,
      total: state.total,
      word: pl('summary.elevators', state.total)
    }));

    el.working.hidden = false;
  }

  // Границы очереди в холле первого этажа. До пяти человек — свободно,
  // с шестого начинается очередь, с шестнадцатого — большая.
  var QUEUE_FREE_MAX = 5;
  var QUEUE_BIG_MIN = 16;

  // С какой длины очереди у одного лифта стоит отдельно о нём предупредить
  var QUEUE_HINT_MIN = 11;

  /** Суммарная очередь в холле первого этажа по всем рабочим лифтам. */
  function firstFloorQueue() {
    return state.elevators.reduce(function (sum, lift) {
      return isDown(lift) ? sum : sum + (lift.waitingFirstFloor || 0);
    }, 0);
  }

  /** Лифт с самой длинной очередью внизу — к нему стоять дольше всего. */
  function busiestLift() {
    return state.elevators
      .filter(function (lift) { return !isDown(lift); })
      .reduce(function (a, b) {
        return !a || (b.waitingFirstFloor || 0) > (a.waitingFirstFloor || 0) ? b : a;
      }, null);
  }

  /**
   * Цветная плашка про первый этаж: сколько человек ждёт лифты внизу.
   *
   * Это единственное место в интерфейсе, где видна обстановка по этажу,
   * и показывает оно ровно то, что умеют камеры: очередь в холле первого
   * этажа. Данных по другим этажам в системе нет, и выдумывать их незачем.
   */
  function renderFloorBar() {
    if (!state.loaded || !state.elevators.length) {
      el.floorbar.hidden = true;
      return;
    }

    var queue = firstFloorQueue();
    var params = {
      n: queue,
      people: pl('detail.people', queue),
      verb: pl('floor.waitVerb', queue)
    };

    var level = 'ok';
    var text = t('floor.free', params);

    if (queue >= QUEUE_BIG_MIN) {
      level = 'full';
      text = t('floor.bigQueue', params);
    } else if (queue > QUEUE_FREE_MAX) {
      level = 'busy';
      text = t('floor.queue', params);
    }

    el.floorbar.dataset.level = level;
    setIcon(el.floorbarIcon, ICONS.statusIcon(level));
    setText(el.floorbarText, text);

    // Если у одного лифта очередь заметно длиннее, на него стоит указать:
    // к соседнему можно встать и уехать раньше
    var busiest = busiestLift();
    var showHint = busiest && (busiest.waitingFirstFloor || 0) >= QUEUE_HINT_MIN;

    el.floorbarHint.hidden = !showHint;
    if (showHint) setText(el.floorbarHint, t('floor.longest', { n: busiest.number }));

    el.floorbar.setAttribute('aria-label', text + '. ' + t('floor.open'));
    el.floorbar.hidden = false;
  }

  /** Иконка лифта в шапке: сколько свободно и каким цветом это показать. */
  function renderSysStatus() {
    var free = 0;
    var busy = 0;

    state.elevators.forEach(function (lift) {
      if (isDown(lift)) return;
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
        // Бейдж статуса работы стоит рядом со звездой и скрыт у рабочего лифта
        '<span class="badge" hidden>' + icon('status-broken') +
          '<span class="badge__text"></span></span>' +
        '<span class="tile__star" data-star="' + lift.id + '">' + icon('star') + '</span>' +
      '</span>' +

      '<span class="tile__floor">' +
        '<span class="shaft">' + ticksHtml(lift.floors) +
          '<span class="shaft__cabin"></span>' +
        '</span>' +
        '<span class="tile__floor-num"><b></b><span></span></span>' +
        '<span class="dir"></span>' +
      '</span>' +

      '<span class="tile__row"><span></span><b></b></span>' +
      '<span class="bar"><i style="width:0%"></i></span>' +

      '<span class="tile__wait">' +
        '<span class="tile__wait-label">' + icon('users') + '<span></span></span>' +
        '<b></b>' +
      '</span>' +

      // Прогноз диапазоном и точка уверенности рядом с ним
      '<span class="tile__eta">' + icon('clock') + '<b></b>' +
        '<i class="confidence" data-level="high"></i></span>' +

      '<span class="pill"></span>';

    return {
      root: root,
      name: root.querySelector('.tile__name'),
      loc: root.querySelector('.tile__loc'),
      badge: root.querySelector('.badge'),
      badgeIcon: root.querySelector('.badge .icon'),
      badgeText: root.querySelector('.badge__text'),
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
      confidence: root.querySelector('.tile__eta .confidence'),
      pill: root.querySelector('.pill')
    };
  }

  /** Обновляет значения в уже построенной карточке. */
  function updateTile(tile, lift) {
    var down = isDown(lift);

    if (tile.root.dataset.status !== lift.status) {
      tile.root.dataset.status = lift.status;
    }

    // data-work включает приглушение карточки и перечёркнутый заголовок
    if (tile.root.dataset.work !== lift.workStatus) {
      tile.root.dataset.work = lift.workStatus;
    }

    // Бейдж: «Сломан» или «Обслуживание». У рабочего лифта бейджа нет.
    tile.badge.hidden = !down;
    if (down) {
      tile.badge.dataset.work = lift.workStatus;
      setIcon(tile.badgeIcon, workIcon(lift.workStatus));
      setText(tile.badgeText, t('status.' + lift.workStatus));
      tile.badge.setAttribute('title', lift.statusNote || t('status.' + lift.workStatus));
    }

    var favorite = isFavorite(lift.id);
    tile.root.dataset.fav = favorite ? '1' : '0';
    tile.star.classList.toggle('is-on', favorite);
    setIcon(tile.star, favorite ? 'star-filled' : 'star');
    tile.star.setAttribute('aria-label', t('tile.favorite'));

    setText(tile.name, elevatorName(lift));
    setText(tile.loc, state.address);     // адрес один на все лифты
    setText(tile.floorLabel, t('tile.floor'));
    setText(tile.cabinLabel, t('tile.inCabin'));
    setText(tile.waitLabel, t('tile.waiting'));

    // Неработающий лифт показывает прочерки: любая цифра здесь была бы ложью
    if (down) {
      [tile.floor, tile.occupancy, tile.waiting, tile.eta].forEach(setDash);

      tile.bar.style.width = '0%';
      tile.confidence.hidden = true;
    } else {
      [tile.floor, tile.occupancy, tile.waiting, tile.eta].forEach(clearDash);

      setText(tile.floor, lift.currentFloor);

      // «2 / 5» — анимируем первую цифру, вместимость подставляем как есть
      setNumber(tile.occupancy, lift.occupancy, function (value) {
        return value + ' / ' + lift.capacity;
      });

      var percent = Math.min(Math.round((lift.occupancy / lift.capacity) * 100), 100);
      tile.bar.style.width = percent + '%';

      setNumber(tile.waiting, lift.waitingFirstFloor);

      // Прогноз ожидания диапазоном: «~25–40 сек»
      setRange(tile.eta, lift.waitTimeMin, lift.waitTimeMax);

      tile.confidence.hidden = false;
      tile.confidence.dataset.level = lift.confidence || 'medium';
      tile.confidence.setAttribute('title', t('forecast.' + (lift.confidence || 'medium')));
    }

    setDirection(tile.dir, down ? 'idle' : (directions[lift.id] || 'idle'));

    // кабина едет плавно: переход задан в CSS (0.6s ease-in-out)
    tile.cabin.style.bottom = cabinOffset(floorRatio(lift));

    var isWait = lift.recommendation === 'wait';
    var pillClass = 'pill ' + (down ? 'pill--down' : (isWait ? 'pill--wait' : 'pill--stairs'));
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
    renderWorking();
    renderFloorBar();
    pingOnFloorAlert();
    renderSysStatus();

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
        t('camera.tag') + ' ' + index + '</text>';
  }

  /**
   * Стилизованный кадр с камеры в холле первого этажа: двери лифта
   * и очередь перед ними. Внутрь кабины камера не смотрит и других
   * этажей не видит — только зону ожидания внизу.
   */
  function renderCamera(lift) {
    var W = 320;
    var H = 180;
    var queue = lift.waitingFirstFloor || 0;
    var shown = Math.min(queue, 6); // больше шести силуэтов кадр не вмещает

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
        ' ' + t('camera.floorShort') + '</text>' +

      // кнопка вызова
      '<circle cx="222" cy="78" r="3.5" fill="#3A3A3C"/>' +

      // служебная подпись камеры
      '<text x="10" y="17" font-size="7.5" ' +
        'font-family="-apple-system, system-ui, sans-serif" ' +
        'font-weight="500" fill="#8E8E93" opacity="0.75">CAM-0' + lift.id +
        ' · ' + t('camera.area') + '</text>';

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

    if (queue > shown) {
      svg += '<text x="' + (W - 10) + '" y="17" text-anchor="end" font-size="7.5" ' +
        'font-family="-apple-system, system-ui, sans-serif" font-weight="600" fill="#0A84FF">+' +
        (queue - shown) + '</text>';
    }

    svg += '</svg>';

    el.cameraScene.innerHTML = svg;
    setText(el.cameraBadge, t('detail.cameraBadge', {
      n: queue,
      verb: pl('floor.waitVerb', queue)
    }));
  }

  // ---------- Экран детали ----------

  /**
   * Карточка «Ожидание»: прогноз диапазоном плюс точка уверенности.
   * Единица измерения входит в сам диапазон, поэтому отдельная подпись
   * под цифрой больше не нужна.
   */
  function renderWaitCard(lift) {
    el.dWaitUnit.hidden = true;
    el.dWait.classList.add('metric__value--range');

    if (isDown(lift)) {
      setDash(el.dWait);
      el.dConfidence.hidden = true;
      return;
    }

    clearDash(el.dWait);
    setRange(el.dWait, lift.waitTimeMin, lift.waitTimeMax);

    var level = lift.confidence || 'medium';
    el.dConfidence.hidden = false;
    el.dConfidence.dataset.level = level;
    el.dConfidence.setAttribute('title', t('forecast.' + level));
  }

  /** Карточка «Сравнение»: лифт против лестницы для выбранного этажа. */
  function renderCompare(lift) {
    // У неработающего лифта времени нет — сравнивать не с чем
    setText(el.cmpElevatorTime, lift.elevatorTotal === null
      ? '—'
      : '~' + formatWaitTime(lift.elevatorTotal));
    setText(el.cmpStairsTime, '~' + formatWaitTime(lift.stairsTime));

    el.cmpElevator.classList.toggle('is-faster', lift.fasterOption === 'elevator');
    el.cmpStairs.classList.toggle('is-faster', lift.fasterOption === 'stairs');

    var verdict = t('compare.equal');
    if (lift.savedSeconds === null) {
      verdict = t('status.unavailable');
    } else if (lift.fasterOption === 'stairs') {
      verdict = t('compare.stairsFaster', { time: formatWaitTime(lift.savedSeconds) });
    } else if (lift.fasterOption === 'elevator') {
      verdict = t('compare.elevatorFaster', { time: formatWaitTime(lift.savedSeconds) });
    }

    setText(el.cmpVerdict, verdict);
    el.cmpVerdict.classList.toggle('is-stairs', lift.fasterOption === 'stairs');
    el.cmpVerdict.classList.toggle('is-elevator', lift.fasterOption === 'elevator');
  }

  /**
   * Плашка «лифт не работает» вместо кадра камеры. Смысл в том, что
   * у неработающего лифта зона ожидания пуста и показывать её бессмысленно,
   * а человеку нужна причина и срок.
   */
  function renderDownPanel(lift) {
    var down = isDown(lift);

    el.detailDown.hidden = !down;
    el.detailCamera.hidden = down;

    if (!down) return;

    el.detailDown.dataset.work = lift.workStatus;
    setIcon(el.downIcon, workIcon(lift.workStatus));
    setText(el.downTitle, t('status.unavailable'));
    setText(el.downNote, lift.statusNote || t('status.noNote'));
  }

  function renderDetail() {
    var lift = findElevator(state.openId);
    if (!lift) return;

    var down = isDown(lift);

    setText(el.detailTitle, elevatorName(lift));
    setText(el.detailSubtitle, state.address);

    renderDownPanel(lift);
    if (!down) renderCamera(lift);

    if (down) {
      // Никаких цифр: кабина стоит, камера зону ожидания уже не показывает
      [el.dOccupancy, el.dWaiting, el.dFloor].forEach(setDash);

      el.dBar.style.width = '0%';
      occupancyCard.dataset.status = '';
    } else {
      [el.dOccupancy, el.dWaiting, el.dFloor].forEach(clearDash);

      var percent = Math.min(Math.round((lift.occupancy / lift.capacity) * 100), 100);
      setNumber(el.dOccupancy, lift.occupancy, function (value) {
        return value + ' / ' + lift.capacity;
      });
      el.dBar.style.width = percent + '%';
      occupancyCard.dataset.status = lift.status;

      setText(el.dWaiting, lift.waitingFirstFloor + ' ' +
        pl('detail.people', lift.waitingFirstFloor));
      setNumber(el.dFloor, lift.currentFloor);
    }

    renderWaitCard(lift);

    setDirection(el.dDirection, down ? 'idle' : (directions[lift.id] || 'idle'));

    // Риски зависят от этажности корпуса — строим их при смене лифта
    if (detailTicksFor !== lift.id) {
      el.dTicks.innerHTML = ticksHtml(lift.floors);
      detailTicksFor = lift.id;
    }
    el.dCabin.style.bottom = cabinOffset(floorRatio(lift));

    var isWait = lift.recommendation === 'wait';
    setText(el.dRec, isWait ? t('rec.wait') : t('rec.stairs'));
    el.dRec.classList.toggle('is-wait', isWait && !down);
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

  /**
   * Нижних модалок две — жалоба и настройки уведомлений. Подложка у них
   * общая, поэтому помним, какая открыта, и закрываем именно её.
   */
  function openSheet(node) {
    openSheetNode = node;

    el.sheetBackdrop.hidden = false;
    node.hidden = false;
    node.classList.remove('is-closing');
    el.sheetBackdrop.classList.remove('is-closing');
  }

  function closeSheet() {
    var node = openSheetNode;
    if (!node) return;

    openSheetNode = null;
    node.classList.add('is-closing');
    el.sheetBackdrop.classList.add('is-closing');

    // Прячем после анимации уезда вниз
    setTimeout(function () {
      node.hidden = true;
      el.sheetBackdrop.hidden = true;
      node.classList.remove('is-closing');
      el.sheetBackdrop.classList.remove('is-closing');
    }, 260);
  }

  function openReportSheet() {
    reportReason = null;
    el.reportComment.value = '';
    buildReportReasons();
    openSheet(el.sheet);
  }

  function openNotifSheet() {
    syncNotifForm();
    openSheet(el.notifSheet);
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

  // ---------- Настройки уведомлений ----------

  /**
   * Настройки читаем из localStorage и обязательно сливаем с значениями по
   * умолчанию: если в следующей версии появится новый тип уведомлений,
   * старая сохранённая запись не должна превратиться в дырявый объект.
   */
  function readNotifications() {
    var saved = null;

    try {
      saved = JSON.parse(window.localStorage.getItem(NOTIF_KEY));
    } catch (e) { /* приватный режим или мусор в хранилище */ }

    if (!saved || typeof saved !== 'object') saved = {};

    var types = {};
    NOTIFY_TYPES.forEach(function (type) {
      var value = saved.types && saved.types[type];
      types[type] = value === undefined
        ? DEFAULT_NOTIFICATIONS.types[type]
        : !!value;
    });

    return {
      enabled: !!saved.enabled,
      // configured отличает «человек открывал настройки» от «никогда не трогал»:
      // плашку «мой этаж» показываем только во втором случае
      configured: !!saved.configured,
      floor: clamp(Math.round(Number(saved.floor)) || DEFAULT_NOTIFICATIONS.floor,
        1, state.floors),
      threshold: clamp(Math.round(Number(saved.threshold)) ||
        DEFAULT_NOTIFICATIONS.threshold, THRESHOLD_MIN, THRESHOLD_MAX),
      types: types
    };
  }

  function saveNotifications() {
    try {
      window.localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications));
    } catch (e) { /* нет места — настройки доживут до конца сессии */ }
  }

  /** Чекбоксы типов уведомлений: подписи приходят из словаря. */
  function buildNotifTypes() {
    var html = '';

    NOTIFY_TYPES.forEach(function (type) {
      html += '<label class="check">' +
        '<input type="checkbox" data-type="' + type + '" />' +
        '<span class="check__box">' + icon('check') + '</span>' +
        '<span>' + t('notif.' + type) + '</span>' +
      '</label>';
    });

    el.notifTypes.innerHTML = html;
  }

  /** Переносит сохранённые настройки в поля формы. */
  function syncNotifForm() {
    el.notifEnabled.checked = notifications.enabled;

    markFloor(el.notifFloors, Number(notifications.floor));

    var boxes = el.notifTypes.querySelectorAll('input[data-type]');
    for (var i = 0; i < boxes.length; i += 1) {
      boxes[i].checked = !!notifications.types[boxes[i].dataset.type];
    }

    el.notifThreshold.value = notifications.threshold;
    renderThresholdLabel();

    // Пока уведомления выключены, остальные поля приглушены
    el.notifScroll.classList.toggle('is-muted', !notifications.enabled);
  }

  function renderThresholdLabel() {
    var value = Number(el.notifThreshold.value);
    setText(el.notifThresholdLabel, t('notif.threshold', {
      n: value,
      people: pl('detail.people', value)
    }));
  }

  /** Считывает форму в настройки. Этаж берётся из активной таблетки. */
  function collectNotifForm() {
    var active = el.notifFloors.querySelector('.is-active');

    notifications.enabled = el.notifEnabled.checked;
    notifications.configured = true;
    notifications.floor = active ? Number(active.dataset.floor) : 1;
    notifications.threshold = clamp(
      Number(el.notifThreshold.value) || DEFAULT_NOTIFICATIONS.threshold,
      THRESHOLD_MIN, THRESHOLD_MAX
    );

    var boxes = el.notifTypes.querySelectorAll('input[data-type]');
    for (var i = 0; i < boxes.length; i += 1) {
      notifications.types[boxes[i].dataset.type] = boxes[i].checked;
    }
  }

  /**
   * Кто мы для бота. Телеграм отдаёт id пользователя в initDataUnsafe;
   * без него подписать человека невозможно — настройки тогда остаются
   * только на устройстве, и мы честно об этом говорим.
   *
   * TODO: сверить путь к данным пользователя в MAX с документацией —
   *       https://dev.max.ru/docs
   */
  function hostChat() {
    var tg = tgApp();
    var tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (tgUser && tgUser.id) {
      return { chatId: String(tgUser.id), platform: 'telegram' };
    }

    var mx = maxApp();
    var mxUser = mx && ((mx.initDataUnsafe && mx.initDataUnsafe.user) || mx.user);
    if (mxUser && mxUser.id) {
      return { chatId: String(mxUser.id), platform: 'max' };
    }

    return null;
  }

  /** Сохраняет настройки и, если мы внутри клиента, подписывает на рассылку. */
  function saveNotifSettings() {
    collectNotifForm();
    saveNotifications();
    renderNotifButton();
    renderFloorBar();

    if (notifications.enabled) {
      playOnce(el.notifSheet.querySelector('.switch .icon'), 'icon--swing', 700);
    }

    var chat = hostChat();

    // Вне Telegram и MAX подписывать некого: пуши шлёт бот, а не браузер
    if (!chat) {
      closeSheet();
      showToast(t('notif.savedLocal'));
      return;
    }

    el.notifSave.classList.add('is-busy');
    setText(el.notifSave, t('notif.saving'));

    fetch('api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: chat.chatId,
        platform: chat.platform,
        floor: notifications.floor,
        lang: lang,
        settings: {
          enabled: notifications.enabled,
          threshold: notifications.threshold,
          types: notifications.types
        }
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () {
        closeSheet();
        showToast(t('notif.saved'));
      })
      .catch(function (err) {
        console.error('TIU GO: не удалось сохранить подписку', err);
        closeSheet();
        showToast(t('notif.error'));
      })
      .then(function () {
        el.notifSave.classList.remove('is-busy');
        setText(el.notifSave, t('notif.save'));
      });
  }

  /** Кнопка-шестерёнка подсвечивается, когда уведомления включены. */
  function renderNotifButton() {
    el.notifOpen.classList.toggle('is-on', !!(notifications && notifications.enabled));
  }

  /**
   * Качнуть колокольчик стоит один раз — в момент, когда внизу
   * действительно собралась большая очередь. Поэтому запоминаем
   * предыдущий уровень и реагируем только на переход в красную зону.
   */
  var lastFloorLevel = null;

  function pingOnFloorAlert() {
    var level = el.floorbar.hidden ? null : el.floorbar.dataset.level;

    if (level === 'full' && lastFloorLevel !== 'full') {
      playOnce(el.notifOpen.querySelector('.icon'), 'icon--swing', 700);
    }

    lastFloorLevel = level;
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

  /**
   * Закрыть экран лифта. Вызывается системной кнопкой клиента, жестом
   * «назад» и кликом по заголовку. Если экран открывали мы и записали
   * состояние в историю — возвращаемся через историю, чтобы она не копилась.
   */
  function closeDetail() {
    if (state.openId === null) return;

    if (window.history.state && window.history.state.tiuGoDetail !== undefined) {
      window.history.back(); // дальше сработает popstate и покажет главный экран
    } else {
      showHome();
    }
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
    revealDestination();
    animateScreen(el.detail, 'screen--push');

    // Отдельная запись в истории: без неё системный свайп «назад»
    // закрывал бы всё мини-приложение, а не экран лифта.
    try { window.history.pushState({ tiuGoDetail: id }, ''); } catch (e) {}
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
    state.total = data.total || state.elevators.length;
    state.working = data.working === undefined ? state.total : data.working;
    state.cameraFloor = data.cameraFloor || state.cameraFloor;
    state.queueAtFirstFloor = data.queueAtFirstFloor || 0;

    // Этажность приходит с сервера: ленты выбора этажа строятся по ней
    if (data.floors && data.floors !== state.floors) {
      state.floors = data.floors;
      buildDestination();
    }

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

  // Системный жест «назад» и кнопка браузера
  window.addEventListener('popstate', function () {
    if (state.openId !== null) showHome();
  });

  // Запасные способы вернуться там, где системной кнопки нет:
  // заголовок экрана лифта и логотип в шапке
  el.detailHome.addEventListener('click', function () {
    haptic();
    closeDetail();
  });

  el.detailHome.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      closeDetail();
    }
  });

  el.brand.addEventListener('click', function () {
    if (state.openId !== null) closeDetail();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.refresh.addEventListener('click', function () {
    haptic();
    playOnce(el.refreshIcon, 'icon--spin', 600); // оборот иконки на время запроса
    el.refresh.classList.add('is-busy');
    setText(el.refreshText, t('detail.refreshing'));

    load().then(function () {
      el.refresh.classList.remove('is-busy');
      setText(el.refreshText, t('detail.refresh'));
    });
  });

  el.reportOpen.addEventListener('click', function () {
    haptic();
    openReportSheet();
  });

  // ── Уведомления ──
  el.notifOpen.addEventListener('click', function () {
    haptic();
    openNotifSheet();
  });

  el.notifCancel.addEventListener('click', closeSheet);
  el.notifSave.addEventListener('click', saveNotifSettings);

  // Главный выключатель приглушает остальные поля, не пряча их
  el.notifEnabled.addEventListener('change', function () {
    el.notifScroll.classList.toggle('is-muted', !el.notifEnabled.checked);
    haptic();
  });

  el.notifFloors.addEventListener('click', function (event) {
    var pill = event.target.closest('.floor-pill');
    if (!pill) return;
    markFloor(el.notifFloors, Number(pill.dataset.floor));
    haptic();
  });

  el.notifThreshold.addEventListener('input', renderThresholdLabel);

  // Плашка ведёт к лифту, у которого очередь внизу самая длинная:
  // именно его стоит открыть первым, чтобы оценить обстановку
  el.floorbar.addEventListener('click', function () {
    var lift = busiestLift();
    if (!lift) return;

    haptic();
    showDetail(lift.id);
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
    notifications = readNotifications();

    initHost();
    renderNotifButton();
    applyLang(); // заодно строит кнопки этажей, причин жалобы и типов уведомлений

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
