// Export and import of all app data (one zip). Relies on globals from app.js / attachments.js at call time.

let importToken = null;

async function exportBackup() {
  const working = toast('Exportando… esto puede tardar si tenés muchos archivos.');
  try {
    const result = await window.api.exportBackup();
    working.remove();
    if (!result.saved) return;
    const extra = result.missing ? ` (${result.missing} archivo${result.missing === 1 ? '' : 's'} no se encontró en el disco y no se incluyó)` : '';
    toast(`Respaldo guardado: ${fmtSize(result.size)}, ${result.files} archivo${result.files === 1 ? '' : 's'}${extra}. Ubicación: ${result.path}`);
  } catch (err) {
    working.remove();
    toast(cleanError(err), 'error');
  }
}

function importSummaryHtml(s) {
  const date = s.createdAt ? new Date(s.createdAt).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' }) : 'fecha desconocida';
  const rows = [
    ['Perfiles', s.profiles],
    ['Materias', s.subjects],
    ['Sesiones', s.sessions],
    ['Notas', s.notes],
    ['Archivos', `${s.files}${s.files ? ` (${fmtSize(s.bytes)})` : ''}`],
  ];
  return `<h2>Importar respaldo</h2>
    <p class="muted small">Creado el ${esc(date)}${s.appVersion ? ` con la versión ${esc(s.appVersion)}` : ''}.</p>
    <table class="import-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
    ${s.missingFiles ? `<p class="error">${s.missingFiles} archivo${s.missingFiles === 1 ? '' : 's'} del respaldo no se encontró dentro del zip; esos archivos no van a estar disponibles.</p>` : ''}
    <p><strong>Importar reemplaza todo lo que hay ahora en esta app</strong>: perfiles, materias, sesiones, notas y archivos.
    Lo actual no se borra: queda guardado en una carpeta aparte por si querés volver atrás.</p>
    <p class="small muted">La app se reinicia al terminar. Tendrás que volver a conectar Spotify y elegir tu perfil.</p>
    <p class="small muted" id="import-wait"></p>`;
}

async function importBackup() {
  let result;
  try {
    result = await window.api.inspectBackup();
  } catch (err) {
    toast(cleanError(err), 'error');
    return;
  }
  if (result.canceled) return;
  importToken = result.token;
  openModal(`${importSummaryHtml(result.summary)}${buttons('Importar y reiniciar')}`, async () => {
    const token = importToken;
    importToken = null; // from here on the staged copy belongs to the import, not to the dialog
    document.getElementById('import-wait').textContent = 'Importando… la app se va a reiniciar sola.';
    await window.api.applyBackup(token);
  });
  modalCleanup = () => {
    if (importToken) window.api.cancelBackup().catch(() => {});
    importToken = null;
  };
}

async function reportLastImport() {
  try {
    const last = await window.api.lastBackupResult();
    if (!last) return;
    if (last.ok) toast(`Importación completa. Tus datos anteriores quedaron guardados en: ${last.safety}`);
    else toast(`La importación falló y se restauró todo como estaba: ${last.error}`, 'error');
  } catch {
    /* nothing to report */
  }
}

const backupActions = {
  'backup-export': exportBackup,
  'backup-import': importBackup,
};
