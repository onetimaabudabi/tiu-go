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

// Результат tech-model/07-optimization.js: оптимальный запас мест.
// Файла может не быть (модель ещё не запускали) — тогда работает запасное
// значение, а в консоль уходит понятная строка.
const OPTIMIZATION_JSON = path.join(
  projectRoot, 'tech-model', 'output', 'data', '07-optimization.json'
);

function readParams() {
  // Сбрасываем кэш require: без этого правка params.js не доедет до браузера.
  for (const file of SOURCES) delete require.cache[require.resolve(file)];

  const tech = require(SOURCES[0]);
  const math = require(SOURCES[1]).PARAMS;

  let optimization = null;
  try {
    optimization = JSON.parse(fs.readFileSync(OPTIMIZATION_JSON, 'utf8'));
  } catch {
    optimization = null;
  }

  return { tech, math, optimization };
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

      const { tech, math, optimization } = readParams();

      // Из результатов оптимизации нужен только оптимальный запас мест.
      const margin = optimization && Number.isFinite(optimization.optimum)
        ? optimization.optimum
        : null;

      return [
        '// Сгенерировано vite.config.mjs из tech-model/params.js и math-model/params.js.',
        '// Руками не править — правьте источники.',
        `export const tech = ${JSON.stringify(tech, null, 2)};`,
        `export const math = ${JSON.stringify(math, null, 2)};`,
        `export const optimalMargin = ${JSON.stringify(margin)};`,
        'export default { tech, math, optimalMargin };'
      ].join('\n');
    },

    configureServer(server) {
      for (const file of SOURCES) server.watcher.add(file);
    },

    handleHotUpdate({ file, server }) {
      if (!SOURCES.includes(file)) return;

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
