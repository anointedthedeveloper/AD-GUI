const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Error logging
function logError(error, context = '') {
  const timestamp = new Date().toISOString();
  const errorMessage = `[${timestamp}] ${context ? context + ': ' : ''}${error.message || error}\n${error.stack || ''}\n`;
  
  const logPath = path.join(app.getPath('userData'), 'error.log');
  fs.appendFileSync(logPath, errorMessage, 'utf8');
  console.error(errorMessage);
  
  return errorMessage;
}

// Global error handler
process.on('uncaughtException', (error) => {
  logError(error, 'Uncaught Exception');
});

process.on('unhandledRejection', (reason, promise) => {
  logError(reason, 'Unhandled Rejection');
});

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

  // Maximize window on start
  mainWindow.maximize();
  mainWindow.show();

  // Disable Ctrl+R refresh
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault();
    }
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Don't quit the app when all windows are closed (for background downloading)
// app.on('window-all-closed', (e) => {
//   // Keep app running for background downloads
//   // Uncomment the line below to allow quitting when all windows are closed
//   // if (process.platform !== 'darwin') {
//   //   app.quit();
//   // }
// });

// Handle tray icon for background operation
const { Tray, Menu } = require('electron');
let tray = null;

app.on('ready', () => {
  // Create tray icon
  tray = new Tray(path.join(__dirname, 'assets', 'adbg.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show AnimeDownloader', click: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    }},
    { label: 'Quit', click: () => {
      app.quit();
    }}
  ]);
  
  tray.setToolTip('AnimeDownloader - Background downloading enabled');
  tray.setContextMenu(contextMenu);
  
  // Show notification when window is closed
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      
      if (Notification.isSupported()) {
        new Notification({
          title: 'AnimeDownloader',
          body: 'App is running in background. Downloads will continue.',
          icon: path.join(__dirname, 'assets', 'adbg.png')
        }).show();
      }
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit - keep app running for background downloads
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
});

// IPC handlers for download management
ipcMain.handle('select-download-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Download Folder'
  });
  return result.filePaths[0];
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get default download folder (Videos/AD)
ipcMain.handle('get-default-download-folder', async () => {
  const { app } = require('electron');
  const path = require('path');
  const videosPath = path.join(app.getPath('home'), 'Videos', 'AD');
  
  // Create Videos/AD folder if it doesn't exist
  if (!fs.existsSync(videosPath)) {
    fs.mkdirSync(videosPath, { recursive: true });
  }
  
  return videosPath;
});

// Create anime folder structure
ipcMain.handle('create-anime-folder', async (event, animeName) => {
  const { app } = require('electron');
  const path = require('path');
  const videosPath = path.join(app.getPath('home'), 'Videos', 'AD');
  const animePath = path.join(videosPath, animeName);
  
  // Create anime folder if it doesn't exist
  if (!fs.existsSync(animePath)) {
    fs.mkdirSync(animePath, { recursive: true });
  }
  
  return animePath;
});

// Start download (placeholder for actual download logic)
ipcMain.handle('start-download', async (event, downloadData) => {
  const { animeName, episodeNumber, quality, animePath } = downloadData;
  
  // TODO: Implement actual download logic
  console.log(`Starting download: ${animeName} EP ${episodeNumber} (${quality}) to ${animePath}`);
  
  // Send notification for download started
  if (Notification.isSupported()) {
    new Notification({
      title: 'Download Started',
      body: `${animeName} EP ${episodeNumber} (${quality})`,
      icon: path.join(__dirname, 'assets', 'adbg.png')
    }).show();
  }
  
  return { success: true, message: 'Download started' };
});

// Send download notification
ipcMain.handle('send-download-notification', async (event, notificationData) => {
  const { title, body, type } = notificationData;
  
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      icon: path.join(__dirname, 'assets', 'adbg.png')
    });
    notification.show();
  }
  
  return { success: true };
});

