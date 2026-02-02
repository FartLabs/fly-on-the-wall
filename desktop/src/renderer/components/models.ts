import { elements } from "./domNodes";
import {
  getAllModelStatus,
  downloadModel,
  deleteModel as deleteModelFromCache,
  type TranscriptionProgress,
  type ModelStatus
} from "@/transcription";
import { isRecordingState } from "./recorder";
import {
  type WhisperModelSize,
  MODEL_DESCRIPTIONS
} from "@/transcription/whisper";
import {
  deleteSummarizationModel,
  getSelectedModelPath,
  saveSelectedModelPath,
} from "@/summarization";

let downloadingModel: WhisperModelSize | null = null;
let isTranscribing = false;

export const STORAGE_KEY_SELECTED_TRANSCRIPTION_MODEL = "selectedWhisperModel";
export const STORAGE_KEY_SELECTED_SUMMARY_MODEL = "selectedSummaryModel";

export function saveSelectedTranscriptionModel(
  modelSize: WhisperModelSize
): void {
  localStorage.setItem(STORAGE_KEY_SELECTED_TRANSCRIPTION_MODEL, modelSize);
}

export function getSelectedTranscriptionModel(): WhisperModelSize | null {
  return localStorage.getItem(
    STORAGE_KEY_SELECTED_TRANSCRIPTION_MODEL
  ) as WhisperModelSize | null;
}

export function saveSelectedSummaryModel(modelId: string): void {
  localStorage.setItem(STORAGE_KEY_SELECTED_SUMMARY_MODEL, modelId);
}

export function getSelectedSummaryModel(): string | null {
  return localStorage.getItem(STORAGE_KEY_SELECTED_SUMMARY_MODEL);
}

export function setTranscriptionInProgress(inProgress: boolean): void {
  isTranscribing = inProgress;
  refreshModelsList();
}

