const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, shell, dialog } = require('electron');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');
const http         = require('http');
const { spawn }    = require('child_process');

const animepahe  = require('./animepahe');
const kwik       = require('./kwik');
const downloader = require('./downloader');

let mainWindow;

// ─── Error logging ─────────────────────────────────────────────────────────────
function logError(error, context = '') {
  const timestamp    = new Date().toISOString();
  const errorMessage = `[${timestamp}] ${context ? context + ': ' : ''}${error.message || error}\n${error.stack || ''}\n`;
  const logPath      = path.join(app.getPath('userData'), 'error.log');
  try { fs.appendFileSync(logPath, errorMessage, 'utf8'); } catch (_) {}
  console.error(errorMessage);
  return errorMessage;
}

// ─── Structured logger (sent to renderer + error.log) ─────────────────────────
function appLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-log', line);
  }
}

// ─── Broadcast State ───────────────────────────────────────────────────────────
function setAppStatus(state) {
  // state: 'starting', 'solving', 'ready', 'error'
  appLog(`[AppStatus] -> ${state}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('flaresolverr-state', state);
  }
}

// Expose loggers to modules
animepahe.setLogger(appLog);
kwik.setLogger(appLog);
downloader.setLogger(appLog);

// ─── Global error handlers ─────────────────────────────────────────────────────
process.on('uncaughtException',   (e)    => logError(e, 'Uncaught Exception'));
process.on('unhandledRejection',  (r)    => logError(r instanceof Error ? r : new Error(String(r)), 'Unhandled Rejection'));

// ─── FlareSolverr auto-launcher ────────────────────────────────────────────────
let _fsProc      = null;
let _fsReady     = false;

const FS_EXE = path.join(__dirname, 'flaresolverr_bin', 'flaresolverr.exe');
const FS_URL = 'http://127.0.0.1:8191/';

function isFsRunning() {
  return new Promise((resolve) => {
    http.get(FS_URL, { timeout: 2000 }, () => resolve(true)).on('error', () => resolve(false));
  });
}

async function startFlareSolverr() {
  // 1. Check for valid cached cookies first
  if (animepahe.hasValidCookies()) {
    appLog('[FlareSolverr] Valid persistent cookies found. Skipping pre-emptive solve.');
    _fsReady = true;
    setAppStatus('ready');
    return true;
  }

  setAppStatus('starting');

  // 2. Start FlareSolverr if not running
  if (!await isFsRunning()) {
    if (!fs.existsSync(FS_EXE)) {
      appLog(`[FlareSolverr] exe not found at: ${FS_EXE}`);
      setAppStatus('error');
      return false;
    }
    appLog('[FlareSolverr] Starting bundled process...');
    try {
      _fsProc = spawn(
        FS_EXE,
        ['--max-timeout', '180000'],
        {
          cwd:         path.dirname(FS_EXE),
          detached:    false,
          windowsHide: true,
          stdio:       ['ignore', 'pipe', 'pipe']
        }
      );
      _fsProc.stdout.on('data', d => appLog(`[FlareSolverr stdout] ${d.toString().trim()}`));
      _fsProc.stderr.on('data', d => appLog(`[FlareSolverr stderr] ${d.toString().trim()}`));
      _fsProc.on('error', (e) => { appLog(`[FlareSolverr] Spawn error: ${e.message}`); setAppStatus('error'); });
      _fsProc.on('exit',  (c) => { appLog(`[FlareSolverr] Exited (code ${c})`); _fsReady = false; });
    } catch (e) {
      appLog(`[FlareSolverr] Failed to spawn: ${e.message}`);
      setAppStatus('error');
      return false;
    }
  }

  // 3. Wait for FlareSolverr to bind port 8191
  appLog('[FlareSolverr] Waiting for :8191 to become ready (up to 60 s)...');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isFsRunning()) {
      ready = true;
      break;
    }
    if (i > 0 && i % 20 === 0) appLog(`[FlareSolverr] Still waiting... (${(i * 0.5).toFixed(0)}s elapsed)`);
  }

  if (!ready) {
    appLog('[FlareSolverr] Did not become ready in 60 s');
    setAppStatus('error');
    return false;
  }

  _fsReady = true;
  appLog('[FlareSolverr] Ready on :8191 ✓');

  // 4. Pre-emptive solve Cloudflare
  setAppStatus('solving');
  try {
    await animepahe.preEmptiveSolve();
    appLog('[FlareSolverr] Pre-emptive solve successful!');
    setAppStatus('ready');
    return true;
  } catch (e) {
    appLog(`[FlareSolverr] Pre-emptive solve failed: ${e.message}`);
    setAppStatus('error');
    return false;
  }
}

function killFlareSolverr() {
  if (_fsProc) {
    try { _fsProc.kill(); } catch (_) {}
    _fsProc  = null;
    _fsReady = false;
    appLog('[FlareSolverr] Killed');
  }
}

// ─── Window creation ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets', 'adbg.png'),
    title: 'AnimeDownloader',
    backgroundColor: '#2563EB',
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
  mainWindow.maximize();
  mainWindow.show();

  // Disable Ctrl+R refresh
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'r') event.preventDefault();
  });

  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ──────────────────────────────────────────────────────────────
let tray = null;

app.whenReady().then(async () => {
  createWindow();

  // Initialize modules that need persistent storage paths
  animepahe.init(app.getPath('userData'));

  // Init downloader with progress callback
  downloader.init(app.getPath('userData'), (id, progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', { id, ...progress });
    }
  });

  // Auto-start FlareSolverr & Pre-emptive solve
  startFlareSolverr().catch(e => logError(e, 'FlareSolverr startup'));

  // Tray icon
  tray = new Tray(path.join(__dirname, 'assets', 'adbg.png'));
  tray.setToolTip('AnimeDownloader — background downloading enabled');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show AnimeDownloader', click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
    }},
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); }}
  ]));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'AnimeDownloader',
          body: 'Running in background. Downloads will continue.',
          icon: path.join(__dirname, 'assets', 'adbg.png')
        }).show();
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  killFlareSolverr();
});

app.on('window-all-closed', () => { /* keep alive for background downloads */ });

// ─── IPC: System ────────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('flaresolverr-status', async () => {
  const running = await isFsRunning();
  _fsReady = running;
  return { running };
});

ipcMain.handle('get-error-logs', async () => {
  const logPath = path.join(app.getPath('userData'), 'error.log');
  try {
    return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : 'No error logs found.';
  } catch (e) { return 'Failed to read error logs.'; }
});

ipcMain.handle('clear-error-logs', async () => {
  const logPath = path.join(app.getPath('userData'), 'error.log');
  try { if (fs.existsSync(logPath)) fs.unlinkSync(logPath); return { success: true }; }
  catch (e) { return { success: false, message: e.message }; }
});

// ─── IPC: Folder / File management ─────────────────────────────────────────────
ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Download Folder'
  });
  return result.filePaths[0];
});

ipcMain.handle('get-default-download-folder', async () => {
  const p = path.join(app.getPath('home'), 'Videos', 'AD');
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
});

ipcMain.handle('create-anime-folder', async (event, animeName) => {
  const safe = animeName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Unknown';
  const p    = path.join(app.getPath('home'), 'Videos', 'AD', safe);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  try { await shell.openPath(folderPath); return { success: true }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('scan-download-folder', async () => {
  try {
    const downloadPath = path.join(app.getPath('home'), 'Videos', 'AD');
    if (!fs.existsSync(downloadPath)) return [];
    const animeFolders = fs.readdirSync(downloadPath, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    return animeFolders.map(name => {
      const ap    = path.join(downloadPath, name);
      const files = fs.readdirSync(ap);
      const imgs  = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
      const vids  = files.filter(f => /\.(mp4|mkv|avi|mov|wmv|flv)$/i.test(f));
      return {
        title: name, episodesCount: vids.length,
        thumbnail: imgs.length ? path.join(ap, imgs[0]) : null,
        path: ap,
        episodes: vids.map((f, i) => ({ number: i + 1, name: f, path: path.join(ap, f) }))
      };
    });
  } catch (e) { logError(e, 'scan-download-folder'); return []; }
});

// ─── IPC: AnimePahe API ─────────────────────────────────────────────────────────
ipcMain.handle('search-anime', async (event, query) => {
  try {
    appLog(`Search: "${query}"`);
    const results = await animepahe.searchAnime(query);
    return { success: true, data: results };
  } catch (e) {
    logError(e, 'search-anime');
    return { success: false, message: e.message };
  }
});

ipcMain.handle('fetch-anime-info', async (event, animeId) => {
  try {
    const info = await animepahe.fetchAnimeInfo(animeId);
    return { success: true, data: info };
  } catch (e) {
    logError(e, 'fetch-anime-info');
    return { success: false, message: e.message };
  }
});

ipcMain.handle('fetch-anime-metadata', async (event, url, isSeries) => {
  try {
    appLog(`Fetching metadata for: ${url}`);
    const metadata = await animepahe.fetchMetadata(url, isSeries);
    return { success: true, data: metadata };
  } catch (e) {
    logError(e, 'fetch-anime-metadata');
    return { success: false, message: e.message };
  }
});

ipcMain.handle('fetch-episode-links', async (event, url, epRange) => {
  try {
    appLog(`Fetching episode links ${epRange[0]}-${epRange[1]} for: ${url}`);
    const links = await animepahe.fetchSeriesEpisodeLinks(url, epRange);
    return { success: true, data: links };
  } catch (e) {
    logError(e, 'fetch-episode-links');
    return { success: false, message: e.message };
  }
});

ipcMain.handle('fetch-download-links', async (event, playUrl, targetRes, audioLang) => {
  try {
    appLog(`Fetching download links for: ${playUrl} (${targetRes}p, ${audioLang})`);
    const link = await animepahe.fetchPaheWinLinks(playUrl, targetRes, audioLang);
    return { success: true, data: link };
  } catch (e) {
    logError(e, 'fetch-download-links');
    return { success: false, message: e.message };
  }
});

ipcMain.handle('check-flaresolverr', async () => {
  try {
    const running = await isFsRunning();
    return { success: true, isRunning: running };
  } catch (e) { return { success: false, isRunning: false }; }
});

// ─── IPC: Full download pipeline ────────────────────────────────────────────────
/**
 * start-download: full pipeline
 *   { playUrl, animeTitle, episodeNumber, quality, audioLang?, animePath }
 */
ipcMain.handle('start-download', async (event, opts) => {
  const { playUrl, animeTitle, episodeNumber, quality, animePath } = opts;
  const audioLang = opts.audioLang || 'jp';

  // Map quality string to resolution int
  const resMap = { '480p': 480, '720p': 720, '1080p': 1080 };
  const targetRes = resMap[quality] || 720;

  const downloadId = `${Date.now()}-ep${episodeNumber}`;

  try {
    appLog(`[Pipeline] EP${episodeNumber} of "${animeTitle}" — resolving pahe.win link...`);

    // Step 1: Get pahe.win link from play page
    const linkResult = await animepahe.fetchPaheWinLinks(playUrl, targetRes, audioLang);
    const paheWinUrl = linkResult.dPaheLink;
    appLog(`[Pipeline] pahe.win URL: ${paheWinUrl}`);

    // Step 2: Extract kwik direct link
    appLog(`[Pipeline] Extracting kwik direct link...`);
    const { directLink, referer } = await kwik.extractKwikLink(paheWinUrl);
    appLog(`[Pipeline] Direct URL: ${directLink}`);

    // Step 3: Build destination path
    const ext      = path.extname(new URL(directLink).pathname) || '.mp4';
    const safeTitle = animeTitle.replace(/[<>:"/\\|?*]/g, '_').trim();
    const fileName  = `${safeTitle} EP${String(episodeNumber).padStart(2, '0')} [${quality}]${ext}`;
    const destPath  = path.join(animePath, fileName);

    // Step 4: Enqueue download
    downloader.startDownload(downloadId, directLink, referer, destPath, animeTitle, episodeNumber, quality);

    // Notification
    if (Notification.isSupported()) {
      new Notification({
        title: 'Download Started',
        body: `${animeTitle} EP${episodeNumber} (${quality})`,
        icon: path.join(__dirname, 'assets', 'adbg.png')
      }).show();
    }

    return { success: true, downloadId, message: `EP${episodeNumber} queued` };
  } catch (e) {
    logError(e, `start-download EP${episodeNumber}`);
    return { success: false, downloadId, message: e.message };
  }
});

ipcMain.handle('pause-download', async (event, downloadId) => {
  try { downloader.pauseDownload(downloadId); return { success: true }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('resume-download', async (event, downloadId) => {
  try { downloader.resumeDownload(downloadId); return { success: true }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('cancel-download', async (event, downloadId) => {
  try { downloader.cancelDownload(downloadId); return { success: true }; }
  catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('get-downloads', async () => {
  try { return { success: true, data: downloader.getAllDownloads() }; }
  catch (e) { return { success: false, data: [] }; }
});

ipcMain.handle('send-download-notification', async (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'adbg.png') }).show();
  }
  return { success: true };
});
