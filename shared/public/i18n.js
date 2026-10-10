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
 * Языков три: русский, английский и китайский. Адрес
 * «Корпус 7, Мельникайте 70» намеренно не переводится ни на один из них —
 * он приходит с сервера и одинаков везде.
 */

(function (global) {
  'use strict';

  var LANGS = ['ru', 'en', 'zh'];
  var DEFAULT = 'ru';

  // Подпись на кнопке языка. Для китайского «ZH» мало кому что говорит,
  // поэтому показываем само слово — оно по ширине как раз с «RU».
  var LABELS = { ru: 'RU', en: 'EN', zh: '中文' };

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
      // Название с номером — шаблоном, а не склейкой: в китайском
      // номер идёт перед существительным, а не после
      'tile.elevatorName': 'Лифт {n}',
      'tile.floor': 'этаж',
      'tile.inCabin': 'В кабине',
      'tile.waiting': 'Ждут внизу',
      'tile.favorite': 'В избранное',

      'pill.wait': 'Ждать',
      'pill.stairs': 'Лестница',

      'foot.refresh': 'обновление каждые 3 секунды',
      'foot.updatedAt': 'обновлено в {time}',
      'foot.note': 'Данные тестовые. Камеры подключим позже.',

      'detail.destination': 'Куда едешь?',
      'detail.camera': 'Онлайн-камера · Холл, 1 этаж',
      'detail.cameraBadge': '{n} {verb} лифт',

      // Подписи прямо на кадре камеры: короткие, рисуются внутри SVG
      'camera.tag': 'чел',
      'camera.floorShort': 'эт.',
      'camera.area': 'ХОЛЛ, 1 ЭТАЖ',
      'detail.inCabin': 'В кабине',
      'detail.waiting': 'Ждут на 1 этаже',
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

      // Сводка по работе лифтов (не по загруженности)
      'summary.working': 'Работают {working} из {total} {word}',
      'status.working': 'Работает',
      'status.broken': 'Сломан',
      'status.maintenance': 'Обслуживание',
      'status.unavailable': 'Лифт не работает',
      'status.noNote': 'Срок устранения пока не известен',

      // Прогноз ожидания: подпись к точке уверенности
      'forecast.high': 'Прогноз надёжный: все лифты на ходу, очередь короткая',
      'forecast.medium': 'Прогноз приблизительный',
      'forecast.low': 'Прогноз грубый: много сломанных лифтов или длинная очередь',

      // Плашка «мой этаж»
      // Плашка первого этажа. Глагол тоже склоняется по числу,
      // иначе получается «1 человек ждут лифт».
      'floor.waitVerb': ['ждёт', 'ждут', 'ждут'],
      'floor.free': 'На 1 этаже свободно · {n} {people} {verb} лифт',
      'floor.queue': 'На 1 этаже очередь · {n} {people} {verb} лифт',
      'floor.bigQueue': 'На 1 этаже большая очередь · {n} {people} {verb} лифт',
      // Номер подставляется отдельно, а не готовым названием: в русском
      // здесь нужен родительный падеж — «у лифта 3», а не «у Лифт 3»
      'floor.longest': 'Дольше всего у лифта {n}',
      'floor.open': 'Открыть лифт с самой длинной очередью',

      // Настройки уведомлений
      'notif.title': 'Настройки уведомлений',
      'notif.enabled': 'Получать уведомления',
      'notif.floorLabel': 'Мой этаж',
      'notif.typesLabel': 'Что присылать',
      'notif.crowd': 'Очередь на 1 этаже',
      'notif.threshold': 'Порог: {n} {people}',
      'notif.arriving': 'Лифт подходит через 1-2 минуты',
      'notif.peak': 'Начинается час пик (за 10 минут)',
      'notif.broken': 'Лифт сломался',
      'notif.full': 'Лифт переполнен',
      'notif.save': 'Сохранить',
      'notif.saving': 'Сохраняем…',
      'notif.saved': 'Настройки сохранены',
      'notif.savedLocal': 'Сохранено на устройстве. Подписка включится при запуске из Telegram или MAX',
      'notif.error': 'Не удалось сохранить подписку',
      'notif.cancel': 'Закрыть',

      'a11y.theme': 'Переключить тему',
      'a11y.lang': 'Переключить язык',
      'a11y.sys': 'Свободных лифтов — к началу списка',
      'a11y.home': 'Вернуться к списку лифтов',
      'a11y.notifications': 'Настройки уведомлений'
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
      'tile.elevatorName': 'Elevator {n}',
      'tile.floor': 'floor',
      'tile.inCabin': 'In cabin',
      'tile.waiting': 'Waiting below',
      'tile.favorite': 'Add to favorites',

      'pill.wait': 'Wait',
      'pill.stairs': 'Stairs',

      'foot.refresh': 'updates every 3 seconds',
      'foot.updatedAt': 'updated at {time}',
      'foot.note': 'Test data. Cameras will be connected later.',

      'detail.destination': 'Where are you going?',
      'detail.camera': 'Live camera · Hall, floor 1',
      'detail.cameraBadge': '{n} {verb}',

      'camera.tag': 'id',
      'camera.floorShort': 'fl.',
      'camera.area': 'HALL, FLOOR 1',
      'detail.inCabin': 'In cabin',
      'detail.waiting': 'Waiting on floor 1',
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

      'summary.working': 'Working: {working} of {total} {word}',
      'status.working': 'Working',
      'status.broken': 'Out of order',
      'status.maintenance': 'Maintenance',
      'status.unavailable': 'Elevator is out of service',
      'status.noNote': 'No repair estimate yet',

      'forecast.high': 'Reliable forecast: all elevators running, short queue',
      'forecast.medium': 'Approximate forecast',
      'forecast.low': 'Rough forecast: several elevators down or a long queue',

      'floor.waitVerb': ['is waiting', 'are waiting'],
      'floor.free': 'Floor 1 is clear · {n} {people} {verb} for an elevator',
      'floor.queue': 'Queue on floor 1 · {n} {people} {verb} for an elevator',
      'floor.bigQueue': 'Long queue on floor 1 · {n} {people} {verb} for an elevator',
      'floor.longest': 'Longest queue at elevator {n}',
      'floor.open': 'Open the elevator with the longest queue',

      'notif.title': 'Notification settings',
      'notif.enabled': 'Receive notifications',
      'notif.floorLabel': 'My floor',
      'notif.typesLabel': 'What to send',
      'notif.crowd': 'Queue on floor 1',
      'notif.threshold': 'Threshold: {n} {people}',
      'notif.arriving': 'Elevator arrives in 1-2 minutes',
      'notif.peak': 'Peak hour starts (10 min ahead)',
      'notif.broken': 'An elevator broke down',
      'notif.full': 'Elevator is full',
      'notif.save': 'Save',
      'notif.saving': 'Saving…',
      'notif.saved': 'Settings saved',
      'notif.savedLocal': 'Saved on this device. The subscription starts when opened from Telegram or MAX',
      'notif.error': 'Could not save the subscription',
      'notif.cancel': 'Close',

      'a11y.theme': 'Switch theme',
      'a11y.lang': 'Switch language',
      'a11y.sys': 'Free elevators — scroll to top',
      'a11y.home': 'Back to the elevator list',
      'a11y.notifications': 'Notification settings'
    },

    zh: {
      'home.title': '电梯',
      'home.subtitle': '秋明工业大学',
      'home.loading': '正在加载数据…',

      // В китайском форма одна, зато нужен счётный суффикс —
      // он входит прямо в строку: «6 部电梯»
      'summary.elevators': ['部电梯'],
      'summary.free': ['部空闲'],
      'summary.full': ['部满载'],

      'tile.elevator': '电梯',
      'tile.elevatorName': '{n} 号电梯',
      'tile.floor': '层',
      'tile.inCabin': '轿厢内',
      'tile.waiting': '楼下等候',
      'tile.favorite': '加入收藏',

      'pill.wait': '等电梯',
      'pill.stairs': '走楼梯',

      'foot.refresh': '每 3 秒更新一次',
      'foot.updatedAt': '{time} 更新',
      'foot.note': '当前为测试数据，摄像头稍后接入。',

      'detail.destination': '你要去几层？',
      'detail.camera': '实时监控 · 一层候梯厅',
      'detail.cameraBadge': '{n} 人在等电梯',

      'camera.tag': '人',
      'camera.floorShort': '层',
      'camera.area': '一层候梯厅',

      'detail.inCabin': '轿厢内',
      'detail.waiting': '一层等候人数',
      'detail.people': ['人'],
      'detail.wait': '等待时间',
      'detail.seconds': ['秒'],
      'detail.currentFloor': '当前楼层',
      'detail.recommendation': '建议',
      'detail.refresh': '刷新',
      'detail.refreshing': '正在刷新…',

      'rec.wait': '等电梯',
      'rec.stairs': '建议走楼梯',

      'compare.title': '对比',
      'compare.elevator': '电梯',
      'compare.stairs': '楼梯',
      'compare.elevatorFaster': '电梯快 {time}',
      'compare.stairsFaster': '楼梯快 {time}',
      'compare.equal': '两者差不多',

      'time.sec': '秒',
      'time.min': '分',

      // «через N минут начнётся X» по-китайски строится от самого события,
      // иначе два «后» подряд читаются как спотыкание

      'offline.title': '无网络连接 · 数据时间 {time}',

      'empty.title': '暂时无法获取数据',
      'empty.subtitle': '无法连接服务器，请检查网络连接。',
      'empty.noData': '暂无电梯数据',
      'empty.retry': '重试',
      'empty.retrying': '正在重试…',

      'report.button': '报告故障',
      'report.title': '发生了什么？',
      'report.broken': '电梯无法运行',
      'report.slow': '等待时间过长',
      'report.noise': '有噪音 / 异响',
      'report.dirty': '轿厢内不干净',
      'report.other': '其他问题',
      'report.comment': '备注（可选）',
      'report.commentPlaceholder': '请详细描述…',
      'report.submit': '发送',
      'report.sending': '正在发送…',
      'report.cancel': '取消',
      'report.close': '关闭',
      'report.thanks': '谢谢！信息已提交',
      'report.error': '发送失败，请稍后重试',

      'summary.working': '{total} {word}中有 {working} 部在运行',
      'status.working': '运行中',
      'status.broken': '故障',
      'status.maintenance': '维护中',
      'status.unavailable': '电梯停运',
      'status.noNote': '暂无预计恢复时间',

      'forecast.high': '预测可靠：电梯全部运行，队列很短',
      'forecast.medium': '预测为大致估算',
      'forecast.low': '预测较粗略：多部电梯故障或队列很长',

      // В китайском глагол по числу не меняется — форма одна
      'floor.waitVerb': ['在等电梯'],
      'floor.free': '一层空闲 · {n} {people}{verb}',
      'floor.queue': '一层有队 · {n} {people}{verb}',
      'floor.bigQueue': '一层排长队 · {n} {people}{verb}',
      'floor.longest': '{n} 号电梯的队最长',
      'floor.open': '打开队最长的电梯',

      'notif.title': '通知设置',
      'notif.enabled': '接收通知',
      'notif.floorLabel': '我的楼层',
      'notif.typesLabel': '通知内容',
      'notif.crowd': '一层排队',
      'notif.threshold': '阈值：{n} {people}',
      'notif.arriving': '电梯将在 1-2 分钟内到达',
      'notif.peak': '高峰时段开始（提前 10 分钟）',
      'notif.broken': '有电梯故障',
      'notif.full': '电梯已满载',
      'notif.save': '保存',
      'notif.saving': '正在保存…',
      'notif.saved': '设置已保存',
      'notif.savedLocal': '已保存在本机。从 Telegram 或 MAX 打开时会自动订阅',
      'notif.error': '订阅保存失败',
      'notif.cancel': '关闭',

      'a11y.theme': '切换主题',
      'a11y.lang': '切换语言',
      'a11y.sys': '空闲电梯 — 回到列表顶部',
      'a11y.home': '返回电梯列表',
      'a11y.notifications': '通知设置'
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
   * 5 лифтов), для английского — две (1 elevator, 2 elevators),
   * для китайского — одна: число там на слово не влияет, зато нужен
   * счётный суффикс, и он входит прямо в саму форму («部电梯»).
   */
  function plural(lang, key, n) {
    var forms = t(lang, key);
    if (!Array.isArray(forms)) return forms;

    if (lang === 'zh') return forms[0];
    if (lang === 'en') return n === 1 ? forms[0] : forms[1];

    var mod10 = n % 10;
    var mod100 = n % 100;

    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  /** Следующий язык по кругу: ru → en → zh → ru. */
  function nextLang(lang) {
    var at = LANGS.indexOf(lang);
    return LANGS[(at + 1) % LANGS.length];
  }

  /** Подпись для кнопки переключения языка. */
  function label(lang) {
    return LABELS[lang] || String(lang).toUpperCase();
  }

  global.TIU_I18N = {
    LANGS: LANGS,
    LABELS: LABELS,
    DEFAULT: DEFAULT,
    nextLang: nextLang,
    label: label,
    translations: translations,
    t: t,
    plural: plural
  };
})(window);
