// Global search (Ctrl+K): notes, files, sessions and subjects across every subject, all from data already in memory.
// Relies on globals from app.js / notes.js / attachments.js at call time.

const MAX_PER_GROUP = 6;
const searchUi = { items: [], active: 0 };

// ---------- searching ----------

function sessionLabel(session) {
  return session ? `${session.topic || 'Sin tema'} · ${fmtDate(session.date)}` : '';
}

function searchAll(query) {
  const terms = queryTerms(query);
  const hit = (...texts) => terms.every((t) => norm(texts.join(' ')).includes(t));
  const titleHit = (text) => (terms.every((t) => norm(text).includes(t)) ? 2 : 0);
  const groups = [];

  const notes = state.notes
    .map((n) => {
      const session = n.sessionId ? sessionById(n.sessionId) : null;
      if (!hit(n.title, n.text, session?.topic, subjectName(n.subjectId))) return null;
      return { kind: 'note', id: n.id, subjectId: n.subjectId, score: titleHit(n.title), date: noteDate(n), title: n.title || 'Sin título', text: n.text, meta: [subjectName(n.subjectId), sessionLabel(session)].filter(Boolean).join(' · ') };
    })
    .filter(Boolean);

  const files = state.files
    .filter((f) => !f.inline)
    .map((f) => {
      const session = f.sessionId ? sessionById(f.sessionId) : null;
      if (!hit(f.name, session?.topic, subjectName(f.subjectId))) return null;
      return { kind: 'file', id: f.id, subjectId: f.subjectId, score: titleHit(f.name), date: f.createdAt.slice(0, 10), title: f.name, meta: [subjectName(f.subjectId), fmtSize(f.size), sessionLabel(session)].filter(Boolean).join(' · ') };
    })
    .filter(Boolean);

  const sessions = state.sessions
    .map((s) => {
      if (!hit(s.topic, s.position, subjectName(s.subjectId))) return null;
      return { kind: 'session', id: s.id, subjectId: s.subjectId, score: titleHit(s.topic), date: s.date, title: s.topic || 'Sin tema', meta: `${subjectName(s.subjectId)} · ${fmtDate(s.date)} · ${fmtHours(s.hours)}${s.position ? ` · ${s.position}` : ''}` };
    })
    .filter(Boolean);

  const subjects = state.subjects
    .filter((s) => hit(s.name))
    .map((s) => ({ kind: 'subject', id: s.id, subjectId: s.id, score: 2, date: '', title: s.name, meta: 'Materia' }));

  const byRelevance = (a, b) => b.score - a.score || b.date.localeCompare(a.date);
  for (const [label, list] of [['Materias', subjects], ['Notas', notes], ['Archivos', files], ['Sesiones', sessions]]) {
    if (list.length) groups.push({ label, total: list.length, items: list.sort(byRelevance).slice(0, MAX_PER_GROUP) });
  }
  return { terms, groups };
}

function emptyQueryGroups() {
  // Nothing typed yet: offer the subjects as quick jumps.
  const items = state.subjects.map((s) => ({ kind: 'subject', id: s.id, subjectId: s.id, title: s.name, meta: 'Materia' }));
  return items.length ? { terms: [], groups: [{ label: 'Ir a una materia', total: items.length, items }] } : { terms: [], groups: [] };
}

// ---------- rendering ----------

const KIND_LABEL = { note: 'Nota', file: 'Archivo', session: 'Sesión', subject: 'Materia' };

function resultRow(item, index, terms) {
  const snippetHtml = item.kind === 'note' && item.text && terms.length ? `<div class="result-snippet">${snippet(item.text, terms)}</div>` : '';
  return `<button class="result ${index === searchUi.active ? 'active' : ''}" role="option" aria-selected="${index === searchUi.active}" data-action="search-pick" data-id="${index}">
    <span class="result-kind ${item.kind}">${KIND_LABEL[item.kind]}</span>
    <span class="result-main">
      <span class="result-title">${terms.length ? highlight(item.title, terms) : esc(item.title)}</span>
      <span class="result-meta">${esc(item.meta)}</span>
      ${snippetHtml}
    </span>
  </button>`;
}

