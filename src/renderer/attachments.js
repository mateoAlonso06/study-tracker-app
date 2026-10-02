// Files tab of a subject: add (button or drag and drop), browse, preview images and PDFs, rename, save a copy, delete.
// Relies on globals from app.js / live.js (state, render, openModal, buttons, esc, cleanError, showContextMenu, ...) at call time.

const defaultFileFilters = () => ({ query: '', kind: 'all', session: 'all' });

const fileUi = { previewId: null, internalDrag: false };

// ---------- helpers ----------

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(Math.round((bytes / 1024 / 1024) * 10) / 10).toString().replace('.', ',')} MB`;
}

function fileKind(file) {
  if (file.mime === 'application/pdf') return 'pdf';
  if (file.mime.startsWith('image/')) return 'image';
  return 'other';
}

const fileUrl = (id) => `studyfiles://file/${id}`;
const fileExt = (name) => (name.includes('.') ? name.split('.').pop().slice(0, 5).toUpperCase() : 'ARCHIVO');
const fileById = (id) => state.files.find((f) => f.id === id);
const filesOfSubject = (subjectId) => state.files.filter((f) => f.subjectId === subjectId && !f.inline);
const filesOfSession = (sessionId) => state.files.filter((f) => f.sessionId === sessionId && !f.inline);

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4500);
  return el;
}

// ---------- listing ----------

function visibleFiles() {
  const f = state.fileFilters;
  const query = norm(f.query);
  return filesOfSubject(state.subjectId)
    .filter((file) => f.kind === 'all' || fileKind(file) === f.kind)
    .filter((file) => f.session === 'all' || (f.session === 'none' ? !file.sessionId : file.sessionId === Number(f.session)))
    .filter((file) => !query || norm(file.name).includes(query));
}

function fileThumb(file) {
  const kind = fileKind(file);
  if (kind === 'image') return `<img src="${fileUrl(file.id)}" alt="" loading="lazy" decoding="async" />`;
  return `<div class="file-badge ${kind}">${kind === 'pdf' ? 'PDF' : esc(fileExt(file.name))}</div>`;
}

