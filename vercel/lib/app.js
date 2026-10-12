/**
 * Serverless-обвязка вокруг перенесённого сервера.
 *
 * lib/server-core.js — это тот же код, что работал на Render: все расчёты
 * ожидания, прогноза, планировщика и уведомлений. Он ничего не знает про
 * serverless и устроен так, будто процесс живёт всегда.
 *
 * Здесь дописано ровно то, чем этот «всегда живущий процесс» занимался
 * между запросами:
 *
 *   • двигал симуляцию таймером        → теперь прокрутка по часам, в начале запроса;
 *   • копил окно наблюдений для прогноза → теперь оно поднимается из хранилища;
 *   • держал всё в памяти               → теперь состояние уезжает в KV после ответа.
 *
 * Снаружи от этого ничего не меняется: маршруты те же, ответы те же.
 */

const core = require('./server-core');
const mock = require('./mockData');
const storage = require('./storage');

// Как часто снимаем показания для прогноза. То же число, что на Render:
// чаще смысла нет, реже — ломается тренд.
const HISTORY_SAMPLE_MS = 10 * 1000;

/**
 * Готовит состояние перед обработкой запроса.
 *
 * Порядок важен: сначала поднять лифты, потом догнать время, потом
 * записать наблюдение — иначе в историю попадёт то, что было до тика.
 */
async function hydrate() {
  await storage.load();

  // ---- лифты ----
  const saved = storage.get('elevators');
  const now = Date.now();

  if (saved && saved.state) mock.hydrate(saved.state);
  const steps = mock.tickTo(saved && saved.tickedAt, now);

  // ---- окно наблюдений ----
  const savedHistory = storage.get('history');

  if (savedHistory && savedHistory.points) {
    core.history.clear();
    Object.keys(savedHistory.points).forEach((id) => {
      core.history.set(Number(id), savedHistory.points[id]);
    });
  }

  const lastSample = (savedHistory && savedHistory.sampledAt) || 0;
  const sampled = now - lastSample >= HISTORY_SAMPLE_MS;

  // recordHistory заодно копит почасовую статистику для планировщика
  if (sampled) core.recordHistory(now);

  return { now, steps, sampled, lastSample };
}

/**
 * Складывает состояние обратно в хранилище.
 * Зовётся после ответа клиенту, но до завершения функции.
 */
async function persist(context) {
  storage.set('elevators', { state: mock.snapshot(), tickedAt: context.now });

  const points = {};
  core.history.forEach((value, id) => { points[id] = value; });

  storage.set('history', {
    points,
    sampledAt: context.sampled ? context.now : context.lastSample
  });

  return storage.flush();
}

module.exports = {
  app: core.app,
  core,
  mock,
  storage,
  hydrate,
  persist
};
