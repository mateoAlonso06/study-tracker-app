// Live study session: timer (free or pomodoro), notes editor and stop flow.
// Relies on globals from app.js (state, render, openModal, ...) at call time only.

const POMO_DEFAULT = { focus: 25, short: 5, long: 15, cycles: 4, autoAdvance: true };
const PHASE_LABEL = { focus: 'Foco', short: 'Descanso corto', long: 'Descanso largo' };
const MAX_TICK_GAP_MS = 5000; // a bigger gap means the PC slept: don't count it
const SAVE_EVERY_MS = 10000;

const live = { active: null, timerId: null, lastTick: 0, lastSave: 0, quill: null, saveTimer: null };

// ---------- config ----------

function loadPomoConfig() {
  try {
    return { ...POMO_DEFAULT, ...JSON.parse(localStorage.getItem('pomoConfig') || '{}') };
  } catch {
    return { ...POMO_DEFAULT };
  }
}

function savePomoConfig(cfg) {
  try {
    localStorage.setItem('pomoConfig', JSON.stringify(cfg));
  } catch {
    /* storage unavailable: defaults will be used next time */
  }
}

// ---------- formatting and timing ----------

function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function phaseDurationMs(a) {
  if (a.mode !== 'pomodoro') return Infinity;
  return a.config[a.phase] * 60000;
}

function clockMs(a) {
  return a.mode === 'pomodoro' ? phaseDurationMs(a) - a.phaseMs : a.phaseMs;
}

// ---------- persistence ----------

function persistActive() {
  if (!live.active) return Promise.resolve();
  live.lastSave = Date.now();
  return window.api.saveActive({ ...live.active }).catch((err) => console.error('Could not save active session', err));
}

function persistActiveSoon() {
  clearTimeout(live.saveTimer);
  live.saveTimer = setTimeout(persistActive, 800);
}

async function restoreActive() {
  const saved = await window.api.getActive();
  live.active = saved ? { ...saved, running: false } : null; // recovered sessions come back paused
  if (live.active) startLoop();
  return live.active;
}

// ---------- loop ----------

function startLoop() {
  stopLoop();
  live.lastTick = Date.now();
  live.timerId = setInterval(tick, 500);
}

function stopLoop() {
  clearInterval(live.timerId);
  live.timerId = null;
}

function tick() {
  const a = live.active;
  if (!a) return stopLoop();
  const now = Date.now();
  let delta = now - live.lastTick;
  live.lastTick = now;
  if (delta > MAX_TICK_GAP_MS) delta = 0;
  if (a.running && delta > 0) {
    a.phaseMs += delta;
    if (a.phase === 'focus') a.focusMs += delta;
    if (a.mode === 'pomodoro' && a.phaseMs >= phaseDurationMs(a)) advancePhase(true);
    if (now - live.lastSave >= SAVE_EVERY_MS) persistActive();
  }
  updateLiveUi();
}

function advancePhase(completed) {
  const a = live.active;
  const cfg = a.config;
  let next;
  if (a.phase === 'focus') {
    if (completed) a.pomodoros += 1;
    next = completed && a.pomodoros % cfg.cycles === 0 ? 'long' : 'short';
  } else {
    next = 'focus';
  }
  a.phase = next;
  a.phaseMs = 0;
  a.running = completed ? cfg.autoAdvance : a.running;
  if (completed) announce(next);
  persistActive();
}

function announce(nextPhase) {
  const msg = nextPhase === 'focus' ? 'Se acabó el descanso. A estudiar.' : 'Pomodoro completado. Hora de descansar.';
  beep();
  try {
    new Notification('Study tracker', { body: msg, silent: true });
  } catch {
    /* notifications unavailable */
  }
}

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.18);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio unavailable */
  }
}

// ---------- ui ----------

function phaseText(a) {
  const state = a.running ? '' : ' · en pausa';
  if (a.mode === 'pomodoro') {
    const inCycle = (a.pomodoros % a.config.cycles) + (a.phase === 'focus' ? 1 : 0);
    const cycle = a.phase === 'focus' ? ` ${inCycle}/${a.config.cycles}` : '';
    return `${PHASE_LABEL[a.phase]}${cycle} · ${a.pomodoros} completados${state}`;
  }
  return `Sesión libre${state}`;
}

function updateLiveUi() {
  const a = live.active;
  if (!a) return;
  const clock = fmtClock(clockMs(a));
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set('live-timer', clock);
  set('live-phase', phaseText(a));
  set('live-toggle', a.running ? 'Pausar' : 'Reanudar');
  set('side-timer', `${a.running ? '●' : '❚❚'} ${clock}`);
  document.title = a.running ? `${clock} · Study tracker` : 'Study tracker';
}

function liveView() {
  const a = live.active;
  const subject = state.subjects.find((s) => s.id === a.subjectId);
  return `<div class="live">
    <div class="live-bar">
      <div>
        <h1>${esc(subject?.name || 'Sesión')}</h1>
        <div class="muted small" id="live-phase"></div>
      </div>
      <div class="live-timer" id="live-timer">00:00</div>
      <div class="actions">
        <button id="live-toggle" data-action="live-toggle">Pausar</button>
        ${a.mode === 'pomodoro' ? '<button data-action="live-skip">Saltar fase</button>' : ''}
        <button class="primary" data-action="live-stop">Detener y guardar</button>
        <button class="ghost danger" data-action="live-discard">Descartar</button>
      </div>
    </div>
    <div class="editor-wrap"><div id="live-editor"></div></div>
  </div>`;
}

