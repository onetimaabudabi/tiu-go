/**
 * TIU GO — конфигурация Vite для 3D-визуализации.
 *
 * Главная задача здесь — отдать в браузер параметры из tech-model/ и
 * math-model/. Эти файлы написаны в CommonJS и живут за пределами корня
 * Vite, поэтому напрямую импортировать их из браузера нельзя. Вместо
 * копирования чисел (а это были бы те самые хардкоды) конфиг читает их
 * в Node и подставляет как виртуальный ES-модуль `virtual:tiu-params`.
 *
 * Правило простое: числа правим в tech-model/params.js или
 * math-model/params.js — визуализация подхватывает их сама.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const VIRTUAL_ID = 'virtual:tiu-params';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

// Файлы-источники. Их же сторожим на изменения, чтобы страница
// перезагружалась сразу после правки параметров.
const SOURCES = [
  path.join(projectRoot, 'tech-model', 'params.js'),
  path.join(projectRoot, 'math-model', 'params.js')
];

// Результаты моделей. Файлов может не быть (модели ещё не запускали) —
// тогда работают запасные значения, а в консоль уходит понятная строка.
//
//   07-optimization.json — оптимальный запас мест;
//   02-errors.json       — табулированное распределение показаний камеры:
//                          по нему браузер разыгрывает камеру так же,
//                          как это делает симуляция дня;
//   06-simulation.json   — результат 500 прогонов: эталон, с которым
//                          сверяется сравнение режимов на экране.
const DATA_DIR = path.join(projectRoot, 'tech-model', 'output', 'data');
const OPTIMIZATION_JSON = path.join(DATA_DIR, '07-optimization.json');
const ERRORS_JSON = path.join(DATA_DIR, '02-errors.json');
const SIMULATION_JSON = path.join(DATA_DIR, '06-simulation.json');

// Пересобранная модель тоже должна доехать до браузера, поэтому
// результаты сторожим наравне с параметрами.
function watchedFiles() {
  return [...SOURCES, OPTIMIZATION_JSON, ERRORS_JSON, SIMULATION_JSON];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readParams() {
  // Сбрасываем кэш require: без этого правка params.js не доедет до браузера.
  for (const file of SOURCES) delete require.cache[require.resolve(file)];

  const tech = require(SOURCES[0]);
  const math = require(SOURCES[1]).PARAMS;

  const optimization = readJson(OPTIMIZATION_JSON);
  const errors = readJson(ERRORS_JSON);
  const simulation = readJson(SIMULATION_JSON);

  return { tech, math, optimization, errors, simulation };
}

/**
 * Запасная таблица показаний камеры.
 *
 * Нужна, если tech-model/02 ещё не запускали: без таблицы сравнение
 * режимов не посчитать вовсе. Строится по тем же вероятностям ошибок
 * из параметров камеры, но грубее — по одному человеку, без кадров
 * и трекинга. Полная таблица приходит из модели.
 */
function fallbackTable(tech) {
  const capacity = tech.elevators.capacityRealPeak;
  const fn = tech.camera.falseNegativeRate;
  const fp = tech.camera.falsePositiveRate;
  const table = [];

  for (let n = 0; n <= capacity + 3; n += 1) {
    const counts = new Array(n + 6).fill(0);
    const trials = 20000;
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < trials; i += 1) {
      let d = 0;
      for (let k = 0; k < n; k += 1) if (rng() >= fn) d += 1;
      for (let k = 0; k < n + 1; k += 1) if (rng() < fp) d += 1;
      counts[Math.min(d, counts.length - 1)] += 1;
    }

    let acc = 0;
    table.push(counts.map((c) => (acc += c / trials)));
  }

  return table;
}

/** Плагин: подменяет `virtual:tiu-params` на сгенерированный ES-модуль. */
function tiuParamsPlugin() {
  return {
    name: 'tiu-params',

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ID) return null;

      const { tech, math, optimization, errors, simulation } = readParams();

      // Из результатов оптимизации нужен только оптимальный запас мест.
      const margin = optimization && Number.isFinite(optimization.optimum)
        ? optimization.optimum
        : null;

      const table = errors && Array.isArray(errors.measurementTable)
        ? errors.measurementTable
        : fallbackTable(tech);

      if (!errors || !Array.isArray(errors.measurementTable)) {
        console.log('[tiu-params] нет output/data/02-errors.json — ' +
          'камера разыгрывается по запасной таблице. Полную даёт npm run tech:errors');
      }

      // Эталон для сравнения режимов: что намерила модель на 500 днях.
      const reference = simulation
        ? {
            runs: simulation.runs,
            margin: simulation.margin,
            withSystem: simulation.withSystem,
            withoutSystem: simulation.withoutSystem,
            gainPercent: simulation.gainPercent,
            waitGainPercent: simulation.waitGainPercent,
            passAccuracy: simulation.passAccuracy
          }
        : null;

      if (!reference) {
        console.log('[tiu-params] нет output/data/06-simulation.json — ' +
          'эталон 500 прогонов не показываем. Считает его npm run tech:sim');
      }

      return [
        '// Сгенерировано vite.config.mjs из tech-model/params.js, math-model/params.js',
        '// и результатов моделей в tech-model/output/data. Руками не править.',
        `export const tech = ${JSON.stringify(tech, null, 2)};`,
        `export const math = ${JSON.stringify(math, null, 2)};`,
        `export const optimalMargin = ${JSON.stringify(margin)};`,
        `export const measurementTable = ${JSON.stringify(table)};`,
        `export const reference = ${JSON.stringify(reference)};`,
        'export default { tech, math, optimalMargin, measurementTable, reference };'
      ].join('\n');
    },

    configureServer(server) {
      for (const file of watchedFiles()) server.watcher.add(file);
    },

    handleHotUpdate({ file, server }) {
      if (!watchedFiles().includes(file)) return;

      const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) server.moduleGraph.invalidateModule(mod);

      server.ws.send({ type: 'full-reload' });
      return [];
    }
  };
}

export default {
  // Корень — сама папка 3d-sim, запуск командой `vite 3d-sim` из корня проекта.
  root: here,
  base: './',
  plugins: [tiuParamsPlugin()],
  server: {
    port: 5173,
    open: false,
    fs: {
      // FBX лежат внутри 3d-sim, но node_modules и модели — уровнем выше.
      allow: [projectRoot]
    }
  },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    // FBX-файлы крупные: 500 кБ порога дают бесполезный шум в логе.
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0
  },
  // Три.js тянет за собой примеры — пусть Vite соберёт их заранее.
  optimizeDeps: {
    include: ['three']
  }
};