function fileCard(file) {
  const session = file.sessionId ? sessionById(file.sessionId) : null;
  const when = sqlUtcToDate(file.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<div class="file-card" data-action="open-file" data-id="${file.id}" tabindex="0">
    <div class="file-thumb">${fileThumb(file)}</div>
    <div class="file-info">
      <div class="file-name" title="${esc(file.name)}">${esc(file.name)}</div>
      <div class="small muted">${fmtSize(file.size)} · ${esc(when)}${session ? ` · ${esc(session.topic || 'Sin tema')}` : ''}</div>
    </div>
    <button class="ghost file-menu" data-action="file-menu" data-id="${file.id}" aria-label="Más opciones" title="Más opciones">⋯</button>
  </div>`;
}

function filesResults() {
  const all = filesOfSubject(state.subjectId);
  if (!all.length) {
    return `<div class="empty"><h2>Todavía no hay archivos</h2><p>Arrastrá imágenes, PDFs o cualquier archivo a esta ventana, o usá <strong>+ Agregar archivos</strong>.</p></div>`;
  }
  const files = visibleFiles();
  if (!files.length) return `<div class="empty"><h2>Sin resultados</h2><p>Probá con otro nombre o cambiá los filtros.</p></div>`;
  return `<p class="muted small">${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}</p><div class="file-grid">${files.map(fileCard).join('')}</div>`;
}

function renderFilesResults() {
  const el = document.getElementById('files-results');
  if (el) el.innerHTML = filesResults();
}

function filesPanel() {
  const f = state.fileFilters;
  const sessions = state.sessions.filter((s) => s.subjectId === state.subjectId);
  const opt = (value, label, current) => `<option value="${value}" ${String(value) === String(current) ? 'selected' : ''}>${label}</option>`;
  return `<div class="filters">
      <div class="search-row">
        <input class="search" type="search" data-file-filter="query" placeholder="Buscar por nombre" value="${esc(f.query)}" />
        <button class="primary" data-action="add-files">+ Agregar archivos</button>
      </div>
      <div class="filter-row">
        <div><label>Tipo</label><select data-file-filter="kind">${opt('all', 'Todos', f.kind)}${opt('image', 'Imágenes', f.kind)}${opt('pdf', 'PDF', f.kind)}${opt('other', 'Otros', f.kind)}</select></div>
        <div><label>Sesión</label><select data-file-filter="session">${opt('all', 'Todas', f.session)}${opt('none', 'Sin sesión', f.session)}${sessions
          .map((s) => opt(s.id, `${esc(fmtDate(s.date))} · ${esc(s.topic || 'Sin tema')}`, f.session))
          .join('')}</select></div>
        <div class="filter-clear"><button type="button" data-action="clear-file-filters">Limpiar filtros</button></div>
      </div>
    </div>
    <div id="files-results">${filesResults()}</div>
    <p class="muted small files-hint">Los archivos se guardan en tu equipo, dentro de la carpeta de datos de la app.</p>`;
}

// ---------- adding ----------

// Runs an add task, refreshes the data and reports the outcome. Returns true when something was processed.
async function addFilesFlow(task, sessionId = null) {
  const previousFilter = state.fileFilters.session;
  if (sessionId) state.fileFilters.session = String(sessionId); // so the Files tab shows where the new files went
  try {
    const result = await task();
    if (result.canceled) {
      state.fileFilters.session = previousFilter;
      return false;
    }
    await reload();
    state.subjectTab = 'files';
    render();
    const { added, failed } = result;
    if (added.length) toast(`${added.length} ${added.length === 1 ? 'archivo agregado' : 'archivos agregados'}`);
    if (failed.length) toast(`No se pudo agregar: ${failed.map((x) => `${x.name} (${x.reason})`).join(', ')}`, 'error');
    return true;
  } catch (err) {
    state.fileFilters.session = previousFilter;
    toast(cleanError(err), 'error');
    return false;
  }
}

const pickFiles = (sessionId = null) => addFilesFlow(() => window.api.pickFiles({ subjectId: state.subjectId, sessionId }), sessionId);

function dropFiles(fileList, sessionId = null) {
  const paths = [...fileList].map((f) => window.api.pathForFile(f)).filter(Boolean);
  if (!paths.length) {
    toast('No se pudo leer lo que soltaste. Probá con el botón + Agregar archivos.', 'error');
    return;
  }
  return addFilesFlow(() => window.api.addFilePaths({ subjectId: state.subjectId, sessionId, paths }), sessionId);
}

// ---------- preview ----------

function previewList() {
  return visibleFiles().filter((f) => fileKind(f) !== 'other');
}

function openPreview(id) {
  const file = fileById(id);
  if (!file) return;
  fileUi.previewId = id;
  const list = file.inline ? [file] : previewList(); // an image taken from a note has no siblings to browse
  const index = list.findIndex((f) => f.id === id);
  const kind = fileKind(file);
  modalRoot.innerHTML = `<div class="overlay" id="preview-overlay"><div class="modal preview" role="dialog" aria-label="${esc(file.name)}">
    <div class="preview-head">
      <div class="preview-title"><strong>${esc(file.name)}</strong><span class="small muted">${fmtSize(file.size)}${list.length > 1 ? ` · ${index + 1} de ${list.length}` : ''}</span></div>
      <div class="preview-actions">
        ${list.length > 1 ? '<button data-action="preview-prev" aria-label="Anterior">‹</button><button data-action="preview-next" aria-label="Siguiente">›</button>' : ''}
        <button data-action="file-system-open" data-id="${file.id}">Abrir con el sistema</button>
        <button data-action="file-save-as" data-id="${file.id}">Guardar copia</button>
        <button data-action="close-modal">Cerrar</button>
      </div>
    </div>
    <div class="preview-body">${kind === 'image' ? `<img src="${fileUrl(file.id)}" alt="${esc(file.name)}" />` : `<iframe src="${fileUrl(file.id)}" title="${esc(file.name)}"></iframe>`}</div>
  </div></div>`;
}

function stepPreview(delta) {
  if (fileById(fileUi.previewId)?.inline) return;
  const list = previewList();
  if (list.length < 2) return;
  const index = list.findIndex((f) => f.id === fileUi.previewId);
  openPreview(list[(index + delta + list.length) % list.length].id);
}

// ---------- editing and deleting ----------

function fileEditModal(file) {
  const sessions = state.sessions.filter((s) => s.subjectId === file.subjectId);
  openModal(
    `<h2>Editar archivo</h2>
     <div class="field"><label>Nombre</label><input name="name" value="${esc(file.name)}" /></div>
     <div class="field"><label>Sesión</label>
       <select name="sessionId"><option value="">Sin sesión</option>${sessions
         .map((s) => `<option value="${s.id}" ${s.id === file.sessionId ? 'selected' : ''}>${esc(fmtDate(s.date))} · ${esc(s.topic || 'Sin tema')}</option>`)
         .join('')}</select>
     </div>
     ${buttons('Guardar')}`,
    async ({ name, sessionId }) => {
      await window.api.updateFile({ id: file.id, name, sessionId: sessionId ? Number(sessionId) : null });
      await reload();
      render();
    }
  );
}

async function deleteFileFlow(id) {
  const file = fileById(id);
  if (!file || !confirm(`¿Borrar "${file.name}"? Se elimina de la app y no se puede deshacer.`)) return;
  try {
    await window.api.deleteFile(id);
    closeModal();
    await reload();
    render();
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

async function systemOpen(id) {
  try {
    const { opened } = await window.api.openFile(id);
    if (!opened) toast('Este tipo de archivo no se abre desde la app por seguridad. Lo mostramos en su carpeta.');
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

async function saveCopy(id) {
  try {
    const { saved } = await window.api.saveFileAs(id);
    if (saved) toast('Copia guardada');
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

function showFileMenu(x, y, id) {
  const file = fileById(id);
  if (!file) return;
  const items = [];
  if (fileKind(file) !== 'other') items.push({ label: 'Ver', onClick: () => openPreview(id) });
  items.push(
    { label: 'Abrir con el sistema', onClick: () => systemOpen(id) },
    { label: 'Mostrar en la carpeta', onClick: () => window.api.revealFile(id).catch((err) => toast(cleanError(err), 'error')) },
    { label: 'Guardar una copia…', onClick: () => saveCopy(id) },
    { label: 'Editar…', onClick: () => fileEditModal(file) },
    { label: 'Borrar', danger: true, onClick: () => deleteFileFlow(id) }
  );
  showContextMenu(x, y, items);
}

// ---------- actions and events ----------

const attachmentActions = {
  'tab-files': () => {
    state.subjectTab = 'files';
    render();
  },
  'add-files': () => pickFiles(),
  'add-session-files': (id) => pickFiles(id),
  'show-session-files': (id) => {
    state.fileFilters = { ...defaultFileFilters(), session: String(id) };
    state.subjectTab = 'files';
    render();
  },
  'open-file': (id) => {
    const file = fileById(id);
    if (!file) return;
    if (fileKind(file) === 'other') systemOpen(id);
    else openPreview(id);
  },
  'file-menu': (id, el) => {
    const r = el.getBoundingClientRect();
    showFileMenu(r.left, r.bottom + 4, id);
  },
  'file-system-open': (id) => systemOpen(id),
  'file-save-as': (id) => saveCopy(id),
  'preview-prev': () => stepPreview(-1),
  'preview-next': () => stepPreview(1),
  'clear-file-filters': () => {
    state.fileFilters = defaultFileFilters();
    render();
  },
};

document.addEventListener('input', (e) => {
  const key = e.target.dataset?.fileFilter;
  if (!key) return;
  state.fileFilters[key] = e.target.value;
  renderFilesResults();
});

document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest?.('.file-card');
  if (!card) return;
  e.preventDefault();
  showFileMenu(e.clientX, e.clientY, Number(card.dataset.id));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('file-card')) {
    e.preventDefault();
    attachmentActions['open-file'](Number(e.target.dataset.id));
  }
  if (!document.getElementById('preview-overlay')) return;
  if (e.key === 'ArrowLeft') stepPreview(-1);
  if (e.key === 'ArrowRight') stepPreview(1);
});

document.addEventListener('mousedown', (e) => {
  if (e.target.id === 'preview-overlay') closeModal(); // click on the dark background closes the preview
});

// Clicking an image inside a saved note opens it large.
document.addEventListener('click', (e) => {
  const img = e.target.closest?.('.notes img');
  if (!img) return;
  const id = Number((img.getAttribute('src') || '').split('/').pop());
  if (fileById(id)) openPreview(id);
});

// ---------- drag and drop of files from the computer ----------

const dragHasFiles = (e) => !fileUi.internalDrag && [...(e.dataTransfer?.types || [])].includes('Files');
const insideEditor = (e) => !!e.target.closest?.('.ql-editor');
const sessionUnder = (e) => {
  const card = state.view === 'subject' ? e.target.closest?.('.session[data-session-id]') : null;
  return card ? sessionById(Number(card.dataset.sessionId)) : null;
};

function dropHint(show, session = null) {
  let hint = document.getElementById('drop-hint');
  if (!show) {
    hint?.remove();
    return;
  }
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'drop-hint';
    hint.className = 'drop-hint';
    document.body.appendChild(hint);
  }
  const subject = state.view === 'subject' ? state.subjects.find((s) => s.id === state.subjectId) : null;
  hint.textContent = session
    ? `Soltá los archivos para adjuntarlos a la sesión "${session.topic || fmtDate(session.date)}"`
    : subject
      ? `Soltá los archivos para agregarlos a "${subject.name}"`
      : 'Abrí una materia para poder agregar archivos';
}

document.addEventListener('dragstart', () => {
  fileUi.internalDrag = true; // something inside the page is being dragged (live notes, text...): not a file from the computer
});
document.addEventListener('dragend', () => {
  fileUi.internalDrag = false;
  dropHint(false);
});

document.addEventListener('dragover', (e) => {
  if (!dragHasFiles(e) || insideEditor(e)) return;
  e.preventDefault(); // without this the browser would navigate to the dropped file
  e.dataTransfer.dropEffect = state.view === 'subject' ? 'copy' : 'none';
  dropHint(true, sessionUnder(e));
});

document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropHint(false);
});

document.addEventListener('drop', (e) => {
  if (!dragHasFiles(e) || insideEditor(e)) return;
  e.preventDefault();
  dropHint(false);
  if (state.view !== 'subject') {
    toast('Abrí una materia para poder agregar archivos.', 'error');
    return;
  }
  dropFiles(e.dataTransfer.files, sessionUnder(e)?.id ?? null);
});
