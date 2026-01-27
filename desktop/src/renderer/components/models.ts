import { elements } from "./domNodes";
import {
  getAllModelStatus,
  downloadModel,
  deleteModel as deleteModelFromCache,
  type TranscriptionProgress,
  type ModelStatus
} from "../../transcription";
import {
  MODEL_SIZES,
  type WhisperModelSize,
  MODEL_DESCRIPTIONS
} from "../../transcription/whisper";
import {
  checkSummarizationModelDownloaded,
  downloadSummarizationModel,
  deleteSummarizationModel,
  type SummarizationProgress
} from "../../summarization";
import {
  SUMMARIZATION_MODEL,
  MODEL_SIZE as SUMMARY_MODEL_SIZE
} from "../../summarization/pipeline";

let downloadingModel: WhisperModelSize | null = null;
let downloadingSummaryModel = false;

function createModelItemHTML(status: ModelStatus): string {
  const isDownloading = downloadingModel === status.modelSize;

  return `
    <div class="model-item ${status.downloaded ? "downloaded" : ""}" data-model="${status.modelSize}">
      <div class="model-info">
        <div class="model-name">Whisper ${status.modelSize.charAt(0).toUpperCase() + status.modelSize.slice(1)}</div>
        <div class="model-meta">
          <span class="model-size">${status.size}</span>
          <span class="model-status ${status.downloaded ? "downloaded" : ""}">
            ${status.downloaded ? "✓ Downloaded" : "Not downloaded"}
          </span>
        </div>
        <div class="model-description" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">
          ${MODEL_DESCRIPTIONS[status.modelSize]}
        </div>
      </div>
      <div class="model-actions">
        ${
          status.downloaded
            ? `<button class="model-btn delete-btn" data-model="${status.modelSize}" ${isDownloading ? "disabled" : ""}>Delete</button>`
            : `<button class="model-btn download-btn" data-model="${status.modelSize}" ${isDownloading ? "disabled" : ""}>
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

function createSummaryModelHTML(downloaded: boolean): string {
  const modelName = SUMMARIZATION_MODEL.split("/").pop();

  return `
    <div class="model-item summary-model ${downloaded ? "downloaded" : ""}" data-model="summary">
      <div class="model-info">
        <div class="model-name">🤖 ${modelName}</div>
        <div class="model-meta">
          <span class="model-size">${SUMMARY_MODEL_SIZE}</span>
          <span class="model-status ${downloaded ? "downloaded" : ""}">
            ${downloaded ? "✓ Downloaded" : "Not downloaded"}
          </span>
        </div>
        <div class="model-description" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">
          AI model for generating meeting summaries
        </div>
      </div>
      <div class="model-actions">
        ${
          downloaded
            ? `<button class="model-btn delete-btn" data-model="summary" ${downloadingSummaryModel ? "disabled" : ""}>Delete</button>`
            : `<button class="model-btn download-btn" data-model="summary" ${downloadingSummaryModel ? "disabled" : ""}>
              ${downloadingSummaryModel ? "Downloading..." : "Download"}
            </button>`
        }
      </div>
      ${
        downloadingSummaryModel
          ? `
        <div class="model-download-progress">
          <div class="model-progress-bar">
            <div class="model-progress-fill" id="model-progress-summary"></div>
          </div>
          <div class="model-progress-text" id="model-progress-text-summary">Starting...</div>
        </div>
      `
          : ""
      }
    </div>
  `;
}

export async function refreshModelsList(): Promise<void> {
  try {
    const statuses = await getAllModelStatus();
    const summaryDownloaded = await checkSummarizationModelDownloaded();

    let html =
      '<div class="model-section"><h3 style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">Transcription Models</h3>';
    html += statuses.map((status) => createModelItemHTML(status)).join("");
    html += "</div>";

    html +=
      '<div class="model-section" style="margin-top: 1.5rem;"><h3 style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">Summarization Model</h3>';
    html += createSummaryModelHTML(summaryDownloaded);
    html += "</div>";

    elements.modelsList.innerHTML = html;

    elements.modelsList.querySelectorAll(".download-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const model = (e.currentTarget as HTMLButtonElement).dataset.model;
        if (model === "summary") {
          handleSummaryModelDownload();
        } else {
          handleModelDownload(model as WhisperModelSize);
        }
      });
    });

    elements.modelsList.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const model = (e.currentTarget as HTMLButtonElement).dataset.model;
        if (model === "summary") {
          handleSummaryModelDelete();
        } else {
          handleModelDelete(model as WhisperModelSize);
        }
      });
    });

    updateModelSelectOptions(statuses);
  } catch (error) {
    elements.modelsList.innerHTML =
      '<p class="error-text">Failed to load models</p>';
  }
}

function updateModelSelectOptions(statuses: ModelStatus[]): void {
  const downloadedModels = statuses.filter((s) => s.downloaded);
  const currentValue = elements.modelSelect.value as WhisperModelSize;

  elements.modelSelect.innerHTML = "";

  if (downloadedModels.length === 0) {
    elements.modelSelect.innerHTML =
      '<option value="" disabled selected>No models downloaded</option>';
    elements.modelSelect.disabled = true;
  } else {
    downloadedModels.forEach((status) => {
      const option = document.createElement("option");
      option.value = status.modelSize;
      option.textContent = `Whisper ${status.modelSize} (${MODEL_SIZES[status.modelSize]})`;
      elements.modelSelect.appendChild(option);
    });
    elements.modelSelect.disabled = false;
    if (downloadedModels.some((m) => m.modelSize === currentValue)) {
      elements.modelSelect.value = currentValue;
    }
  }
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

async function handleSummaryModelDownload() {
  if (downloadingSummaryModel) return;
  downloadingSummaryModel = true;
  await refreshModelsList();

  try {
    await downloadSummarizationModel((progress: SummarizationProgress) => {
      const fill = document.getElementById("model-progress-summary");
      const text = document.getElementById("model-progress-text-summary");
      if (fill && progress.progress) fill.style.width = `${progress.progress}%`;
      if (text) text.textContent = progress.message;
    });
  } catch (err) {
    alert(`Download failed: ${err}`);
  } finally {
    downloadingSummaryModel = false;
    await refreshModelsList();
  }
}

async function handleSummaryModelDelete() {
  if (
    !confirm(
      `Delete summarization model (${SUMMARY_MODEL_SIZE})?\n\nThis will free up disk space.`
    )
  )
    return;

  const success = await deleteSummarizationModel();
  if (success) {
    console.log("Summarization model deleted successfully");
  } else {
    alert("Failed to delete summarization model. Please try again.");
  }
  await refreshModelsList();
}

async function handleModelDelete(modelSize: WhisperModelSize) {
  if (!confirm(`Delete ${modelSize} model?`)) return;
  await deleteModelFromCache(modelSize);
  await refreshModelsList();
}
