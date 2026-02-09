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
import { LOCAL_STORAGE_KEYS } from "./settings";

let downloadingModel: WhisperModelSize | null = null;
let isTranscribing = false;
let isDownloadingGguf = false;
let ggufDownloadProgressUnsub: (() => void) | null = null;

const SELECTED_TRANSCRIPTION_MODEL =
  LOCAL_STORAGE_KEYS.SELECTED_TRANSCRIPTION_MODEL;

export function saveSelectedTranscriptionModel(
  modelSize: WhisperModelSize
): void {
  localStorage.setItem(SELECTED_TRANSCRIPTION_MODEL, modelSize);
}

export function getSelectedTranscriptionModel(): WhisperModelSize | null {
  return localStorage.getItem(
    SELECTED_TRANSCRIPTION_MODEL
  ) as WhisperModelSize | null;
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

    <div class="gguf-download-section">
      <h4 class="gguf-download-title">Download from Hugging Face</h4>

      <div class="gguf-download-tabs">
        <button class="gguf-tab active" data-tab="url">Direct URL</button>
        <button class="gguf-tab" data-tab="repo">Repo + Filename</button>
      </div>

      <div class="gguf-tab-content" id="ggufTabUrl">
        <input
          type="text"
          id="ggufDirectUrlInput"
          class="gguf-download-input"
          placeholder="hf:lmstudio-community/Llama-3.2-1B-Instruct-GGUF:Q3_K_L"
          ${isDownloadingGguf ? "disabled" : ""}
        />
      </div>

      <div class="gguf-tab-content hidden" id="ggufTabRepo">
        <input
          type="text"
          id="ggufRepoInput"
          class="gguf-download-input"
          placeholder="Repo ID (e.g. TheBloke/Llama-2-7B-GGUF)"
          ${isDownloadingGguf ? "disabled" : ""}
        />
        <input
          type="text"
          id="ggufFilenameInput"
          class="gguf-download-input"
          placeholder="Filename (e.g. llama-2-7b.Q4_K_M.gguf)"
          style="margin-top: 0.5rem;"
          ${isDownloadingGguf ? "disabled" : ""}
        />
        <input
          type="text"
          id="ggufRevisionInput"
          class="gguf-download-input"
          placeholder="Branch/tag (default: main)"
          style="margin-top: 0.5rem;"
          ${isDownloadingGguf ? "disabled" : ""}
        />
      </div>

      <div style="margin-top: 0.75rem;">
        <button class="model-btn download-btn" id="ggufDownloadBtn" ${isButtonDisabled || isDownloadingGguf ? "disabled" : ""}>
          ${isDownloadingGguf ? "Downloading..." : "Download Model"}
        </button>
      </div>

      <div class="gguf-download-progress hidden" id="ggufDownloadProgress">
        <div class="model-progress-bar">
          <div class="model-progress-fill" id="ggufProgressFill"></div>
        </div>
        <div class="model-progress-text" id="ggufProgressText">Starting...</div>
      </div>
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

    const tabs = elements.modelsList.querySelectorAll(".gguf-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const tabName = (tab as HTMLElement).dataset.tab;
        const urlContent = document.getElementById("ggufTabUrl");
        const repoContent = document.getElementById("ggufTabRepo");
        if (urlContent)
          urlContent.classList.toggle("hidden", tabName !== "url");
        if (repoContent)
          repoContent.classList.toggle("hidden", tabName !== "repo");
      });
    });

    const ggufDownloadBtn = document.getElementById("ggufDownloadBtn");
    if (ggufDownloadBtn) {
      ggufDownloadBtn.addEventListener("click", async (e) => {
        if (isRecordingState() || isTranscribing || isDownloadingGguf) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        await handleDownloadGgufModel();
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

async function handleDownloadGgufModel(): Promise<void> {
  const activeTab = document.querySelector(".gguf-tab.active") as HTMLElement;
  const tabName = activeTab?.dataset.tab || "url";

  let downloadData: {
    url?: string;
    repo?: string;
    filename?: string;
    revision?: string;
  };

  if (tabName === "url") {
    const urlInput = document.getElementById(
      "ggufDirectUrlInput"
    ) as HTMLInputElement;
    const url = urlInput?.value.trim();
    if (!url) {
      showNotification("Please enter a URL.", "error");
      return;
    }
    downloadData = { url };
  } else {
    const repoInput = document.getElementById(
      "ggufRepoInput"
    ) as HTMLInputElement;
    const filenameInput = document.getElementById(
      "ggufFilenameInput"
    ) as HTMLInputElement;
    const revisionInput = document.getElementById(
      "ggufRevisionInput"
    ) as HTMLInputElement;
    const repo = repoInput?.value.trim();
    const filename = filenameInput?.value.trim();
    const revision = revisionInput?.value.trim() || undefined;
    if (!repo || !filename) {
      showNotification("Please enter both repo ID and filename.", "error");
      return;
    }
    if (!filename.toLowerCase().endsWith(".gguf")) {
      showNotification("Filename must end with .gguf", "error");
      return;
    }
    downloadData = { repo, filename, revision };
  }

  try {
    const checkResult =
      await window.electronAPI.checkGgufModelUrl(downloadData);
    if (!checkResult.success) {
      showNotification(`Invalid model: ${checkResult.error}`, "error");
      return;
    }

    if (checkResult.exists) {
      const incomingSize = checkResult.sizeFormatted || "unknown size";
      const existingSize = checkResult.existingSizeFormatted || "unknown size";
      const shouldReplace = confirm(
        `A model named "${checkResult.fileName}" already exists.\n\n` +
          `Existing file: ${existingSize}\n` +
          `New file: ${incomingSize}\n\n` +
          `Do you want to replace it?`
      );
      if (!shouldReplace) return;
    }

    isDownloadingGguf = true;
    const progressContainer = document.getElementById("ggufDownloadProgress");
    if (progressContainer) progressContainer.classList.remove("hidden");

    if (ggufDownloadProgressUnsub) ggufDownloadProgressUnsub();
    ggufDownloadProgressUnsub = window.electronAPI.onGgufDownloadProgress(
      (progress) => {
        const fill = document.getElementById("ggufProgressFill");
        const text = document.getElementById("ggufProgressText");
        if (fill) fill.style.width = `${progress.percent}%`;
        if (text) text.textContent = progress.message;
      }
    );

    const dlBtn = document.getElementById(
      "ggufDownloadBtn"
    ) as HTMLButtonElement;
    if (dlBtn) {
      dlBtn.disabled = true;
      dlBtn.textContent = "Downloading...";
    }

    const downloadResult =
      await window.electronAPI.downloadGgufModel(downloadData);

    if (!downloadResult.success) {
      showNotification(`Download failed: ${downloadResult.error}`, "error");
    } else {
      showNotification(
        `Model "${downloadResult.fileName}" downloaded successfully!`,
        "success"
      );

      if (downloadResult.path) {
        saveSelectedModelPath(downloadResult.path);
      }

      const urlInput = document.getElementById(
        "ggufDirectUrlInput"
      ) as HTMLInputElement;
      const repoInput = document.getElementById(
        "ggufRepoInput"
      ) as HTMLInputElement;
      const filenameInput = document.getElementById(
        "ggufFilenameInput"
      ) as HTMLInputElement;
      const revisionInput = document.getElementById(
        "ggufRevisionInput"
      ) as HTMLInputElement;
      if (urlInput) urlInput.value = "";
      if (repoInput) repoInput.value = "";
      if (filenameInput) filenameInput.value = "";
      if (revisionInput) revisionInput.value = "";
    }
  } catch (error) {
    console.error("Error downloading GGUF model:", error);
    showNotification(`Download error: ${error}`, "error");
  } finally {
    isDownloadingGguf = false;
    if (ggufDownloadProgressUnsub) {
      ggufDownloadProgressUnsub();
      ggufDownloadProgressUnsub = null;
    }

    setTimeout(() => {
      const progressContainer = document.getElementById("ggufDownloadProgress");
      if (progressContainer) progressContainer.classList.add("hidden");
    }, 2000);

    await refreshModelsList();
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
