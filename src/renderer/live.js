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

// Sessions saved by older versions kept one big note string; the current shape is a list of notes.
function normalizeActive(a) {
  if (typeof a.notes === 'string') a.notes = a.notes ? [{ id: 1, title: '', content: a.notes }] : [];
  if (!Array.isArray(a.notes)) a.notes = [];
  if (!a.notes.length) a.notes.push({ id: 1, title: '', content: '' });
  a.noteSeq = Math.max(a.noteSeq || 0, ...a.notes.map((n) => n.id));
  if (!a.notes.some((n) => n.id === a.currentNote)) a.currentNote = a.notes[0].id;
  return a;
}

async function restoreActive() {
  const saved = await window.api.getActive();
  live.active = saved ? normalizeActive({ ...saved, running: false }) : null; // recovered sessions come back paused
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
    <div class="live-body">
      <aside class="live-notes">
        <div class="live-notes-head"><strong>Notas</strong><button data-action="live-add-note">+ Nota</button></div>
        <div class="live-note-list" id="live-note-list"></div>
        <div class="live-notes-hint small muted">Arrastrá para reordenar</div>
      </aside>
      <section class="live-editor-col">
        <div class="live-title-row">
          <input id="live-note-title" placeholder="Título de la nota" />
          <button class="ghost danger" data-action="live-delete-note">Borrar nota</button>
        </div>
        <div class="editor-wrap"><div id="live-editor"></div></div>
      </section>
    </div>
  </div>`;
}

const currentNote = () => live.active.notes.find((n) => n.id === live.active.currentNote);

function renderLiveNoteList() {
  const el = document.getElementById('live-note-list');
  if (!el) return;
  const a = live.active;
  el.innerHTML = a.notes
    .map((n) => {
      const preview = n.content ? noteText(n.content).slice(0, 70) : '';
      return `<button class="live-note ${n.id === a.currentNote ? 'active' : ''}" draggable="true" title="Arrastrá para reordenar (Alt + flechas)" data-action="live-select-note" data-id="${n.id}">
        <strong>${esc(n.title || 'Sin título')}</strong>
        <span class="small muted">${esc(preview) || 'Vacía'}</span>
      </button>`;
    })
    .join('');
}

// Moves a note next to another one (before it, or after it when `after` is true).
function moveNote(id, targetId, after) {
  const a = live.active;
  if (id === targetId) return;
  const [note] = a.notes.splice(a.notes.findIndex((n) => n.id === id), 1);
  const target = a.notes.findIndex((n) => n.id === targetId);
  a.notes.splice(after ? target + 1 : target, 0, note);
  renderLiveNoteList();
  persistActiveSoon();
}

function bindNoteDrag(list) {
  let dragId = null;
  const clearMarks = () =>
    list.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  const isAfter = (e, item) => {
    const r = item.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.live-note');
    if (!item) return;
    dragId = Number(item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
    item.classList.add('dragging');
  });

  list.addEventListener('dragover', (e) => {
    if (dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const item = e.target.closest('.live-note');
    if (item && Number(item.dataset.id) !== dragId) item.classList.add(isAfter(e, item) ? 'drop-after' : 'drop-before');
    else if (!item) list.lastElementChild?.classList.add('drop-after'); // empty space below the list
  });

  list.addEventListener('drop', (e) => {
    if (dragId === null) return;
    e.preventDefault();
    const item = e.target.closest('.live-note');
    if (item) moveNote(dragId, Number(item.dataset.id), isAfter(e, item));
    else moveNote(dragId, Number(list.lastElementChild.dataset.id), true);
    dragId = null;
    clearMarks();
  });

  list.addEventListener('dragend', () => {
    dragId = null;
    clearMarks();
  });

  // Keyboard alternative: Alt + Arrow Up/Down moves the focused note.
  list.addEventListener('keydown', (e) => {
    const item = e.target.closest('.live-note');
    if (!item || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const id = Number(item.dataset.id);
    const notes = live.active.notes;
    const index = notes.findIndex((n) => n.id === id);
    const neighbour = notes[e.key === 'ArrowUp' ? index - 1 : index + 1];
    if (!neighbour) return;
    moveNote(id, neighbour.id, e.key === 'ArrowDown');
    list.querySelector(`[data-id="${id}"]`)?.focus();
  });
}

function showNote(id, focus = false) {
  const a = live.active;
  a.currentNote = id;
  const note = currentNote();
  const title = document.getElementById('live-note-title');
  title.value = note.title;
  setEditorHtml(live.quill, note.content);
  live.quill.history.clear();
  renderLiveNoteList();
  persistActiveSoon();
  if (focus) title.focus();
}

// Called by render() after the live view markup is in the DOM.
function mountLive() {
  live.quill = createEditor(document.getElementById('live-editor'), currentNote().content, (html) => {
    currentNote().content = html;
    renderLiveNoteList();
    persistActiveSoon();
  });
  const title = document.getElementById('live-note-title');
  title.value = currentNote().title;
  title.addEventListener('input', () => {
    currentNote().title = title.value;
    renderLiveNoteList();
    persistActiveSoon();
  });
  renderLiveNoteList();
  bindNoteDrag(document.getElementById('live-note-list'));
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
    notes: [],
    phase: 'focus',
    phaseMs: 0,
    focusMs: 0,
    pomodoros: 0,
    running: true,
  };
  normalizeActive(live.active);
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
  const toSave = a.notes.filter((n) => n.title.trim() || n.content);
  const notesInfo = toSave.length ? `<p class="muted small">Se guardarán ${toSave.length} ${toSave.length === 1 ? 'nota' : 'notas'} con la sesión.</p>` : '';
  const extra = a.mode === 'pomodoro' ? `<p class="muted small">Pomodoros completados: ${a.pomodoros}. Solo el tiempo de foco suma.</p>` : '';
  openModal(
    `<h2>Guardar sesión</h2>
     ${extra}${notesInfo}
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
        notes: toSave.map((n) => ({
          title: n.title.trim() || (toSave.length === 1 ? topic : ''),
          content: n.content,
          text: n.content ? noteText(n.content) : '',
        })),
        startedAt: a.startedAt,
        pomodoros: a.pomodoros,
      });
      await endLive();
      state.view = 'subject';
      state.subjectId = a.subjectId;
      state.subjectTab = 'sessions';
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
  'live-add-note': () => {
    const a = live.active;
    const note = { id: ++a.noteSeq, title: '', content: '' };
    a.notes.push(note);
    showNote(note.id, true);
  },
  'live-select-note': (id) => showNote(id),
  'live-delete-note': () => {
    const a = live.active;
    const note = currentNote();
    if ((note.title || note.content) && !confirm('¿Borrar esta nota?')) return;
    const index = a.notes.indexOf(note);
    a.notes.splice(index, 1);
    if (!a.notes.length) a.notes.push({ id: ++a.noteSeq, title: '', content: '' });
    showNote(a.notes[Math.min(index, a.notes.length - 1)].id);
  },
  'live-stop': () => stopModal(),
  'live-discard': async () => {
    if (!confirm('¿Descartar esta sesión y sus notas? No se puede deshacer.')) return;
    await endLive();
    state.view = 'home';
    render();
  },
};
