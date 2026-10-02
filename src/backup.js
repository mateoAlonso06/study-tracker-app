// Export and import of all app data as one zip: manifest.json, study-tracker.db and files/<userId>/<name>.
// A backup may come from another person, so everything read from it is treated as untrusted:
// entry names are whitelisted, the zip is extracted into a staging folder first, the database is checked,
// and the current data is moved aside (never deleted) before being replaced.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { STORED_NAME } = require('./files');

const FORMAT = 1;
const MAX_ENTRIES = 200000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024; // declared uncompressed size of the whole backup
const ALLOWED_ENTRY = new RegExp(`^(manifest\\.json|study-tracker\\.db|files/\\d{1,9}/${STORED_NAME.source.slice(1, -1)})$`);
const ALLOWED_DIR = /^files\/(\d{1,9}\/)?$/;
const REQUIRED_TABLES = ['users', 'subjects', 'sessions'];
const PRECOMPRESSED = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'mp4', 'webm', 'mov', 'zip', 'docx', 'xlsx', 'pptx', 'm4a', 'ogg']);

class BackupError extends Error {}

function register({ ipcMain, app, dialog, shell, BrowserWindow, getDb, closeDb, releaseLock }) {
  let pending = null; // { token, staging, summary } of an import waiting for the user's confirmation

  const userData = () => app.getPath('userData');
  const dbFile = () => path.join(userData(), 'study-tracker.db');
  const markerFile = () => path.join(userData(), 'last-import.json');
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

  // ---------- export ----------

  async function exportTo(target) {
    const db = getDb();
    const snapshot = path.join(app.getPath('temp'), `study-tracker-export-${crypto.randomUUID()}.db`);
    const partial = `${target}.part`;
    try {
      // A consistent copy of the live database, without anything that grants access to an account.
      db.prepare('VACUUM INTO ?').run(snapshot);
      const copy = new DatabaseSync(snapshot);
      // Deleted rows would otherwise stay readable inside the file's free pages: wipe them and rewrite the file.
      copy.exec(`PRAGMA secure_delete = ON;
                 DELETE FROM spotify_tokens; DELETE FROM remember_tokens; DELETE FROM user_settings WHERE key LIKE 'spotify.%';
                 VACUUM;`);
      copy.close();

      const attachments = db.prepare('SELECT user_id, stored_name FROM attachments').all();
      const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const manifest = {
        app: 'study-tracker',
        format: FORMAT,
        appVersion: app.getVersion(),
        createdAt: new Date().toISOString(),
        counts: { profiles: count('users'), subjects: count('subjects'), sessions: count('sessions'), notes: count('notes'), files: attachments.length },
      };

      const zip = new yazl.ZipFile();
      zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
      zip.addFile(snapshot, 'study-tracker.db');
      let included = 0;
      let missing = 0;
      for (const row of attachments) {
        const source = path.join(userData(), 'files', String(row.user_id), row.stored_name);
        if (!STORED_NAME.test(row.stored_name) || !fs.existsSync(source)) {
          missing += 1;
          continue;
        }
        const ext = path.extname(row.stored_name).slice(1);
        zip.addFile(source, `files/${row.user_id}/${row.stored_name}`, { compress: !PRECOMPRESSED.has(ext) });
        included += 1;
      }
      zip.end();
      await pipeline(zip.outputStream, fs.createWriteStream(partial));
      await fsp.rename(partial, target);
      const { size } = await fsp.stat(target);
      return { saved: true, path: target, size, files: included, missing };
    } finally {
      await fsp.rm(snapshot, { force: true });
      await fsp.rm(partial, { force: true });
    }
  }

  // ---------- import: stage and validate ----------

  const openZip = (file) =>
    new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => (err ? reject(err) : resolve(zip))));
  const openEntry = (zip, entry) =>
    new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream))));

  async function extractToStaging(zipPath, staging) {
    const zip = await openZip(zipPath);
    const seen = new Set();
    let total = 0;
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', async (entry) => {
        try {
          const name = entry.fileName;
          if (name.endsWith('/')) {
            if (!ALLOWED_DIR.test(name)) throw new BackupError(`El respaldo contiene una carpeta inesperada (${name}).`);
            zip.readEntry();
            return;
          }
          if (!ALLOWED_ENTRY.test(name)) throw new BackupError(`El respaldo contiene un archivo inesperado (${name}).`);
          if (seen.has(name)) throw new BackupError('El respaldo tiene entradas repetidas.');
          seen.add(name);
          total += entry.uncompressedSize;
          if (seen.size > MAX_ENTRIES || total > MAX_TOTAL_BYTES) throw new BackupError('El respaldo es demasiado grande.');
          const dest = path.join(staging, ...name.split('/'));
          if (!path.resolve(dest).startsWith(path.resolve(staging) + path.sep)) throw new BackupError('El respaldo contiene rutas no válidas.');
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await pipeline(await openEntry(zip, entry), fs.createWriteStream(dest, { flags: 'wx' }));
          zip.readEntry();
        } catch (err) {
          zip.close();
          reject(err);
        }
      });
      zip.readEntry();
    });
    zip.close();
    for (const required of ['manifest.json', 'study-tracker.db']) {
      if (!seen.has(required)) throw new BackupError('No es un respaldo de Study Tracker (falta un archivo esencial).');
    }
  }

  function inspectStaged(staging) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
    } catch {
      throw new BackupError('El respaldo está dañado (no se pudo leer el índice).');
    }
    if (manifest.app !== 'study-tracker') throw new BackupError('Este archivo no es un respaldo de Study Tracker.');
    if (manifest.format !== FORMAT) throw new BackupError('Este respaldo viene de una versión que esta app no entiende. Actualizá la app e intentá de nuevo.');

    let db;
    try {
      db = new DatabaseSync(path.join(staging, 'study-tracker.db'), { readOnly: true });
      const integrity = db.prepare('PRAGMA integrity_check').all();
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new BackupError('La base de datos del respaldo está dañada.');
      const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name));
      for (const table of REQUIRED_TABLES) if (!tables.has(table)) throw new BackupError('La base de datos del respaldo no tiene el formato esperado.');
      const count = (table) => (tables.has(table) ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : 0);

      let files = 0;
      let missingFiles = 0;
      let bytes = 0;
      if (tables.has('attachments')) {
        for (const row of db.prepare('SELECT user_id, stored_name, size FROM attachments').all()) {
          if (!STORED_NAME.test(row.stored_name)) throw new BackupError('El respaldo contiene datos de archivos no válidos.');
          files += 1;
          bytes += Number(row.size) || 0;
          if (!fs.existsSync(path.join(staging, 'files', String(row.user_id), row.stored_name))) missingFiles += 1;
        }
      }
      return {
        createdAt: manifest.createdAt || null,
        appVersion: manifest.appVersion || null,
        profiles: count('users'),
        subjects: count('subjects'),
        sessions: count('sessions'),
        notes: count('notes'),
        files,
        bytes,
        missingFiles,
      };
    } catch (err) {
      if (err instanceof BackupError) throw err;
      throw new BackupError('La base de datos del respaldo no se pudo leer.');
    } finally {
      db?.close();
    }
  }

  const friendly = (err) => {
    if (err instanceof BackupError) return err;
    if (/end of central directory|not a zip|zip file/i.test(err.message)) return new BackupError('El archivo elegido no es un zip válido.');
    if (/relative path|absolute path|invalid characters/i.test(err.message)) return new BackupError('El respaldo contiene rutas no válidas.');
    return new BackupError(`No se pudo leer el respaldo: ${err.message}`);
  };

  async function discardPending() {
    if (pending) await fsp.rm(pending.staging, { recursive: true, force: true });
    pending = null;
  }

  // Leftovers of an import that was interrupted (crash, power cut).
  async function cleanStale() {
    for (const entry of await fsp.readdir(userData()).catch(() => [])) {
      if (entry.startsWith('import-staging-')) await fsp.rm(path.join(userData(), entry), { recursive: true, force: true });
    }
  }

  // ---------- import: apply ----------

  async function applyStaged(staging, summary) {
    const safety = path.join(userData(), 'backups-before-import', stamp());
    const dbNames = ['study-tracker.db', 'study-tracker.db-wal', 'study-tracker.db-shm', 'study-tracker.db-journal'];
    const moved = [];
    closeDb();
    await fsp.mkdir(safety, { recursive: true });
    try {
      for (const name of [...dbNames, 'files']) {
        const from = path.join(userData(), name);
        if (fs.existsSync(from)) {
          await fsp.rename(from, path.join(safety, name));
          moved.push(name);
        }
      }
      await fsp.rename(path.join(staging, 'study-tracker.db'), dbFile());
      const stagedFiles = path.join(staging, 'files');
      if (fs.existsSync(stagedFiles)) await fsp.rename(stagedFiles, path.join(userData(), 'files'));
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.writeFile(markerFile(), JSON.stringify({ ok: true, at: new Date().toISOString(), safety, summary }));
    } catch (err) {
      // Put everything back exactly as it was.
      for (const name of [...dbNames, 'files']) await fsp.rm(path.join(userData(), name), { recursive: true, force: true });
      for (const name of moved) await fsp.rename(path.join(safety, name), path.join(userData(), name)).catch(() => {});
      await fsp.rmdir(safety).catch(() => {}); // only succeeds when everything went back, so no empty folder is left
      await fsp.writeFile(markerFile(), JSON.stringify({ ok: false, at: new Date().toISOString(), error: err.message })).catch(() => {});
      throw err;
    }
  }

  function restart() {
    releaseLock(); // otherwise the new instance can start before this one let go of the single-instance lock
    const options = {};
    const launcher = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE; // packaged single-file builds
    if (launcher) options.execPath = launcher;
    app.relaunch(options);
    app.exit(0);
  }

  // ---------- ipc ----------

  ipcMain.handle('backup:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const target = await dialog.showSaveDialog(win, {
      title: 'Exportar datos',
      defaultPath: `StudyTracker-respaldo-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Respaldo de Study Tracker', extensions: ['zip'] }],
    });
    if (target.canceled || !target.filePath) return { saved: false };
    const file = target.filePath.toLowerCase().endsWith('.zip') ? target.filePath : `${target.filePath}.zip`;
    return exportTo(file);
  });

  ipcMain.handle('backup:inspect', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Importar datos',
      properties: ['openFile'],
      filters: [{ name: 'Respaldo de Study Tracker', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true };
    await discardPending();
    const staging = path.join(userData(), `import-staging-${Date.now()}`);
    try {
      await fsp.mkdir(staging, { recursive: true });
      await extractToStaging(picked.filePaths[0], staging);
      const summary = inspectStaged(staging);
      pending = { token: crypto.randomUUID(), staging, summary };
      return { canceled: false, token: pending.token, summary };
    } catch (err) {
      await fsp.rm(staging, { recursive: true, force: true });
      throw friendly(err);
    }
  });

  ipcMain.handle('backup:cancel', () => discardPending());

  ipcMain.handle('backup:apply', async (_e, token) => {
    if (!pending || pending.token !== token) throw new BackupError('La importación ya no está disponible. Elegí el archivo de nuevo.');
    const { staging, summary } = pending;
    pending = null;
    try {
      await applyStaged(staging, summary);
    } catch (err) {
      restart(); // the database was closed: restart so the app runs on the restored data
      throw err;
    }
    restart();
  });

  // The renderer asks once at startup how the last import ended.
  ipcMain.handle('backup:last-result', async () => {
    try {
      const marker = JSON.parse(await fsp.readFile(markerFile(), 'utf8'));
      await fsp.rm(markerFile(), { force: true });
      return marker;
    } catch {
      return null;
    }
  });

  cleanStale();
  return { exportTo, extractToStaging, inspectStaged };
}

module.exports = { register, BackupError };
