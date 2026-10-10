/**
 * Панель управления: пуск, скорость, сценарии, камера, запись видео.
 *
 * Кнопки скоростей собираются из SIM.speeds, сценарии — из SCENARIOS,
 * слежение — по числу работающих лифтов. Ничего не прописано руками:
 * поменяются параметры — поменяются и кнопки.
 */

import { SIM, SCENARIOS, ELEVATORS } from '../logic/params.js';

export function createControls(app, sim) {
  const $ = (id) => document.getElementById(id);

  const btnPlay = $('btn-play');
  const btnReset = $('btn-reset');
  const btnRecord = $('btn-record');
  const speedRow = $('speed-row');
  const scenarioRow = $('scenario-row');
  const cameraRow = $('camera-row');
  const followRow = $('follow-row');
  const speedHint = $('speed-hint');
  const toast = $('toast');

  let scenario = SCENARIOS[0];
  let controlsReady = false;

  // ---------- вспомогательное ----------

  let toastTimer = null;
  function say(text, ms = 3200) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  function makeButton(row, label, onClick, { small = false } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = small ? 'btn btn--small' : 'btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    row.appendChild(btn);
    return btn;
  }

  function markActive(buttons, active) {
    for (const btn of buttons) btn.classList.toggle('is-active', btn === active);
  }

  // ---------- пуск и сброс ----------

  function refreshPlay() {
    btnPlay.textContent = app.running ? '⏸ Пауза' : '▶ Пуск';
  }

  btnPlay.addEventListener('click', () => {
    app.toggle();
    refreshPlay();
  });

  btnReset.addEventListener('click', () => {
    app.pause();
    sim.jumpTo(scenario.hhmm);
    refreshPlay();
    say(`Сброшено на ${scenario.hhmm} — ${scenario.label}`);
  });

  // ---------- скорость ----------

  const speedButtons = SIM.speeds.map((value) => makeButton(
    speedRow, `${value}×`, () => {
      app.setSpeed(value);
      markActive(speedButtons, speedButtons[SIM.speeds.indexOf(value)]);
      speedHint.hidden = value <= SIM.smoothSpeedLimit;
    }
  ));

  app.setSpeed(SIM.defaultSpeed);
  markActive(speedButtons, speedButtons[SIM.speeds.indexOf(SIM.defaultSpeed)]);

  // ---------- сценарии ----------

  const scenarioButtons = SCENARIOS.map((item) => makeButton(
    scenarioRow, `${item.label} ${item.hhmm}`, () => {
      scenario = item;
      sim.jumpTo(item.hhmm);
      markActive(scenarioButtons, scenarioButtons[SCENARIOS.indexOf(item)]);
      app.play();
      refreshPlay();
      say(item.peak ? `${item.peak.label}: ${item.peak.start}–${item.peak.end}` : item.label);
    }
  ));

  markActive(scenarioButtons, scenarioButtons[0]);

  // ---------- камера ----------

  const viewKeys = Object.keys(app.views);
  const viewButtons = viewKeys.map((key) => makeButton(
    cameraRow, app.views[key].label, () => {
      app.setView(key);
      markActive([...viewButtons, ...followButtons], viewButtons[viewKeys.indexOf(key)]);
    }
  ));

  const workingNumbers = ELEVATORS.working;
  const followButtons = workingNumbers.map((number) => makeButton(
    followRow, `За №${number}`, () => {
      app.setFollow(number);
      markActive([...viewButtons, ...followButtons], followButtons[workingNumbers.indexOf(number)]);
    }, { small: true }
  ));

  markActive([...viewButtons, ...followButtons], viewButtons[0]);

  // Камеру перехватили мышью — снимаем подсветку с кнопок
  window.__tiuOnCameraGrab = () => markActive([...viewButtons, ...followButtons], null);
  window.__tiuOnQuality = (level) => {
    if (!controlsReady) return;      // стартовый уровень объявлять незачем
    say(`Детализация: ${level.name} — полных моделей ${level.fullDetail}`, 3000);
  };

  // ---------- сворачивание панелей ----------

  for (const toggle of document.querySelectorAll('[data-collapse]')) {
    toggle.addEventListener('click', () => {
      const panel = document.getElementById(toggle.dataset.collapse);
      const collapsed = panel.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '+' : '–';
    });
  }

  // ---------- запись ----------

  let recorder = null;
  let recordTimer = null;

  btnRecord.addEventListener('click', () => {
    if (recorder) { stopRecording(); return; }
    startRecording();
  });

  function startRecording() {
    if (!window.MediaRecorder || !app.renderer.domElement.captureStream) {
      say('Браузер не умеет записывать canvas — снимите экран системной записью');
      return;
    }

    const stream = app.renderer.domElement.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));

    if (!type) { say('Браузер не поддерживает webm-запись'); return; }

    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tiu-go-3d-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      recorder = null;
      btnRecord.textContent = '● Записать 60 сек';
      btnRecord.classList.remove('is-recording');
      say('Видео сохранено в загрузки');
    };

    recorder.start();
    btnRecord.textContent = '■ Остановить';
    btnRecord.classList.add('is-recording');
    say('Идёт запись: 60 секунд');

    recordTimer = setTimeout(stopRecording, 60_000);
  }

  function stopRecording() {
    clearTimeout(recordTimer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  // ---------- клавиатура ----------

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;

    if (event.code === 'Space') {
      event.preventDefault();
      app.toggle();
      refreshPlay();
    }
    if (event.code === 'KeyR') btnReset.click();
  });

  refreshPlay();
  controlsReady = true;

  return { say, refreshPlay };
}
