// Notes section: notes are standalone objects that can belong to a session.
// Relies on globals from app.js (state, render, openModal, ...) at call time only.

const noteUi = { expanded: new Set() };

const defaultNoteFilters = () => ({ query: '', from: '', to: '', order: 'desc', group: 'session' });

// ---------- helpers ----------

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function noteText(html) {
  const spaced = notesToHtml(html).replace(/<\/(p|h[1-3]|li|blockquote|pre|ul|ol)>|<br\s*\/?>/gi, '$& ');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function sqlUtcToDate(s) {
  return new Date(`${s.replace(' ', 'T')}Z`);
}

function sessionById(id) {
  return state.sessions.find((s) => s.id === id);
}

function subjectName(id) {
  return state.subjects.find((s) => s.id === id)?.name || '—';
}

function notesOfSession(sessionId) {
  return state.notes.filter((n) => n.sessionId === sessionId);
}

function notesOfSubject(subjectId) {
  return state.notes.filter((n) => n.subjectId === subjectId);
}

// Reference date for filtering and ordering: the session's date, or the note's own creation day.
function noteDate(note) {
  const session = note.sessionId ? sessionById(note.sessionId) : null;
  return session ? session.date : toIso(sqlUtcToDate(note.createdAt));
}

function queryTerms(query) {
  return norm(query).split(/\s+/).filter(Boolean);
}

function matchesQuery(note, terms) {
  if (!terms.length) return true;
  const session = note.sessionId ? sessionById(note.sessionId) : null;
  const haystack = norm(`${note.title} ${note.text} ${session?.topic || ''}`);
  return terms.every((t) => haystack.includes(t));
}

function highlight(text, terms) {
  const n = norm(text);
  if (!terms.length || n.length !== text.length) return esc(text);
  const ranges = [];
  for (const t of terms) {
    let i = n.indexOf(t);
    while (i !== -1) {
      ranges.push([i, i + t.length]);
      i = n.indexOf(t, i + t.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let out = '';
  let pos = 0;
  for (const [a, b] of merged) {
    out += `${esc(text.slice(pos, a))}<mark>${esc(text.slice(a, b))}</mark>`;
    pos = b;
  }
  return out + esc(text.slice(pos));
}

function snippet(text, terms) {
  const n = norm(text);
  const hit = terms.map((t) => n.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 60);
  const piece = text.slice(start, start + 220);
  return `${start > 0 ? '…' : ''}${highlight(piece, terms)}${start + 220 < text.length ? '…' : ''}`;
}

// ---------- listing ----------

function filteredNotes() {
  const f = state.noteFilters;
  const terms = queryTerms(f.query);
  const dir = f.order === 'asc' ? 1 : -1;
  return notesOfSubject(state.subjectId)
    .filter((n) => !f.from || noteDate(n) >= f.from)
    .filter((n) => !f.to || noteDate(n) <= f.to)
    .filter((n) => matchesQuery(n, terms))
    .sort((a, b) => dir * (noteDate(a).localeCompare(noteDate(b)) || a.createdAt.localeCompare(b.createdAt) || a.id - b.id));
}

function noteCard(note, terms) {
  const open = noteUi.expanded.has(note.id);
  const content = note.content ? notesToHtml(note.content) : '';
  let body = '';
  if (open) body = `<div class="notes">${content}</div>`;
  else if (terms.length && note.text) body = `<p class="snippet">${snippet(note.text, terms)}</p>`;
  else if (content) body = `<div class="notes clamp">${content}</div>`;
  const when = sqlUtcToDate(note.updatedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<div class="note" data-action="toggle-note" data-id="${note.id}">
    <div class="top">
      <strong>${note.title ? highlight(note.title, terms) : '<span class="muted">Sin título</span>'}</strong>
      <span class="meta">editada ${esc(when)}</span>
    </div>
    ${body}
    <div class="row-actions">
      <button class="ghost" data-action="edit-note" data-id="${note.id}">Editar</button>
      <button class="ghost danger" data-action="delete-note" data-id="${note.id}">Borrar</button>
    </div>
  </div>`;
}

function sessionHeading(session) {
  return `${esc(session.topic || 'Sin tema')} · ${esc(fmtDate(session.date))} · ${fmtHours(session.hours)}`;
}

function notesResults() {
  const f = state.noteFilters;
  const terms = queryTerms(f.query);
  const notes = filteredNotes();
  if (!notesOfSubject(state.subjectId).length) {
    return `<div class="empty"><h2>Todavía no hay notas</h2><p>Se crean solas al terminar una sesión con notas, o podés agregar una a mano.</p></div>`;
  }
  if (!notes.length) return `<div class="empty"><h2>Sin resultados</h2><p>Probá con otras palabras o cambiá los filtros.</p></div>`;

  const count = `<p class="muted small">${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}</p>`;
  if (f.group !== 'session') {
    return count + notes.map((n) => {
      const session = n.sessionId ? sessionById(n.sessionId) : null;
      const where = session ? sessionHeading(session) : 'Sin sesión';
      return `<div class="note-where small muted">${where}</div>${noteCard(n, terms)}`;
    }).join('');
  }

  const groups = new Map();
  for (const n of notes) {
    const key = n.sessionId ?? 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const orphan = groups.get('none');
  groups.delete('none');
  const blocks = [...groups.entries()].map(([sid, list]) => {
    const session = sessionById(sid);
    return `<section class="note-group"><h3 class="group-title">${sessionHeading(session)}</h3>${list.map((n) => noteCard(n, terms)).join('')}</section>`;
  });
  if (orphan) {
    blocks.push(`<section class="note-group"><h3 class="group-title">Sin sesión</h3>${orphan.map((n) => noteCard(n, terms)).join('')}</section>`);
  }
  return count + blocks.join('');
}

function renderNotesResults() {
  const el = document.getElementById('notes-results');
  if (el) el.innerHTML = notesResults();
}

function notesPanel() {
  const f = state.noteFilters;
  const opt = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  return `<div class="filters">
      <div class="search-row">
        <input class="search" type="search" data-filter="query" placeholder="Buscar en títulos y contenido" value="${esc(f.query)}" />
        <button class="primary" data-action="new-note">+ Nueva nota</button>
      </div>
      <div class="filter-row">
        <div><label>Desde</label><input type="date" data-filter="from" value="${esc(f.from)}" /></div>
        <div><label>Hasta</label><input type="date" data-filter="to" value="${esc(f.to)}" /></div>
        <div><label>Orden</label><select data-filter="order">${opt('desc', 'Más recientes primero', f.order)}${opt('asc', 'Más antiguas primero', f.order)}</select></div>
        <div><label>Vista</label><select data-filter="group">${opt('session', 'Agrupadas por sesión', f.group)}${opt('flat', 'Lista simple', f.group)}</select></div>
        <div class="filter-clear"><button type="button" data-action="clear-filters">Limpiar filtros</button></div>
      </div>
    </div>
    <div id="notes-results">${notesResults()}</div>`;
}

// ---------- note modal ----------

function sessionOptions(subjectId, selectedId) {
  const sessions = state.sessions.filter((s) => s.subjectId === Number(subjectId));
  return (
    `<option value="">Sin sesión</option>` +
    sessions
      .map((s) => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${esc(fmtDate(s.date))} · ${esc(s.topic || 'Sin tema')}</option>`)
      .join('')
  );
}

function noteModal(note, preset = {}) {
  const subjectId = note?.subjectId ?? preset.subjectId ?? state.subjectId;
  const sessionId = note ? note.sessionId : preset.sessionId ?? null;
  let quill;
  openModal(
    `<h2>${note ? 'Editar nota' : 'Nueva nota'}</h2>
     <div class="field"><label>Sesión de ${esc(subjectName(subjectId))}</label><select name="sessionId">${sessionOptions(subjectId, sessionId)}</select></div>
     <div class="field"><label>Título</label><input name="title" value="${esc(note?.title || '')}" placeholder="Opcional" /></div>
     <div class="field"><label>Contenido</label><div class="editor-wrap modal-editor"><div id="modal-editor"></div></div></div>
     ${buttons('Guardar')}`,
    async (data) => {
      const content = getEditorHtml(quill);
      await window.api.saveNote({
        id: note?.id,
        subjectId,
        sessionId: data.sessionId ? Number(data.sessionId) : null,
        title: data.title,
        content,
        text: content ? noteText(content) : '',
      });
      await reload();
      render();
    }
  );
  modalRoot.querySelector('.modal').classList.add('wide');
  quill = createEditor(document.getElementById('modal-editor'), note?.content || '');
}

// ---------- actions ----------

const notesActions = {
  'tab-sessions': () => {
    state.subjectTab = 'sessions';
    render();
  },
  'tab-notes': () => {
    state.subjectTab = 'notes';
    render();
  },
  'new-note': () => noteModal(null),
  'new-note-for-session': (id) => {
    const session = sessionById(id);
    noteModal(null, { subjectId: session.subjectId, sessionId: session.id });
  },
  'edit-note': (id) => noteModal(state.notes.find((n) => n.id === id)),
  'delete-note': async (id) => {
    if (!confirm('¿Borrar esta nota?')) return;
    await window.api.deleteNote(id);
    await reload();
    render();
  },
  'toggle-note': (id) => {
    if (noteUi.expanded.has(id)) noteUi.expanded.delete(id);
    else noteUi.expanded.add(id);
    renderNotesResults();
  },
  'clear-filters': () => {
    state.noteFilters = defaultNoteFilters();
    render();
  },
};

document.addEventListener('input', (e) => {
  const key = e.target.dataset?.filter;
  if (!key) return;
  state.noteFilters[key] = e.target.value;
  renderNotesResults();
});
