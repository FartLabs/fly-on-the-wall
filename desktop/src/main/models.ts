import { app, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { getProjectRoot } from "./app";

const getModelsDir = (): string => {
  const modelsDir = path.join(app.getPath("userData"), "models");
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
};

ipcMain.handle("get-models-dir", () => {
  return getModelsDir();
});

ipcMain.handle("check-model-exists", async (_event, modelId: string) => {
  const modelsDir = getModelsDir();

  // transformers.js stores models in subdirectories based on model ID
  const modelPath = path.join(modelsDir, modelId.replace("/", "--"));

  const exists = fs.existsSync(modelPath);
  return { exists, path: modelPath };
});

ipcMain.handle("delete-model", async (_event, modelId: string) => {
  try {
    const modelsDir = getModelsDir();
    const modelPath = path.join(modelsDir, modelId.replace("/", "--"));
    if (fs.existsSync(modelPath)) {
      fs.rmSync(modelPath, { recursive: true, force: true });
      console.log(`Model deleted: ${modelPath}`);
      return { success: true };
    }
    return { success: false, error: "Model not found" };
  } catch (error) {
    console.error("Error deleting model:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  "save-transcription",
  async (_event, data: { text: string; filename: string }) => {
    try {
      const projectRoot = getProjectRoot();
      const notesDir = path.join(projectRoot, "notes");

      if (!fs.existsSync(notesDir)) {
        fs.mkdirSync(notesDir, { recursive: true });
      }

      const filePath = path.join(notesDir, data.filename);
      fs.writeFileSync(filePath, data.text, "utf-8");

      console.log(`Transcription saved: ${filePath}`);
      return { success: true, path: filePath };
    } catch (error) {
      console.error("Error saving transcription:", error);
      return { success: false, error: String(error) };
    }
  }
);

// TODO: would it be possible to store transcriptions and summaries in browser's db instead?

ipcMain.handle("list-notes", async () => {
  try {
    const projectRoot = getProjectRoot();
    const notesDir = path.join(projectRoot, "notes");

    if (!fs.existsSync(notesDir)) {
      return { success: true, files: [] };
    }

    const files = fs
      .readdirSync(notesDir)
      .filter((file) => file.endsWith(".txt"))
      .map((file) => {
        const filePath = path.join(notesDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      })
      .sort(
        (a, b) =>
          new Date(b.modified).getTime() - new Date(a.modified).getTime()
      );

    return { success: true, files };
  } catch (error) {
    console.error("Error listing notes:", error);
    return { success: false, error: String(error), files: [] };
  }
});

ipcMain.handle("read-note", async (_event, filename: string) => {
  try {
    const projectRoot = getProjectRoot();
    const notesDir = path.join(projectRoot, "notes");
    const filePath = path.join(notesDir, filename);

    const content = fs.readFileSync(filePath, "utf-8");
    return { success: true, content };
  } catch (error) {
    console.error("Error reading note:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("delete-note", async (_event, filename: string) => {
  try {
    const projectRoot = getProjectRoot();
    const notesDir = path.join(projectRoot, "notes");
    const filePath = path.join(notesDir, filename);

    fs.unlinkSync(filePath);
    console.log(`Note deleted: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error("Error deleting note:", error);
    return { success: false, error: String(error) };
  }
});
