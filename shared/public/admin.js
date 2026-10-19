/**
 * TIU GO — админ-панель.
 *
 * Два экрана: вход по логину с паролем и дашборд из трёх вкладок.
 *
 *   Лифты      — статус работы, пояснение к нему и «сырые» показания датчиков.
 *   Статистика — пользователи ботов и обращения к /api/status по часам.
 *   Рассылка   — сообщение всем, кто писал боту /start.
 *
 * Токен сессии приходит от POST /api/admin/login и лежит в localStorage.
 * Сервер генерирует его при старте, поэтому перезапуск сервера
 * разлогинивает страницу: любой запрос отвечает 401, и мы возвращаем
 * экран входа. Это не ошибка, а и есть защита.
 *
 * Поле «Ждут на 1 этаже» — то, что считает камера в холле внизу. Им удобно
 * проверять плашку на главном экране: сумма по всем лифтам до 5 даёт
 * зелёную, 6-15 жёлтую, 16 и больше — красную.
 *
 * Локализации здесь намеренно нет: это внутренний инструмент.
 */

(function () {
  'use strict';

  var ICONS = window.TIU_ICONS;

  var TOKEN_KEY = 'tiu-go-admin-token';
  var TAB_KEY = 'tiu-go-admin-tab';

  var STATUS_LABELS = {
    working: 'Работает',
    broken: 'Сломан',
    maintenance: 'Обслуживание'
  };

  var STATUS_ORDER = ['working', 'broken', 'maintenance'];

  var TABS = ['lifts', 'stats', 'reports', 'support', 'cast'];

  // Причины жалоб — те же ключи, что шлёт мини-апп (см. report.* в i18n.js).
  // Незнакомый ключ показываем как есть: лучше сырое значение, чем «Другое»,
  // за которым не видно, что в мини-аппе появилась новая кнопка.
  var REASON_LABELS = {
    broken: 'Не работает',
    slow: 'Долго едет',
    noise: 'Шумит / скрипит',
    dirty: 'Грязно в кабине',
    other: 'Другое'
  };

  // Как часто обновляем цифры на открытой вкладке «Статистика»
  var STATS_REFRESH_MS = 15000;

  // Как часто спрашиваем сервер о ходе рассылки
  var CAST_POLL_MS = 1000;

  // Пределы приходят с сервера вместе со списком получателей — держать
  // их здесь вторым экземпляром значило бы однажды разойтись с бэкендом
  var limits = { text: 3500, caption: 1024, buttons: 6, uploadBytes: 20 * 1024 * 1024 };

  // Выбранное вложение: { kind, id } для загруженного файла либо
  // { kind, url } для ссылки. null — вложения нет
  var media = null;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    login: $('screen-login'),
    loginForm: $('login-form'),
    loginUser: $('login-user'),
    loginPass: $('login-pass'),
    loginError: $('login-error'),
    loginSubmit: $('login-submit'),

    app: $('screen-app'),
    headSub: $('head-sub'),
    logout: $('btn-logout'),
    tabs: $('tabs'),
    toast: $('toast'),

    list: $('list'),
    reset: $('btn-reset'),
    allWorking: $('btn-all-working'),
    testPush: $('btn-test-push'),

    metrics: $('metrics'),
    chart: $('chart'),

    reportsBadge: $('tab-reports-badge'),
    reportsMetrics: $('reports-metrics'),
    reportsSub: $('reports-sub'),
    reportsList: $('reports-list'),
    reportsRefresh: $('btn-reports-refresh'),

    supportBadge: $('tab-support-badge'),
    supportMetrics: $('support-metrics'),
    supportSub: $('support-sub'),
    supportList: $('support-list'),
    supportRefresh: $('btn-support-refresh'),

    castText: $('cast-text'),
    castFile: $('cast-file'),
    castUrl: $('cast-url'),
    castClear: $('btn-cast-clear'),
    castMediaState: $('cast-media-state'),
    castButtons: $('cast-buttons'),
    buttonAdd: $('btn-button-add'),
    castSend: $('btn-cast'),
    castCancel: $('btn-cast-cancel'),
    castCount: $('cast-count'),
    castWarn: $('cast-warn'),
    castWarnText: $('cast-warn-text'),
    castProgress: $('cast-progress'),
    castFill: $('cast-fill'),
    castProgressText: $('cast-progress-text')
  };

  var token = null;
  var limits = { floors: 16, maxWaiting: 20 };
  var activeTab = 'lifts';
  var recipients = 0;

  var toastTimer = null;
  var statsTimer = null;
  var castTimer = null;

  // ---------- Сообщения ----------

  function toast(message, tone) {
    clearTimeout(toastTimer);

    el.toast.textContent = message;
    el.toast.dataset.tone = tone || 'ok';
    el.toast.hidden = false;

    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3500);
  }

  function plural(count, one, few, many) {
    var mod100 = count % 100;
    var mod10 = count % 10;

    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  /** «1 пользователю» / «2 пользователям» — склонение в предупреждении рассылки. */
  function usersDative(count) {
    return count + ' ' + plural(count, 'пользователю', 'пользователям', 'пользователям');
  }

  // ---------- Запросы ----------

  /**
   * Запрос к /api/admin. Токен подставляется сам.
   * 401 значит «сессия больше не действует» — возвращаем экран входа,
   * не дожидаясь, пока человек нажмёт что-то ещё.
   */
  function api(path, options) {
    var config = options || {};
    var headers = Object.assign({}, config.headers || {});

    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch('api/admin' + path, Object.assign({}, config, { headers: headers }))
      .then(function (res) {
        if (res.status === 401) {
          showLogin('Сессия закрыта. Войдите снова.');
          throw new Error('Нужен вход');
        }

        return res.json()
          .catch(function () { throw new Error('HTTP ' + res.status); })
          .then(function (body) {
            if (!res.ok || body.success === false) {
              throw new Error(body.error || 'HTTP ' + res.status);
            }
            return body;
          });
      });
  }

  function post(path, body) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  // ---------- Вход и выход ----------

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null; // приватный режим браузера — просто поработаем без памяти
    }
  }

  function saveToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      // не смогли запомнить — вход просто не переживёт перезагрузку страницы
    }
  }

  function showLogin(message) {
    token = null;
    saveToken(null);
    stopTimers();

    el.app.hidden = true;
    el.login.hidden = false;

    el.loginPass.value = '';
    el.loginError.hidden = !message;
    if (message) el.loginError.textContent = message;

    el.loginUser.focus();
  }

  function showApp() {
    el.login.hidden = true;
    el.app.hidden = false;

    switchTab(activeTab);
  }

  el.loginForm.addEventListener('submit', function (event) {
    event.preventDefault();

    var username = el.loginUser.value.trim();
    var password = el.loginPass.value;

    if (!username || !password) {
      el.loginError.textContent = 'Заполните логин и пароль';
      el.loginError.hidden = false;
      return;
    }

    el.loginSubmit.disabled = true;
    el.loginError.hidden = true;

    fetch('api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) {
        return res.json()
          .catch(function () { throw new Error('HTTP ' + res.status); })
          .then(function (body) {
            if (!res.ok || !body.token) {
              throw new Error(body.error || 'HTTP ' + res.status);
            }
            return body;
          });
      })
      .then(function (body) {
        token = body.token;
        saveToken(token);

        el.loginPass.value = '';
        showApp();
        toast('Вход выполнен');
      })
      .catch(function (err) {
        el.loginError.textContent = err.message;
        el.loginError.hidden = false;
      })
      .then(function () {
        el.loginSubmit.disabled = false;
      });
  });

  el.logout.addEventListener('click', function () {
    showLogin('');
  });

  // ---------- Вкладки ----------

  function stopTimers() {
    clearInterval(statsTimer);
    clearInterval(castTimer);
    statsTimer = null;
    castTimer = null;
  }

  function switchTab(name) {
    activeTab = TABS.indexOf(name) === -1 ? 'lifts' : name;

    try {
      localStorage.setItem(TAB_KEY, activeTab);
    } catch (err) {
      // не запомнили выбранную вкладку — не повод ломать страницу
    }

    TABS.forEach(function (tab) {
      $('tab-' + tab).hidden = tab !== activeTab;
    });

    Array.prototype.forEach.call(el.tabs.children, function (button) {
      button.classList.toggle('is-on', button.dataset.tab === activeTab);
    });

    stopTimers();

    if (activeTab === 'lifts') {
      loadLifts();
    } else if (activeTab === 'stats') {
      loadStats();
      statsTimer = setInterval(function () {
        if (!document.hidden) loadStats();
      }, STATS_REFRESH_MS);
    } else if (activeTab === 'reports') {
      loadReports();
    } else if (activeTab === 'support') {
      loadSupport();
    } else {
      loadCast();
    }
  }

  el.tabs.addEventListener('click', function (event) {
    var button = event.target.closest('.tabs__btn');
    if (button) switchTab(button.dataset.tab);
  });

  // ---------- Вкладка «Лифты» ----------

  function numberField(id, label, value, min, max) {
    return '' +
      '<label class="field">' +
        '<span class="field__label">' + label + '</span>' +
        '<input class="input" type="number" data-field="' + id + '" ' +
          'min="' + min + '" max="' + max + '" value="' + value + '" />' +
      '</label>';
  }

  function liftCard(lift) {
    var segments = STATUS_ORDER.map(function (value) {
      return '<button class="seg__btn' + (lift.status === value ? ' is-on' : '') +
        '" type="button" data-value="' + value + '">' + STATUS_LABELS[value] + '</button>';
    }).join('');

    var note = lift.statusNote ? String(lift.statusNote).replace(/"/g, '&quot;') : '';

    var card = document.createElement('section');
    card.className = 'lift';
    card.dataset.id = lift.id;
    card.dataset.status = lift.status;

    card.innerHTML = '' +
      '<div class="lift__head">' +
        '<span class="lift__name">Лифт ' + lift.number + '</span>' +
        '<span class="lift__meta">вместимость ' + lift.capacity +
          ' · камера в холле ' + lift.cameraFloor + ' этажа</span>' +
      '</div>' +

      '<span class="lift__frozen" data-frozen ' + (lift.frozen ? '' : 'hidden') + '>' +
        'значения выставлены вручную</span>' +

      '<div class="seg" data-seg>' + segments + '</div>' +

      '<label class="field">' +
        '<span class="field__label">Комментарий — его увидит человек на экране лифта</span>' +
        '<input class="input" type="text" data-field="statusNote" maxlength="120" ' +
          'placeholder="Например: ремонт до 15:00" value="' + note + '" />' +
      '</label>' +

      '<div class="nums">' +
        numberField('currentFloor', 'Этаж', lift.currentFloor, 1, lift.floors) +
        numberField('occupancy', 'В кабине', lift.occupancy, 0, lift.capacity) +
        numberField('waitingAtFirstFloor', 'Ждут на 1 этаже',
          lift.waitingAtFirstFloor, 0, limits.maxWaiting) +
      '</div>' +

      '<button class="btn btn--accent" type="button" data-save>' +
        ICONS.icon('check') + ' Сохранить изменения</button>';

    return card;
  }

  function renderLifts(elevators) {
    el.list.innerHTML = '';
    elevators.forEach(function (lift) { el.list.appendChild(liftCard(lift)); });

    var working = elevators.filter(function (lift) {
      return lift.status === 'working';
    }).length;

    el.headSub.textContent = 'Корпус 7, Мельникайте 70 · работают ' +
      working + ' из ' + elevators.length;
  }

  function loadLifts() {
    return api('/elevators')
      .then(function (body) {
        limits.floors = body.floors || limits.floors;
        limits.maxWaiting = body.maxWaiting || limits.maxWaiting;
        renderLifts(body.elevators);
      })
      .catch(function (err) {
        if (err.message === 'Нужен вход') return;
        el.list.innerHTML = '<p class="hint">Не удалось загрузить лифты: ' +
          err.message + '</p>';
      });
  }

  /** Собирает значения формы одной карточки и отправляет их на сервер. */
  function saveLift(card) {
    var id = card.dataset.id;
    var active = card.querySelector('.seg__btn.is-on');

    var body = {
      status: active ? active.dataset.value : 'working',
      statusNote: card.querySelector('[data-field="statusNote"]').value,
      currentFloor: card.querySelector('[data-field="currentFloor"]').value,
      occupancy: card.querySelector('[data-field="occupancy"]').value,
      waitingAtFirstFloor: card.querySelector('[data-field="waitingAtFirstFloor"]').value
    };

    var button = card.querySelector('[data-save]');
    button.disabled = true;

    return post('/elevators/' + id, body)
      .then(function () {
        toast('Лифт ' + id + ' обновлён');
        return loadLifts();
      })
      .catch(function (err) {
        if (err.message !== 'Нужен вход') toast('Ошибка: ' + err.message, 'error');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  el.list.addEventListener('click', function (event) {
    var segment = event.target.closest('.seg__btn');

    if (segment) {
      var card = segment.closest('.lift');

      // Подсветку статуса меняем сразу, на сервер уходит по «Сохранить»
      Array.prototype.forEach.call(segment.parentNode.children, function (node) {
        node.classList.toggle('is-on', node === segment);
      });
      card.dataset.status = segment.dataset.value;
      return;
    }

    var saveButton = event.target.closest('[data-save]');
    if (saveButton) saveLift(saveButton.closest('.lift'));
  });

  function liftAction(path, message) {
    return post(path)
      .then(function (body) {
        renderLifts(body.elevators);
        toast(message);
      })
      .catch(function (err) {
        if (err.message !== 'Нужен вход') toast('Ошибка: ' + err.message, 'error');
      });
  }

  el.reset.addEventListener('click', function () {
    liftAction('/reset', 'Значения сброшены к случайным');
  });

  el.allWorking.addEventListener('click', function () {
    liftAction('/all-working', 'Все лифты переведены в «работает»');
  });

  el.testPush.addEventListener('click', function () {
    el.testPush.disabled = true;

    post('/test-notification')
      .then(function (body) {
        if (!body.total) toast('Подписок пока нет — отправлять некому');
        else toast('Отправлено ' + body.sent + ' из ' + body.total);
      })
      .catch(function (err) {
        if (err.message !== 'Нужен вход') toast('Ошибка: ' + err.message, 'error');
      })
      .then(function () { el.testPush.disabled = false; });
  });

  // ---------- Вкладка «Статистика» ----------

  function metricCard(name, label, value, hint) {
    return '' +
      '<div class="metric">' +
        '<div class="metric__label">' + ICONS.icon(name) + label + '</div>' +
        '<div class="metric__value">' + value + '</div>' +
        '<div class="metric__hint">' + hint + '</div>' +
      '</div>';
  }

  function renderStats(body) {
    var api24 = body.api;

    // Подзаголовок обновляем и отсюда: иначе, если страница открылась
    // сразу на «Статистике», в шапке не было бы счёта работающих лифтов
    el.headSub.textContent = 'Корпус 7, Мельникайте 70 · работают ' +
      body.elevators.working + ' из ' + body.elevators.total;

    // Пользователи тестовых ботов в цифру не входят — но сказать о них надо,
    // иначе непонятно, почему в базе записей больше, чем в цифре
    var usersHint = 'Telegram ' + body.users.telegram + ' · MAX ' + body.users.max;
    if (body.users.others) {
      usersHint += ' · ещё ' + body.users.others + ' у других ботов';
    }

    // Счётчик жалоб на кнопке вкладки — чтобы новые было видно,
    // не открывая её. /stats отдаёт их число заодно
    el.reportsBadge.textContent = body.reports;
    el.reportsBadge.hidden = !body.reports;

    el.supportBadge.textContent = body.supportOpen;
    el.supportBadge.hidden = !body.supportOpen;

    // Память вместо Redis — значит, цифры обнулятся при перезапуске.
    // Молчать об этом нельзя: человек решит, что статистика просто врёт
    if (body.storage === 'memory') {
      usersHint += ' · база не подключена';
    }

    el.metrics.innerHTML =
      metricCard('users', 'Всего пользователей', body.users.total, usersHint) +
      metricCard('signal', 'Всего запросов к API', api24.total,
        'с момента первого запуска') +
      metricCard('clock', 'Запросов сегодня', api24.today,
        'с начала суток') +
      metricCard('bell', 'Подписок на уведомления', body.subscriptions,
        'жалоб на лифты: ' + body.reports);

    renderChart(api24.hours);
  }

  /**
   * Бар-чарт из 24 столбцов. Высоту считаем в процентах от самого
   * большого часа: абсолютная шкала при двадцати запросах показывала бы
   * двадцать неразличимых полосок у самого низа.
   */
  function renderChart(hours) {
    var peak = hours.reduce(function (max, cell) {
      return Math.max(max, cell.count);
    }, 0);

    if (!peak) {
      el.chart.innerHTML = '<p class="chart__empty">За сутки обращений к API не было. ' +
        'Откройте мини-апп — и столбцы появятся.</p>';
      return;
    }

    el.chart.innerHTML = hours.map(function (cell, index) {
      var height = Math.max(Math.round(cell.count / peak * 100), cell.count ? 4 : 1);
      var isNow = index === hours.length - 1;

      // Подпись ставим через три часа: двадцать четыре подряд не читаются
      var label = cell.hour % 3 === 0 ? cell.label.slice(0, 2) : '';

      return '<div class="chart__col' + (isNow ? ' is-now' : '') + '" ' +
        'title="' + cell.label + ' — ' + cell.count + '">' +
          '<div class="chart__bar" style="height:' + height + '%"></div>' +
          '<span class="chart__hour">' + label + '</span>' +
        '</div>';
    }).join('');
  }

  function loadStats() {
    return api('/stats')
      .then(renderStats)
      .catch(function (err) {
        if (err.message === 'Нужен вход') return;
        el.metrics.innerHTML = '<p class="hint">Не удалось загрузить статистику: ' +
          err.message + '</p>';
      });
  }

  // ---------- Вкладка «Проблемы» ----------

  function reasonLabel(key) {
    return REASON_LABELS[key] || key;
  }

  /** «18.10, 14:32» — день и время без года: год на экране жалоб не нужен. */
  function reportTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';

    var pad = function (n) { return n < 10 ? '0' + n : String(n); };

    return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + ', ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Лифт с наибольшим числом жалоб — его и выносим в сводку. */
  function worstElevator(byElevator) {
    var ids = Object.keys(byElevator);
    if (!ids.length) return null;

    var worst = ids[0];
    ids.forEach(function (id) {
      if (byElevator[id] > byElevator[worst]) worst = id;
    });

    return { id: worst, count: byElevator[worst] };
  }

  function renderReports(body) {
    var worst = worstElevator(body.byElevator);

    // Самая частая причина — по ней видно, что именно чинить
    var reasons = Object.keys(body.byReason).sort(function (a, b) {
      return body.byReason[b] - body.byReason[a];
    });

    el.reportsMetrics.innerHTML =
      metricCard('report', 'Всего сообщений', body.total,
        body.total ? 'последнее ' + reportTime(body.reports[0].timestamp) : 'пока пусто') +
      metricCard('elevator', 'Больше всего жалоб',
        worst ? 'Лифт ' + worst.id : '—',
        worst ? worst.count + ' из ' + body.total : 'жалоб нет') +
      metricCard('warning', 'Частая причина',
        reasons.length ? reasonLabel(reasons[0]) : '—',
        reasons.length ? body.byReason[reasons[0]] + ' раз' : 'жалоб нет');

    // Счётчик на кнопке вкладки
    el.reportsBadge.textContent = body.total;
    el.reportsBadge.hidden = !body.total;

    if (!body.total) {
      el.reportsList.innerHTML = '<p class="reports__empty">Сообщений о проблемах пока нет. ' +
        'Они появятся здесь, когда кто-нибудь нажмёт «Сообщить о проблеме» ' +
        'на экране лифта в мини-аппе.</p>';
      return;
    }

    el.reportsSub.textContent = body.shown < body.total
      ? 'Показаны последние ' + body.shown + ' из ' + body.total + ', новые сверху.'
      : 'Жалобы из мини-аппа, новые сверху.';

    el.reportsList.innerHTML = body.reports.map(function (report) {
      var reason = report.reason || 'other';

      return '<article class="report" data-reason="' + escapeHtml(reason) + '">' +
          '<div class="report__head">' +
            '<span class="report__lift">Лифт ' + escapeHtml(report.elevatorId) + '</span>' +
            '<span class="report__reason">' + escapeHtml(reasonLabel(reason)) + '</span>' +
            '<span class="report__time">' + reportTime(report.timestamp) + '</span>' +
          '</div>' +
          '<p class="report__comment">' + escapeHtml(report.comment || '') + '</p>' +
        '</article>';
    }).join('');
  }

  function loadReports() {
    return api('/reports')
      .then(renderReports)
      .catch(function (err) {
        if (err.message === 'Нужен вход') return;
        el.reportsList.innerHTML = '<p class="reports__empty">Не удалось загрузить: ' +
          escapeHtml(err.message) + '</p>';
      });
  }

  el.reportsRefresh.addEventListener('click', function () {
    el.reportsRefresh.disabled = true;
    loadReports().then(function () { el.reportsRefresh.disabled = false; });
  });

  // ---------- Вкладка «Поддержка» ----------

  function ticketCard(ticket) {
    var replied = ticket.status === 'replied';

    // Подтверждён ли отправитель. Для неподтверждённых ответ уйдёт
    // по адресу, который прислал клиент, — об этом честно пишем
    var trust = ticket.verified
      ? '<span class="ticket__tag ticket__tag--ok">подтверждён</span>'
      : '<span class="ticket__tag ticket__tag--warn">не подтверждён</span>';

    var platform = '<span class="ticket__tag ticket__tag--plain">' +
      (ticket.platform === 'max' ? 'MAX' : 'Telegram') + '</span>';

    var body = replied
      ? '<div class="ticket__reply"><b>Ответ отправлен ' +
          reportTime(ticket.repliedAt || ticket.createdAt) + '</b>' +
          escapeHtml(ticket.replyText || '') + '</div>'
      : '<div class="ticket__form">' +
          '<textarea class="ticket__area" data-reply ' +
            'placeholder="Ответ уйдёт человеку в чат с ботом"></textarea>' +
          '<div class="ticket__actions">' +
            '<button class="btn btn--accent" type="button" data-send>' +
              ICONS.icon('send') + ' Ответить</button>' +
            '<span class="ticket__hint" data-state></span>' +
          '</div>' +
        '</div>';

    return '<article class="ticket" data-id="' + escapeHtml(ticket.id) + '" ' +
        'data-status="' + escapeHtml(ticket.status) + '">' +
        '<div class="ticket__head">' +
          '<span class="ticket__user">' + escapeHtml(ticket.username || 'anonymous') + '</span>' +
          platform + trust +
          '<span class="ticket__time">' + reportTime(ticket.createdAt) + '</span>' +
        '</div>' +
        '<div class="ticket__message">' + escapeHtml(ticket.message || '') + '</div>' +
        body +
      '</article>';
  }

  function renderSupport(body) {
    el.supportMetrics.innerHTML =
      metricCard('support', 'Всего обращений', body.total,
        body.total ? 'последнее ' + reportTime(body.tickets[0].createdAt) : 'пока пусто') +
      metricCard('warning', 'Ждут ответа', body.open,
        body.open ? 'ответьте из карточки ниже' : 'все обработаны') +
      metricCard('check', 'Отвечено', body.total - body.open,
        'ответ ушёл в чат с ботом');

    el.supportBadge.textContent = body.open;
    el.supportBadge.hidden = !body.open;

    if (!body.total) {
      el.supportList.innerHTML = '<p class="tickets__empty">Пока нет обращений ' +
        'от пользователей. Они появятся здесь, когда кто-нибудь напишет через ' +
        '«Связаться с поддержкой» в настройках мини-аппа.</p>';
      return;
    }

    el.supportSub.textContent = 'Вопросы из мини-аппа, новые сверху. ' +
      'Ответ уходит человеку в чат с ботом.';

    el.supportList.innerHTML = body.tickets.map(ticketCard).join('');
  }

  function loadSupport() {
    return api('/support')
      .then(renderSupport)
      .catch(function (err) {
        if (err.message === 'Нужен вход') return;
        el.supportList.innerHTML = '<p class="tickets__empty">Не удалось загрузить: ' +
          escapeHtml(err.message) + '</p>';
      });
  }

  /** Отправляет ответ и перерисовывает список. */
  function replyToTicket(card) {
    var id = card.dataset.id;
    var area = card.querySelector('[data-reply]');
    var button = card.querySelector('[data-send]');
    var state = card.querySelector('[data-state]');

    var replyText = area.value.trim();

    if (!replyText) {
      state.textContent = 'Напишите ответ';
      return;
    }

    button.disabled = true;
    state.textContent = 'Отправляем...';

    post('/support/' + encodeURIComponent(id) + '/reply', { replyText: replyText })
      .then(function (body) {
        // Доставка и сохранение — разные вещи: ответ записан в любом случае,
        // а дойти мог и не дойти, если человек заблокировал бота
        if (body.delivered) toast('Ответ отправлен');
        else toast(body.note || 'Ответ сохранён, но не доставлен', 'error');

        return loadSupport();
      })
      .catch(function (err) {
        if (err.message !== 'Нужен вход') {
          state.textContent = 'Ошибка: ' + err.message;
          toast('Ошибка: ' + err.message, 'error');
        }
        button.disabled = false;
      });
  }

  el.supportList.addEventListener('click', function (event) {
    var send = event.target.closest('[data-send]');
    if (send) replyToTicket(send.closest('.ticket'));
  });

  el.supportRefresh.addEventListener('click', function () {
    el.supportRefresh.disabled = true;
    loadSupport().then(function () { el.supportRefresh.disabled = false; });
  });

  // ---------- Вкладка «Рассылка» ----------

  /** Предел длины зависит от того, есть ли вложение: подпись короче текста. */
  function castLimit() {
    return media ? limits.caption : limits.text;
  }

  function updateCastCount() {
    var length = el.castText.value.length;
    var max = castLimit();

    el.castCount.textContent = length + ' / ' + max;
    el.castCount.style.color = length > max ? 'var(--full)' : '';
    el.castText.maxLength = max;
  }

  el.castText.addEventListener('input', updateCastCount);

  // ---------- Вложение ----------

  function humanSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
    return Math.max(1, Math.round(bytes / 1024)) + ' КБ';
  }

  function showMediaState(message, tone) {
    el.castMediaState.textContent = message || '';
    el.castMediaState.hidden = !message;
    el.castMediaState.dataset.tone = tone || 'ok';
    el.castClear.hidden = !media;
  }

  function clearMedia() {
    media = null;
    el.castFile.value = '';
    el.castUrl.value = '';
    showMediaState('');
    updateCastCount();
  }

  el.castClear.addEventListener('click', clearMedia);

  /** Ссылка вместо файла: грузить ничего не надо, Telegram заберёт сам. */
  el.castUrl.addEventListener('input', function () {
    var url = el.castUrl.value.trim();

    if (!url) {
      if (media && media.url) clearMedia();
      return;
    }

    el.castFile.value = '';

    // Тип определяем по расширению — спросить сервер по ту сторону ссылки
    // мы не можем, а Telegram разные методы для фото и видео
    var kind = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|$)/i.test(url) ? 'video' : 'photo';

    media = { kind: kind, url: url };
    showMediaState('Ссылка: ' + (kind === 'video' ? 'видео' : 'фото'));
    updateCastCount();
  });

  el.castFile.addEventListener('change', function () {
    var file = el.castFile.files && el.castFile.files[0];
    if (!file) return;

    if (file.size > limits.uploadBytes) {
      el.castFile.value = '';
      showMediaState('Файл слишком большой: ' + humanSize(file.size) +
        ' при пределе ' + humanSize(limits.uploadBytes), 'error');
      return;
    }

    el.castUrl.value = '';
    showMediaState('Загружаю ' + file.name + ' (' + humanSize(file.size) + ')...');

    // Шлём сырые байты: разбирать multipart на сервере ради одного файла
    // незачем, а тип и имя помещаются в заголовки
    fetch('api/admin/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name).replace(/%20/g, ' ')
      },
      body: file
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.success === false) {
            throw new Error(body.error || 'HTTP ' + res.status);
          }
          return body;
        });
      })
      .then(function (body) {
        media = { kind: body.kind, id: body.id };
        showMediaState((body.kind === 'video' ? 'Видео' : 'Фото') + ': ' +
          file.name + ' · ' + humanSize(body.size));
        updateCastCount();
      })
      .catch(function (err) {
        el.castFile.value = '';
        media = null;
        showMediaState('Не удалось загрузить: ' + err.message, 'error');
        updateCastCount();
      });
  });

  // ---------- Кнопки под сообщением ----------

  function addButtonRow(text, url) {
    if (el.castButtons.children.length >= limits.buttons) {
      toast('Больше ' + limits.buttons + ' кнопок Telegram не покажет', 'error');
      return;
    }

    var row = document.createElement('div');
    row.className = 'buttons__row';

    row.innerHTML = '' +
      '<input class="input" data-button="text" type="text" maxlength="64" ' +
        'placeholder="Подпись" value="' + escapeHtml(text || '') + '" />' +
      '<input class="input" data-button="url" type="url" ' +
        'placeholder="https://..." value="' + escapeHtml(url || '') + '" />' +
      '<button class="buttons__drop" type="button" data-button-remove ' +
        'title="Убрать кнопку">' + ICONS.icon('close') + '</button>';

    el.castButtons.appendChild(row);
  }

  el.buttonAdd.addEventListener('click', function () { addButtonRow(); });

  el.castButtons.addEventListener('click', function (event) {
    var remove = event.target.closest('[data-button-remove]');
    if (remove) remove.closest('.buttons__row').remove();
  });

  /** Собирает кнопки из формы; пустые строки просто пропускаются. */
  function collectButtons() {
    return Array.prototype.map.call(el.castButtons.children, function (row) {
      return {
        text: row.querySelector('[data-button="text"]').value.trim(),
        url: row.querySelector('[data-button="url"]').value.trim()
      };
    }).filter(function (item) { return item.text || item.url; });
  }

  /** Показывает ход рассылки; возвращает true, пока она не закончилась. */
  function renderProgress(progress) {
    if (!progress) {
      el.castProgress.hidden = true;
      el.castCancel.hidden = true;
      return false;
    }

    var done = progress.sent + progress.failed;
    var share = progress.total ? Math.round(done / progress.total * 100) : 0;

    el.castProgress.hidden = false;
    el.castFill.style.width = share + '%';

    var text = 'Отправлено ' + progress.sent + ' из ' + progress.total;
    if (progress.failed) text += ' · ошибок ' + progress.failed;
    if (progress.media) text += ' · ' + (progress.media === 'video' ? 'видео' : 'фото');
    if (progress.buttons) text += ' · кнопок ' + progress.buttons;

    if (progress.done) {
      text = progress.cancelled
        ? 'Остановлено: ' + text.toLowerCase()
        : 'Готово: ' + text.toLowerCase();
    }

    el.castProgressText.textContent = text;

    var running = !progress.done;
    el.castCancel.hidden = !running;
    el.castSend.disabled = running;

    return running;
  }

  function pollCast() {
    clearInterval(castTimer);

    castTimer = setInterval(function () {
      api('/broadcast')
        .then(function (body) {
          if (!renderProgress(body.progress)) {
            clearInterval(castTimer);
            castTimer = null;
            loadCast();
          }
        })
        .catch(function () {
          clearInterval(castTimer);
          castTimer = null;
        });
    }, CAST_POLL_MS);
  }

  function loadCast() {
    updateCastCount();

    return api('/broadcast')
      .then(function (body) {
        recipients = body.recipients.total;
        if (body.limits) limits = body.limits;
        updateCastCount();

        var warn = recipients
          ? 'Будет отправлено ' + usersDative(recipients) +
            ' (Telegram ' + body.recipients.telegram + ' · MAX ' + body.recipients.max + ').'
          : 'Получателей пока нет: список наполняется, когда люди пишут /start ' +
            'боту из .env этого проекта.';

        if (body.recipients.others) {
          warn += ' Пользователи других ботов (' + body.recipients.others +
            ') не получат ничего: их чаты знает только тот бот, который их завёл.';
        }

        el.castWarnText.textContent = warn;

        // Порядок важен: renderProgress тоже трогает кнопку, а последнее
        // слово должно остаться за «получателей нет — отправлять некому»
        var running = renderProgress(body.progress);

        el.castSend.disabled = running || !recipients;

        if (running) pollCast();
      })
      .catch(function (err) {
        if (err.message === 'Нужен вход') return;
        el.castWarnText.textContent = 'Не удалось получить список: ' + err.message;
      });
  }

  el.castSend.addEventListener('click', function () {
    var text = el.castText.value.trim();
    var buttons = collectButtons();

    // С вложением текст необязателен: фото без подписи — нормальное сообщение
    if (!text && !media) {
      toast('Сообщение пустое', 'error');
      return;
    }

    if (text.length > castLimit()) {
      toast('Текст длиннее ' + castLimit() + ' знаков', 'error');
      return;
    }

    var what = media
      ? (media.kind === 'video' ? 'видео' : 'фото') + (text ? ' с подписью' : '')
      : 'сообщение';

    if (buttons.length) what += ' и кнопок: ' + buttons.length;

    if (!window.confirm('Отправить ' + what + ' ' + usersDative(recipients) + '?')) return;

    el.castSend.disabled = true;

    var payload = { text: text, buttons: buttons };

    if (media && media.id) payload.mediaId = media.id;
    if (media && media.url) {
      payload.mediaUrl = media.url;
      payload.mediaKind = media.kind;
    }

    post('/broadcast', payload)
      .then(function (body) {
        toast('Рассылка запущена');
        if (body.warning) toast('Внимание: ' + body.warning, 'error');

        // Байты уже уехали в задание, и сервер их у себя удалил.
        // Повторная отправка тем же id не прошла бы — сбрасываем форму
        if (media && media.id) clearMedia();

        renderProgress(body.progress);
        pollCast();
      })
      .catch(function (err) {
        if (err.message !== 'Нужен вход') toast('Ошибка: ' + err.message, 'error');
        el.castSend.disabled = false;
      });
  });

  el.castCancel.addEventListener('click', function () {
    post('/broadcast/cancel')
      .then(function (body) {
        toast('Рассылка останавливается');
        renderProgress(body.progress);
      })
      .catch(function (err) {
        if (err.message !== 'Нужен вход') toast('Ошибка: ' + err.message, 'error');
      });
  });

  // ---------- Старт ----------

  // Спрайт иконок здесь не инлайнится — подтягиваем его файлом
  ICONS.loadSprite('icons.svg').then(function () {
    try {
      var saved = localStorage.getItem(TAB_KEY);
      if (TABS.indexOf(saved) !== -1) activeTab = saved;
    } catch (err) {
      // нет доступа к localStorage — откроем первую вкладку
    }

    token = readToken();

    if (!token) {
      showLogin('');
      return;
    }

    // Токен есть, но он мог остаться от прежнего запуска сервера.
    // Проверяем его одним запросом, прежде чем показывать дашборд.
    api('/stats')
      .then(function () { showApp(); })
      .catch(function () { /* 401 уже вернул экран входа */ });
  });
})();
