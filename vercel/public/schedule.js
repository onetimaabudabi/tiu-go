/**
 * TIU GO — расписание пар и фразы дня.
 *
 * Подключается обычным <script> перед app.js и кладёт в window объект
 * TIU_SCHEDULE: { PAIRS, TIPS, pairState, tipFor }.
 *
 * Почему пары лежат здесь, а не приходят с сервера: отсчёт до пары
 * должен работать с первой отрисовки и без сети, а это просто часы.
 * Единственный источник правды по корпусу — shared/params.json;
 * чтобы копия не разошлась с ним, её сверяет npm run check:params.
 */

(function (global) {
  'use strict';

  // ---------- Пары ----------
  //
  // Копия поля schedule из shared/params.json. Менять нужно там,
  // здесь — следом, иначе check:params поднимет шум.

  var PAIRS = [
    { pair: 1, start: '08:00', end: '09:45' },
    { pair: 2, start: '09:55', end: '11:20' },
    { pair: 3, start: '11:30', end: '13:05' },
    { pair: 4, start: '13:45', end: '15:20' },
    { pair: 5, start: '15:30', end: '17:05' },
    { pair: 6, start: '17:15', end: '18:50' }
  ];

  /** «08:00» -> 480 минут от полуночи. */
  function minutesOf(hhmm) {
    var parts = String(hhmm).split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  /** Минуты от полуночи для момента времени. */
  function minutesNow(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  /**
   * Что с парами прямо сейчас.
   *
   * Возвращает одно из трёх:
   *   { kind: 'now',  pair: n }                — пара идёт
   *   { kind: 'before', pair: n, minutes: m }  — до начала m минут
   *   { kind: 'over' }                         — на сегодня всё
   *
   * Минуты округляются вверх: «1 мин» должна держаться до самой пары,
   * а не превращаться в «0 мин» за полминуты до звонка.
   */
  function pairState(date) {
    var now = minutesNow(date || new Date());

    for (var i = 0; i < PAIRS.length; i += 1) {
      var start = minutesOf(PAIRS[i].start);
      var end = minutesOf(PAIRS[i].end);

      if (now < start) {
        return { kind: 'before', pair: PAIRS[i].pair, minutes: Math.ceil(start - now) };
      }
      if (now < end) {
        return { kind: 'now', pair: PAIRS[i].pair };
      }
    }

    return { kind: 'over' };
  }

  // ---------- Фразы дня ----------
  //
  // Выбор детерминированный, по номеру дня в году: у всех, кто открыл
  // приложение в один день, фраза одна и та же, а в полночь она меняется
  // сама собой, без запроса к серверу.

  var TIPS = {
    ru: [
      'Иногда шаг назад — это разбег перед прыжком вверх.',
      'Студент, идущий пешком, живёт дольше студента, ждущего лифт.',
      'Каждый день — новый шанс сдать всё на отлично.',
      'Если лифт занят — это знак: пора размяться.',
      'Сессия — марафон, а не спринт. Дыши глубже.',
      'Сначала ты ищешь аудиторию, потом она ищет тебя.',
      'Пять минут раньше — и очередь к лифту уже не твоя забота.',
      'Лучший конспект — тот, который ты перечитал.',
      'Лестница на третий этаж быстрее любого лифта. Проверено.',
      'Не знаешь ответ — начни писать. Рука вспомнит.',
      'Сон перед экзаменом полезнее последней главы.',
      'Шестнадцать этажей — это шестнадцать поводов гордиться собой.',
      'Спроси у преподавателя. Худшее, что случится, — он ответит.',
      'Кто выходит на десять минут раньше, тот никуда не бежит.',
      'Лифт везёт тело. Расписание везёт жизнь.',
      'Дедлайн — не стена, а дверь. Просто открывается строго в срок.',
      'Час без телефона стоит трёх часов с ним.',
      'Пропущенная пара догоняет на сессии.',
      'Вода в бутылке работает лучше кофе в стакане.',
      'Если всё валится — начни с одного дела. Любого.',
      'Самый тяжёлый этаж — первый. Дальше легче.',
      'Записал на полях — считай, уже запомнил.',
      'Хороший однокурсник дороже хорошего конспекта.',
      'Не сравнивай свой второй курс с чужим пятым.',
      'Лестница бесплатная, а абонемент в зал — нет.',
      'Сегодняшние пятнадцать минут экономят завтрашние два часа.',
      'Непонятно на лекции — значит, вопрос уже есть. Задай его.',
      'Расписание знает твой день лучше, чем ты сам.',
      'Поешь. Мозг работает на глюкозе, а не на упрямстве.',
      'Курсовая пишется по странице в день. Серьёзно.',
      'Пустой лифт в пик — редкость. Как и свободная аудитория.',
      'Ошибся в задаче — нашёл способ, который не работает.',
      'Перерыв — часть работы, а не побег от неё.',
      'Кто спросил — выглядит глупо минуту. Кто не спросил — семестр.',
      'Университет заканчивается. Привычки остаются.',
      'Лучшее время начать — то, которое уже идёт.'
    ],

    en: [
      'Sometimes a step back is just a run-up for the jump.',
      'A student who takes the stairs outlives one who waits for the lift.',
      'Every day is a fresh chance to ace everything.',
      'Lift is busy? Take it as a sign to stretch your legs.',
      'Exams are a marathon, not a sprint. Breathe.',
      'First you look for the room, then the room looks for you.',
      'Five minutes early, and the lift queue is no longer your problem.',
      'The best notes are the ones you have read twice.',
      'Stairs to the third floor beat any lift. Tested.',
      'Do not know the answer? Start writing. Your hand remembers.',
      'Sleep before an exam beats one more chapter.',
      'Sixteen floors are sixteen reasons to be proud of yourself.',
      'Ask the lecturer. The worst that happens is an answer.',
      'Leave ten minutes early and you never have to run.',
      'A lift carries your body. A timetable carries your life.',
      'A deadline is not a wall, it is a door. It just opens on time.',
      'An hour without your phone is worth three with it.',
      'A skipped class catches up with you during exams.',
      'Water in a bottle works better than coffee in a cup.',
      'When everything falls apart, start with one thing. Any one.',
      'The hardest floor is the first. After that it gets easier.',
      'Written in the margin means already remembered.',
      'A good classmate is worth more than good notes.',
      'Do not compare your second year with the fifth year of someone else.',
      'Stairs are free. A gym membership is not.',
      'Fifteen minutes today save two hours tomorrow.',
      'Lost during the lecture? Then you already have a question. Ask it.',
      'The timetable knows your day better than you do.',
      'Eat something. Brains run on glucose, not on stubbornness.',
      'A term paper gets written one page a day. Seriously.',
      'An empty lift at peak time is rare. So is an empty room.',
      'A wrong answer is a method you now know does not work.',
      'A break is part of the work, not an escape from it.',
      'Ask and look silly for a minute. Stay silent and look silly all term.',
      'University ends. The habits stay.',
      'The best time to start is the one already running.'
    ],

    zh: [
      '有时候后退一步，只是为了跳得更高。',
      '走楼梯的同学，比等电梯的同学活得更久。',
      '每一天都是把事情做好的新机会。',
      '电梯满了？那是提醒你该活动一下了。',
      '考试季是马拉松，不是短跑。深呼吸。',
      '先是你找教室，后来教室找你。',
      '早到五分钟，电梯的队伍就与你无关了。',
      '最好的笔记，是你又读了一遍的那份。',
      '走楼梯到三楼，比任何电梯都快。亲测。',
      '不会答就先动笔，手会替你想起来。',
      '考前的睡眠，比最后一章更有用。',
      '十六层楼，就是十六个值得骄傲的理由。',
      '去问老师。最坏的结果，不过是得到答案。',
      '早出门十分钟的人，从来不用跑。',
      '电梯载的是身体，课表载的是生活。',
      '截止日期不是墙，是一扇准时开启的门。',
      '不碰手机的一小时，抵得上碰手机的三小时。',
      '逃掉的课，会在考试周追上你。',
      '瓶子里的水，比杯子里的咖啡更管用。',
      '一切都乱了，就先做一件事，哪件都行。',
      '最难的是第一层，之后就轻松了。',
      '写在页边的东西，等于已经记住了。',
      '一个好同学，胜过一份好笔记。',
      '别拿自己的大二，去比别人的大五。',
      '楼梯是免费的，健身卡不是。',
      '今天的十五分钟，省下明天的两小时。',
      '听不懂，说明问题已经有了。问出来。',
      '课表比你自己更清楚你的一天。',
      '吃点东西。大脑靠葡萄糖运转，不靠硬撑。',
      '论文是一天一页写出来的。真的。',
      '高峰期的空电梯很少见，空教室也是。',
      '做错一道题，就是找到了一个行不通的办法。',
      '休息是工作的一部分，不是逃避。',
      '问了，傻一分钟；不问，傻一学期。',
      '大学会结束，习惯会留下。',
      '开始的最好时机，就是正在走的这一刻。'
    ]
  };

  /** Номер дня в году: 1 января — 0. */
  function dayIndex(date) {
    var d = date || new Date();
    var start = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d - start) / 86400000);
  }

  /** Фраза дня для языка. Один день — одна фраза у всех. */
  function tipFor(lang, date) {
    var list = TIPS[lang] || TIPS.ru;
    return list[dayIndex(date) % list.length];
  }

  global.TIU_SCHEDULE = {
    PAIRS: PAIRS,
    TIPS: TIPS,
    minutesOf: minutesOf,
    pairState: pairState,
    dayIndex: dayIndex,
    tipFor: tipFor
  };
})(window);
