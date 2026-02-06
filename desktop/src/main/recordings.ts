import { app, ipcMain, desktopCapturer, dialog, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";

const getRecordingsDir = (): string => {
  const recordingsDir = path.join(app.getPath("userData"), "recordings");
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }
  return recordingsDir;
};

ipcMain.handle("get-desktop-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      fetchWindowIcons: false
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name
    }));
  } catch (error) {
    console.error("Error getting desktop sources:", error);
    return [];
  }
});

ipcMain.handle("get-recordings-dir", () => {
  return getRecordingsDir();
});

ipcMain.handle(
  "save-recording",
  async (_event, data: { buffer: ArrayBuffer; filename: string }) => {
    try {
      const recordingsDir = getRecordingsDir();
      const filePath = path.join(recordingsDir, data.filename);
      const buffer = Buffer.from(data.buffer);
      fs.writeFileSync(filePath, buffer);

      console.log(`Recording saved: ${filePath}`);
      return { success: true, path: filePath };
    } catch (error) {
      console.error("Error saving recording:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("get-recording-path", async (_event, filename: string) => {
  try {
    const recordingsDir = getRecordingsDir();
    const filePath = path.join(recordingsDir, filename);

    if (fs.existsSync(filePath)) {
      return { success: true, path: filePath };
    } else {
      return {
        success: false,
        error: `Recording file not found: ${filename}`
      };
    }
  } catch (error) {
    console.error("Error getting recording path:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("get-recording-buffer", async (_event, filename: string) => {
  try {
    const recordingsDir = getRecordingsDir();
    const filePath = path.join(recordingsDir, filename);

    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return { success: true, buffer: buffer.buffer };
    } else {
      return {
        success: false,
        error: `Recording file not found: ${filename}`
      };
    }
  } catch (error) {
    console.error("Error reading recording file:", error);
    return { success: false, error: String(error) };
  }
});

const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "flac",
  "aac",
  "m4a",
  "wma",
  "webm",
  "opus",
  "aiff",
  "aif",
  "amr",
  "ape",
  "mp4",
  "mkv"
];

ipcMain.handle("select-audio-files", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win!, {
    title: "Import Audio Files",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Audio Files",
        extensions: AUDIO_EXTENSIONS
      },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, files: [] };
  }

  const files = result.filePaths.map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size
    };
  });

  return { canceled: false, files };
});

function getUniqueFilename(dir: string, originalName: string): string {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  let candidate = originalName;
  let counter = 1;

  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}_${counter}${ext}`;
    counter++;
  }

  return candidate;
}

ipcMain.handle(
  "import-audio-file",
  async (
    _event,
    data: { sourcePath: string; mode: "copy" | "move" }
  ): Promise<{
    success: boolean;
    filename?: string;
    error?: string;
  }> => {
    try {
      const recordingsDir = getRecordingsDir();
      const originalName = path.basename(data.sourcePath);
      const destName = getUniqueFilename(recordingsDir, originalName);
      const destPath = path.join(recordingsDir, destName);

      if (data.mode === "move") {
        // "Move" means copy then keep original (user asked: don't delete originals)
        fs.copyFileSync(data.sourcePath, destPath);
      } else {
        fs.copyFileSync(data.sourcePath, destPath);
      }

      console.log(`Imported audio: ${data.sourcePath} → ${destPath} (${data.mode})`);
      return { success: true, filename: destName };
    } catch (error) {
      console.error("Error importing audio file:", error);
      return { success: false, error: String(error) };
    }
  }
);
