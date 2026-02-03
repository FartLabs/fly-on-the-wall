import { app, ipcMain, desktopCapturer } from "electron";
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