function createModelItemHTML(status: ModelStatus): string {
  const isDownloading = downloadingModel === status.modelSize;
  const selectedModel = getSelectedTranscriptionModel();
  const isSelected = status.downloaded && selectedModel === status.modelSize;
  const isRecording = isRecordingState();
  const isClickable = status.downloaded && !isTranscribing && !isRecording;
  const isButtonDisabled = isDownloading || isTranscribing || isRecording;

  return `
    <div class="model-item ${status.downloaded ? "downloaded" : ""} ${isSelected ? "selected" : ""} ${isClickable ? "selectable" : ""} ${(isTranscribing || isRecording) && !isSelected ? "disabled" : ""}" data-model="${status.modelSize}">
      <div class="model-info">
        <div class="model-name">
          Whisper ${status.modelSize.charAt(0).toUpperCase() + status.modelSize.slice(1)}
          ${isSelected ? '<span style="color: #4CAF50; margin-left: 0.5rem;">● Active</span>' : ""}
        </div>
        <div class="model-meta">
          <span class="model-size">${status.size}</span>
          <span class="model-status ${status.downloaded ? "downloaded" : ""}">
            ${status.downloaded ? "✓ Downloaded" : "Not downloaded"}
          </span>
        </div>
        <div class="model-description" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">
          ${MODEL_DESCRIPTIONS[status.modelSize]}
          ${status.downloaded && !isSelected && !isTranscribing && !isRecording ? '<span style="color: #888; font-style: italic;"> • Click to use for transcription</span>' : ""}
          ${isTranscribing ? '<span style="color: #ff9800; font-style: italic;"> • Locked during transcription</span>' : ""}
          ${isRecording && !isTranscribing ? '<span style="color: #ff9800; font-style: italic;"> • Locked during recording</span>' : ""}
        </div>
      </div>
      <div class="model-actions">
        ${
          status.downloaded
            ? `<button class="model-btn delete-btn" data-model="${status.modelSize}" ${isButtonDisabled ? "disabled" : ""}>Delete</button>`
            : `<button class="model-btn download-btn" data-model="${status.modelSize}" ${isButtonDisabled ? "disabled" : ""}>
              ${isDownloading ? "Downloading..." : "Download"}
            </button>`
        }
      </div>
      ${
        isDownloading
          ? `
        <div class="model-download-progress">
          <div class="model-progress-bar">
            <div class="model-progress-fill" id="model-progress-${status.modelSize}"></div>
          </div>
          <div class="model-progress-text" id="model-progress-text-${status.modelSize}">Starting...</div>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function createSummaryModelHTML(): string {
  const selectedModelPath = getSelectedModelPath();
  const isRecording = isRecordingState();
  const isButtonDisabled = isTranscribing || isRecording;

  return `
    <div class="model-item summary-model-section" data-model="summary">
      <div class="model-info">
       <div class="model-description" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">
          ${!selectedModelPath ? "Select a GGUF model from the list below, import one, or drag-and-drop into the models folder." : ""}
        </div>
      </div>
      <div class="model-actions" style="display: flex; gap: 0.5rem;">
        <button class="model-btn" id="openModelsFolderBtn" ${isButtonDisabled ? "disabled" : ""}>
          📁 Open Folder
        </button>
        <button class="model-btn" id="importModelBtn" ${isButtonDisabled ? "disabled" : ""}>
          Import Model
        </button>
      </div>
      <div id="ggufModelsList" style="margin-top: 1rem;">
        <div style="text-align: center; padding: 1rem; color: #888;">Loading models...</div>
      </div>
    </div>
  `;
}

async function renderGgufModelsList(): Promise<void> {
  const container = document.getElementById("ggufModelsList");
  if (!container) return;

  try {
    const result = await window.electronAPI.listGgufModels();
    const selectedModelPath = getSelectedModelPath();
    const isRecording = isRecordingState();
    const isClickable = !isTranscribing && !isRecording;

    if (!result.success) {
      container.innerHTML = `<div style="color: #ff6b81; padding: 0.5rem; font-size: 0.8rem;">Error loading models: ${result.error}</div>`;
      return;
    }

    if (result.models.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 1rem; color: #888; font-size: 0.85rem;">
          No GGUF models found.<br>
          <span style="font-size: 0.75rem;">Import a model or drag-and-drop .gguf files into the models folder.</span>
        </div>
      `;
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
    result.models.forEach((model: any) => {
      const isSelected = selectedModelPath === model.path;
      html += `
        <div class="gguf-model-item ${isSelected ? "selected" : ""} ${isClickable ? "selectable" : ""}" 
             data-model-path="${model.path}" 
             style="padding: 0.75rem; background: rgba(102, 126, 234, ${isSelected ? '0.2' : '0.05'}); 
                    border: 1px solid rgba(102, 126, 234, ${isSelected ? '0.4' : '0.1'}); 
                    border-radius: 6px; cursor: ${isClickable ? 'pointer' : 'default'}; 
                    transition: all 0.2s;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 0.85rem; color: ${isSelected ? '#4CAF50' : '#fff'}; font-weight: ${isSelected ? '600' : '400'}; 
                          display: flex; align-items: center; gap: 0.5rem;">
                ${isSelected ? '● ' : ''}${model.name}
              </div>
              <div style="font-size: 0.7rem; color: #888; margin-top: 0.25rem;">
                ${model.sizeFormatted}
                ${!isSelected && isClickable ? ' • Click to select' : ''}
                ${isTranscribing || isRecording ? ' • Locked during operation' : ''}
              </div>
            </div>
            <button class="model-btn delete-btn gguf-delete-btn" 
                    data-model-path="${model.path}"
                    style="padding: 0.4rem 0.75rem; font-size: 0.75rem;"
                    ${!isClickable ? 'disabled' : ''}>
              Delete
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    
    container.innerHTML = html;

    // Add click handlers for selection
    container.querySelectorAll('.gguf-model-item.selectable').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.gguf-delete-btn')) return;
        
        const modelPath = (e.currentTarget as HTMLElement).dataset.modelPath;
        if (modelPath) {
          handleSelectGgufModel(modelPath);
        }
      });
    });

    // Add click handlers for delete buttons
    container.querySelectorAll('.gguf-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const modelPath = (e.currentTarget as HTMLElement).dataset.modelPath;
        if (modelPath) {
          await handleDeleteGgufModel(modelPath);
        }
      });
    });
  } catch (error) {
    console.error("Error rendering GGUF models:", error);
    container.innerHTML = `<div style="color: #ff6b81; padding: 0.5rem; font-size: 0.8rem;">Error: ${error}</div>`;
  }
}

