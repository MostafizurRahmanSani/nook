const { app, BrowserWindow, ipcMain, screen, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const http = require('http');
const crypto = require('crypto');

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
    { label: 'Connect Dropbox…', click: () => connectDropbox() },
    { label: 'Disconnect Dropbox', click: () => disconnectDropbox() },
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
  scheduleDropboxPush(tasks);
}

// Optional Dropbox sync. The token is read from DROPBOX_TOKEN (a .env file next to main.js,
// or the real environment). Without a token none of this runs and the app stays local-only.
// Last writer wins: whichever side (local file vs Dropbox copy) was modified later is kept.
function readEnv(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const line = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
      .split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

// Credentials, in order of preference:
//  1. "Connect Dropbox…" in the tray menu — a one-time browser login (OAuth + PKCE, no app
//     secret needed) whose refresh token is kept in config.json in the app's own data folder.
//     This is what the installed app uses; nothing sensitive ships in the installer.
//  2. DROPBOX_REFRESH_TOKEN + DROPBOX_APP_SECRET from .env (handy when running from source).
//  3. A plain DROPBOX_TOKEN from .env, which expires after a few hours.
const DROPBOX_TOKEN = readEnv('DROPBOX_TOKEN');
const DROPBOX_APP_KEY = readEnv('DROPBOX_APP_KEY') || 'hnwlo24w1z70zma'; // public identifier, not a secret
const DROPBOX_APP_SECRET = readEnv('DROPBOX_APP_SECRET');
const ENV_REFRESH_TOKEN = readEnv('DROPBOX_REFRESH_TOKEN');
const DROPBOX_REDIRECT_PORT = 53682;
const DROPBOX_REDIRECT_URI = `http://localhost:${DROPBOX_REDIRECT_PORT}/callback`;
let accessToken = { value: '', expiresAt: 0 };

function hasDropbox() {
  const config = readConfig();
  // "Disconnect" must also switch off the .env credentials used when running from source.
  if (config.dropboxDisabled) return false;
  return Boolean(config.dropboxRefreshToken || (ENV_REFRESH_TOKEN && DROPBOX_APP_SECRET) || DROPBOX_TOKEN);
}

async function dropboxTokenRequest(params, useSecret = false) {
  const headers = useSecret
    ? { Authorization: `Basic ${Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64')}` }
    : {};
  const body = new URLSearchParams(useSecret ? params : { client_id: DROPBOX_APP_KEY, ...params });
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Dropbox token request failed: HTTP ${res.status}`);
  return res.json();
}

function rememberAccessToken(data) {
  // Renew a minute early so a token never expires mid-request.
  accessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return accessToken.value;
}

async function getDropboxToken() {
  if (accessToken.value && Date.now() < accessToken.expiresAt) return accessToken.value;
  const { dropboxRefreshToken } = readConfig();
  if (dropboxRefreshToken) {    return rememberAccessToken(await dropboxTokenRequest({ grant_type: 'refresh_token', refresh_token: dropboxRefreshToken }));
  }
  if (ENV_REFRESH_TOKEN && DROPBOX_APP_SECRET) {
    return rememberAccessToken(await dropboxTokenRequest({ grant_type: 'refresh_token', refresh_token: ENV_REFRESH_TOKEN }, true));
  }
  return DROPBOX_TOKEN;
}

let connectServer = null;

// Resolves true once the login completes, false if it fails, is denied, is abandoned or the
// user cancels the choice. The choice is asked first, before the browser opens.
let dropboxConnecting = false;

// Plain-text trail of the connect steps, kept in the app's data folder for troubleshooting.
function logSync(message) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'sync.log'), `${new Date().toISOString()} ${message}
`);
  } catch {
    // Logging must never break syncing.
  }
}

async function connectDropbox() {
  const choice = await askSyncChoice('Dropbox');
  logSync(`dropbox connect: choice=${choice}`);
  if (!choice) return false;
  dropboxConnecting = true; // keep the background sync from overriding the choice mid-connect
  const connected = await new Promise((resolve) => startDropboxLogin(resolve));
  logSync(`dropbox login connected=${connected}`);
  if (!connected) { dropboxConnecting = false; return false; }
  try {
    const local = loadTasksFromDisk();
    const remote = await dropboxDownload();
    const resolved = remote ? applySyncChoice(choice, local, remote.tasks) : local;
    logSync(`local=${local.length} remote=${remote ? remote.tasks.length : 'none'} resolved=${resolved.length}`);
    fs.writeFileSync(tasksFilePath(), JSON.stringify(resolved));
    await dropboxUpload(resolved);
    widgetWindow?.webContents.send('tasks:changed', resolved);
    logSync('uploaded ok');
  } catch (err) {
    logSync(`failed: ${err.message}`);
    console.error(err.message);
    dialog.showErrorBox('Dropbox', `Connected, but syncing your tasks failed: ${err.message}`);
  }
  dropboxConnecting = false;
  return true;
}

// Asks (in the widget) what to do if the cloud already holds tasks. Resolves to
// 'merge' | 'rewrite' | 'cloud', or null if the user cancelled.
function askSyncChoice(cloudName) {
  return new Promise((resolve) => {
    ipcMain.once('sync:choice', (_event, picked) => resolve(picked));
    widgetWindow.webContents.send('sync:ask', { cloudName });
  });
}

function applySyncChoice(choice, local, cloud) {
  if (choice === 'merge') {
    const seen = new Set(cloud.map((task) => task.id));
    return [...cloud, ...local.filter((task) => !seen.has(task.id))];
  }
  return choice === 'cloud' ? cloud : local;
}

function startDropboxLogin(done) {
  connectServer?.close();
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authUrl = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: DROPBOX_REDIRECT_URI
  });

  let connected = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, DROPBOX_REDIRECT_URI);
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const code = url.searchParams.get('code');
    try {
      if (!code) throw new Error(url.searchParams.get('error_description') || 'Authorization was denied.');
      const data = await dropboxTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: DROPBOX_REDIRECT_URI
      });
      const { dropboxDisabled, ...config } = readConfig();
      writeConfig({ ...config, dropboxRefreshToken: data.refresh_token });
      rememberAccessToken(data);
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h3>Nook is connected to Dropbox. You can close this tab.</h3>');
      connected = true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`Could not connect: ${err.message}`);
      dialog.showErrorBox('Dropbox', `Could not connect: ${err.message}`);
    }
    server.close();
  });
  server.on('error', (err) => {
    dialog.showErrorBox('Dropbox', `Could not start the login helper: ${err.message}`);
    done(false);
  });
  server.on('close', () => {
    if (connectServer === server) connectServer = null;
    done(connected);
  });
  server.listen(DROPBOX_REDIRECT_PORT, '127.0.0.1', () => shell.openExternal(authUrl));
  connectServer = server;
  setTimeout(() => server.close(), 5 * 60 * 1000); // give up if the login is abandoned
}

function disconnectDropbox() {
  const { dropboxRefreshToken, ...rest } = readConfig();
  writeConfig({ ...rest, dropboxDisabled: true });
  accessToken = { value: '', expiresAt: 0 };
  dropboxRev = null;
}

const DROPBOX_FILE = `/${TASKS_FILENAME}`;
const DROPBOX_POLL_MS = 60 * 1000;
const DROPBOX_PUSH_DELAY_MS = 2000;
let dropboxRev = null;
let dropboxPushTimer = null;

async function dropboxDownload() {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getDropboxToken()}`,
      'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_FILE })
    }
  });
  if (res.status === 409) return null; // file doesn't exist on Dropbox yet
  if (!res.ok) throw new Error(`Dropbox download failed: HTTP ${res.status}`);
  const meta = JSON.parse(res.headers.get('dropbox-api-result'));
  const parsed = JSON.parse(await res.text());
  return { tasks: Array.isArray(parsed) ? parsed : [], rev: meta.rev, modified: Date.parse(meta.server_modified) };
}

