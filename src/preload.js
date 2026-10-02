const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('api', {
  listUsers: call('users:list'),
  createUser: call('users:create'),
  login: call('users:login'),
  logout: call('users:logout'),
  listSubjects: call('subjects:list'),
  saveSubject: call('subjects:save'),
  deleteSubject: call('subjects:delete'),
  listSessions: call('sessions:list'),
  saveSession: call('sessions:save'),
  deleteSession: call('sessions:delete'),
  listNotes: call('notes:list'),
  saveNote: call('notes:save'),
  deleteNote: call('notes:delete'),
  getActive: call('active:get'),
  saveActive: call('active:save'),
  clearActive: call('active:clear'),
});