// Check network status and resume downloads
let networkStatus = true;
let checkNetworkInterval = null;

function checkNetworkStatus() {
  // TODO: Implement actual network check
  // For now, assume network is always available
  return true;
}

// Resume downloads on network recovery
function resumeDownloadsOnNetworkRecovery() {
  if (checkNetworkInterval) clearInterval(checkNetworkInterval);
  
  checkNetworkInterval = setInterval(() => {
    const currentStatus = checkNetworkStatus();
    
    if (!networkStatus && currentStatus) {
      // Network recovered
      networkStatus = true;
      console.log('Network recovered, resuming downloads');
      
      if (Notification.isSupported()) {
        new Notification({
          title: 'Network Recovered',
          body: 'Resuming paused downloads...',
          icon: path.join(__dirname, 'assets', 'adbg.png')
        }).show();
      }
      
      // TODO: Resume all paused downloads
      // This would involve calling the download manager to resume
    } else if (networkStatus && !currentStatus) {
      // Network lost
      networkStatus = false;
      console.log('Network lost, pausing downloads');
      
      if (Notification.isSupported()) {
        new Notification({
          title: 'Network Lost',
          body: 'Pausing downloads until network is restored...',
          icon: path.join(__dirname, 'assets', 'adbg.png')
        }).show();
      }
      
      // TODO: Pause all active downloads
    }
  }, 5000); // Check every 5 seconds
}

// Start network monitoring
resumeDownloadsOnNetworkRecovery();

// Get error logs
ipcMain.handle('get-error-logs', async () => {
  const logPath = path.join(app.getPath('userData'), 'error.log');
  try {
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf8');
      return logs;
    }
    return 'No error logs found.';
  } catch (error) {
    logError(error, 'Failed to read error logs');
    return 'Failed to read error logs.';
  }
});

// Clear error logs
ipcMain.handle('clear-error-logs', async () => {
  const logPath = path.join(app.getPath('userData'), 'error.log');
  try {
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
      return { success: true };
    }
    return { success: true, message: 'No error logs to clear.' };
  } catch (error) {
    logError(error, 'Failed to clear error logs');
    return { success: false, message: 'Failed to clear error logs.' };
  }
});

// Scan download folder for anime
ipcMain.handle('scan-download-folder', async () => {
  try {
    const { app } = require('electron');
    const downloadPath = path.join(app.getPath('home'), 'Videos', 'AD');
    
    if (!fs.existsSync(downloadPath)) {
      return [];
    }
    
    const animeFolders = fs.readdirSync(downloadPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    const animeList = [];
    
    for (const animeName of animeFolders) {
      const animePath = path.join(downloadPath, animeName);
      const files = fs.readdirSync(animePath);
      
      // Look for image files for thumbnail
      const imageFiles = files.filter(file => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
      );
      
      // Look for video files
      const videoFiles = files.filter(file => 
        /\.(mp4|mkv|avi|mov|wmv|flv)$/i.test(file)
      );
      
      animeList.push({
        title: animeName,
        episodesCount: videoFiles.length,
        thumbnail: imageFiles.length > 0 ? path.join(animePath, imageFiles[0]) : null,
        path: animePath,
        episodes: videoFiles.map((file, index) => ({
          number: index + 1,
          name: file,
          path: path.join(animePath, file)
        }))
      });
    }
    
    return animeList;
  } catch (error) {
    logError(error, 'Failed to scan download folder');
    return [];
  }
});

// Open folder in file explorer
ipcMain.handle('open-folder', async (event, folderPath) => {
  const { shell } = require('electron');
  try {
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    logError(error, 'Failed to open folder');
    return { success: false, message: 'Failed to open folder.' };
  }
});

// Delete file
ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: true, message: 'File not found.' };
  } catch (error) {
    logError(error, 'Failed to delete file');
    return { success: false, message: 'Failed to delete file.' };
  }
});
