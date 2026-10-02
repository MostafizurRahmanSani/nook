const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// Without this, Windows attributes notifications (and other OS-level identity) to the
// default "Electron" app name instead of Nook.
app.setName('Nook');
if (process.platform === 'win32') app.setAppUserModelId('com.nook.widget');

// Transparent windows can corrupt GPU-accelerated glyph rasterization on Windows (certain
// characters render compressed/garbled). Disabling hardware acceleration forces software
// rendering, which handles a transparent BrowserWindow's text correctly.
app.disableHardwareAcceleration();

let widgetWindow;
let tray = null;
let isQuitting = false;

// No project icon asset exists, so the tray icon is drawn at runtime: a small solid-color
// square PNG built by hand (just PNG chunk framing + zlib deflate, no image library needed).
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createSolidIcon(size, [r, g, b, a]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA

  const rowLength = size * 4;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (rowLength + 1);
    for (let x = 0; x < size; x += 1) {
      const px = rowStart + 1 + x * 4;
      raw[px] = r; raw[px + 1] = g; raw[px + 2] = b; raw[px + 3] = a;
    }
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function createTray() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH)
    : nativeImage.createFromBuffer(createSolidIcon(32, [231, 127, 104, 255]));
  tray = new Tray(icon);
  tray.setToolTip('Nook');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Nook', click: () => widgetWindow?.show() },
    { type: 'separator' },
    { label: 'Quit Nook', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => {
    if (widgetWindow?.isVisible()) widgetWindow.hide();
    else widgetWindow?.show();
  });
}

// Tasks live in a JSON file instead of localStorage, so they can be pointed at any folder
// a cloud-sync client (Google Drive, OneDrive, Dropbox…) already mirrors across devices.
// Which folder to use is remembered in a small config file in Electron's own userData dir.
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_TASKS_PATH = path.join(app.getPath('userData'), 'tasks.json');
const TASKS_FILENAME = 'calendar-widget-tasks.json';
let fileWatcher = null;

// The app was renamed (package.json "calendar-widget" -> "Nook"), which moves Electron's
// default userData folder. Carry over any config/tasks saved under the old folder name so
// an already-chosen sync folder doesn't silently disappear.
function migrateFromOldUserDataDir() {
  if (fs.existsSync(CONFIG_PATH)) return;
  const oldDir = path.join(path.dirname(app.getPath('userData')), 'calendar-widget');
  const oldConfig = path.join(oldDir, 'config.json');
  const oldTasks = path.join(oldDir, 'tasks.json');
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    if (fs.existsSync(oldConfig)) fs.copyFileSync(oldConfig, CONFIG_PATH);
    if (fs.existsSync(oldTasks) && !fs.existsSync(DEFAULT_TASKS_PATH)) fs.copyFileSync(oldTasks, DEFAULT_TASKS_PATH);
  } catch {
    // Nothing to migrate, or no old install existed — fine either way.
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
  } catch (err) {
    console.error('Could not save sync config', err);
  }
}

function tasksFilePath() {
  const { syncFolder } = readConfig();
  return syncFolder ? path.join(syncFolder, TASKS_FILENAME) : DEFAULT_TASKS_PATH;
}

function loadTasksFromDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(tasksFilePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTasksToDisk(tasks) {
  try {
    fs.writeFileSync(tasksFilePath(), JSON.stringify(tasks));
  } catch (err) {
    console.error('Could not save tasks', err);
  }
}

function watchTasksFile() {
  fileWatcher?.close();
  fileWatcher = null;
  try {
    fileWatcher = fs.watch(tasksFilePath(), { persistent: false }, () => {
      widgetWindow?.webContents.send('tasks:changed', loadTasksFromDisk());
    });
  } catch {
    // Target file doesn't exist yet — nothing to watch until the first save creates it.
  }
}

// The window itself never resizes (that was corrupting the transparent compositor on
// Windows). It's created once at the size of the widest state (task panel open), anchored
// top-right, and sits permanently there; the visible card grows/shrinks purely via CSS
// inside it. The leftover transparent margin is made click-through in renderer.js.
const WINDOW_WIDTH = 730;
const WINDOW_HEIGHT = 340;
const ICON_PATH = path.join(__dirname, 'icon.ico');

function createWidget() {
  const { workArea } = screen.getPrimaryDisplay();
  widgetWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    resizable: false,
    x: workArea.x + workArea.width - WINDOW_WIDTH - 24,
    y: workArea.y + 28,
    frame: false,
    icon: ICON_PATH,
    alwaysOnTop: false,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  widgetWindow.loadFile('index.html');
  // Keeps the window hidden until the first paint is ready, instead of showing a blank
  // frame while content loads — avoids the "hang" look on startup.
  widgetWindow.once('ready-to-show', () => widgetWindow?.show());

  // There's no minimize affordance by design — only moving or closing the widget should
  // make it go away. If something minimizes it anyway (e.g. Win+D "show desktop"), pop it
  // straight back so it always stays visible on the desktop.
  widgetWindow.on('minimize', () => widgetWindow?.restore());

  // The × button minimizes to the tray instead of quitting; only the tray's "Quit" truly closes it.
  widgetWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    widgetWindow.hide();
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
}

app.whenReady().then(() => {
  migrateFromOldUserDataDir();
  createWidget();
  createTray();

  // Autostart on Windows login. In dev (`npm start`) this launches the bare electron.exe,
  // which needs the app folder passed as an argument; a packaged build just needs its own exe.
  app.setLoginItemSettings(
    app.isPackaged
      ? { openAtLogin: true }
      : { openAtLogin: true, path: process.execPath, args: [path.resolve(__dirname)] }
  );

  ipcMain.on('widget:close', () => widgetWindow?.close());
  ipcMain.on('widget:toggle-always-on-top', (_event, enabled) => {
    widgetWindow?.setAlwaysOnTop(enabled, enabled ? 'floating' : 'normal');
  });
  ipcMain.on('widget:set-ignore-mouse-events', (_event, ignore, forward) => {
    widgetWindow?.setIgnoreMouseEvents(ignore, { forward });
  });

  ipcMain.handle('tasks:load', () => loadTasksFromDisk());
  ipcMain.on('tasks:save', (_event, tasks) => saveTasksToDisk(tasks));
  ipcMain.handle('tasks:get-sync-info', () => ({ folder: readConfig().syncFolder || null }));
  ipcMain.handle('tasks:choose-folder', async (_event, currentTasks) => {
    const result = await dialog.showOpenDialog(widgetWindow, {
      properties: ['openDirectory'],
      title: 'Choose a synced folder (Google Drive, OneDrive, Dropbox…)'
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const folder = result.filePaths[0];
    writeConfig({ syncFolder: folder });
    const target = path.join(folder, TASKS_FILENAME);
    const existing = fs.existsSync(target);
    const tasks = existing ? loadTasksFromDisk() : (currentTasks || []);
    if (!existing) saveTasksToDisk(tasks);
    watchTasksFile();
    return { folder, tasks };
  });

  watchTasksFile();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWidget();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
