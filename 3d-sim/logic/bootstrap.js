/**
 * Сборка боевой логики: грузим людей, создаём толпу, симулятор и панели.
 *
 * Отдельный модуль нужен, чтобы main.js оставался про сцену и рендер,
 * а не про загрузку ассетов. Если FBX не доехал, визуализация всё равно
 * запускается — просто с запасными человечками: пустая сцена в день
 * презентации хуже, чем упрощённые модели.
 */

import * as THREE from 'three';
import { loadPeopleAssets } from '../scene/person.js';
import { Crowd } from '../scene/crowd.js';
import { Simulator } from './simulator.js';
import { createControls } from '../ui/controls.js';
import { createStats } from '../ui/stats.js';
import { Quality } from './quality.js';
import { SIM } from './params.js';

/** Драйвер: единая точка, через которую main.js дёргает логику. */
class Driver {
  constructor(sim, stats) {
    this.sim = sim;
    this.stats = stats;
  }

  beginStep() { this.sim.beginStep(); }
  update(dt) { this.sim.update(dt); }

  render(alpha, realDt) {
    this.sim.render(alpha, realDt);
    this.stats.update(realDt);
  }
}

export async function boot(app) {
  const loader = document.getElementById('loader');
  const fill = document.getElementById('loader-fill');
  const sub = document.getElementById('loader-sub');
  const note = document.getElementById('loader-note');

  const manager = new THREE.LoadingManager();

  manager.onProgress = (url, loaded, total) => {
    const percent = total ? Math.round((loaded / total) * 100) : 0;
    fill.style.width = `${percent}%`;
    sub.textContent = `Модели людей: ${loaded} из ${total}`;
  };

  let assets = null;

  try {
    sub.textContent = 'Загружаем модели людей…';
    assets = await loadPeopleAssets(manager);
  } catch (error) {
    console.error('[люди] FBX не загрузился:', error);
    note.textContent = 'FBX не загрузился — показываем упрощённых персонажей. Подробности в консоли.';
    sub.textContent = 'Запасной режим';
  }

  fill.style.width = '100%';

  const crowd = new Crowd(app.scene, assets);
  const sim = new Simulator(app, crowd);

  const stats = createStats(app, sim);
  const controls = createControls(app, sim);

  app.setDriver(new Driver(sim, stats));
  app.sim = sim;
  app.crowd = crowd;

  // Детализация подбирается под машину: см. logic/quality.js
  const quality = new Quality({
    renderer: app.renderer,
    crowd,
    lighting: app.lighting,
    onChange: (level) => {
      if (typeof window.__tiuOnQuality === 'function') window.__tiuOnQuality(level);
    }
  });
  app.attachQuality(quality);

  stats.draw();

  // Прячем заставку и запускаем день
  loader.classList.add('is-done');
  setTimeout(() => { loader.hidden = true; }, 500);

  app.play();
  controls.refreshPlay();

  console.log(
    `[симуляция] старт ${SIM.dayStart}:00, ускорение ${app.speed}×, ` +
    `людей в сцене не более ${SIM.maxVisiblePeople}, ` +
    `персонажи: ${assets ? 'FBX (Mixamo)' : 'запасные'}`
  );
}
