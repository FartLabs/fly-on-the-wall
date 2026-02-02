import { app, ipcMain, dialog, shell } from "electron";
import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

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

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${note.id}</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:20px}h1{font-size:18px}h2{font-size:14px;margin-top:18px}pre{white-space:pre-wrap;background:#f7f7f7;padding:12px;border-radius:6px}</style></head><body><h1>${note.id}</h1><p>Created: ${note.created}</p><h2>Transcription</h2><pre>${note.transcription || ""}</pre><h2>Summary</h2><pre>${note.summary || ""}</pre></body></html>`;

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

// interface ModelValidationResult {
//   valid: boolean;
//   error?: string;
//   modelType?: string;
//   modelName?: string;
// }

// function validateSummarizationModel(modelPath: string): ModelValidationResult {
//   try {
//     if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) {
//       return { valid: false, error: "Selected path is not a valid directory" };
//     }

//     const configPath = path.join(modelPath, "config.json");
//     const tokenizerPath = path.join(modelPath, "tokenizer.json");

//     if (!fs.existsSync(configPath)) {
//       return { valid: false, error: "Missing config.json - not a valid model" };
//     }

//     if (!fs.existsSync(tokenizerPath)) {
//       return { valid: false, error: "Missing tokenizer.json - not a valid model" };
//     }

//     const files = fs.readdirSync(modelPath);
//     const hasOnnxFiles = files.some(file => file.endsWith('.onnx') || file.endsWith('.onnx_data'));

//     if (!hasOnnxFiles) {
//       return {
//         valid: false,
//         error: "No ONNX model files found - model must be in ONNX format for transformers.js"
//       };
//     }

//     const configContent = fs.readFileSync(configPath, 'utf-8');
//     const config = JSON.parse(configContent);

//     // Extract model name from path or config
//     const modelName = config.name || config._name_or_path || path.basename(modelPath);

//     return {
//       valid: true,
//       modelType: 'text-generation',
//       modelName
//     };
//   } catch (error) {
//     return {
//       valid: false,
//       error: `Error validating model: ${error instanceof Error ? error.message : String(error)}`
//     };
//   }
// }

// ipcMain.handle("select-custom-model-folder", async () => {
//   try {
//     const result = await dialog.showOpenDialog({
//       properties: ["openDirectory"],
//       title: "Select Custom Model Folder",
//       message: "Choose a folder containing an ONNX model for summarization"
//     });

//     if (result.canceled || result.filePaths.length === 0) {
//       return { success: false, canceled: true };
//     }

//     const selectedPath = result.filePaths[0];
//     return { success: true, path: selectedPath };
//   } catch (error) {
//     console.error("Error selecting folder:", error);
//     return { success: false, error: String(error) };
//   }
// });

// ipcMain.handle("validate-custom-model", async (_event, modelPath: string) => {
//   return validateSummarizationModel(modelPath);
// });

// ipcMain.handle("import-custom-model", async (_event, data: {
//   sourcePath: string;
//   modelName: string;
// }) => {
//   try {
//     const { sourcePath, modelName } = data;

//     const validation = validateSummarizationModel(sourcePath);
//     if (!validation.valid) {
//       return { success: false, error: validation.error };
//     }

//     const modelsDir = getModelsDir();

//     const safeName = modelName.replace(/[^a-zA-Z0-9-_]/g, '_');
//     const targetPath = path.join(modelsDir, `custom--${safeName}`);

//     if (fs.existsSync(targetPath)) {
//       return {
//         success: false,
//         error: "A custom model with this name already exists"
//       };
//     }

//     fs.mkdirSync(targetPath, { recursive: true });
//     copyDirectory(sourcePath, targetPath);

//     const relativePath = path.relative(app.getPath('userData'), targetPath);
//     const modelUrl = `app-data://${relativePath.replace(/\\/g, '/')}`;

//     console.log(`Custom model imported: ${targetPath}`);
//     return {
//       success: true,
//       path: targetPath,
//       url: modelUrl,
//       modelId: `custom--${safeName}`
//     };
//   } catch (error) {
//     console.error("Error importing custom model:", error);
//     return { success: false, error: String(error) };
//   }
// });

// ipcMain.handle("list-custom-models", async () => {
//   try {
//     const modelsDir = getModelsDir();

//     if (!fs.existsSync(modelsDir)) {
//       return { success: true, models: [] };
//     }

//     const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
//     const customModels = entries
//       .filter(entry => entry.isDirectory() && entry.name.startsWith('custom--'))
//       .map(entry => {
//         const modelPath = path.join(modelsDir, entry.name);
//         const configPath = path.join(modelPath, 'config.json');

//         let modelName = entry.name.replace('custom--', '');

//         if (fs.existsSync(configPath)) {
//           try {
//             const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
//             modelName = config.name || config._name_or_path || modelName;
//           } catch (e) {
//             console.warn(`Could not read config for model ${entry.name}:`, e);
//         }
//         }

//         const modelUrl = modelPath;

//         return {
//           id: entry.name,
//           name: modelName,
//           path: modelPath,
//           url: modelUrl
//         };
//       });

//     return { success: true, models: customModels };
//   } catch (error) {
//     console.error("Error listing custom models:", error);
//     return { success: false, error: String(error), models: [] };
//   }
// });

// function copyDirectory(source: string, destination: string) {
//   const entries = fs.readdirSync(source, { withFileTypes: true });

//   for (const entry of entries) {
//     const srcPath = path.join(source, entry.name);
//     const destPath = path.join(destination, entry.name);

//     if (entry.isDirectory()) {
//       fs.mkdirSync(destPath, { recursive: true });
//       copyDirectory(srcPath, destPath);
//     } else {
//       fs.copyFileSync(srcPath, destPath);
//     }
//   }
// }
