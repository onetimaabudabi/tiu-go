/**
 * Модель 1. Теория массового обслуживания, M/M/c.
 *
 * Лифтовый холл рассматривается как система массового обслуживания:
 * c = 6 каналов (лифтов), пуассоновский поток заявок с интенсивностью λ,
 * экспоненциальное обслуживание с интенсивностью μ, взятой из физической
 * модели (04-elevator-physics.js).
 *
 * Отдельно разбирается случай ρ ≥ 1. Формулы Эрланга выведены для
 * стационарного режима и при перегрузке неприменимы: очередь растёт
 * неограниченно. Для пиков используется детерминированная (жидкостная)
 * модель накопления очереди на конечном интервале.
 *
 * Запуск:  npm run math:queue
 */

const math = require('mathjs');
const { PARAMS, arrivalRate, averageArrivalRate } = require('./params');
const physics = require('./04-elevator-physics');
const chart = require('./chart-helper');

/**
 * Формула Эрланга C — вероятность того, что заявка застанет все каналы
 * занятыми и встанет в очередь:
 *
 *            a^c / (c! · (1 − ρ))
 *   C(c,a) = ───────────────────────────────────────
 *            Σ_{k=0}^{c−1} a^k/k!  +  a^c / (c!·(1−ρ))
 *
 * где a = λ/μ — предложенная нагрузка, ρ = a/c — загрузка канала.
 */
function erlangC(c, a) {
  const rho = a / c;
  if (rho >= 1) return 1; // все заявки ждут: стационарного режима нет

  let sum = 0;
  for (let k = 0; k < c; k += 1) {
    sum += Math.pow(a, k) / math.factorial(k);
  }

  const last = Math.pow(a, c) / (math.factorial(c) * (1 - rho));
  return last / (sum + last);
}

/**
 * Полный расчёт показателей M/M/c для заданных λ и μ.
 *
 *   Lq = C · ρ / (1 − ρ)     средняя длина очереди
 *   Wq = Lq / λ              среднее время ожидания
 *   W  = Wq + 1/μ            среднее время в системе
 */
function mmc(lambda, mu, c) {
  // Пустой поток: очереди нет, а Wq = Lq/λ дало бы 0/0
  if (lambda <= 0) {
    return { lambda: 0, mu, c, a: 0, rho: 0, stable: true, pWait: 0, Lq: 0, Wq: 0, W: 1 / mu };
  }

  const a = lambda / mu;
  const rho = a / c;

  if (rho >= 1) {
    return { lambda, mu, c, a, rho, stable: false, pWait: 1, Lq: Infinity, Wq: Infinity, W: Infinity };
  }

  const pWait = erlangC(c, a);
  const Lq = (pWait * rho) / (1 - rho);
  const Wq = Lq / lambda;

  return { lambda, mu, c, a, rho, stable: true, pWait, Lq, Wq, W: Wq + 1 / mu };
}

/**
 * Детерминированная модель перегруженного интервала.
 *
 * Если λ > ν (ν = c·μ — пропускная способность), очередь растёт линейно:
 * q(t) = (λ − ν)·t. Заявка, пришедшая в момент t, ждёт q(t)/ν, а среднее
 * по интервалу длительностью D составляет
 *
 *   W̄ = (λ − ν) · D / (2 ν)
 *
 * Это нижняя оценка: она предполагает, что никто не уходит из очереди.
 */
function fluidOverload(lambda, capacityRate, durationSec) {
  if (lambda <= capacityRate) return { overloaded: false, avgWait: 0, queueEnd: 0, unserved: 0 };

  const excess = lambda - capacityRate;
  return {
    overloaded: true,
    avgWait: (excess * durationSec) / (2 * capacityRate),
    queueEnd: excess * durationSec,
    unserved: excess * durationSec
  };
}

/**
 * Единая оценка ожидания, пригодная и для устойчивого режима, и для перегрузки.
 *
 *   W(λ) = W_жидк(λ)  +  Wq_эрланг( min(λ, 0.95·ν) )
 *
 * Первое слагаемое отвечает за детерминированное накопление очереди при
 * λ > ν, второе — за случайные колебания при λ < ν. Загрузка во втором
 * слагаемом ограничена ρ = 0.95: у формулы Эрланга в точке ρ = 1 полюс,
 * и без ограничения функция теряет монотонность ровно там, где ищется
 * оптимум распределения потока.
 */
function effectiveWait(lambda, mu, c, durationSec) {
  const nu = mu * c;
  const fluid = fluidOverload(lambda, nu, durationSec);
  const stochastic = mmc(Math.min(lambda, 0.95 * nu), mu, c);

  return fluid.avgWait + (stochastic.stable ? stochastic.Wq : 0);
}

/** Критическая интенсивность: при λ ≥ λ* система теряет устойчивость. */
function criticalLambda(mu, c) {
  return mu * c;
}

