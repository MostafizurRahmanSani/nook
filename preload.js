const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  close: () => ipcRenderer.send('widget:close'),
  setAlwaysOnTop: (enabled) => ipcRenderer.send('widget:toggle-always-on-top', enabled),
  setIgnoreMouseEvents: (ignore, forward) => ipcRenderer.send('widget:set-ignore-mouse-events', ignore, forward),
  loadTasks: () => ipcRenderer.invoke('tasks:load'),
  saveTasks: (tasks) => ipcRenderer.send('tasks:save', tasks),
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  chooseSyncFolder: (currentTasks) => ipcRenderer.invoke('folder:choose', currentTasks),
  disconnectFolder: () => ipcRenderer.invoke('folder:disconnect'),
  connectDropbox: () => ipcRenderer.invoke('dropbox:connect'),
  disconnectDropbox: () => ipcRenderer.invoke('dropbox:disconnect'),
  onSyncAsk: (callback) => ipcRenderer.on('sync:ask', (_event, info) => callback(info)),
  answerSyncAsk: (choice) => ipcRenderer.send('sync:choice', choice),
  onTasksChanged: (callback) => ipcRenderer.on('tasks:changed', (_event, tasks) => callback(tasks))
});
