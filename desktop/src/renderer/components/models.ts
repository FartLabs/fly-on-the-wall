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
  checkSummarizationModelDownloaded,
  downloadSummarizationModel,
  deleteSummarizationModel,
  type SummarizationProgress
} from "@/summarization";
import {
  SUMMARIZATION_MODEL,
  MODEL_SIZE as SUMMARY_MODEL_SIZE
} from "@/summarization/pipeline";
let downloadingModel: WhisperModelSize | null = null;
let downloadingSummaryModel = false;
let isTranscribing = false;

export const STORAGE_KEY_SELECTED_MODEL = "selectedWhisperModel";

export function saveSelectedModel(modelSize: WhisperModelSize): void {
  localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, modelSize);
}

export function getSelectedModel(): WhisperModelSize | null {
  return localStorage.getItem(
    STORAGE_KEY_SELECTED_MODEL
  ) as WhisperModelSize | null;
}

export function setTranscriptionInProgress(inProgress: boolean): void {
  isTranscribing = inProgress;
  refreshModelsList();
}

function createModelItemHTML(status: ModelStatus): string {
  const isDownloading = downloadingModel === status.modelSize;
  const selectedModel = getSelectedModel();
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

function createSummaryModelHTML(downloaded: boolean): string {
  const modelName = SUMMARIZATION_MODEL.split("/").pop();
  const isRecording = isRecordingState();
  const isButtonDisabled = downloadingSummaryModel || isTranscribing || isRecording;

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
            ? `<button class="model-btn delete-btn" data-model="summary" ${isButtonDisabled ? "disabled" : ""}>Delete</button>`
            : `<button class="model-btn download-btn" data-model="summary" ${isButtonDisabled ? "disabled" : ""}>
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

    // auto-select first downloaded model if none selected
    const downloadedModels = statuses.filter((s) => s.downloaded);
    const currentSelected = getSelectedModel();
    if (
      downloadedModels.length > 0 &&
      (!currentSelected ||
        !downloadedModels.some((m) => m.modelSize === currentSelected))
    ) {
      saveSelectedModel(downloadedModels[0].modelSize);
    }

    let html =
      '<div class="model-section"><h3 style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">Transcription Models</h3>';
    html += statuses.map((status) => createModelItemHTML(status)).join("");
    html += "</div>";

    html +=
      '<div class="model-section" style="margin-top: 1.5rem;"><h3 style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">Summarization Model</h3>';
    html += createSummaryModelHTML(summaryDownloaded);
    html += "</div>";

    elements.modelsList.innerHTML = html;

    elements.modelsList
      .querySelectorAll(".model-item.selectable")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;

          if (target.closest(".model-actions")) return;

          const modelSize = (e.currentTarget as HTMLElement).dataset
            .model as WhisperModelSize;
          selectModelForTranscription(modelSize);
        });
      });

    elements.modelsList.querySelectorAll(".download-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          console.log("Cannot download models during recording or transcription");
          return;
        }
        
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
        if (isRecordingState() || isTranscribing) {
          e.preventDefault();
          e.stopPropagation();
          console.log("Cannot delete models during recording or transcription");
          return;
        }
        
        const model = (e.currentTarget as HTMLButtonElement).dataset.model;
        if (model === "summary") {
          handleSummaryModelDelete();
        } else {
          handleModelDelete(model as WhisperModelSize);
        }
      });
    });
  } catch (error) {
    elements.modelsList.innerHTML =
      '<p class="error-text">Failed to load models</p>';
  }
}

function selectModelForTranscription(modelSize: WhisperModelSize): void {
  if (isTranscribing) {
    console.log("Cannot change model during transcription");
    return;
  }
  if (isRecordingState()) {
    console.log("Cannot change model during recording");
    return;
  }
  saveSelectedModel(modelSize);
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
