import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Get the project root (parent of desktop folder)
const getProjectRoot = (): string => {
  // In development, __dirname is in .vite/build, so go up to desktop then to project root
  // In production, adjust as needed
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '..');
  }
  // Development: go from desktop/.vite/build to project root
  return path.resolve(__dirname, '..', '..', '..');
};

const getRecordingsDir = (): string => {
  const projectRoot = getProjectRoot();
  const recordingsDir = path.join(projectRoot, 'recordings');
  
  // Ensure recordings directory exists
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }
  
  return recordingsDir;
};

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// IPC handler for saving recordings
ipcMain.handle('save-recording', async (_event, data: { buffer: ArrayBuffer; filename: string }) => {
  try {
    const recordingsDir = getRecordingsDir();
    const filePath = path.join(recordingsDir, data.filename);
    
    // Convert ArrayBuffer to Buffer and write to file
    const buffer = Buffer.from(data.buffer);
    fs.writeFileSync(filePath, buffer);
    
    console.log(`Recording saved: ${filePath}`);
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving recording:', error);
    return { success: false, error: String(error) };
  }
});

// IPC handler to get recordings directory path
ipcMain.handle('get-recordings-dir', () => {
  return getRecordingsDir();
});

// IPC handler to get desktop audio sources
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen', 'window'],
      fetchWindowIcons: false
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
    }));
  } catch (error) {
    console.error('Error getting desktop sources:', error);
    return [];
  }
});