// Called by render() after the live view markup is in the DOM.
function mountLive() {
  live.quill = createEditor(document.getElementById('live-editor'), live.active.notes, (html) => {
    live.active.notes = html;
    persistActiveSoon();
  });
  updateLiveUi();
}

// ---------- start / stop flow ----------

function startModal(subjectId) {
  if (live.active) {
    state.view = 'live';
    render();
    return;
  }
  const subject = state.subjects.find((s) => s.id === subjectId);
  const cfg = loadPomoConfig();
  const num = (name, label, value) =>
    `<div class="field"><label>${label}</label><input name="${name}" type="number" min="1" step="1" value="${value}" /></div>`;
  openModal(
    `<h2>Iniciar sesión · ${esc(subject.name)}</h2>
     <div class="field"><label>Modo</label>
       <select name="mode">
         <option value="free">Libre (cronómetro)</option>
         <option value="pomodoro">Pomodoro</option>
       </select>
     </div>
     <div id="pomo-fields" hidden>
       <div class="row2">${num('focus', 'Foco (min)', cfg.focus)}${num('short', 'Descanso corto (min)', cfg.short)}</div>
       <div class="row2">${num('long', 'Descanso largo (min)', cfg.long)}${num('cycles', 'Pomodoros hasta el descanso largo', cfg.cycles)}</div>
       <div class="field"><label><input type="checkbox" name="autoAdvance" ${cfg.autoAdvance ? 'checked' : ''} /> Pasar de fase automáticamente</label></div>
     </div>
     ${buttons('Comenzar')}`,
    async (data) => {
      const mode = data.mode;
      const config = {
        focus: Number(data.focus),
        short: Number(data.short),
        long: Number(data.long),
        cycles: Number(data.cycles),
        autoAdvance: data.autoAdvance === 'on',
      };
      if (mode === 'pomodoro') {
        if (![config.focus, config.short, config.long, config.cycles].every((n) => Number.isInteger(n) && n >= 1)) {
          throw new Error('Los tiempos y ciclos deben ser números enteros mayores a 0');
        }
        savePomoConfig(config);
      }
      await beginSession(subjectId, mode, mode === 'pomodoro' ? config : { ...POMO_DEFAULT });
    }
  );
  const modeSelect = modalRoot.querySelector('[name=mode]');
  const fields = document.getElementById('pomo-fields');
  modeSelect.addEventListener('change', () => {
    fields.hidden = modeSelect.value !== 'pomodoro';
  });
}

async function beginSession(subjectId, mode, config) {
  live.active = {
    subjectId,
    mode,
    config,
    startedAt: new Date().toISOString(),
    notes: '',
    phase: 'focus',
    phaseMs: 0,
    focusMs: 0,
    pomodoros: 0,
    running: true,
  };
  await persistActive();
  startLoop();
  state.view = 'live';
  render();
}

function stopModal() {
  const a = live.active;
  a.running = false;
  persistActive();
  const minutes = Math.max(1, Math.round(a.focusMs / 60000));
  const extra = a.mode === 'pomodoro' ? `<p class="muted small">Pomodoros completados: ${a.pomodoros}. Solo el tiempo de foco suma.</p>` : '';
  openModal(
    `<h2>Guardar sesión</h2>
     ${extra}
     <div class="field"><label>Duración (minutos)</label><input name="minutes" type="number" min="1" step="1" value="${minutes}" /></div>
     <div class="row2">
       <div class="field"><label>Tema o lección</label><input name="topic" placeholder="IAM" /></div>
       <div class="field"><label>Hasta dónde llegaste</label><input name="position" value="${esc(lastPositionHint(a.subjectId))}" placeholder="min 42:10" /></div>
     </div>
     ${buttons('Guardar sesión')}`,
    async ({ minutes: m, topic, position }) => {
      await window.api.saveSession({
        subjectId: a.subjectId,
        date: toIso(new Date(a.startedAt)),
        hours: Number(m) / 60,
        topic,
        position,
        notes: a.notes,
        startedAt: a.startedAt,
        pomodoros: a.pomodoros,
      });
      await endLive();
      state.view = 'subject';
      state.subjectId = a.subjectId;
      await reload();
      render();
    }
  );
}

async function endLive() {
  clearTimeout(live.saveTimer);
  stopLoop();
  await window.api.clearActive();
  live.active = null;
  live.quill = null;
  document.title = 'Study tracker';
}

const liveActions = {
  'start-session': (id) => startModal(id),
  'go-live': () => {
    state.view = 'live';
    render();
  },
  'live-toggle': () => {
    live.active.running = !live.active.running;
    live.lastTick = Date.now();
    persistActive();
    updateLiveUi();
  },
  'live-skip': () => {
    advancePhase(false);
    updateLiveUi();
  },
  'live-stop': () => stopModal(),
  'live-discard': async () => {
    if (!confirm('¿Descartar esta sesión y sus notas? No se puede deshacer.')) return;
    await endLive();
    state.view = 'home';
    render();
  },
};