async function dropboxUpload(tasks) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getDropboxToken()}`,
      'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_FILE, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream'
    },
    body: JSON.stringify(tasks)
  });
  if (!res.ok) throw new Error(`Dropbox upload failed: HTTP ${res.status}`);
  dropboxRev = (await res.json()).rev;
}

function scheduleDropboxPush(tasks) {
  if (!hasDropbox()) return;
  clearTimeout(dropboxPushTimer);
  dropboxPushTimer = setTimeout(() => {
    dropboxPushTimer = null;
    dropboxUpload(tasks).catch((err) => console.error(err.message));
  }, DROPBOX_PUSH_DELAY_MS);
}

async function syncWithDropbox() {
  if (!hasDropbox() || dropboxConnecting || dropboxPushTimer) return; // a local edit is about to be pushed anyway
  try {
    const remote = await dropboxDownload();
    const localPath = tasksFilePath();
    const localExists = fs.existsSync(localPath);
    if (!remote) {
      if (localExists) await dropboxUpload(loadTasksFromDisk());
      return;
    }
    if (remote.rev === dropboxRev) return; // nothing changed since our last sync
    const localModified = localExists ? fs.statSync(localPath).mtimeMs : 0;
    if (remote.modified > localModified) {
      fs.writeFileSync(localPath, JSON.stringify(remote.tasks));
      dropboxRev = remote.rev;
      widgetWindow?.webContents.send('tasks:changed', remote.tasks);
    } else {
      await dropboxUpload(loadTasksFromDisk());
    }
  } catch (err) {
    console.error(err.message);
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
    x: workArea.x + workArea.width - WINDOW_WIDTH,
    y: workArea.y,
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
  // The ☁ button: connect Nook to Dropbox, or disconnect again.
  // The ☁ button offers two independent ways to sync: Dropbox, and a folder that another
  // client (Google Drive, OneDrive…) already mirrors. Either, both or neither can be active.
  ipcMain.handle('sync:status', () => ({ dropbox: hasDropbox(), folder: readConfig().syncFolder || null }));
  ipcMain.handle('folder:choose', async (_event, currentTasks) => {
    const choice = await askSyncChoice('This folder');
    if (!choice) return null;
    const result = await dialog.showOpenDialog(widgetWindow, {
      properties: ['openDirectory'],
      title: 'Choose a synced folder (Google Drive, OneDrive, Dropbox…)'
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const folder = result.filePaths[0];
    let cloud = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(folder, TASKS_FILENAME), 'utf8'));
      if (Array.isArray(parsed)) cloud = parsed;
    } catch {
      // No tasks file in that folder yet.
    }
    const tasks = cloud ? applySyncChoice(choice, currentTasks || [], cloud) : (currentTasks || []);
    writeConfig({ ...readConfig(), syncFolder: folder });
    saveTasksToDisk(tasks);
    watchTasksFile();
    return { folder, tasks };
  });
  ipcMain.handle('folder:disconnect', () => {
    // Keep the tasks: copy them back to the app's own data folder before dropping the folder.
    const tasks = loadTasksFromDisk();
    const { syncFolder, ...rest } = readConfig();
    writeConfig(rest);
    try {
      fs.writeFileSync(DEFAULT_TASKS_PATH, JSON.stringify(tasks));
    } catch (err) {
      console.error('Could not keep tasks after disconnecting the folder', err);
    }
    watchTasksFile();
    return tasks;
  });
  ipcMain.handle('dropbox:connect', () => connectDropbox());
  ipcMain.handle('dropbox:disconnect', () => {
    disconnectDropbox();
    return hasDropbox();
  });

  watchTasksFile();

  syncWithDropbox();
  setInterval(syncWithDropbox, DROPBOX_POLL_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWidget();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Windows keeps a tray icon on screen until the owning app removes it, so quitting without
// this leaves a dead "ghost" icon behind that only disappears when the mouse hovers over it.
app.on('before-quit', () => {
  isQuitting = true;
  tray?.destroy();
  tray = null;
});
