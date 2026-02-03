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
import { getSelectedModelPath, saveSelectedModelPath } from "@/summarization";
import { showNotification } from "./notifications";

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
  const isRecording = isRecordingState();
  const isButtonDisabled = isTranscribing || isRecording;

  return `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <button class="model-btn" id="openModelsFolderBtn" ${isButtonDisabled ? "disabled" : ""}>
        Open Folder
      </button>
      <button class="model-btn" id="importModelBtn" ${isButtonDisabled ? "disabled" : ""}>
        Import Model
      </button>
    </div>
    <div id="ggufModelsList">
      <div style="text-align: center; padding: 1rem; color: #888;">Loading models...</div>
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

    let html = "";
    result.models.forEach((model: any) => {
      const isSelected = selectedModelPath === model.path;
      const isClickable = !isTranscribing && !isRecording;
      html += `
        <div class="gguf-model-item ${isSelected ? "selected" : ""} ${isClickable ? "selectable" : ""}" 
             data-model-path="${model.path}" 
             style="padding: 0.5rem; background: rgba(102, 126, 234, ${isSelected ? "0.2" : "0.1"}); 
                    border-radius: 6px; margin-bottom: 0.5rem; 
                    display: flex; justify-content: space-between; align-items: center; 
                    cursor: ${isClickable ? "pointer" : "default"};">
          <div style="flex: 1; min-width: 0; overflow: hidden;">
            <div style="font-size: 0.85rem; color: #fff;">
              ${model.name}
              ${isSelected ? '<span style="color: #4CAF50; margin-left: 0.5rem;">● Active</span>' : ""}
            </div>
            <div style="font-size: 0.7rem; color: #666;">
              ${model.sizeFormatted}
              ${!isSelected && isClickable ? " • Click to use for summarization" : ""}
              ${isTranscribing || isRecording ? " • Locked during operation" : ""}
            </div>
          </div>
          <div class="model-actions">
            <button class="model-btn delete-btn gguf-delete-btn" 
                    data-model-path="${model.path}"
                    style="padding: 0.25rem 0.5rem; font-size: 0.75rem;"
                    ${!isClickable ? "disabled" : ""}>
              Delete
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    container
      .querySelectorAll(".gguf-model-item.selectable")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          if (target.closest(".gguf-delete-btn")) return;

          const modelPath = (e.currentTarget as HTMLElement).dataset.modelPath;
          if (modelPath) {
            handleSelectGgufModel(modelPath);
          }
        });
      });

    container.querySelectorAll(".gguf-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
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

    elements.modelsList.innerHTML = html;

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

    console.log(
      `Model ${modelSize} downloaded successfully, refreshing list...`
    );
    await refreshModelsList();
  } catch (err) {
    console.error(`Download failed for ${modelSize}:`, err);
    alert(`Download failed: ${err}`);
  } finally {
    downloadingModel = null;
    await refreshModelsList();
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
      showNotification("Please select a valid GGUF model file.", "error");
      return;
    }

    const importResult = await window.electronAPI.importGgufModel({
      sourcePath: filePath,
      copyMode: "copy"
    });

    if (!importResult.success) {
      showNotification(
        `Failed to import model: ${importResult.error}`,
        "error"
      );
      return;
    }

    saveSelectedModelPath(importResult.path);
    console.log(`Model imported and selected: ${importResult.path}`);
    showNotification(
      `Model "${importResult.fileName}" imported successfully`,
      "success"
    );

    await refreshModelsList();
  } catch (error) {
    console.error("Error selecting model file:", error);
    showNotification(`Failed to select model file: ${error}`, "error");
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
      showNotification("Please select a valid GGUF model file.", "error");
      return;
    }

    const importResult = await window.electronAPI.importGgufModel({
      sourcePath: filePath,
      copyMode: "copy"
    });

    if (!importResult.success) {
      showNotification(
        `Failed to import model: ${importResult.error}`,
        "error"
      );
      return;
    }

    console.log(`Model imported: ${importResult.fileName}`);
    showNotification(
      `Model "${importResult.fileName}" imported successfully`,
      "success"
    );

    saveSelectedModelPath(importResult.path);

    await refreshModelsList();
  } catch (error) {
    console.error("Error importing model:", error);
    showNotification(`Error importing model: ${error}`, "error");
  }
}

async function handleDeleteGgufModel(modelPath: string): Promise<void> {
  const modelName = modelPath.split(/[/\\]/).pop();

  if (
    !confirm(
      `Delete model "${modelName}"?\n\nThis will permanently remove the file from your models folder.`
    )
  ) {
    return;
  }

  try {
    const result = await window.electronAPI.deleteGgufModel(modelPath);

    if (!result.success) {
      alert(`Failed to delete model: ${result.error}`);
      return;
    }

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
