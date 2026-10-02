// Attachments (main process only): files are copied into <userData>/files/<userId>/, the database keeps only metadata.
// The UI reaches the bytes through the studyfiles:// protocol, which checks ownership on every request.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const MAX_BYTES = 100 * 1024 * 1024; // per file picked from disk
const MAX_PASTED_BYTES = 25 * 1024 * 1024; // per image pasted or dropped into a note

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', rtf: 'application/rtf',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const EXT_BY_IMAGE_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

// Types the OS may open directly. Anything else (executables, scripts, installers...) is only revealed in its folder,
// because a backup received from someone else could contain a harmful file.
const SAFE_TO_OPEN = new Set(Object.keys(MIME_BY_EXT).filter((ext) => ext !== 'svg'));

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,8})?$/;

const extensionOf = (name) => path.extname(String(name)).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
const mimeOf = (name) => MIME_BY_EXT[extensionOf(name)] || 'application/octet-stream';

function register({ ipcMain, db, app, dialog, shell, protocol, net, BrowserWindow, requireUser, getUserId }) {
  const filesRoot = () => path.join(app.getPath('userData'), 'files');
  const userDir = (uid) => path.join(filesRoot(), String(uid));

  const columns = `id, subject_id AS subjectId, session_id AS sessionId, name, original_name AS originalName,
                   mime, size, inline, created_at AS createdAt`;

  const rowFor = (uid, id) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?').get(id, uid);
    if (!row) throw new Error('Archivo no encontrado');
    return row;
  };

  function checkTargets(uid, subjectId, sessionId) {
    const subject = db.prepare('SELECT 1 FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, uid);
    if (!subject) throw new Error('Materia no encontrada');
    if (sessionId) {
      const session = db.prepare('SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND subject_id = ?').get(sessionId, uid, subjectId);
      if (!session) throw new Error('La sesión no pertenece a esa materia');
    }
  }

  async function sha256Of(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  }

  async function register_(uid, { subjectId, sessionId, name, mime, size, inline, writeTo }) {
    await fsp.mkdir(userDir(uid), { recursive: true });
    const ext = extensionOf(name);
    const storedName = crypto.randomUUID() + (ext ? `.${ext}` : '');
    const dest = path.join(userDir(uid), storedName);
    try {
      await writeTo(dest);
      const hash = await sha256Of(dest);
      const result = db
        .prepare(
          `INSERT INTO attachments (user_id, subject_id, session_id, name, original_name, stored_name, mime, size, sha256, inline)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(uid, subjectId, sessionId || null, name, name, storedName, mime, size, hash, inline ? 1 : 0);
      return db.prepare(`SELECT ${columns} FROM attachments WHERE id = ?`).get(Number(result.lastInsertRowid));
    } catch (err) {
      await fsp.rm(dest, { force: true });
      throw err;
    }
  }

  async function addPaths(uid, { subjectId, sessionId, paths }) {
    checkTargets(uid, subjectId, sessionId);
    const added = [];
    const failed = [];
    for (const source of Array.isArray(paths) ? paths : []) {
      const name = path.basename(String(source));
      try {
        const stat = await fsp.stat(source);
        if (!stat.isFile()) throw new Error('No es un archivo');
        if (stat.size > MAX_BYTES) throw new Error(`Supera el máximo de ${MAX_BYTES / 1024 / 1024} MB`);
        if (stat.size === 0) throw new Error('El archivo está vacío');
        added.push(
          await register_(uid, {
            subjectId, sessionId, name, mime: mimeOf(name), size: stat.size, inline: false,
            writeTo: (dest) => fsp.copyFile(source, dest, fs.constants.COPYFILE_EXCL),
          })
        );
      } catch (err) {
        failed.push({ name, reason: err.code === 'ENOENT' ? 'No se encontró el archivo' : err.code === 'EACCES' ? 'No hay permiso para leer el archivo' : err.message });
      }
    }
    return { added, failed };
  }

  // ---------- protocol: studyfiles://file/<id> ----------

  protocol.handle('studyfiles', async (request) => {
    const notFound = () => new Response('Not found', { status: 404 });
    const uid = getUserId();
    const url = new URL(request.url);
    const id = Number(url.pathname.slice(1));
    if (uid === null || url.hostname !== 'file' || !Number.isInteger(id)) return notFound();
    const row = db.prepare('SELECT stored_name, mime FROM attachments WHERE id = ? AND user_id = ?').get(id, uid);
    if (!row || !STORED_NAME.test(row.stored_name)) return notFound();
    const file = path.join(userDir(uid), row.stored_name);
    if (!fs.existsSync(file)) return notFound();
    const res = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers, bypassCustomProtocolHandlers: true });
    const headers = new Headers(res.headers);
    headers.set('Content-Type', row.mime);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  });

  // ---------- ipc ----------

  ipcMain.handle('files:list', () => db.prepare(`SELECT ${columns} FROM attachments WHERE user_id = ? ORDER BY created_at DESC, id DESC`).all(requireUser()));

  ipcMain.handle('files:add-paths', (_e, args) => addPaths(requireUser(), args));

  ipcMain.handle('files:pick', async (e, { subjectId, sessionId }) => {
    const uid = requireUser();
    checkTargets(uid, subjectId, sessionId);
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win, { title: 'Agregar archivos', properties: ['openFile', 'multiSelections'] });
    if (picked.canceled || !picked.filePaths.length) return { added: [], failed: [], canceled: true };
    return addPaths(uid, { subjectId, sessionId, paths: picked.filePaths });
  });

  // Pasted or dropped images (they have no path on disk).
  ipcMain.handle('files:add-bytes', async (_e, { subjectId, sessionId, name, mime, bytes, inline }) => {
    const uid = requireUser();
    checkTargets(uid, subjectId, sessionId);
    const ext = EXT_BY_IMAGE_MIME[mime];
    if (!ext) throw new Error('Solo se pueden pegar imágenes PNG, JPG, GIF, WebP o BMP');
    const buffer = Buffer.from(bytes);
    if (!buffer.length) throw new Error('La imagen está vacía');
    if (buffer.length > MAX_PASTED_BYTES) throw new Error(`La imagen supera el máximo de ${MAX_PASTED_BYTES / 1024 / 1024} MB`);
    const safeName = `${String(name || 'imagen').replace(/[^\w .()-]/g, '').slice(0, 60) || 'imagen'}`.replace(/\.[a-z0-9]+$/i, '') + `.${ext}`;
    return register_(uid, {
      subjectId, sessionId, name: safeName, mime, size: buffer.length, inline: !!inline,
      writeTo: (dest) => fsp.writeFile(dest, buffer, { flag: 'wx' }),
    });
  });

  ipcMain.handle('files:update', (_e, { id, name, sessionId }) => {
    const uid = requireUser();
    const row = rowFor(uid, id);
    const newName = String(name || '').trim();
    if (!newName) throw new Error('Escribí un nombre');
    checkTargets(uid, row.subject_id, sessionId || null);
    db.prepare('UPDATE attachments SET name = ?, session_id = ? WHERE id = ? AND user_id = ?').run(newName.slice(0, 200), sessionId || null, id, uid);
  });

  ipcMain.handle('files:delete', async (_e, id) => {
    const uid = requireUser();
    const row = rowFor(uid, id);
    db.prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?').run(id, uid);
    if (STORED_NAME.test(row.stored_name)) await fsp.rm(path.join(userDir(uid), row.stored_name), { force: true });
  });

  ipcMain.handle('files:open', async (_e, id) => {
    const uid = requireUser();
    const row = rowFor(uid, id);
    const file = path.join(userDir(uid), row.stored_name);
    if (!fs.existsSync(file)) throw new Error('El archivo ya no está en el disco');
    if (SAFE_TO_OPEN.has(extensionOf(row.original_name))) {
      const error = await shell.openPath(file);
      if (error) throw new Error(`No se pudo abrir el archivo: ${error}`);
      return { opened: true };
    }
    shell.showItemInFolder(file); // not a known-safe type: show it instead of running it
    return { opened: false };
  });

  ipcMain.handle('files:reveal', (_e, id) => {
    const uid = requireUser();
    shell.showItemInFolder(path.join(userDir(uid), rowFor(uid, id).stored_name));
  });

  ipcMain.handle('files:save-as', async (e, id) => {
    const uid = requireUser();
    const row = rowFor(uid, id);
    const win = BrowserWindow.fromWebContents(e.sender);
    const target = await dialog.showSaveDialog(win, { title: 'Guardar una copia', defaultPath: row.name });
    if (target.canceled || !target.filePath) return { saved: false };
    await fsp.copyFile(path.join(userDir(uid), row.stored_name), target.filePath);
    return { saved: true };
  });

  // Deletes files on disk that no database row points to (after cascades, crashes or restored backups).
  function sweepUser(uid) {
    const dir = userDir(uid);
    if (!fs.existsSync(dir)) return;
    const known = new Set(db.prepare('SELECT stored_name FROM attachments WHERE user_id = ?').all(uid).map((r) => r.stored_name));
    for (const file of fs.readdirSync(dir)) {
      if (STORED_NAME.test(file) && !known.has(file)) fs.rmSync(path.join(dir, file), { force: true });
    }
  }

  function sweepAll() {
    if (!fs.existsSync(filesRoot())) return;
    const users = new Set(db.prepare('SELECT id FROM users').all().map((u) => String(u.id)));
    for (const entry of fs.readdirSync(filesRoot())) {
      if (users.has(entry)) sweepUser(Number(entry));
      else if (/^\d+$/.test(entry)) fs.rmSync(path.join(filesRoot(), entry), { recursive: true, force: true }); // user no longer exists
    }
  }

  return { sweepUser, sweepAll, filesRoot };
}

const isSafeToOpen = (name) => SAFE_TO_OPEN.has(extensionOf(name));

module.exports = { register, MAX_BYTES, isSafeToOpen, mimeOf, STORED_NAME };
