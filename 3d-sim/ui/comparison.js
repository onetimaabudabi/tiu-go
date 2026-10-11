/**
 * Окно «С технической частью и без неё».
 *
 * Считает logic/compare.js — тот же учебный день, что и tech-model/06,
 * только в браузере и на меньшем числе прогонов. Здесь — показ: таблица
 * разницы и список параметров, по которым всё посчитано.
 *
 * Параметры в списке не продублированы, а прочитаны из тех же объектов,
 * которыми пользуется симуляция. Если в shared/params.json поменяется
 * скорость кабины, здесь она поменяется сама.
 */

import {
  BUILDING, ELEVATORS, BANKS, SIM, WALK, DISPATCH, COMPARE
} from '../logic/params.js';
import { run as runComparison } from '../logic/compare.js';

/** Число с пробелом в разряде тысяч и запятой в дробной части. */
function num(value, digits = 0) {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

/**
 * Русское склонение после числа: 1 остановка, 2 остановки, 5 остановок.
 * Числа от 11 до 14 — исключение, у них всегда последняя форма.
 */
function plural(value, one, few, many) {
  const n = Math.abs(Math.round(value));
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;

  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Относительное изменение в процентах со знаком. */
function delta(before, after) {
  if (!before) return '—';
  const percent = (after / before - 1) * 100;
  const sign = percent >= 0 ? '+' : '−';
  return `${sign}${num(Math.abs(percent), 1)} %`;
}

// Что показываем в таблице. lower — «меньше значит лучше».
const ROWS = [
  { field: 'peakThroughput', label: 'Пропускная способность в пик, чел/ч', digits: 0, key: true },
  { field: 'avgWait', label: 'Среднее ожидание, с', digits: 0, lower: true, key: true },
  { field: 'p95Wait', label: 'Ожидание, 95-й перцентиль, с', digits: 0, lower: true },
  { field: 'maxQueue', label: 'Самая длинная очередь, чел', digits: 0, lower: true },
  { field: 'stops', label: 'Остановок за день', digits: 0, lower: true },
  { field: 'uselessStops', label: 'Бесполезных остановок за день', digits: 0, lower: true, key: true }
];

export function createComparison(app) {
  const $ = (id) => document.getElementById(id);

  const overlay = $('compare-overlay');
  const table = $('compare-table');
  const rows = $('compare-rows');
  const note = $('compare-note');
  const verdict = $('compare-verdict');
  const progress = $('compare-progress');
  const fill = $('compare-progress-fill');
  const params = $('compare-params');

  let running = false;
  let lastResult = null;

  // ---------- параметры ----------

  function paramLines() {
    const workingBanks = Object.values(BANKS)
      .map((bank) => {
        const live = bank.numbers.filter((n) => ELEVATORS.working.includes(n));
        return live.length ? `${live.join(', ')} ${bank.label}` : null;
      })
      .filter(Boolean)
      .join('; ');

    return [
      ['Этажей', `${BUILDING.floors} × ${num(BUILDING.floorHeight, 1)} м`],
      ['Лифтов в работе', `${ELEVATORS.working.length} из ${ELEVATORS.total}`],
      ['Какие именно', workingBanks],
      ['Вместимость в пик', `${DISPATCH.capacity} чел`],
      ['Скорость кабины', `${num(ELEVATORS.speed, 1)} м/с`],
      ['Ускорение', `${num(ELEVATORS.acceleration, 1)} м/с²`],
      ['Двери', `${ELEVATORS.doorOpenTime} + ${ELEVATORS.doorHoldTime} + ` +
        `${ELEVATORS.doorCloseTime} = ${ELEVATORS.doorCycle} с`],
      ['Проём створок', `${num(ELEVATORS.doorWidth, 2)} м`],
      ['Вход-выход', `${ELEVATORS.boardingTimePerPerson} с на человека`],
      ['Шаг пешехода', `${num(WALK.speed, 2)} м/с`],
      ['Терпение в очереди', `${SIM.patienceSeconds} с`],
      ['Запас мест', `${DISPATCH.margin}` +
        (DISPATCH.marginFromModel ? ' (оптимум модели)' : ' (по умолчанию)')],
      ['Пограничная зона', `${DISPATCH.band} места`],
      ['Камера', `map50 ${num(DISPATCH.camera.map50, 2)}, ` +
        `FP ${num(DISPATCH.camera.falsePositiveRate * 100, 0)} %, ` +
        `FN ${num(DISPATCH.camera.falseNegativeRate * 100, 0)} %`],
      ['Поток', `${num(SIM.population)} чел × ${SIM.tripsPerPersonPerDay} поездки, ` +
        `${num(SIM.lobbyShare * 100, 0)} % из холла`]
    ];
  }

  function drawParams() {
    params.replaceChildren();

    for (const [label, value] of paramLines()) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      params.append(dt, dd);
    }
  }

  // ---------- таблица ----------

  function drawTable(result) {
    rows.replaceChildren();

    for (const row of ROWS) {
      const before = result.off[row.field];
      const after = result.on[row.field];
      const better = row.lower ? after < before : after > before;

      const tr = document.createElement('tr');
      if (row.key) tr.className = 'is-key';

      const cells = [
        row.label,
        num(before, row.digits),
        num(after, row.digits),
        delta(before, after)
      ];

      cells.forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 3 && before !== after) {
          td.className = better ? 'is-better' : 'is-worse';
        }
        tr.appendChild(td);
      });

      rows.appendChild(tr);
    }

    table.hidden = false;

    // Прямой ответ на вопрос «с функцией лучше или без»
    const better = result.on.peakThroughput > result.off.peakThroughput &&
      result.on.avgWait < result.off.avgWait;
    const saved = Math.round(result.off.uselessStops - result.on.uselessStops);

    verdict.textContent = better
      ? `С технической частью лучше: в пиковый час лифты увозят на ` +
        `${num(result.gainPercent, 1)} % больше людей, ждать приходится на ` +
        `${num(result.waitGainPercent, 1)} % меньше, и за день исчезает ` +
        `${num(saved)} ` +
        plural(saved, 'бесполезная остановка', 'бесполезные остановки',
          'бесполезных остановок') +
        ` из ${num(result.off.uselessStops, 0)}.`
      : `На этих прогонах техническая часть не дала выигрыша: ` +
        `пропускная способность ${delta(result.off.peakThroughput, result.on.peakThroughput)}, ` +
        `ожидание ${delta(result.off.avgWait, result.on.avgWait)}.`;

    verdict.classList.toggle('is-good', better);
    verdict.hidden = false;

    const lines = [
      `${result.days} дней × 2 режима, расчёт занял ` +
        `${num(result.elapsed, 1)} с. Лифтов ${result.lifts}, вместимость ` +
        `${result.capacity}, запас мест ${result.margin}.`,
      `Проездов мимо этажа за день: ${num(result.on.passes, 0)}, ` +
        `из них обоснованных ${num(result.passAccuracy * 100, 0)} %.`
    ];

    // Сверка с моделью: те же правила, но 500 дней вместо тридцати
    if (result.reference) {
      lines.push(
        `Та же модель на ${result.reference.runs} днях (npm run tech:sim): ` +
        `пропускная способность ${result.reference.gainPercent > 0 ? '+' : ''}` +
        `${num(result.reference.gainPercent, 1)} %, ожидание −` +
        `${num(result.reference.waitGainPercent, 1)} %.`
      );
    }

    note.textContent = lines.join(' ');
    note.hidden = false;
  }

  // ---------- запуск ----------

  async function run() {
    if (running) return;
    running = true;

    progress.hidden = false;
    fill.style.width = '0%';
    note.hidden = true;
    verdict.hidden = true;

    try {
      lastResult = await runComparison({
        days: COMPARE.days,
        onProgress: (done, total) => {
          fill.style.width = `${Math.round((done / total) * 100)}%`;
        }
      });

      drawTable(lastResult);

      console.log(
        `[сравнение] ${lastResult.days} дней: пропускная способность ` +
        `${lastResult.gainPercent.toFixed(1)} %, ожидание ` +
        `${(-lastResult.waitGainPercent).toFixed(1)} %, бесполезных остановок ` +
        `${Math.round(lastResult.off.uselessStops)} → ${Math.round(lastResult.on.uselessStops)}`
      );
    } catch (error) {
      console.error('[сравнение] не посчиталось:', error);
      note.textContent = 'Не удалось посчитать — подробности в консоли.';
      note.hidden = false;
    } finally {
      progress.hidden = true;
      running = false;
    }
  }

  // Пока открыто окно, сцена закрыта им почти целиком. Останавливаем
  // день: счёт тридцати дней и рендер толпы за одни и те же кадры
  // конкурировать не должны.
  let wasRunning = false;

  function open() {
    drawParams();
    wasRunning = app.running;
    app.pause();
    overlay.hidden = false;
    if (!lastResult) run();
  }

  function close() {
    overlay.hidden = true;
    if (wasRunning) app.play();
    if (typeof window.__tiuOnSimResumed === 'function') window.__tiuOnSimResumed();
  }

  $('btn-compare-close').addEventListener('click', close);
  $('btn-compare-run').addEventListener('click', run);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && !overlay.hidden) close();
  });

  return { open, close, run, get result() { return lastResult; } };
}