// this is used frequently, may need to be optimized in future if performance issues arise
export async function refreshModelsList(): Promise<void> {
  try {
    const statuses = await getAllModelStatus();

    // auto-select first downloaded model if none selected
    const downloadedModels = statuses.filter((s) => s.downloaded);
    const currentSelected = getSelectedTranscriptionModel();
    if (
      downloadedModels.length > 0 &&
      (!currentSelected ||
        !downloadedModels.some((m) => m.modelSize === currentSelected))
    ) {
      saveSelectedTranscriptionModel(downloadedModels[0].modelSize);
    }

    let html =
      '<div class="model-section"><h3 style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">Transcription Models</h3>';
    html += statuses.map((status) => createModelItemHTML(status)).join("");
    html += "</div>";

    html +=
      '<div class="model-section" style="margin-top: 1.5rem;"><h3 style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">Summarization Model</h3>';
    html += createSummaryModelHTML();
    html += "</div>";

    // custom model selection disabled for now

    // const selectedSummaryModel = getSelectedSummaryModel();
    // const isRecording = isRecordingState();
    // try {
    //   const customModelsResult = await window.electronAPI.listCustomModels();
    //   if (customModelsResult.success && customModelsResult.models.length > 0) {
    //     html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">';
    //     html += '<h4 style="font-size: 0.8rem; color: #666; margin-bottom: 0.5rem;">Custom Models</h4>';
    //     customModelsResult.models.forEach(model => {
    //       const isCustomSelected = selectedSummaryModel === model.url;
    //       const isClickable = !isTranscribing && !isRecording;
    //       html += `
    //         <div class="custom-model-item ${isCustomSelected ? "selected" : ""} ${isClickable ? "selectable" : ""}" data-model-url="${model.url}" style="padding: 0.5rem; background: rgba(102, 126, 234, ${isCustomSelected ? '0.2' : '0.1'}); border-radius: 6px; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; cursor: ${isClickable ? 'pointer' : 'default'};">
    //           <div style="flex: 1;">
    //             <div style="font-size: 0.85rem; color: #fff;">
    //               ${model.name}
    //               ${isCustomSelected ? '<span style="color: #4CAF50; margin-left: 0.5rem;">● Active</span>' : ""}
    //             </div>
    //             <div style="font-size: 0.7rem; color: #666;">
    //               Custom • ID: ${model.id}
    //               ${!isCustomSelected && isClickable ? '<span style="color: #888; font-style: italic;"> • Click to use for summarization</span>' : ""}
    //             </div>
    //           </div>
    //           <div class="model-actions">
    //             <button class="model-btn delete-btn custom-model-delete" data-model-id="${model.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" ${!isClickable ? 'disabled' : ''}>Delete</button>
    //           </div>
    //         </div>
    //       `;
    //     });
    //     html += '</div>';
    //   }
    // } catch (error) {
    //   console.error('Failed to load custom models:', error);
    // }

    // html += `
    //   <button class="action-btn" id="importCustomModelBtn" style="width: 100%; margin-top: 1rem; background: rgba(102, 126, 234, 0.2); border: 1px solid rgba(102, 126, 234, 0.3);">
    //     📁 Import Custom Model
    //   </button>
    // `;

    // html += "</div>";

    elements.modelsList.innerHTML = html;

    // Render GGUF models list after the main HTML is set
    await renderGgufModelsList();

    elements.modelsList
      .querySelectorAll(
        '.model-item.selectable[data-model]:not([data-model="summary"])'
      )
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;

          if (target.closest(".model-actions")) return;

          const modelSize = (e.currentTarget as HTMLElement).dataset
            .model as WhisperModelSize;
          selectTranscriptionModel(modelSize);
        });
      });

    elements.modelsList.querySelectorAll(".download-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          console.log(
            "Cannot download models during recording or transcription"
          );
          return;
        }

        const model = (e.currentTarget as HTMLButtonElement).dataset.model;
        // handle Whisper model downloads here
        if (model && model !== "summary") {
          handleModelDownload(model as WhisperModelSize);
        }
      });
    });

    const selectSummaryBtn = document.getElementById("selectSummaryModelBtn");
    if (selectSummaryBtn) {
      selectSummaryBtn.addEventListener("click", (e) => {
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        handleSelectSummaryModel();
      });
    }

    const openFolderBtn = document.getElementById("openModelsFolderBtn");
    if (openFolderBtn) {
      openFolderBtn.addEventListener("click", async (e) => {
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        await handleOpenModelsFolder();
      });
    }

    const importBtn = document.getElementById("importModelBtn");
    if (importBtn) {
      importBtn.addEventListener("click", async (e) => {
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        await handleImportGgufModel();
      });
    }

    elements.modelsList.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          console.log("Cannot delete models during recording or transcription");
          return;
        }

        const model = (e.currentTarget as HTMLButtonElement).dataset.model;

        if (model && model !== "summary") {
          handleModelDelete(model as WhisperModelSize);
        }
      });
    });

    // const importBtn = document.getElementById("importCustomModelBtn");
    // if (importBtn) {
    //   importBtn.addEventListener("click", handleImportCustomModel);
    // }
  } catch (error) {
    elements.modelsList.innerHTML =
      '<p class="error-text">Failed to load models</p>';
  }
}

