/**
 * TIU GO — словарь интерфейса.
 *
 * Подключается обычным <script> перед app.js и кладёт в window объект
 * TIU_I18N: { translations, t, plural, LANGS, DEFAULT }.
 *
 * Как пользоваться:
 *   t('ru', 'detail.recommendation')            -> 'Рекомендация'
 *   t('en', 'peak.soon', { n: 7, label: '…' })  -> '… starts in 7 min'
 *
 * Адрес «Корпус 7, Мельникайте 70» намеренно не переводится —
 * он приходит с сервера и одинаков на обоих языках.
 */

(function (global) {
  'use strict';

  var LANGS = ['ru', 'en'];
  var DEFAULT = 'ru';

  var translations = {
    ru: {
      'home.title': 'Лифты',
      'home.subtitle': 'Тюменский индустриальный университет',
      'home.loading': 'Загружаем данные…',

      // Сводка: три формы для русского счёта
      'summary.elevators': ['лифт', 'лифта', 'лифтов'],
      'summary.free': ['свободен', 'свободны', 'свободно'],
      'summary.full': ['переполнен', 'переполнены', 'переполнено'],

      'tile.elevator': 'Лифт',
      'tile.floor': 'этаж',
      'tile.inCabin': 'В кабине',
      'tile.waiting': 'Ожидают',
      'tile.favorite': 'В избранное',

      'pill.wait': 'Ждать',
      'pill.stairs': 'Лестница',

      'foot.refresh': 'обновление каждые 3 секунды',
      'foot.updatedAt': 'обновлено в {time}',
      'foot.note': 'Данные тестовые. Камеры подключим позже.',

      'detail.destination': 'Куда едешь?',
      'detail.camera': 'Онлайн-камера',
      'detail.cameraCaption': 'Камера: Холл, {floor} этаж',
      'detail.cameraBadge': 'Ожидают: {n}',
      'detail.inCabin': 'В кабине',
      'detail.waiting': 'Ожидают',
      'detail.people': ['человек', 'человека', 'человек'],
      'detail.wait': 'Ожидание',
      'detail.seconds': ['секунда', 'секунды', 'секунд'],
      'detail.currentFloor': 'Текущий этаж',
      'detail.recommendation': 'Рекомендация',
      'detail.refresh': 'Обновить',
      'detail.refreshing': 'Обновляем…',

      'rec.wait': 'Ждать лифт',
      'rec.stairs': 'Иди по лестнице',

      'compare.title': 'Сравнение',
      'compare.elevator': 'Лифт',
      'compare.stairs': 'Лестница',
      'compare.elevatorFaster': 'Лифт быстрее на {time}',
      'compare.stairsFaster': 'Лестница быстрее на {time}',
      'compare.equal': 'Примерно одинаково',

      // Время
      'time.sec': 'сек',
      'time.min': 'мин',

      'peak.now': 'Сейчас {label} — лифты перегружены',
      'peak.soon': 'Через {n} мин начнётся {label}',
      'peak.morning': 'Утренний пик',
      'peak.afterFirst': 'После первой пары',
      'peak.afterSecond': 'После второй пары',
      'peak.afterThird': 'После третьей пары',

      'offline.title': 'Нет связи · данные от {time}',

      'empty.title': 'Данные недоступны',
      'empty.subtitle': 'Не удалось связаться с сервером. Проверь соединение.',
      'empty.noData': 'Пока нет данных о лифтах',
      'empty.retry': 'Повторить',
      'empty.retrying': 'Пробуем…',

      'report.button': 'Сообщить о проблеме',
      'report.title': 'Что случилось?',
      'report.broken': 'Лифт не работает',
      'report.slow': 'Долго едет',
      'report.noise': 'Шумит / скрипит',
      'report.dirty': 'Грязно в кабине',
      'report.other': 'Другое',
      'report.comment': 'Комментарий (необязательно)',
      'report.commentPlaceholder': 'Опишите подробнее…',
      'report.submit': 'Отправить',
      'report.sending': 'Отправляем…',
      'report.cancel': 'Отмена',
      'report.close': 'Закрыть',
      'report.thanks': 'Спасибо! Мы передали информацию',
      'report.error': 'Не удалось отправить. Попробуйте позже',

      'a11y.theme': 'Переключить тему',
      'a11y.lang': 'Переключить язык',
      'a11y.sys': 'Свободных лифтов — к началу списка',
      'a11y.home': 'Вернуться к списку лифтов'
    },

    en: {
      'home.title': 'Elevators',
      'home.subtitle': 'Tyumen Industrial University',
      'home.loading': 'Loading data…',

      // В английском всего две формы: единственное и множественное
      'summary.elevators': ['elevator', 'elevators'],
      'summary.free': ['free', 'free'],
      'summary.full': ['full', 'full'],

      'tile.elevator': 'Elevator',
      'tile.floor': 'floor',
      'tile.inCabin': 'In cabin',
      'tile.waiting': 'Waiting',
      'tile.favorite': 'Add to favorites',

      'pill.wait': 'Wait',
      'pill.stairs': 'Stairs',

      'foot.refresh': 'updates every 3 seconds',
      'foot.updatedAt': 'updated at {time}',
      'foot.note': 'Test data. Cameras will be connected later.',

      'detail.destination': 'Where are you going?',
      'detail.camera': 'Live camera',
      'detail.cameraCaption': 'Camera: hall, floor {floor}',
      'detail.cameraBadge': 'Waiting: {n}',
      'detail.inCabin': 'In cabin',
      'detail.waiting': 'Waiting',
      'detail.people': ['person', 'people'],
      'detail.wait': 'Wait time',
      'detail.seconds': ['second', 'seconds'],
      'detail.currentFloor': 'Current floor',
      'detail.recommendation': 'Recommendation',
      'detail.refresh': 'Refresh',
      'detail.refreshing': 'Refreshing…',

      'rec.wait': 'Wait for elevator',
      'rec.stairs': 'Take stairs',

      'compare.title': 'Comparison',
      'compare.elevator': 'Elevator',
      'compare.stairs': 'Stairs',
      'compare.elevatorFaster': 'Elevator is faster by {time}',
      'compare.stairsFaster': 'Stairs are faster by {time}',
      'compare.equal': 'About the same',

      'time.sec': 'sec',
      'time.min': 'min',

      'peak.now': '{label} right now — elevators are crowded',
      'peak.soon': '{label} starts in {n} min',
      'peak.morning': 'Morning peak',
      'peak.afterFirst': 'After first class',
      'peak.afterSecond': 'After second class',
      'peak.afterThird': 'After third class',

      'offline.title': 'Offline · data from {time}',

      'empty.title': 'Data unavailable',
      'empty.subtitle': 'Could not reach the server. Check your connection.',
      'empty.noData': 'No elevator data yet',
      'empty.retry': 'Retry',
      'empty.retrying': 'Trying…',

      'report.button': 'Report a problem',
      'report.title': 'What happened?',
      'report.broken': 'Elevator is out of order',
      'report.slow': 'Takes too long',
      'report.noise': 'Noisy / squeaking',
      'report.dirty': 'Dirty cabin',
      'report.other': 'Something else',
      'report.comment': 'Comment (optional)',
      'report.commentPlaceholder': 'Tell us more…',
      'report.submit': 'Send',
      'report.sending': 'Sending…',
      'report.cancel': 'Cancel',
      'report.close': 'Close',
      'report.thanks': 'Thanks! We have passed it on',
      'report.error': 'Could not send. Please try again later',

      'a11y.theme': 'Switch theme',
      'a11y.lang': 'Switch language',
      'a11y.sys': 'Free elevators — scroll to top',
      'a11y.home': 'Back to the elevator list'
    }
  };

  /** Подставляет {ключи} из params в строку. */
  function fill(text, params) {
    if (!params) return text;

    return text.replace(/\{(\w+)\}/g, function (match, key) {
      return params[key] === undefined ? match : params[key];
    });
  }

  /**
   * Перевод по ключу. Если ключа нет в выбранном языке, берём русский,
   * а в самом крайнем случае возвращаем сам ключ — так пропажа строки
   * сразу видна и ничего не падает.
   */
  function t(lang, key, params) {
    var dict = translations[lang] || translations[DEFAULT];
    var value = dict[key];

    if (value === undefined) value = translations[DEFAULT][key];
    if (value === undefined) return key;

    return typeof value === 'string' ? fill(value, params) : value;
  }

  /**
   * Правильная форма слова. Для русского — три формы (1 лифт, 2 лифта,
   * 5 лифтов), для английского — две (1 elevator, 2 elevators).
   */
  function plural(lang, key, n) {
    var forms = t(lang, key);
    if (!Array.isArray(forms)) return forms;

    if (lang === 'en') return n === 1 ? forms[0] : forms[1];

    var mod10 = n % 10;
    var mod100 = n % 100;

    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  global.TIU_I18N = {
    LANGS: LANGS,
    DEFAULT: DEFAULT,
    translations: translations,
    t: t,
    plural: plural
  };
})(window);
