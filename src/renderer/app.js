const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');

const state = {
  user: null,
  subjects: [],
  sessions: [],
  view: 'home', // 'home' | 'subject' | 'live'
  subjectId: null,
};

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIso(new Date());
const parseIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const fmtHours = (h) => {
  const min = Math.round(h * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
};
const fmtDate = (iso) =>
  parseIso(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function sessionsOf(subjectId) {
  return state.sessions.filter((s) => s.subjectId === subjectId);
}

function hoursByDate(sessions) {
  const map = new Map();
  for (const s of sessions) map.set(s.date, (map.get(s.date) || 0) + s.hours);
  return map;
}

function streakOf(sessions) {
  const days = new Set(sessions.map((s) => s.date));
  let cursor = new Date();
  if (!days.has(toIso(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days.has(toIso(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function weekHours(sessions) {
  const start = toIso(mondayOf(new Date()));
  return sessions.filter((s) => s.date >= start).reduce((sum, s) => sum + s.hours, 0);
}

function lastPosition(sessions) {
  const s = sessions[0]; // list is ordered newest first
  if (!s) return null;
  return [s.topic, s.position && `(${s.position})`].filter(Boolean).join(' ') || fmtDate(s.date);
}

async function reload() {
  [state.subjects, state.sessions] = await Promise.all([window.api.listSubjects(), window.api.listSessions()]);
}

// ---------- rendering ----------

function render() {
  if (!state.user) return renderLogin();
  const subject = state.view === 'subject' ? state.subjects.find((s) => s.id === state.subjectId) : null;
  if (state.view === 'subject' && !subject) state.view = 'home';
  if (state.view === 'live' && !live.active) state.view = 'home';
  const liveItem = live.active
    ? `<button class="nav-item live-item ${state.view === 'live' ? 'active' : ''}" data-action="go-live">
         <span>${esc(state.subjects.find((x) => x.id === live.active.subjectId)?.name || 'Sesión')}</span>
         <span class="small" id="side-timer"></span>
       </button>`
    : '';
  appEl.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="user">
          <strong>${esc(state.user.name)}</strong>
        </div>
        ${liveItem}
        <button class="nav-item ${state.view === 'home' ? 'active' : ''}" data-action="go-home">Inicio</button>
        ${state.subjects
          .map(
            (s) =>
              `<button class="nav-item ${state.view === 'subject' && state.subjectId === s.id ? 'active' : ''}" data-action="go-subject" data-id="${s.id}">${esc(s.name)}</button>`
          )
          .join('')}
        <button class="nav-item" data-action="new-subject">+ Nueva materia</button>
        <div class="spacer"></div>
        <button class="nav-item" data-action="logout">Cambiar de perfil</button>
      </aside>
      <main class="main">${state.view === 'live' ? liveView() : state.view === 'subject' ? subjectView(subject) : homeView()}</main>
    </div>`;
  if (state.view === 'live') mountLive();
  else if (live.active) updateLiveUi();
}

function homeView() {
  if (!state.subjects.length) {
    return `<div class="empty">
      <h2>Empezá con tu primera materia</h2>
      <p>Por ejemplo "AWS Cloud Practitioner" o "Inglés". Cada una tiene su propia racha y meta semanal.</p>
      <button class="primary" data-action="new-subject">Crear materia</button>
    </div>`;
  }
  const cards = state.subjects
    .map((s) => {
      const ss = sessionsOf(s.id);
      const wk = weekHours(ss);
      const pct = s.weeklyGoal > 0 ? Math.min(100, Math.round((wk / s.weeklyGoal) * 100)) : 0;
      const goalLine =
        s.weeklyGoal > 0
          ? `<div class="bar"><div class="${pct >= 100 ? 'done' : ''}" style="width:${pct}%"></div></div>
             <div class="small muted">${fmtHours(wk)} de ${fmtHours(s.weeklyGoal)} esta semana</div>`
          : `<div class="small muted">${fmtHours(wk)} esta semana · sin meta</div>`;
      const last = lastPosition(ss);
      return `<div class="card clickable" data-action="go-subject" data-id="${s.id}">
        <div class="title"><h2>${esc(s.name)}</h2><span class="streak">${streakOf(ss)} d</span></div>
        ${goalLine}
        <div class="footer">
          <span class="small muted">${last ? `Seguís en: ${esc(last)}` : 'Sin sesiones todavía'}</span>
          <span>
            <button class="ghost" data-action="new-session" data-id="${s.id}">Registrar manual</button>
            <button class="primary" data-action="start-session" data-id="${s.id}">Iniciar sesión</button>
          </span>
        </div>
      </div>`;
    })
    .join('');
  return `<div class="header"><h1>Inicio</h1><div class="actions"><button data-action="new-subject">+ Nueva materia</button></div></div>
    <div class="grid">${cards}</div>`;
}

function heatmap(sessions) {
  const byDate = hoursByDate(sessions);
  const weeks = 20;
  const start = addDays(mondayOf(new Date()), -(weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = addDays(start, i);
    const iso = toIso(d);
    if (d > new Date()) {
      cells.push('<div style="visibility:hidden"></div>');
      continue;
    }
    const h = byDate.get(iso) || 0;
    const level = h === 0 ? 0 : h < 1 ? 1 : h < 2 ? 2 : 3;
    cells.push(`<div class="l${level}" title="${iso}: ${fmtHours(h)}"></div>`);
  }
  return `<div class="heat">${cells.join('')}</div>`;
}

function subjectView(subject) {
  const ss = sessionsOf(subject.id);
  const total = ss.reduce((sum, s) => sum + s.hours, 0);
  const wk = weekHours(ss);
  const goal = subject.weeklyGoal > 0 ? ` / ${fmtHours(subject.weeklyGoal)}` : '';
  const list = ss.length
    ? ss
        .map(
          (s) => `<div class="session">
        <div class="top">
          <strong>${esc(s.topic || 'Sin tema')}</strong>
          <span class="meta">${esc(fmtDate(s.date))} · ${fmtHours(s.hours)}${s.pomodoros ? ` · ${s.pomodoros} ${s.pomodoros === 1 ? 'pomodoro' : 'pomodoros'}` : ''}${s.position ? ` · ${esc(s.position)}` : ''}</span>
        </div>
        ${s.notes ? `<div class="notes">${notesToHtml(s.notes)}</div>` : ''}
        <div class="row-actions">
          <button class="ghost" data-action="edit-session" data-id="${s.id}">Editar</button>
          <button class="ghost danger" data-action="delete-session" data-id="${s.id}">Borrar</button>
        </div>
      </div>`
        )
        .join('')
    : `<div class="empty"><h2>Todavía no hay sesiones</h2><p>Registrá la primera cuando termines de estudiar.</p></div>`;
  return `<div class="header">
      <h1>${esc(subject.name)}</h1>
      <div class="actions">
        <button data-action="edit-subject" data-id="${subject.id}">Editar materia</button>
        <button data-action="new-session" data-id="${subject.id}">Registrar manual</button>
        <button class="primary" data-action="start-session" data-id="${subject.id}">Iniciar sesión</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Racha</div><div class="value">${streakOf(ss)} ${streakOf(ss) === 1 ? 'día' : 'días'}</div></div>
      <div class="stat"><div class="label">Esta semana</div><div class="value">${fmtHours(wk)}${goal}</div></div>
      <div class="stat"><div class="label">Total</div><div class="value">${fmtHours(total)}</div></div>
      <div class="stat"><div class="label">Sesiones</div><div class="value">${ss.length}</div></div>
    </div>
    <h2>Actividad</h2>
    ${heatmap(ss)}
    <h2 style="margin-bottom:10px">Sesiones y notas</h2>
    ${list}`;
}

// ---------- login ----------

async function renderLogin() {
  const users = await window.api.listUsers();
  appEl.innerHTML = `<div class="login">
    <h1>Study tracker</h1>
    <p class="muted" style="margin:6px 0 20px">${users.length ? 'Elegí tu perfil' : 'Creá tu primer perfil para empezar'}</p>
    ${users
      .map(
        (u) => `<button class="profile" data-action="pick-user" data-id="${u.id}" data-protected="${u.hasPassword}" data-name="${esc(u.name)}">
        <span class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</span>
        <span>${esc(u.name)}</span>
        ${u.hasPassword ? '<span class="small muted" style="margin-left:auto">con contraseña</span>' : ''}
      </button>`
      )
      .join('')}
    <button data-action="new-user" style="margin-top:8px">+ Nuevo perfil</button>
  </div>`;
}

// ---------- modals ----------

function openModal(html, onSubmit) {
  modalRoot.innerHTML = `<div class="overlay"><form class="modal" novalidate>${html}<div class="error" id="form-error"></div></form></div>`;
  const form = modalRoot.querySelector('form');
  const first = form.querySelector('input, textarea');
  if (first) first.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await onSubmit(data);
      closeModal();
    } catch (err) {
      document.getElementById('form-error').textContent = cleanError(err);
    }
  });
}

const closeModal = () => {
  modalRoot.innerHTML = '';
};

const cleanError = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const buttons = (label) => `<div class="buttons">
  <button type="button" data-action="close-modal">Cancelar</button>
  <button type="submit" class="primary">${label}</button>
</div>`;

function userModal() {
  openModal(
    `<h2>Nuevo perfil</h2>
     <div class="field"><label>Nombre</label><input name="name" /></div>
     <div class="field"><label>Contraseña (opcional)</label><input name="password" type="password" /></div>
     ${buttons('Crear perfil')}`,
    async ({ name, password }) => {
      state.user = await window.api.createUser({ name, password });
      await enterApp();
    }
  );
}

function passwordModal(id, name) {
  openModal(
    `<h2>Hola, ${esc(name)}</h2>
     <div class="field"><label>Contraseña</label><input name="password" type="password" /></div>
     ${buttons('Entrar')}`,
    async ({ password }) => {
      state.user = await window.api.login({ id, password });
      await enterApp();
    }
  );
}

function subjectModal(subject) {
  openModal(
    `<h2>${subject ? 'Editar materia' : 'Nueva materia'}</h2>
     <div class="field"><label>Nombre</label><input name="name" value="${esc(subject?.name || '')}" /></div>
     <div class="field"><label>Meta semanal en horas (0 = sin meta)</label><input name="weeklyGoal" type="number" min="0" step="0.5" value="${subject?.weeklyGoal ?? 5}" /></div>
     ${buttons('Guardar')}
     ${subject ? '<div class="buttons" style="justify-content:flex-start"><button type="button" class="ghost danger" data-action="delete-subject" data-id="' + subject.id + '">Borrar materia y sus sesiones</button></div>' : ''}`,
    async ({ name, weeklyGoal }) => {
      const id = await window.api.saveSubject({ id: subject?.id, name, weeklyGoal });
      await reload();
      if (!subject) {
        state.view = 'subject';
        state.subjectId = id;
      }
      render();
    }
  );
}

function sessionModal(subjectId, session) {
  const defaultPos = session ? session.position : lastPositionHint(subjectId);
  let quill;
  openModal(
    `<h2>${session ? 'Editar sesión' : 'Registrar sesión manual'}</h2>
     <div class="row2">
       <div class="field"><label>Fecha</label><input name="date" type="date" value="${session?.date || todayIso()}" /></div>
       <div class="field"><label>Duración (minutos)</label><input name="minutes" type="number" min="1" step="1" value="${session ? Math.round(session.hours * 60) : ''}" placeholder="90" /></div>
     </div>
     <div class="row2">
       <div class="field"><label>Tema o lección</label><input name="topic" value="${esc(session?.topic || '')}" placeholder="IAM" /></div>
       <div class="field"><label>Hasta dónde llegaste</label><input name="position" value="${esc(defaultPos || '')}" placeholder="min 42:10" /></div>
     </div>
     <div class="field"><label>Notas</label><div class="editor-wrap modal-editor"><div id="modal-editor"></div></div></div>
     ${buttons('Guardar')}`,
    async (data) => {
      await window.api.saveSession({
        id: session?.id,
        subjectId,
        date: data.date,
        hours: Number(data.minutes) / 60,
        topic: data.topic,
        position: data.position,
        notes: getEditorHtml(quill),
      });
      await reload();
      render();
    }
  );
  modalRoot.querySelector('.modal').classList.add('wide');
  quill = createEditor(document.getElementById('modal-editor'), session?.notes || '');
}

function lastPositionHint(subjectId) {
  return sessionsOf(subjectId)[0]?.position || '';
}

// ---------- actions ----------

async function enterApp() {
  await reload();
  state.view = 'home';
  state.subjectId = null;
  if (await restoreActive()) state.view = 'live';
  render();
}

const actions = {
  'close-modal': () => closeModal(),
  'go-home': () => {
    state.view = 'home';
    render();
  },
  'go-subject': (id) => {
    state.view = 'subject';
    state.subjectId = id;
    render();
  },
  'new-subject': () => subjectModal(null),
  'edit-subject': (id) => subjectModal(state.subjects.find((s) => s.id === id)),
  'delete-subject': async (id) => {
    const s = state.subjects.find((x) => x.id === id);
    if (!confirm(`¿Borrar "${s.name}" y todas sus sesiones? No se puede deshacer.`)) return;
    await window.api.deleteSubject(id);
    closeModal();
    await reload();
    state.view = 'home';
    render();
  },
  'new-session': (id) => sessionModal(id, null),
  'edit-session': (id) => {
    const s = state.sessions.find((x) => x.id === id);
    sessionModal(s.subjectId, s);
  },
  'delete-session': async (id) => {
    if (!confirm('¿Borrar esta sesión?')) return;
    await window.api.deleteSession(id);
    await reload();
    render();
  },
  'new-user': () => userModal(),
  'pick-user': async (id, el) => {
    if (el.dataset.protected === 'true') return passwordModal(id, el.dataset.name);
    state.user = await window.api.login({ id });
    await enterApp();
  },
  logout: async () => {
    if (live.active) {
      await persistActive();
      stopLoop();
      live.active = null;
      document.title = 'Study tracker';
    }
    await window.api.logout();
    state.user = null;
    state.subjects = [];
    state.sessions = [];
    render();
  },
};

Object.assign(actions, liveActions);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.stopPropagation();
  const fn = actions[el.dataset.action];
  if (!fn) return;
  const id = el.dataset.id ? Number(el.dataset.id) : undefined;
  Promise.resolve(fn(id, el)).catch((err) => alert(cleanError(err)));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

render();
