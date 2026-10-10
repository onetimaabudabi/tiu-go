/**
 * Живая статистика и два графика.
 *
 * Панель обновляется четыре раза в секунду — чаще не нужно, цифры и так
 * мелькают, а перерисовка DOM на каждом кадре отъедает кадровый бюджет.
 * Графики — раз в секунду, по точкам, которые симулятор копит раз
 * в модельную минуту.
 */

import Chart from 'chart.js/auto';
import { ELEVATORS, SIM } from '../logic/params.js';

const ROWS = [
  { key: 'inHall', label: 'Людей в холле' },
  { key: 'inLifts', label: 'Людей в лифтах' },
  { key: 'toStairs', label: 'Ушло на лестницу' },
  { key: 'avgWait', label: 'Среднее ожидание', format: (v) => `${Math.round(v)} с` },
  { key: 'served', label: 'Увезли всего' },
  { key: 'passes', label: 'Проехали мимо' },
  { key: 'working', label: 'Работают' }
];

export function createStats(app, sim) {
  const list = document.getElementById('stats-list');
  const clock = document.getElementById('stat-clock');
  const phase = document.getElementById('stat-phase');
  const fpsEl = document.getElementById('stat-fps');

  const cells = new Map();

  for (const row of ROWS) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;

    const dd = document.createElement('dd');
    dd.textContent = '—';

    list.append(dt, dd);
    cells.set(row.key, dd);
  }

  // ---------- графики ----------

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#6b7682', maxTicksLimit: 6, font: { size: 9 } }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: '#6b7682', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
    },
    elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.3 } }
  };

  const queueChart = new Chart(document.getElementById('chart-queue'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#4b8cf7', fill: true, backgroundColor: 'rgba(75,140,247,0.14)' }] },
    options: common
  });

  const loadChart = new Chart(document.getElementById('chart-load'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#ffd166', fill: true, backgroundColor: 'rgba(255,209,102,0.14)' }] },
    options: {
      ...common,
      scales: { ...common.scales, y: { ...common.scales.y, suggestedMax: ELEVATORS.capacityRealPeak } }
    }
  });

  // ---------- обновление ----------

  let uiTimer = 0;
  let chartTimer = 0;

  function set(key, value, level) {
    const cell = cells.get(key);
    if (!cell) return;
    if (cell.textContent !== value) cell.textContent = value;

    cell.classList.toggle('is-free', level === 'free');
    cell.classList.toggle('is-busy', level === 'busy');
    cell.classList.toggle('is-full', level === 'full');
  }

  function update(dt) {
    uiTimer += dt;
    chartTimer += dt;

    if (uiTimer >= 0.25) {
      uiTimer = 0;
      draw();
    }

    if (chartTimer >= 1) {
      chartTimer = 0;
      drawCharts();
    }
  }

  function draw() {
    const s = sim.stats;

    clock.textContent = sim.clockLabel;
    phase.textContent = app.running ? sim.phaseLabel : 'на паузе · ' + sim.phaseLabel;

    const level = s.inHall >= 16 ? 'full' : s.inHall > 5 ? 'busy' : 'free';

    for (const row of ROWS) {
      if (row.key === 'working') continue;
      const raw = s[row.key] || 0;
      set(row.key, row.format ? row.format(raw) : String(Math.round(raw)));
    }

    set('inHall', String(s.inHall), level);
    set('working', `${ELEVATORS.working.length} из ${ELEVATORS.total}`,
      ELEVATORS.working.length < ELEVATORS.total ? 'busy' : 'free');

    const hidden = s.offscreen
      ? ` · за кадром ${s.offscreen}`
      : '';
    fpsEl.textContent = `${app.fps} FPS · в сцене ${sim.crowd.count}/${SIM.maxVisiblePeople}${hidden}` +
      ` · детализация: ${app.qualityName}`;
  }

  function drawCharts() {
    const points = sim.history;
    if (!points.length) return;

    const labels = points.map((p) => p.label);

    queueChart.data.labels = labels;
    queueChart.data.datasets[0].data = points.map((p) => p.queue);
    queueChart.update('none');

    loadChart.data.labels = labels;
    loadChart.data.datasets[0].data = points.map((p) => p.load);
    loadChart.update('none');
  }

  return { update, draw };
}
