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
let isDownloadingGguf = false;
let ggufDownloadProgressUnsub: (() => void) | null = null;

async function saveSelectedTranscriptionModel(
  modelSize: WhisperModelSize
): Promise<void> {
  await window.electronAPI.configSet({
    transcription: { selectedModel: modelSize } as any
  });
}

export async function getSelectedTranscriptionModel(): Promise<WhisperModelSize | null> {
  const config = await window.electronAPI.configGet();
  return (config.transcription.selectedModel as WhisperModelSize) || null;
}

export function setTranscriptionInProgress(inProgress: boolean): void {
  isTranscribing = inProgress;
  refreshModelsList();
}

function createModelItemHTML(
  status: ModelStatus,
  selectedModel: WhisperModelSize | null
): string {
  const isDownloading = downloadingModel === status.modelSize;
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
            ${status.downloaded ? "Downloaded" : "Not downloaded"}
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
    <div class="settings-model-actions-row">
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

      <div class="settings-model-download-action">
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
      <div class="gguf-models-empty">Loading models...</div>
    </div>
  `;
}

// dynamically render the list of .gguf models
async function renderGgufModelsList(): Promise<void> {
  const container = document.getElementById("ggufModelsList");
  if (!container) return;

  try {
    const result = await window.electronAPI.listGgufModels();
    const selectedModelPath = await getSelectedModelPath();
    const isRecording = isRecordingState();

    if (!result.success) {
      container.innerHTML = `<div class="gguf-models-error">Error loading models: ${result.error}</div>`;
      return;
    }

    if (result.models.length === 0) {
      container.innerHTML = `
        <div class="gguf-models-empty">
          No GGUF models found.<br>
          <span class="gguf-models-empty-hint">Import a model or drag-and-drop .gguf files into the models folder.</span>
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
             data-model-path="${model.path}">
          <div class="gguf-model-item-content">
            <div class="gguf-model-name">
              ${model.name}
              ${isSelected ? '<span style="color: #4CAF50; margin-left: 0.5rem;">● Active</span>' : ""}
            </div>
            <div class="gguf-model-meta">
              ${model.sizeFormatted}
              ${!isSelected && isClickable ? " • Click to use for summarization" : ""}
              ${isTranscribing || isRecording ? " • Locked during operation" : ""}
            </div>
          </div>
          <div class="model-actions">
            <button class="model-btn delete-btn gguf-delete-btn" 
                    data-model-path="${model.path}"
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
    container.innerHTML = `<div class="gguf-models-error">Error: ${error}</div>`;
  }
}

// this is used frequently, may need to be optimized in future if performance issues arise
export async function refreshModelsList(): Promise<void> {
  try {
    const statuses = await getAllModelStatus();
    const transcriptionContainer = document.getElementById(
      "transcriptionModelsContainer"
    );

    // auto-select first downloaded model if none selected
    const downloadedModels = statuses.filter((s) => s.downloaded);
    const currentSelected = await getSelectedTranscriptionModel();
    if (
      downloadedModels.length > 0 &&
      (!currentSelected ||
        !downloadedModels.some((m) => m.modelSize === currentSelected))
    ) {
      await saveSelectedTranscriptionModel(downloadedModels[0].modelSize);
    }

    let html = '<div class="model-section">';
    const selectedTranscription = await getSelectedTranscriptionModel();
    html += statuses
      .map((status) => createModelItemHTML(status, selectedTranscription))
      .join("");
    html += "</div>";

    if (transcriptionContainer) {
      transcriptionContainer.innerHTML = html;
    }

    const summarizationContainer = document.getElementById(
      "summarizationModelsContainer"
    );
    if (summarizationContainer) {
      summarizationContainer.innerHTML = createSummaryModelHTML();
    }

    await renderGgufModelsList();

    transcriptionContainer
      ?.querySelectorAll(
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

    transcriptionContainer?.querySelectorAll(".download-btn").forEach((btn) => {
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

    const tabs = document.querySelectorAll(
      "#summarizationModelsContainer .gguf-tab"
    );
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

    transcriptionContainer?.querySelectorAll(".delete-btn").forEach((btn) => {
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
    const transcriptionContainer = document.getElementById(
      "transcriptionModelsContainer"
    );
    if (transcriptionContainer) {
      transcriptionContainer.innerHTML =
        '<p class="error-text">Failed to load models</p>';
    }
  }
}

async function selectTranscriptionModel(
  modelSize: WhisperModelSize
): Promise<void> {
  if (isTranscribing) {
    console.log("Cannot change model during transcription");
    return;
  }
  if (isRecordingState()) {
    console.log("Cannot change model during recording");
    return;
  }
  await saveSelectedTranscriptionModel(modelSize);
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

    await saveSelectedModelPath(importResult.path);
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

  await saveSelectedModelPath(modelPath);
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

    await saveSelectedModelPath(importResult.path);

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
        await saveSelectedModelPath(downloadResult.path);
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

    if ((await getSelectedModelPath()) === modelPath) {
      await saveSelectedModelPath("");
    }

    console.log(`Model deleted: ${modelName}`);
    await refreshModelsList();
  } catch (error) {
    console.error("Error deleting model:", error);
    alert(`Error: ${error}`);
  }
}
