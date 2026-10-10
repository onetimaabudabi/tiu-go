/**
 * TIU GO — админка управления лифтами.
 *
 * Служебная страница для демонстраций и тестов: позволяет выставить
 * статус работы лифта, пояснение к нему и «сырые» показания датчиков.
 *
 * Поле «Ждут на 1 этаже» — это то, что считает камера в холле внизу.
 * Им удобно проверять плашку на главном экране: сумма по всем лифтам
 * до 5 даёт зелёную, 6–15 жёлтую, 16 и больше — красную.
 * Данные живут в памяти сервера и сбрасываются при его перезапуске.
 *
 * Страница открывается только при ADMIN_ENABLED=true в .env — иначе
 * и она, и ручки /api/admin отвечают 404.
 *
 * Локализации здесь намеренно нет: это внутренний инструмент.
 */

(function () {
  'use strict';

  var ICONS = window.TIU_ICONS;

  var STATUS_LABELS = {
    working: 'Работает',
    broken: 'Сломан',
    maintenance: 'Обслуживание'
  };

  var STATUS_ORDER = ['working', 'broken', 'maintenance'];

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    list: $('list'),
    headSub: $('head-sub'),
    toast: $('toast'),
    reset: $('btn-reset'),
    allWorking: $('btn-all-working'),
    testPush: $('btn-test-push')
  };

  var limits = { floors: 16, maxWaiting: 20 };
  var toastTimer = null;

  // ---------- Сообщения ----------

  function toast(message, tone) {
    clearTimeout(toastTimer);

    el.toast.textContent = message;
    el.toast.dataset.tone = tone || 'ok';
    el.toast.hidden = false;

    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3500);
  }

  // ---------- Запросы ----------

  function api(path, options) {
    return fetch('api/admin' + path, options)
      .then(function (res) {
        return res.json().catch(function () {
          throw new Error('HTTP ' + res.status);
        }).then(function (body) {
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

  // ---------- Разметка карточки ----------

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
        '<span class="field__label">Пояснение к статусу</span>' +
        '<input class="input" type="text" data-field="statusNote" maxlength="120" ' +
          'placeholder="Например: плановый ремонт до 15:00" value="' + note + '" />' +
      '</label>' +

      '<div class="nums">' +
        numberField('currentFloor', 'Этаж', lift.currentFloor, 1, lift.floors) +
        numberField('occupancy', 'В кабине', lift.occupancy, 0, lift.capacity) +
        numberField('waitingAtFirstFloor', 'Ждут на 1 этаже',
          lift.waitingAtFirstFloor, 0, limits.maxWaiting) +
      '</div>' +

      '<button class="btn btn--accent" type="button" data-save>' +
        ICONS.icon('check') + ' Сохранить</button>';

    return card;
  }

  function render(elevators) {
    el.list.innerHTML = '';
    elevators.forEach(function (lift) { el.list.appendChild(liftCard(lift)); });

    var working = elevators.filter(function (lift) {
      return lift.status === 'working';
    }).length;

    el.headSub.textContent = 'Корпус 7, Мельникайте 70 · работают ' +
      working + ' из ' + elevators.length;
  }

  // ---------- Загрузка и сохранение ----------

  function load() {
    return api('/elevators')
      .then(function (body) {
        limits.floors = body.floors || limits.floors;
        limits.maxWaiting = body.maxWaiting || limits.maxWaiting;
        render(body.elevators);
      })
      .catch(function (err) {
        el.list.innerHTML = '<p class="hint">Не удалось загрузить лифты: ' +
          err.message + '</p>';
      });
  }

  /** Собирает значения формы одной карточки и отправляет их на сервер. */
  function save(card) {
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

    return post('/elevator/' + id, body)
      .then(function () {
        toast('Лифт ' + id + ' обновлён');
        return load();
      })
      .catch(function (err) {
        toast('Ошибка: ' + err.message, 'error');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  // ---------- События ----------

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
    if (saveButton) save(saveButton.closest('.lift'));
  });

  el.reset.addEventListener('click', function () {
    post('/reset')
      .then(function (body) {
        render(body.elevators);
        toast('Значения сброшены к случайным');
      })
      .catch(function (err) { toast('Ошибка: ' + err.message, 'error'); });
  });

  el.allWorking.addEventListener('click', function () {
    post('/all-working')
      .then(function (body) {
        render(body.elevators);
        toast('Все лифты переведены в «работает»');
      })
      .catch(function (err) { toast('Ошибка: ' + err.message, 'error'); });
  });

  el.testPush.addEventListener('click', function () {
    el.testPush.disabled = true;

    post('/test-notification')
      .then(function (body) {
        if (!body.total) toast('Подписок пока нет — отправлять некому');
        else toast('Отправлено ' + body.sent + ' из ' + body.total);
      })
      .catch(function (err) { toast('Ошибка: ' + err.message, 'error'); })
      .then(function () { el.testPush.disabled = false; });
  });

  // ---------- Старт ----------

  // Спрайт иконок здесь не инлайнится — подтягиваем его файлом
  ICONS.loadSprite('icons.svg').then(load);
})();
