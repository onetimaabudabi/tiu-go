/**
 * Подбор детализации под машину.
 *
 * Требование из постановки задачи — «если FPS падает ниже 30,
 * автоматически снижать детализацию». Здесь это сделано лестницей
 * уровней с гистерезисом: падаем быстро (две секунды низкого FPS),
 * поднимаемся медленно (шесть секунд комфортного). Без гистерезиса
 * качество дёргалось бы туда-сюда каждые полсекунды.
 *
 * Уровни описаны в PERF.levels и включают всё разом: сколько персонажей
 * показывать целиком, с какого расстояния переходить на упрощённые,
 * масштаб пикселей, тени и число источников света.
 */

import { PERF } from './params.js';

export class Quality {
  constructor({ renderer, crowd, lighting, onChange }) {
    this.renderer = renderer;
    this.crowd = crowd;
    this.lighting = lighting;
    this.onChange = onChange || (() => {});

    this.level = PERF.startLevel;
    this.lowFor = 0;
    this.highFor = 0;
    this.locked = false;      // ручная фиксация уровня

    this.apply();
  }

  get current() { return PERF.levels[this.level]; }

  apply() {
    const level = this.current;

    // Масштаб пикселей ограничиваем и плотностью экрана, и уровнем
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, level.pixelRatio));
    this.renderer.shadowMap.enabled = level.shadows;
    this.renderer.shadowMap.needsUpdate = true;

    this.lighting.setShadows(level.shadows);
    this.lighting.setQuality(level.lights);

    this.crowd.setBudget(level.fullDetail, level.lodDistance, level.shadowCasters);

    console.log(
      `[качество] ${level.name}: полных моделей ${level.fullDetail}, ` +
      `LOD с ${level.lodDistance} м, pixelRatio ${level.pixelRatio}, ` +
      `тени ${level.shadows ? 'вкл' : 'выкл'}`
    );

    this.onChange(level);
  }

  /** Вызывается раз в полсекунды вместе с замером FPS. */
  update(fps, dt) {
    if (this.locked || !fps) return;

    // В свёрнутой вкладке requestAnimationFrame сам по себе идёт раз
    // в сотню миллисекунд. Это не просадка производительности, и
    // понижать по ней качество нельзя — иначе вернувшись к вкладке
    // пользователь увидит картинку хуже, чем оставил.
    if (document.hidden) { this.lowFor = 0; this.highFor = 0; return; }

    if (fps < PERF.fpsFloor) {
      this.lowFor += dt;
      this.highFor = 0;

      if (this.lowFor >= PERF.dropAfter && this.level > 0) {
        this.level -= 1;
        this.lowFor = 0;
        this.apply();
      }
      return;
    }

    if (fps > PERF.fpsComfort) {
      this.highFor += dt;
      this.lowFor = 0;

      if (this.highFor >= PERF.raiseAfter && this.level < PERF.levels.length - 1) {
        this.level += 1;
        this.highFor = 0;
        this.apply();
      }
      return;
    }

    this.lowFor = 0;
    this.highFor = 0;
  }

  /** Ручной выбор уровня — отключает автоматику. */
  setLevel(index) {
    this.level = Math.max(0, Math.min(PERF.levels.length - 1, index));
    this.locked = true;
    this.apply();
  }
}
