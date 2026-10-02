const { app, BrowserWindow, ipcMain } = require('electron');
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
  `);
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
      `SELECT id, subject_id AS subjectId, date, hours, topic, position, notes
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
    const notes = String(s.notes || '');
    if (s.id) {
      db.prepare('UPDATE sessions SET date = ?, hours = ?, topic = ?, position = ?, notes = ? WHERE id = ? AND user_id = ?')
        .run(s.date, hours, topic, position, notes, s.id, uid);
      return s.id;
    }
    const owned = db.prepare('SELECT 1 FROM subjects WHERE id = ? AND user_id = ?').get(s.subjectId, uid);
    if (!owned) throw new Error('Subject not found');
    const r = db.prepare('INSERT INTO sessions (user_id, subject_id, date, hours, topic, position, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, s.subjectId, s.date, hours, topic, position, notes);
    return Number(r.lastInsertRowid);
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
