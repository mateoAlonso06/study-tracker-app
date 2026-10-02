const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

let db;
let currentUserId = null;

function initDb() {
  db = new DatabaseSync(path.join(app.getPath('userData'), 'study-tracker.db'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      pass_hash TEXT,
      salt TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      weekly_goal_hours REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      hours REAL NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(subject_id, date);
    CREATE TABLE IF NOT EXISTS active_sessions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);
  `);
  migrate();
}

function migrate() {
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!cols.includes('started_at')) db.exec('ALTER TABLE sessions ADD COLUMN started_at TEXT');
  if (!cols.includes('pomodoros')) db.exec('ALTER TABLE sessions ADD COLUMN pomodoros INTEGER NOT NULL DEFAULT 0');
  migrateLegacyNotes();
}

// Notes used to live in sessions.notes. Move them into the notes table (idempotent: the column is cleared).
function migrateLegacyNotes() {
  const rows = db.prepare("SELECT id, user_id, subject_id, topic, notes, created_at FROM sessions WHERE notes <> ''").all();
  if (!rows.length) return;
  const insert = db.prepare(
    'INSERT INTO notes (user_id, subject_id, session_id, title, content, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const clear = db.prepare("UPDATE sessions SET notes = '' WHERE id = ?");
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      insert.run(r.user_id, r.subject_id, r.id, r.topic, r.notes, plainText(r.notes), r.created_at, r.created_at);
      clear.run(r.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function plainText(content) {
  if (!/^\s*</.test(content)) return content;
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function requireUser() {
  if (currentUserId === null) throw new Error('Not signed in');
  return currentUserId;
}

function registerIpc() {
  ipcMain.handle('users:list', () =>
    db.prepare('SELECT id, name, pass_hash IS NOT NULL AS hasPassword FROM users ORDER BY name').all()
      .map((u) => ({ id: u.id, name: u.name, hasPassword: !!u.hasPassword }))
  );

  ipcMain.handle('users:create', (_e, { name, password }) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Enter a name');
    let salt = null;
    let hash = null;
    if (password) {
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(password, salt);
    }
    try {
      const r = db.prepare('INSERT INTO users (name, pass_hash, salt) VALUES (?, ?, ?)').run(cleanName, hash, salt);
      currentUserId = Number(r.lastInsertRowid);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new Error('That name is already taken');
      throw err;
    }
    return { id: currentUserId, name: cleanName };
  });

  ipcMain.handle('users:login', (_e, { id, password }) => {
    const u = db.prepare('SELECT id, name, pass_hash, salt FROM users WHERE id = ?').get(id);
    if (!u) throw new Error('Profile not found');
    if (u.pass_hash) {
      const given = Buffer.from(hashPassword(password || '', u.salt), 'hex');
      const stored = Buffer.from(u.pass_hash, 'hex');
      if (!crypto.timingSafeEqual(given, stored)) throw new Error('Wrong password');
    }
    currentUserId = u.id;
    return { id: u.id, name: u.name };
  });

  ipcMain.handle('users:logout', () => {
    currentUserId = null;
  });

  ipcMain.handle('subjects:list', () =>
    db.prepare('SELECT id, name, weekly_goal_hours AS weeklyGoal FROM subjects WHERE user_id = ? ORDER BY name').all(requireUser())
  );

  ipcMain.handle('subjects:save', (_e, s) => {
    const uid = requireUser();
    const name = String(s.name || '').trim();
    if (!name) throw new Error('Enter a subject name');
    const goal = Math.max(0, Number(s.weeklyGoal) || 0);
    if (s.id) {
      db.prepare('UPDATE subjects SET name = ?, weekly_goal_hours = ? WHERE id = ? AND user_id = ?').run(name, goal, s.id, uid);
      return s.id;
    }
    const r = db.prepare('INSERT INTO subjects (user_id, name, weekly_goal_hours) VALUES (?, ?, ?)').run(uid, name, goal);
    return Number(r.lastInsertRowid);
  });

  ipcMain.handle('subjects:delete', (_e, id) => {
    db.prepare('DELETE FROM subjects WHERE id = ? AND user_id = ?').run(id, requireUser());
  });

  ipcMain.handle('sessions:list', () =>
    db.prepare(
      `SELECT id, subject_id AS subjectId, date, hours, topic, position, started_at AS startedAt, pomodoros
       FROM sessions WHERE user_id = ? ORDER BY date DESC, id DESC`
    ).all(requireUser())
  );

  ipcMain.handle('sessions:save', (_e, s) => {
    const uid = requireUser();
    const hours = Number(s.hours);
    if (!(hours > 0)) throw new Error('Hours must be greater than 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) throw new Error('Invalid date');
    const topic = String(s.topic || '').trim();
    const position = String(s.position || '').trim();
    if (s.id) {
      db.prepare('UPDATE sessions SET date = ?, hours = ?, topic = ?, position = ? WHERE id = ? AND user_id = ?')
        .run(s.date, hours, topic, position, s.id, uid);
      return s.id;
    }
    const owned = db.prepare('SELECT 1 FROM subjects WHERE id = ? AND user_id = ?').get(s.subjectId, uid);
    if (!owned) throw new Error('Subject not found');
    db.exec('BEGIN');
    try {
      const r = db.prepare(
        'INSERT INTO sessions (user_id, subject_id, date, hours, topic, position, started_at, pomodoros) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uid, s.subjectId, s.date, hours, topic, position, s.startedAt || null, Math.max(0, Number(s.pomodoros) || 0));
      const sessionId = Number(r.lastInsertRowid);
      if (s.note && s.note.content) {
        db.prepare('INSERT INTO notes (user_id, subject_id, session_id, title, content, text) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uid, s.subjectId, sessionId, String(s.note.title || '').trim(), String(s.note.content), String(s.note.text || ''));
      }
      db.exec('COMMIT');
      return sessionId;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  ipcMain.handle('notes:list', () =>
    db.prepare(
      `SELECT id, subject_id AS subjectId, session_id AS sessionId, title, content, text,
              created_at AS createdAt, updated_at AS updatedAt
       FROM notes WHERE user_id = ? ORDER BY created_at DESC, id DESC`
    ).all(requireUser())
  );

  ipcMain.handle('notes:save', (_e, n) => {
    const uid = requireUser();
    const title = String(n.title || '').trim();
    const content = String(n.content || '');
    if (!title && !content) throw new Error('Write a title or some content');
    const subject = db.prepare('SELECT 1 FROM subjects WHERE id = ? AND user_id = ?').get(n.subjectId, uid);
    if (!subject) throw new Error('Subject not found');
    let sessionId = null;
    if (n.sessionId) {
      const session = db.prepare('SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND subject_id = ?').get(n.sessionId, uid, n.subjectId);
      if (!session) throw new Error('Session does not belong to that subject');
      sessionId = n.sessionId;
    }
    const text = String(n.text || '');
    if (n.id) {
      db.prepare(
        `UPDATE notes SET subject_id = ?, session_id = ?, title = ?, content = ?, text = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      ).run(n.subjectId, sessionId, title, content, text, n.id, uid);
      return n.id;
    }
    const r = db.prepare('INSERT INTO notes (user_id, subject_id, session_id, title, content, text) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, n.subjectId, sessionId, title, content, text);
    return Number(r.lastInsertRowid);
  });

  ipcMain.handle('notes:delete', (_e, id) => {
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, requireUser());
  });

  ipcMain.handle('active:get', () => {
    const row = db.prepare('SELECT subject_id, data FROM active_sessions WHERE user_id = ?').get(requireUser());
    return row ? { ...JSON.parse(row.data), subjectId: row.subject_id } : null;
  });

  ipcMain.handle('active:save', (_e, a) => {
    const uid = requireUser();
    const owned = db.prepare('SELECT 1 FROM subjects WHERE id = ? AND user_id = ?').get(a.subjectId, uid);
    if (!owned) throw new Error('Subject not found');
    db.prepare(
      `INSERT INTO active_sessions (user_id, subject_id, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET subject_id = excluded.subject_id, data = excluded.data, updated_at = CURRENT_TIMESTAMP`
    ).run(uid, a.subjectId, JSON.stringify(a));
  });

  ipcMain.handle('active:clear', () => {
    db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(requireUser());
  });

  ipcMain.handle('sessions:delete', (_e, id) => {
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, requireUser());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'Study tracker',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  initDb();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
