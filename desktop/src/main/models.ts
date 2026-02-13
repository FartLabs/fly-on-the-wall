import { app, ipcMain, dialog, shell, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { formatBytes, ensureDir } from "../utils";
import { exportNoteHtml } from "./exportedNote";
import type { ModelDownloader } from "node-llama-cpp";
import { readConfig } from "./config";

function resolveConfiguredDir(
  configuredPath: string,
  fallbackPath: string
): string {
  const raw = configuredPath.trim();
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

const getModelsDir = (): string => {
  const modelsDir = path.join(app.getPath("userData"), "models");
  return ensureDir(modelsDir);
};

const getModelsCacheDir = (): string => {
  const cacheDir = path.join(app.getPath("userData"), "cache", "models");
  return ensureDir(cacheDir);
};

export const getSummarizationModelsDir = (): string => {
  const config = readConfig();
  return resolveConfiguredDir(
    config.summarization.modelStoragePath || "",
    path.join(app.getPath("userData"), "models", "summarization")
  );
};

export const getTranscriptionModelsDir = (): string => {
  const config = readConfig();
  return resolveConfiguredDir(
    config.transcription.modelStoragePath || "",
    path.join(app.getPath("userData"), "models", "transcription")
  );
};

const getNotesDir = (): string => {
  const notesDir = path.join(app.getPath("userData"), "notes");
  return ensureDir(notesDir);
};

ipcMain.handle("get-models-dir", () => {
  return getModelsDir();
});

ipcMain.handle("get-models-cache-dir", () => {
  return getModelsCacheDir();
});

ipcMain.handle("get-transcription-models-dir", () => {
  return getTranscriptionModelsDir();
});

ipcMain.handle("get-summarization-models-dir", () => {
  return getSummarizationModelsDir();
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
    if (!fs.existsSync(summarizationDir)) {
      return { success: true, models: [] };
    }
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
      ensureDir(summarizationDir);
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

        // save the recording file if it exists
        if (note.metadata && note.metadata.recordingFilename) {
          try {
            const recordingsDir = path.join(
              app.getPath("userData"),
              "recordings"
            );
            const recordingPath = path.join(
              recordingsDir,
              note.metadata.recordingFilename
            );

            if (fs.existsSync(recordingPath)) {
              const pdfDir = path.dirname(savePath);
              const pdfBaseName = path.basename(savePath, ".pdf");
              const recordingExt = path.extname(
                note.metadata.recordingFilename
              );
              const audioSavePath = path.join(
                pdfDir,
                `${pdfBaseName}${recordingExt}`
              );

              fs.copyFileSync(recordingPath, audioSavePath);
              console.log(`Exported recording to: ${audioSavePath}`);
            }
          } catch (audioError) {
            console.error("Error copying recording:", audioError);
          }
        } else {
          console.log("No recording associated with this note.");
        }

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

/**
 * Supported formats:
 *   - Direct HTTP URL (to the .gguf file): https://huggingface.co/user/repo/resolve/main/model.gguf
 *   - Huggingface URI: hf:<user>/<model>:<quant>, hf:<user>/<model>/<file-path>#<branch>
 *
 * See: https://node-llama-cpp.withcat.ai/api/functions/createModelDownloader for more info
 */
function buildModelUri(data: {
  url?: string;
  repo?: string;
  filename?: string;
  revision?: string;
}): { modelUri: string } | { error: string } {
  if (data.url) {
    const trimmed = data.url.trim();
    if (
      !trimmed.startsWith("http://") &&
      !trimmed.startsWith("https://") &&
      !trimmed.startsWith("hf:")
    ) {
      return {
        error:
          "URL must start with http://, https:// (highly recommended), or hf:"
      };
    }
    return { modelUri: trimmed };
  }

  if (data.repo && data.filename) {
    if (!data.filename.toLowerCase().endsWith(".gguf")) {
      return { error: "Filename must end with .gguf" };
    }
    const revision = data.revision?.trim() || "main";
    let modelUri = `hf:${data.repo}/${data.filename}`;
    if (revision !== "main") {
      modelUri += `#${revision}`;
    }
    return { modelUri };
  }

  return { error: "Provide either a URL, or a repo + filename" };
}

function broadcastToRenderer(channel: string, data: any): void {
  // there's only one window for this app
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

ipcMain.handle(
  "check-gguf-model-url",
  async (
    _event,
    data: {
      url?: string;
      repo?: string;
      filename?: string;
      revision?: string;
    }
  ) => {
    try {
      const result = buildModelUri(data);
      if ("error" in result) {
        return { success: false, error: result.error };
      }

      const summarizationDir = getSummarizationModelsDir();

      let downloader: ModelDownloader;
      try {
        const { createModelDownloader } = await import("node-llama-cpp");
        downloader = await createModelDownloader({
          modelUri: result.modelUri,
          dirPath: summarizationDir,
          skipExisting: true
        });
      } catch (err) {
        console.error("[Models] Failed to resolve model URI:", err);
        return {
          success: false,
          error: `Failed to resolve model: ${err instanceof Error ? err.message : String(err)}`
        };
      }

      const filename = downloader.entrypointFilename;
      const size = downloader.totalSize || undefined;
      const sizeFormatted = size ? formatBytes(size) : undefined;

      // check if file already exists locally
      const targetPath = path.join(summarizationDir, filename);
      let exists = false;
      let existingSize: number | undefined;
      let existingSizeFormatted: string | undefined;

      if (fs.existsSync(targetPath)) {
        exists = true;
        const stats = fs.statSync(targetPath);
        existingSize = stats.size;
        existingSizeFormatted = formatBytes(stats.size);
      }

      // then cancel the downloader, only need the metadata
      await downloader.cancel({ deleteTempFile: true });

      return {
        success: true,
        fileName: filename,
        size,
        sizeFormatted,
        exists,
        existingSize,
        existingSizeFormatted
      };
    } catch (error) {
      console.error("[Models] Error checking GGUF model URL:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle(
  "download-gguf-model",
  async (
    _event,
    data: {
      url?: string;
      repo?: string;
      filename?: string;
      revision?: string;
    }
  ) => {
    try {
      const result = buildModelUri(data);
      if ("error" in result) {
        return { success: false, error: result.error };
      }

      const summarizationDir = getSummarizationModelsDir();
      ensureDir(summarizationDir);

      console.log(`[Models] Downloading GGUF model: ${result.modelUri}`);
      console.log(`[Models] Target directory: ${summarizationDir}`);

      broadcastToRenderer("gguf-download-progress", {
        percent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        message: "Resolving model..."
      });

      const { createModelDownloader } = await import("node-llama-cpp");
      const downloader = await createModelDownloader({
        modelUri: result.modelUri,
        dirPath: summarizationDir,
        skipExisting: false,
        deleteTempFileOnCancel: true,
        onProgress({ totalSize, downloadedSize }) {
          const percent =
            totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
          broadcastToRenderer("gguf-download-progress", {
            percent,
            transferredBytes: downloadedSize,
            totalBytes: totalSize,
            message:
              totalSize > 0
                ? `Downloading... ${formatBytes(downloadedSize)} / ${formatBytes(totalSize)} (${percent}%)`
                : `Downloading... ${formatBytes(downloadedSize)}`
          });
        }
      });

      const filename = downloader.entrypointFilename;

      console.log(
        `[Models] Resolved filename: ${filename}, total size: ${formatBytes(downloader.totalSize)}`
      );

      const modelPath = await downloader.download();

      broadcastToRenderer("gguf-download-progress", {
        percent: 100,
        transferredBytes: downloader.totalSize,
        totalBytes: downloader.totalSize,
        message: "Download complete!"
      });

      console.log(`[Models] GGUF model downloaded successfully: ${modelPath}`);
      return { success: true, path: modelPath, fileName: filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      broadcastToRenderer("gguf-download-progress", {
        percent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        message: `Download failed: ${message}`
      });

      console.error("[Models] Error downloading GGUF model:", error);
      return { success: false, error: message };
    }
  }
);
