import { app, ipcMain, dialog } from "electron";
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