function selectTranscriptionModel(modelSize: WhisperModelSize): void {
  if (isTranscribing) {
    console.log("Cannot change model during transcription");
    return;
  }
  if (isRecordingState()) {
    console.log("Cannot change model during recording");
    return;
  }
  saveSelectedTranscriptionModel(modelSize);
  console.log(`Selected model for transcription: ${modelSize}`);
  refreshModelsList();
}

async function handleModelDownload(modelSize: WhisperModelSize) {
  if (downloadingModel) return;
  downloadingModel = modelSize;
  await refreshModelsList();

  try {
    await downloadModel(modelSize, (progress: TranscriptionProgress) => {
      const fill = document.getElementById(`model-progress-${modelSize}`);
      const text = document.getElementById(`model-progress-text-${modelSize}`);
      if (fill && progress.progress) fill.style.width = `${progress.progress}%`;
      if (text) text.textContent = progress.message;
    });
  } catch (err) {
    alert(`Download failed: ${err}`);
  } finally {
    downloadingModel = null;
  }
}

async function handleModelDelete(modelSize: WhisperModelSize) {
  if (!confirm(`Delete ${modelSize} model?`)) return;
  await deleteModelFromCache(modelSize);
  await refreshModelsList();
}

async function handleSelectSummaryModel(): Promise<void> {
  try {
    const result = await window.electronAPI.selectModelFile();
    
    if (result.canceled || !result.filePath) {
      console.log("Model selection canceled");
      return;
    }
    
    const filePath = result.filePath;
    
    if (!filePath.toLowerCase().endsWith(".gguf")) {
      alert("Please select a valid GGUF model file.");
      return;
    }

    // Ask user if they want to import (copy) the model to the userData folder
    const shouldImport = confirm(
      "Would you like to import this model to your models folder?\n\n" +
      "YES: Copy the model file to your models folder\n" +
      "NO: Use the model from its current location\n\n" +
      "Importing makes it easier to manage your models."
    );

    if (shouldImport) {
      const importResult = await window.electronAPI.importGgufModel({
        sourcePath: filePath,
        copyMode: 'copy'
      });

      if (!importResult.success) {
        alert(`Failed to import model: ${importResult.error}`);
        return;
      }

      saveSelectedModelPath(importResult.path);
      console.log(`Model imported and selected: ${importResult.path}`);
    } else {
      saveSelectedModelPath(filePath);
      console.log(`Selected summarization model: ${filePath}`);
    }
    
    await refreshModelsList();
  } catch (error) {
    console.error("Error selecting model file:", error);
    alert(`Failed to select model file: ${error}`);
  }
}

async function handleSelectGgufModel(modelPath: string): Promise<void> {
  if (isTranscribing || isRecordingState()) {
    console.log("Cannot select model during operation");
    return;
  }
  
  saveSelectedModelPath(modelPath);
  console.log(`Selected GGUF model: ${modelPath}`);
  await renderGgufModelsList();
}

async function handleOpenModelsFolder(): Promise<void> {
  try {
    const result = await window.electronAPI.openModelsFolder();
    if (!result.success) {
      alert(`Failed to open models folder: ${result.error}`);
    }
  } catch (error) {
    console.error("Error opening models folder:", error);
    alert(`Error: ${error}`);
  }
}

