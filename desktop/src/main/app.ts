import { app, BrowserWindow, protocol, net, Menu } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import fs from "node:fs";

if (!app.isPackaged) {
  app.setName("Fly on the Wall-dev");
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "recording",
    privileges: {
      // standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// Get the project root (parent of desktop folder)
export const getProjectRoot = (): string => {
  // In development, __dirname is in .vite/build, so go up to desktop then to project root
  // In production, adjust as needed
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "..");
  }
  // Development: go from desktop/.vite/build to project root
  return path.resolve(__dirname, "..", "..", "..");
};

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "renderer", MAIN_WINDOW_VITE_NAME, "index.html")
    );
  }

  // TODO: add content security policy
  // https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy

  mainWindow.maximize();

  // Open the DevTools if in development mode.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  protocol.handle("recording", (request) => {
    const url = request.url.replace("recording://", "");
    const filePath = decodeURIComponent(url);

    // ensure the file exists and is in the recordings directory
    if (!fs.existsSync(filePath)) {
      return new Response("File not found", { status: 404 });
    }

    return net.fetch(`file://${filePath}`);
  });

  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