// ---------- Запуск ----------
async function run(p = PARAMS) {
  console.log('[queue] Считаю M/M/c…');

  const mu = physics.serviceRate(p.capacity, p);
  const c = p.elevators;
  const nu = criticalLambda(mu, c);

  console.log(`[queue] μ = ${mu.toFixed(4)} чел/с на лифт (из физической модели)`);
  console.log(`[queue] Пропускная способность системы ν = c·μ = ${nu.toFixed(4)} чел/с = ${Math.round(nu * 3600)} чел/ч`);
  console.log('');

  // Интервалы: фон и каждый пик
  const intervals = [
    { label: 'Вне пика', lambda: arrivalRate(11, p), duration: 3600 },
    ...p.peakHours.map((peak) => ({
      label: `Пик ${peak.label}`,
      lambda: arrivalRate((peak.start + peak.end) / 2, p),
      duration: (peak.end - peak.start) * 3600
    }))
  ];

  const rows = intervals.map((iv) => {
    const res = mmc(iv.lambda, mu, c);
    const fluid = fluidOverload(iv.lambda, nu, iv.duration);
    return Object.assign({}, iv, { res, fluid });
  });

  console.log('  Интервал            |  λ, чел/с |  λ, чел/ч |     ρ | P_wait |      Lq | Wq, с   | W, с');
  rows.forEach((r) => {
    const q = r.res;
    const wq = q.stable ? q.Wq.toFixed(1) : `~${r.fluid.avgWait.toFixed(0)}*`;
    const w = q.stable ? q.W.toFixed(1) : '—';
    const lq = q.stable ? q.Lq.toFixed(2) : '∞';
    const pw = q.stable ? q.pWait.toFixed(3) : '1.000';

    console.log(
      `  ${r.label.padEnd(19)} | ${r.lambda.toFixed(4).padStart(9)} | ${String(Math.round(r.lambda * 3600)).padStart(9)} | ` +
      `${q.rho.toFixed(2).padStart(5)} | ${pw.padStart(6)} | ${lq.padStart(7)} | ${wq.padStart(7)} | ${w.padStart(6)}`
    );
  });

  console.log('');
  console.log('  * при ρ ≥ 1 формулы Эрланга неприменимы: показано среднее ожидание');
  console.log('    по жидкостной модели за время пика, в предположении, что из очереди никто не уходит.');
  console.log('');
  console.log(`[queue] Критическая интенсивность λ* = ${nu.toFixed(4)} чел/с (${Math.round(nu * 3600)} чел/ч).`);
  console.log(`[queue] Вне пика λ = ${arrivalRate(11, p).toFixed(4)} — система устойчива (ρ = ${(arrivalRate(11, p) / nu).toFixed(2)}).`);

  const morning = rows.find((r) => r.label.includes('08:20'));
  console.log(`[queue] В утренний пик λ = ${morning.lambda.toFixed(3)} превышает λ* в ${(morning.lambda / nu).toFixed(1)} раза:`);
  console.log('[queue] лифты физически не могут обслужить пик — часть потока обязана уйти на лестницу.');

  // График: Wq от λ
  const lambdas = [];
  const waits = [];
  for (let l = 0.01; l <= nu * 0.995; l += nu / 120) {
    const r = mmc(l, mu, c);
    lambdas.push(Number((l * 3600).toFixed(0)));
    waits.push(Number(Math.min(r.Wq, 1200).toFixed(1)));
  }

  await chart.save({
    type: 'line',
    data: {
      labels: lambdas,
      datasets: [{
        label: 'Среднее ожидание Wq, с',
        data: waits,
        borderColor: chart.COLOR.accent,
        backgroundColor: 'rgba(91, 141, 239, 0.12)',
        fill: true,
        tension: 0.1,
        pointRadius: 0,
        borderWidth: 3
      }]
    },
    options: chart.options(`Рост очереди при приближении к λ* = ${Math.round(nu * 3600)} чел/ч`, {
      scales: {
        y: chart.axis('Wq, секунд', { beginAtZero: true, suggestedMax: 600 }),
        x: chart.axis('интенсивность λ, чел/ч', { grid: { display: false } })
      },
      plugins: {
        title: chart.options(`Рост очереди при приближении к λ* = ${Math.round(nu * 3600)} чел/ч`).plugins.title,
        legend: { display: false }
      }
    })
  }, 'queue_wq_vs_lambda.png');

  console.log('[queue] График сохранён: queue_wq_vs_lambda.png');

  return { mu, c, nu, rows, criticalLambda: nu };
}

module.exports = { erlangC, mmc, fluidOverload, effectiveWait, criticalLambda, run };

if (require.main === module) {
  run().catch((err) => { console.error('[queue] Ошибка:', err.message); process.exit(1); });
}