function renderSearchResults(query) {
  const box = document.getElementById('search-results');
  if (!box) return;
  const { terms, groups } = query.trim() ? searchAll(query) : emptyQueryGroups();
  searchUi.items = groups.flatMap((g) => g.items);
  searchUi.active = Math.min(searchUi.active, Math.max(0, searchUi.items.length - 1));

  if (!searchUi.items.length) {
    box.innerHTML = query.trim()
      ? '<div class="empty small"><h2>Sin resultados</h2><p>Probá con otras palabras. Se ignoran mayúsculas y tildes.</p></div>'
      : '<div class="empty small"><p>Escribí para buscar en tus notas, archivos y sesiones.</p></div>';
    return;
  }
  let index = 0;
  box.innerHTML = groups
    .map(
      (g) => `<div class="result-group"><div class="result-group-title">${g.label}${g.total > g.items.length ? ` <span class="muted">(${g.items.length} de ${g.total})</span>` : ''}</div>${g.items
        .map((item) => resultRow(item, index++, terms))
        .join('')}</div>`
    )
    .join('');
  box.querySelector('.result.active')?.scrollIntoView({ block: 'nearest' });
}

function openSearch() {
  if (!state.user) return;
  if (document.getElementById('search-input')) {
    document.getElementById('search-input').focus();
    return;
  }
  if (modalRoot.innerHTML.trim()) return; // another dialog is open: do not replace it
  searchUi.active = 0;
  modalRoot.innerHTML = `<div class="overlay palette-overlay"><div class="modal palette" role="dialog" aria-label="Buscar">
    <input id="search-input" type="search" placeholder="Buscar en notas, archivos, sesiones y materias" autocomplete="off" aria-controls="search-results" />
    <div id="search-results" role="listbox"></div>
    <div class="palette-hint small muted">↑ ↓ para moverte · Enter para abrir · Esc para cerrar</div>
  </div></div>`;
  const input = document.getElementById('search-input');
  input.focus();
  renderSearchResults('');
}

// ---------- opening a result ----------

function flash(selector) {
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1900);
  });
}

function goToResult(item) {
  closeModal();
  if (state.subjectId !== item.subjectId || state.view !== 'subject') {
    state.noteFilters = defaultNoteFilters();
    state.fileFilters = defaultFileFilters();
  }
  state.view = 'subject';
  state.subjectId = item.subjectId;
  state.subjectTab = item.kind === 'note' ? 'notes' : item.kind === 'file' ? 'files' : 'sessions';
  if (item.kind === 'note') {
    state.noteFilters = defaultNoteFilters();
    noteUi.expanded.add(item.id);
  }
  if (item.kind === 'file') state.fileFilters = defaultFileFilters();
  render();

  if (item.kind === 'note') flash(`.note[data-id="${item.id}"]`);
  else if (item.kind === 'session') flash(`.session[data-session-id="${item.id}"]`);
  else if (item.kind === 'file') {
    const file = fileById(item.id);
    if (file && fileKind(file) !== 'other') openPreview(item.id); // images and PDFs open right away
    else flash(`.file-card[data-id="${item.id}"]`);
  }
}

// ---------- events ----------

const searchActions = {
  'open-search': () => openSearch(),
  'search-pick': (index) => {
    const item = searchUi.items[index];
    if (item) goToResult(item);
  },
};

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search-input') return;
  searchUi.active = 0;
  renderSearchResults(e.target.value);
});

document.addEventListener('keydown', (e) => {
  // Ctrl+K opens the search, except inside the note editor where Quill uses it to insert a link.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !e.target.closest?.('.ql-editor')) {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.target.id !== 'search-input') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!searchUi.items.length) return;
    searchUi.active = (searchUi.active + (e.key === 'ArrowDown' ? 1 : -1) + searchUi.items.length) % searchUi.items.length;
    renderSearchResults(e.target.value);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    searchActions['search-pick'](searchUi.active);
  }
});

document.addEventListener('mousedown', (e) => {
  if (e.target.classList?.contains('palette-overlay')) closeModal();
});
