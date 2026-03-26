import { app, BrowserWindow, protocol, net, session } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import fs from "node:fs";

if (!app.isPackaged) {
  app.setName("Fly on the Wall-dev");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // focus current instance instead of opening a new one
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      const mainWindow = allWindows[0];
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
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
      path.join(
        __dirname,
        "..",
        "renderer",
        MAIN_WINDOW_VITE_NAME,
        "index.html"
      )
    );
  }

  mainWindow.maximize();

  // Open the DevTools if in development mode.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

  const csp = isDev
    ? // add localhost/ws allowances for Vite HMR in dev
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: recording:",
        "font-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'"
      ].join("; ")
    : // prod locks to 'self' only
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        // in the future, this'll need to change once the server is developed, maybe disable this entirely.
        "connect-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: recording:",
        "font-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'"
      ].join("; ");

  console.log("Setting Content-Security-Policy:", csp);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });

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