async function handleImportGgufModel(): Promise<void> {
  try {
    const result = await window.electronAPI.selectModelFile();
    
    if (result.canceled || !result.filePath) {
      console.log("Import canceled");
      return;
    }
    
    const filePath = result.filePath;
    
    if (!filePath.toLowerCase().endsWith(".gguf")) {
      alert("Please select a valid GGUF model file.");
      return;
    }

    const importResult = await window.electronAPI.importGgufModel({
      sourcePath: filePath,
      copyMode: 'copy'
    });

    if (!importResult.success) {
      alert(`Failed to import model: ${importResult.error}`);
      return;
    }

    console.log(`Model imported: ${importResult.fileName}`);
    
    // Auto-select the newly imported model
    saveSelectedModelPath(importResult.path);
    
    await refreshModelsList();
  } catch (error) {
    console.error("Error importing model:", error);
    alert(`Error: ${error}`);
  }
}

async function handleDeleteGgufModel(modelPath: string): Promise<void> {
  const modelName = modelPath.split(/[/\\]/).pop();
  
  if (!confirm(`Delete model "${modelName}"?\n\nThis will permanently remove the file from your models folder.`)) {
    return;
  }

  try {
    const result = await window.electronAPI.deleteGgufModel(modelPath);
    
    if (!result.success) {
      alert(`Failed to delete model: ${result.error}`);
      return;
    }

    // Clear selection if this was the selected model
    if (getSelectedModelPath() === modelPath) {
      saveSelectedModelPath("");
    }

    console.log(`Model deleted: ${modelName}`);
    await refreshModelsList();
  } catch (error) {
    console.error("Error deleting model:", error);
    alert(`Error: ${error}`);
  }
}

// Custom models disabled for now

// async function handleImportCustomModel() {
//   try {
//     const selectResult = await window.electronAPI.selectCustomModelFolder();

//     if (!selectResult.success) {
//       if (!selectResult.canceled) {
//         alert(`Error selecting folder: ${selectResult.error}`);
//       }
//       return;
//     }

//     if (!selectResult.path) {
//       return;
//     }

//     const validation = await window.electronAPI.validateCustomModel(selectResult.path);

//     if (!validation.valid) {
//       alert(`Invalid model:\n\n${validation.error}\n\nPlease select a valid ONNX model folder for summarization.`);
//       return;
//     }

//     const finalName = validation.modelName || 'custom-model';

//     const importingMsg = document.createElement('div');
//     importingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); padding: 2rem; border-radius: 8px; z-index: 10000; color: white;';
//     importingMsg.textContent = 'Importing model...';
//     document.body.appendChild(importingMsg);

//     try {
//       const importResult = await window.electronAPI.importCustomModel({
//         sourcePath: selectResult.path,
//         modelName: finalName
//       });

//       document.body.removeChild(importingMsg);

//       if (!importResult.success) {
//         alert(`Failed to import model:\n\n${importResult.error}`);
//         return;
//       }

//       alert(`Model imported successfully!\n\nName: ${finalName}\nID: ${importResult.modelId}\n\nYou can now use this model for summarization.`);

//       if (importResult.url) {
//         selectSummaryModel(importResult.url);
//       }

//       await refreshModelsList();
//     } catch (error) {
//       document.body.removeChild(importingMsg);
//       throw error;
//     }
//   } catch (error) {
//     console.error('Error importing custom model:', error);
//     alert(`Error importing model: ${error}`);
//   }
// }

// async function handleCustomModelDelete(modelId: string) {
//   if (!confirm(`Delete custom model?\n\nID: ${modelId}\n\nThis will permanently remove the model files.`)) {
//     return;
//   }

//   try {
//     const result = await window.electronAPI.deleteModel(modelId);

//     if (result.success) {
//       console.log(`Custom model deleted: ${modelId}`);
//       await refreshModelsList();
//     } else {
//       alert('Failed to delete custom model. Please try again.');
//     }
//   } catch (error) {
//     console.error('Error deleting custom model:', error);
//     alert(`Error deleting model: ${error}`);
//   }
// }
