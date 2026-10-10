/**
 * TIU GO — хелпер для SVG-иконок.
 *
 * Спрайт (shared/public/icons.svg) вставлен инлайном в начало <body>,
 * поэтому иконка — это короткая ссылка на нужный символ:
 *
 *   icon('elevator')                  -> '<svg class="icon">…</svg>'
 *   icon('star', 'icon--filled', 20)  -> с доп. классом и размером 20px
 *
 * Размер по умолчанию не задаётся: иконка наследует размер шрифта
 * (width/height: 1em), поэтому в тексте она всегда соразмерна подписи.
 * Третий аргумент нужен там, где размер должен быть фиксированным.
 *
 * Кладём в window.TIU_ICONS и дублируем коротким window.icon —
 * разметку собирают строками, и короткое имя читается заметно лучше.
 */

(function (global) {
  'use strict';

  // Полный список символов спрайта. Нужен ровно для одного:
  // поймать опечатку в имени на этапе разработки, а не глазами на экране.
  var NAMES = [
    'status-ok', 'status-busy', 'status-full', 'status-broken',
    'status-maintenance', 'online',

    'elevator', 'elevator-moving-up', 'elevator-moving-down',
    'elevator-idle', 'floor',

    'user', 'users', 'user-waiting',

    'clock', 'hourglass', 'calendar', 'bell', 'bell-off',

    'refresh', 'star', 'star-filled', 'settings', 'back', 'close',
    'check', 'plus', 'minus', 'share', 'info', 'warning', 'alert', 'report',

    'sun', 'moon', 'globe',

    'arrow-up', 'arrow-down', 'arrow-right', 'chevron-down',

    'flame', 'zap', 'stairs', 'camera',
    'signal', 'signal-low', 'signal-medium', 'signal-high'
  ];

  /**
   * Разметка иконки.
   *
   * @param {string} name — имя символа без префикса icon-
   * @param {string} [className] — дополнительные классы (icon--ok, icon--large…)
   * @param {number} [size] — фиксированный размер в пикселях
   * @returns {string} HTML-строка
   */
  function icon(name, className, size) {
    if (NAMES.indexOf(name) === -1) {
      console.warn('TIU GO: нет иконки «' + name + '»');
    }

    var cls = 'icon' + (className ? ' ' + className : '');
    var style = size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '';

    return '<svg class="' + cls + '"' + style + ' aria-hidden="true">' +
      '<use href="#icon-' + name + '"></use></svg>';
  }

  /**
   * Статус заполненности → имя иконки. Отдельной функцией, чтобы
   * соответствие «ok → галочка» жило в одном месте.
   */
  function statusIcon(status) {
    if (status === 'full') return 'status-full';
    if (status === 'busy') return 'status-busy';
    return 'status-ok';
  }

  /** Направление кабины → имя иконки. */
  function directionIcon(direction) {
    if (direction === 'up') return 'arrow-up';
    if (direction === 'down') return 'arrow-down';
    return 'minus';
  }

  /**
   * Подгружает спрайт в документ запросом — нужно страницам, куда он
   * не вставлен инлайном (админка). В index.html не вызывается.
   */
  function loadSprite(url) {
    return fetch(url || 'icons.svg')
      .then(function (res) { return res.text(); })
      .then(function (markup) {
        var holder = document.createElement('div');
        holder.id = 'icon-sprite';
        holder.setAttribute('aria-hidden', 'true');
        holder.style.display = 'none';
        holder.innerHTML = markup;
        document.body.insertBefore(holder, document.body.firstChild);
      })
      .catch(function (err) {
        // Без спрайта страница останется рабочей, просто без картинок
        console.warn('TIU GO: спрайт иконок не загрузился', err);
      });
  }

  global.TIU_ICONS = {
    NAMES: NAMES,
    icon: icon,
    statusIcon: statusIcon,
    directionIcon: directionIcon,
    loadSprite: loadSprite
  };

  global.icon = icon;
})(window);
