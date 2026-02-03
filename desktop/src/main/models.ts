import { app, ipcMain, dialog, shell } from "electron";
import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { formatBytes } from "../utils";
import { exportNoteHtml } from "@/renderer/components/exportedNote";

const getModelsDir = (): string => {
  const modelsDir = path.join(app.getPath("userData"), "models");
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
};

const getModelsCacheDir = (): string => {
  const cacheDir = path.join(app.getPath("userData"), "cache", "models");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
};

const getSummarizationModelsDir = (): string => {
  const summarizationDir = path.join(
    app.getPath("userData"),
    "models",
    "summarization"
  );
  if (!fs.existsSync(summarizationDir)) {
    fs.mkdirSync(summarizationDir, { recursive: true });
  }
  return summarizationDir;
};

export const getTranscriptionModelsDir = (): string => {
  const transcriptionDir = path.join(
    app.getPath("userData"),
    "models",
    "transcription"
  );
  if (!fs.existsSync(transcriptionDir)) {
    fs.mkdirSync(transcriptionDir, { recursive: true });
  }
  return transcriptionDir;
};

const getNotesDir = (): string => {
  const notesDir = path.join(app.getPath("userData"), "notes");
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }
  return notesDir;
};

ipcMain.handle("get-models-dir", () => {
  return getModelsDir();
});

ipcMain.handle("get-models-cache-dir", () => {
  return getModelsCacheDir();
});

ipcMain.handle("open-models-folder", async () => {
  try {
    const summarizationDir = getSummarizationModelsDir();
    await shell.openPath(summarizationDir);
    return { success: true, path: summarizationDir };
  } catch (error) {
    console.error("Error opening models folder:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("list-gguf-models", async () => {
  try {
    const summarizationDir = getSummarizationModelsDir();
    const files = fs.readdirSync(summarizationDir);
    const ggufFiles = files
      .filter((file) => file.toLowerCase().endsWith(".gguf"))
      .map((file) => {
        const filePath = path.join(summarizationDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          modified: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, models: ggufFiles };
  } catch (error) {
    console.error("Error listing GGUF models:", error);
    return { success: false, error: String(error), models: [] };
  }
});

ipcMain.handle("select-model-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select GGUF Model File",
    filters: [
      { name: "GGUF Models", extensions: ["gguf"] },
      { name: "All Files", extensions: ["*"] }
    ],
    properties: ["openFile"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle(
  "import-gguf-model",
  async (_event, data: { sourcePath: string; copyMode?: "copy" | "move" }) => {
    try {
      const summarizationDir = getSummarizationModelsDir();
      const fileName = path.basename(data.sourcePath);
      const targetPath = path.join(summarizationDir, fileName);

      if (!data.sourcePath.toLowerCase().endsWith(".gguf")) {
        return { success: false, error: "File must be a .gguf file" };
      }

      if (!fs.existsSync(data.sourcePath)) {
        return { success: false, error: "Source file does not exist" };
      }

      if (fs.existsSync(targetPath)) {
        return {
          success: false,
          error: "A model with this name already exists"
        };
      }

      const mode = data.copyMode || "copy";
      if (mode === "move") {
        fs.renameSync(data.sourcePath, targetPath);
        console.log(`Model moved: ${data.sourcePath} -> ${targetPath}`);
      } else {
        fs.copyFileSync(data.sourcePath, targetPath);
        console.log(`Model copied: ${data.sourcePath} -> ${targetPath}`);
      }

      return { success: true, path: targetPath, fileName };
    } catch (error) {
      console.error("Error importing GGUF model:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("delete-gguf-model", async (_event, modelPath: string) => {
  try {
    if (!modelPath.toLowerCase().endsWith(".gguf")) {
      return { success: false, error: "File is not a .gguf file" };
    }

    if (fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      console.log(`GGUF model deleted: ${modelPath}`);
      return { success: true };
    }

    return { success: false, error: "Model file not found" };
  } catch (error) {
    console.error("Error deleting GGUF model:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("check-model-exists", async (_event, modelId: string) => {
  const modelsDir = getModelsDir();

  // transformers.js stores models in subdirectories based on model ID
  const modelPath = path.join(modelsDir, modelId.replace("/", "--"));

  console.log(`Checking model at path: ${modelPath}`);

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
      const notesDir = getNotesDir();
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

ipcMain.handle(
  "save-note",
  async (
    _event,
    data: {
      transcription: string;
      summary?: string;
      filename?: string;
      metadata?: Record<string, any>;
    }
  ) => {
    try {
      const notesDir = getNotesDir();

      const ts = new Date();
      const filename =
        data.filename ||
        `note_${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}_${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}.json`;

      const note = {
        id: filename.replace(/\.[^.]+$/, ""),
        created: ts.toISOString(),
        transcription: data.transcription,
        summary: data.summary || "",
        metadata: data.metadata || {}
      };

      const filePath = path.join(notesDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(note, null, 2), "utf-8");

      console.log(`Note saved: ${filePath}`);
      return { success: true, path: filePath, filename };
    } catch (error) {
      console.error("Error saving note:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("list-notes", async () => {
  try {
    const notesDir = getNotesDir();

    const files = fs
      .readdirSync(notesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const filePath = path.join(notesDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          isJson: true
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
    const notesDir = getNotesDir();
    const filePath = path.join(notesDir, filename);

    const content = fs.readFileSync(filePath, "utf-8");
    try {
      const parsed = JSON.parse(content);
      return { success: true, content: parsed };
    } catch (err) {
      console.error("Error parsing JSON note:", err);
      return { success: false, error: "Failed to parse JSON note" };
    }
  } catch (error) {
    console.error("Error reading note:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("delete-note", async (_event, filename: string) => {
  try {
    const notesDir = getNotesDir();
    const filePath = path.join(notesDir, filename);

    fs.unlinkSync(filePath);
    console.log(`Note deleted: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error("Error deleting note:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  "export-note",
  async (_event, data: { filename: string; format: string }) => {
    try {
      const notesDir = getNotesDir();
      const filePath = path.join(notesDir, data.filename);

      if (!fs.existsSync(filePath)) {
        return { success: false, error: "Note not found" };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const note = JSON.parse(content);

      const html = exportNoteHtml(note);

      // create a hidden BrowserWindow to render the HTML and print to PDF
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          offscreen: true
        }
      });

      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html)
      );

      if (data.format === "pdf") {
        const pdfBuffer = await win.webContents.printToPDF({
          printBackground: true
        });

        const { canceled, filePath: savePath } = await dialog.showSaveDialog({
          title: "Export note as PDF",
          defaultPath: `${note.id}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }]
        });

        if (canceled || !savePath) {
          win.destroy();
          return { success: false, error: "Save canceled" };
        }

        fs.writeFileSync(savePath, pdfBuffer);
        win.destroy();
        return { success: true, path: savePath };
      }

      win.destroy();
      return { success: false, error: "Unsupported export format" };
    } catch (error) {
      console.error("Error exporting note:", error);
      return { success: false, error: String(error) };
    }
  }
);
