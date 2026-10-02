const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  close: () => ipcRenderer.send('widget:close'),
  setAlwaysOnTop: (enabled) => ipcRenderer.send('widget:toggle-always-on-top', enabled),
  setIgnoreMouseEvents: (ignore, forward) => ipcRenderer.send('widget:set-ignore-mouse-events', ignore, forward),
  loadTasks: () => ipcRenderer.invoke('tasks:load'),
  saveTasks: (tasks) => ipcRenderer.send('tasks:save', tasks),
  getDropboxStatus: () => ipcRenderer.invoke('dropbox:status'),
  connectDropbox: () => ipcRenderer.invoke('dropbox:connect'),
  disconnectDropbox: () => ipcRenderer.invoke('dropbox:disconnect'),
  onTasksChanged: (callback) => ipcRenderer.on('tasks:changed', (_event, tasks) => callback(tasks))
});
