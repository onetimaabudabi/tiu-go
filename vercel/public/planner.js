/**
 * TIU GO — планировщик выхода.
 *
 * Отдельная страница, а не модалка: расчёт отвечает на свой вопрос
 * («во сколько выходить»), им делятся ссылкой и к нему возвращаются,
 * а главный экран остаётся про «что с лифтами прямо сейчас».
 *
 * Считает сервер (POST /api/planner) — здесь только форма, показ
 * результата и выгрузка события в календарь.
 */

(function () {
  'use strict';

  var I18N = window.TIU_I18N;

  var THEME_KEY = 'tiu-go-theme';
  var LANG_KEY = 'tiu-go-lang';

  // Сколько этажей показывать в селекторах, пока сервер не ответил
  var FALLBACK_FLOORS = 16;

  var lang = I18N.DEFAULT;
  var floors = FALLBACK_FLOORS;
  var result = null;     // последний ответ сервера
  var toastTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    sprite: $('icon-sprite'),
    address: $('plan-address'),
    from: $('plan-from'),
    to: $('plan-to'),
    time: $('plan-time'),
    day: $('plan-day'),
    calc: $('plan-calc'),
    result: $('plan-result'),
    status: $('plan-status'),
    exit: $('plan-exit'),
    explain: $('plan-explain'),
    source: $('plan-source'),
    calendar: $('plan-calendar'),
    toast: $('toast')
  };

  function t(key, params) {
    return I18N.t(lang, key, params);
  }

  // ---------- Мелкие утилиты ----------

  function readStoredLang() {
    try {
      var saved = window.localStorage.getItem(LANG_KEY);
      return I18N.LANGS.indexOf(saved) === -1 ? null : saved;
    } catch (e) {
      return null;
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
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

  /** Склонение минут: 1 минута, 2 минуты, 5 минут. */
  function minutesText(value) {
    var n = Math.max(Math.round(value), 0);
    return n + ' ' + I18N.plural(lang, 'plan.minutes', n);
  }

  /**
   * Сколько осталось до нужного времени, по-человечески.
   *
   * Планировать можно и на следующий вторник, поэтому «9733 минуты»
   * здесь не годятся: больше часа показываем часами, больше суток —
   * днями, и не мельче двух единиц подряд.
   */
  function leftText(minutes) {
    var total = Math.max(Math.round(minutes), 0);
    if (total < 60) return minutesText(total);

    var days = Math.floor(total / 1440);
    var hours = Math.floor((total % 1440) / 60);
    var mins = total % 60;

    if (days) {
      return days + ' ' + t('time.day') + (hours ? ' ' + hours + ' ' + t('time.hour') : '');
    }

    return hours + ' ' + t('time.hour') + (mins ? ' ' + mins + ' ' + t('time.min') : '');
  }

  /** Секунды в человеческий вид: «40 сек» или «1 мин 20 сек». */
  function seconds(value) {
    var total = Math.max(Math.round(value), 0);
    var min = Math.floor(total / 60);
    var sec = total % 60;

    if (!min) return sec + ' ' + t('time.sec');
    if (!sec) return min + ' ' + t('time.min');
    return min + ' ' + t('time.min') + ' ' + sec + ' ' + t('time.sec');
  }

  // ---------- Интеграция с клиентом ----------

  function host() {
    return (window.Telegram && window.Telegram.WebApp) ||
           (window.MAX && window.MAX.WebApp) ||
           window.MaxWebApp ||
           null;
  }

  function initHost() {
    var client = host();
    if (!client) return;

    try {
      if (client.ready) client.ready();
      if (client.expand) client.expand();
      // Системная кнопка «назад» возвращает к списку лифтов
      if (client.BackButton) {
        if (client.BackButton.show) client.BackButton.show();
        if (client.BackButton.onClick) {
          client.BackButton.onClick(function () { window.location.href = 'index.html'; });
        }
      }
    } catch (e) { /* старый клиент — страница работает и так */ }
  }

  function haptic() {
    var client = host();
    if (client && client.HapticFeedback && client.HapticFeedback.impactOccurred) {
      try { client.HapticFeedback.impactOccurred('light'); } catch (e) {}
    }
  }

  // ---------- Форма ----------

  function fillFloors(select, selected) {
    var html = '';
    for (var floor = 1; floor <= floors; floor += 1) {
      html += '<option value="' + floor + '"' +
        (floor === selected ? ' selected' : '') + '>' + floor + '</option>';
    }
    select.innerHTML = html;
  }

  function fillDays() {
    var names = I18N.t(lang, 'plan.days');
    var today = new Date().getDay();
    var html = '';

    for (var day = 0; day < 7; day += 1) {
      html += '<option value="' + day + '"' +
        (day === today ? ' selected' : '') + '>' + names[day] + '</option>';
    }
    el.day.innerHTML = html;
  }

  function applyLang() {
    document.documentElement.setAttribute('lang', lang);

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = t(nodes[i].dataset.i18n);
    }

    fillDays();
    if (result) renderResult(result);
  }

  // ---------- Результат ----------

  function renderResult(data) {
    result = data;

    var statusKey = {
      ok: 'plan.statusOk',
      soon: 'plan.statusSoon',
      now: 'plan.statusNow'
    }[data.status] || 'plan.statusSoon';

    el.result.dataset.status = data.status;
    el.status.textContent = t(statusKey);
    el.exit.textContent = t('plan.exitAt', { time: data.exitTime });

    el.explain.textContent = t('plan.explain', {
      left: leftText(data.minutesLeft),
      wait: seconds(data.waitTime),
      travel: seconds(data.travelTime),
      buffer: minutesText(data.bufferMinutes)
    });

    var source = data.source === 'history'
      ? t('plan.sourceHistory', { n: data.samples })
      : t('plan.sourceSchedule');

    // Больше суток до выхода бывает ровно в одном случае: выбранное
    // время сегодня уже прошло, и расчёт уехал на следующую неделю
    if (data.minutesLeft > 1440) source = t('plan.late') + ' · ' + source;

    el.source.textContent = source;
    el.result.hidden = false;
  }

  function calculate() {
    haptic();

    var body = {
      fromFloor: Number(el.from.value),
      toFloor: Number(el.to.value),
      targetTime: el.time.value,
      dayOfWeek: Number(el.day.value)
    };

    if (!body.targetTime) {
      showToast(t('plan.error'));
      return;
    }

    el.calc.disabled = true;

    fetch('api/planner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(renderResult)
      .catch(function (err) {
        console.error('TIU GO: планировщик не посчитал', err);
        showToast(t('plan.error'));
      })
      .then(function () {
        el.calc.disabled = false;
      });
  }

  // ---------- Событие в календарь ----------

  /** Дата в формате iCalendar: 20261014T045600Z */
  function icsDate(value) {
    return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /**
   * Файл .ics вместо «Web Calendar API»: такого API в браузерах нет,
   * а .ics открывают и iOS, и Android, и настольные календари.
   */
  function buildIcs(data) {
    var start = new Date(data.exitAt);
    var end = new Date(new Date(data.targetAt).getTime());

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TIU GO//Planner//RU',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:tiu-go-' + Date.now() + '@tiu.go',
      'DTSTAMP:' + icsDate(Date.now()),
      'DTSTART:' + icsDate(start),
      'DTEND:' + icsDate(end),
      'SUMMARY:' + t('plan.calendarTitle'),
      'DESCRIPTION:' + t('plan.calendarNote', {
        from: data.fromFloor,
        to: data.toFloor,
        wait: seconds(data.waitTime)
      }),
      'END:VEVENT',
      'END:VCALENDAR'
    ];

    return lines.join('\r\n');
  }

  function addToCalendar() {
    if (!result) return;
    haptic();

    try {
      var blob = new Blob([buildIcs(result)], { type: 'text/calendar;charset=utf-8' });
      var url = URL.createObjectURL(blob);

      var link = document.createElement('a');
      link.href = url;
      link.download = 'tiu-go-exit.ics';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) {
      console.error('TIU GO: не удалось собрать событие', e);
      showToast(t('plan.error'));
    }
  }

  // ---------- Старт ----------

  /** Спрайт иконок берём из общего файла, чтобы не держать вторую копию. */
  function loadIcons() {
    return fetch('icons.svg')
      .then(function (res) { return res.text(); })
      .then(function (markup) { el.sprite.innerHTML = markup; })
      .catch(function () { /* без иконок страница остаётся рабочей */ });
  }

  /** Этажность и адрес берём у сервера — они живут в параметрах корпуса. */
  function loadMeta() {
    return fetch('api/status', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        floors = data.floors || FALLBACK_FLOORS;
        el.address.textContent = data.address || '';
      })
      .catch(function () { /* работаем с запасной этажностью */ });
  }

  function start() {
    lang = readStoredLang() || I18N.DEFAULT;

    initHost();
    loadIcons();

    loadMeta().then(function () {
      fillFloors(el.from, Math.min(5, floors));
      fillFloors(el.to, 1);
      applyLang();
    });

    el.calc.addEventListener('click', calculate);
    el.calendar.addEventListener('click', addToCalendar);
    el.time.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') calculate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
