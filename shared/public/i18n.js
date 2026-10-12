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
      'time.hour': 'ч',
      'time.day': 'дн',


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


      // ---------- Прогноз на 5-10 минут ----------
      'forecast.title': 'Прогноз',
      'forecast.now': 'Сейчас',
      'forecast.in5': 'Через 5 мин',
      'forecast.in10': 'Через 10 мин',
      'forecast.cabin': '{n}/{capacity} внутри',
      'forecast.waiting': '{n} ждут',
      'forecast.queueUp': 'Через 5 минут очередь вырастет до {n} {people}',
      'forecast.queueDown': 'Через 5 минут очередь снизится до {n} {people}',
      'forecast.warmup': 'Прогноз появится через пару минут наблюдений',

      'trend.growing': 'растёт',
      'trend.falling': 'падает',
      'trend.stable': 'стабильно',

      // ---------- Планировщик выхода ----------
      'plan.open': 'Планировщик выхода',
      'plan.title': 'Планировщик выхода',
      'plan.subtitle': 'Посчитаем, когда выходить, чтобы успеть вовремя',
      'plan.from': 'Сейчас на этаже',
      'plan.to': 'Нужно попасть на этаж',
      'plan.time': 'К какому времени',
      'plan.day': 'День недели',
      'plan.calc': 'Рассчитать',
      'plan.exitAt': 'Выходи в {time}',
      'plan.explain': 'До нужного времени {left}. Ожидание лифта — {wait}. Дорога — {travel}. Запас — {buffer}.',
      'plan.statusOk': 'Есть время',
      'plan.statusSoon': 'Скоро выходить',
      'plan.statusNow': 'Пора выходить',
      'plan.calendar': 'Добавить в календарь',
      'plan.calendarTitle': 'Выходить к лифту',
      'plan.calendarNote': 'Лифт с {from} на {to} этаж. Ожидание ~{wait}.',
      'plan.sourceHistory': 'По наблюдениям за этот час: {n} замеров',
      'plan.sourceSchedule': 'Наблюдений за этот час пока мало — считаем по расписанию пар',
      'plan.back': 'К лифтам',
      'plan.error': 'Не удалось рассчитать. Проверь соединение.',
      'plan.late': 'Это время уже прошло — выбери более позднее',
      'plan.minutes': ['минута', 'минуты', 'минут'],
      'plan.days': ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],

      // ---------- Кольцо ожидания ----------
      'ring.arrived': 'Лифт должен приехать',
      'ring.late': 'Лифт задерживается',

      // ---------- Поделиться ----------
      'share.button': 'Поделиться',
      'share.title': 'Поделиться статусом',
      'share.copy': 'Скопировать текст',
      'share.copied': 'Скопировано',
      'share.telegram': 'В Telegram',
      'share.max': 'В MAX',
      'share.system': 'Системное меню',
      'share.failed': 'Не удалось скопировать',
      'share.head': 'TIU GO — статус лифта',
      'share.state': 'Сейчас: {occupancy}/{capacity} внутри, {waiting} ждут на 1 этаже',
      'share.wait': 'Прогноз ожидания: {wait}',
      'share.rec': 'Рекомендация: {rec}',
      'share.updated': 'Обновлено: {time}',
      'share.more': 'Подробнее: {url}',
      'share.broken': 'Не работает',

      // ---------- Канал проекта ----------
      'subscribe.title': 'Новости TIU GO',
      'subscribe.text': 'Подпишись на канал, чтобы первым узнать о бета-версии и обновлениях',
      'subscribe.button': 'Открыть канал',
      'subscribe.missing': 'Ссылка на канал пока не настроена',

      // ---------- Экран «О проекте» ----------
      'about.open': 'О проекте',
      'about.title': 'О проекте',
      'about.channelText': 'Бета-версия, новые корпуса и всё, что мы чиним по дороге, — сначала в канале, потом везде.',
      'about.what': 'Что это',
      'about.whatText': 'TIU GO показывает, свободны ли лифты, пока ты ещё идёшь к корпусу. Сколько человек в кабине, на каком она этаже и сколько ждать — видно до того, как встанешь в очередь.',
      'about.facts': 'Коротко о корпусе',
      'about.floors': 'Этажей',
      'about.lifts': 'Лифтов',
      'about.working': 'Работают',
      'about.workingValue': '{working} из {total}',
      'about.camera': 'Камеры на этаже',
      'about.refresh': 'Обновление',
      'about.refreshValue': 'раз в {seconds} с',
      'about.data': 'Откуда данные',
      'about.dataText': 'Сейчас приложение работает на тестовых данных: камеры в кабинах подключим позже. Ожидание считается по тем же формулам, что и в моделях проекта, — меняются только исходные числа.',

      // ---------- Вибрация ----------
      'notif.haptics': 'Вибрация при событиях',
      'notif.hapticsHint': 'Короткий отклик, когда лифт подходит, приезжает или ломается',

      'a11y.channel': 'Канал проекта',
      'a11y.planner': 'Планировщик выхода',

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
      'time.hour': 'h',
      'time.day': 'd',


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


      // ---------- Прогноз на 5-10 минут ----------
      'forecast.title': 'Forecast',
      'forecast.now': 'Now',
      'forecast.in5': 'In 5 min',
      'forecast.in10': 'In 10 min',
      'forecast.cabin': '{n}/{capacity} inside',
      'forecast.waiting': '{n} waiting',
      'forecast.queueUp': 'In 5 minutes the queue grows to {n} {people}',
      'forecast.queueDown': 'In 5 minutes the queue drops to {n} {people}',
      'forecast.warmup': 'The forecast needs a couple of minutes of data',

      'trend.growing': 'growing',
      'trend.falling': 'falling',
      'trend.stable': 'stable',

      // ---------- Планировщик выхода ----------
      'plan.open': 'Exit planner',
      'plan.title': 'Exit planner',
      'plan.subtitle': 'Work out when to leave so you are not late',
      'plan.from': 'You are on floor',
      'plan.to': 'You need floor',
      'plan.time': 'Be there by',
      'plan.day': 'Day of week',
      'plan.calc': 'Calculate',
      'plan.exitAt': 'Leave at {time}',
      'plan.explain': '{left} until that time. Elevator wait — {wait}. Ride — {travel}. Buffer — {buffer}.',
      'plan.statusOk': 'You have time',
      'plan.statusSoon': 'Leave soon',
      'plan.statusNow': 'Leave now',
      'plan.calendar': 'Add to calendar',
      'plan.calendarTitle': 'Head to the elevator',
      'plan.calendarNote': 'Elevator from floor {from} to {to}. Wait ~{wait}.',
      'plan.sourceHistory': 'From observations for this hour: {n} samples',
      'plan.sourceSchedule': 'Not enough data for this hour yet — using the class schedule',
      'plan.back': 'Back to elevators',
      'plan.error': 'Could not calculate. Check your connection.',
      'plan.late': 'That time has passed — pick a later one',
      'plan.minutes': ['minute', 'minutes'],
      'plan.days': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

      // ---------- Кольцо ожидания ----------
      'ring.arrived': 'The elevator should be here',
      'ring.late': 'The elevator is late',

      // ---------- Поделиться ----------
      'share.button': 'Share',
      'share.title': 'Share the status',
      'share.copy': 'Copy text',
      'share.copied': 'Copied',
      'share.telegram': 'To Telegram',
      'share.max': 'To MAX',
      'share.system': 'System menu',
      'share.failed': 'Could not copy',
      'share.head': 'TIU GO — elevator status',
      'share.state': 'Now: {occupancy}/{capacity} inside, {waiting} waiting on floor 1',
      'share.wait': 'Expected wait: {wait}',
      'share.rec': 'Recommendation: {rec}',
      'share.updated': 'Updated: {time}',
      'share.more': 'More: {url}',
      'share.broken': 'Out of service',

      // ---------- Канал проекта ----------
      'subscribe.title': 'TIU GO News',
      'subscribe.text': 'Subscribe to be the first to know about the beta and updates',
      'subscribe.button': 'Open channel',
      'subscribe.missing': 'The channel link is not configured yet',

      // ---------- About screen ----------
      'about.open': 'About the project',
      'about.title': 'About the project',
      'about.channelText': 'The beta, new buildings and everything we fix along the way show up in the channel first.',
      'about.what': 'What this is',
      'about.whatText': 'TIU GO shows whether the lifts are free while you are still walking to the building. How many people are in the cabin, which floor it is on and how long the wait is — all before you join the queue.',
      'about.facts': 'The building in short',
      'about.floors': 'Floors',
      'about.lifts': 'Lifts',
      'about.working': 'In service',
      'about.workingValue': '{working} of {total}',
      'about.camera': 'Cameras on floor',
      'about.refresh': 'Refresh',
      'about.refreshValue': 'every {seconds} s',
      'about.data': 'Where the data comes from',
      'about.dataText': 'For now the app runs on test data: cameras in the cabins will be connected later. Waiting time is computed with the same formulas as in the project models — only the inputs change.',

      // ---------- Вибрация ----------
      'notif.haptics': 'Vibrate on events',
      'notif.hapticsHint': 'A short buzz when the elevator approaches, arrives or breaks down',

      'a11y.channel': 'Project channel',
      'a11y.planner': 'Exit planner',

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
      'time.hour': '小时',
      'time.day': '天',

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


      // ---------- Прогноз на 5-10 минут ----------
      'forecast.title': '预测',
      'forecast.now': '现在',
      'forecast.in5': '5 分钟后',
      'forecast.in10': '10 分钟后',
      'forecast.cabin': '轿厢 {n}/{capacity}',
      'forecast.waiting': '{n} 人在等',
      'forecast.queueUp': '5 分钟后队列将增至 {n} {people}',
      'forecast.queueDown': '5 分钟后队列将减至 {n} {people}',
      'forecast.warmup': '再观测几分钟才能给出预测',

      'trend.growing': '增加',
      'trend.falling': '减少',
      'trend.stable': '稳定',

      // ---------- Планировщик выхода ----------
      'plan.open': '出发规划',
      'plan.title': '出发规划',
      'plan.subtitle': '算一算什么时候出发才不会迟到',
      'plan.from': '你现在在几层',
      'plan.to': '你要去几层',
      'plan.time': '需要几点到',
      'plan.day': '星期',
      'plan.calc': '计算',
      'plan.exitAt': '{time} 出发',
      'plan.explain': '距离目标时间还有 {left}。等梯 {wait}，行程 {travel}，余量 {buffer}。',
      'plan.statusOk': '时间充裕',
      'plan.statusSoon': '快该出发了',
      'plan.statusNow': '该出发了',
      'plan.calendar': '加入日历',
      'plan.calendarTitle': '前往电梯',
      'plan.calendarNote': '从 {from} 层到 {to} 层，预计等待 {wait}。',
      'plan.sourceHistory': '依据该时段的 {n} 次观测',
      'plan.sourceSchedule': '该时段观测还不够，按课表估算',
      'plan.back': '返回电梯列表',
      'plan.error': '计算失败，请检查网络。',
      'plan.late': '这个时间已经过去了，请选择更晚的时间',
      'plan.minutes': ['分钟'],
      'plan.days': ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],

      // ---------- Кольцо ожидания ----------
      'ring.arrived': '电梯应该到了',
      'ring.late': '电梯晚点了',

      // ---------- Поделиться ----------
      'share.button': '分享',
      'share.title': '分享电梯状态',
      'share.copy': '复制文本',
      'share.copied': '已复制',
      'share.telegram': '分享到 Telegram',
      'share.max': '分享到 MAX',
      'share.system': '系统分享',
      'share.failed': '复制失败',
      'share.head': 'TIU GO — 电梯状态',
      'share.state': '当前：轿厢 {occupancy}/{capacity}，一层 {waiting} 人在等',
      'share.wait': '预计等待：{wait}',
      'share.rec': '建议：{rec}',
      'share.updated': '更新时间：{time}',
      'share.more': '详情：{url}',
      'share.broken': '停运',

      // ---------- Канал проекта ----------
      'subscribe.title': 'TIU GO 频道',
      'subscribe.text': '订阅频道，第一时间获知测试版和更新',
      'subscribe.button': '打开频道',
      'subscribe.missing': '频道链接尚未配置',

      // ---------- 关于项目 ----------
      'about.open': '关于项目',
      'about.title': '关于项目',
      'about.channelText': '测试版、新楼栋以及我们一路修复的内容，都会先发布在频道里。',
      'about.what': '这是什么',
      'about.whatText': 'TIU GO 让你在走向楼栋的路上就知道电梯是否空闲：轿厢里有多少人、停在哪一层、还要等多久，排队之前就能看到。',
      'about.facts': '楼栋概况',
      'about.floors': '楼层',
      'about.lifts': '电梯',
      'about.working': '运行中',
      'about.workingValue': '{total} 部中的 {working} 部',
      'about.camera': '摄像头楼层',
      'about.refresh': '刷新',
      'about.refreshValue': '每 {seconds} 秒',
      'about.data': '数据来源',
      'about.dataText': '目前应用使用测试数据，轿厢摄像头稍后接入。等待时间使用与项目模型相同的公式计算，只是输入数据不同。',

      // ---------- Вибрация ----------
      'notif.haptics': '事件震动提示',
      'notif.hapticsHint': '电梯临近、到达或故障时轻微震动',

      'a11y.channel': '项目频道',
      'a11y.planner': '出发规划',

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
