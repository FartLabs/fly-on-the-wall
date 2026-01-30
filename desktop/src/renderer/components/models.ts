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

function createSummaryModelHTML(downloaded: boolean): string {
  const modelName = SUMMARIZATION_MODEL.split("/").pop();
  const isRecording = isRecordingState();
  const isButtonDisabled =
    downloadingSummaryModel || isTranscribing || isRecording;
  const selectedSummaryModel = getSelectedSummaryModel();
  const isSelected =
    downloaded &&
    (!selectedSummaryModel || selectedSummaryModel === SUMMARIZATION_MODEL);
  const isClickable = downloaded && !isTranscribing && !isRecording;

  return `
    <div class="model-item summary-model ${downloaded ? "downloaded" : ""} ${isSelected ? "selected" : ""} ${isClickable ? "selectable" : ""}" data-model="summary" data-model-id="${SUMMARIZATION_MODEL}">
      <div class="model-info">
        <div class="model-name">
          🤖 ${modelName}
          ${isSelected ? '<span style="color: #4CAF50; margin-left: 0.5rem;">● Active</span>' : ""}
        </div>
        <div class="model-meta">
          <span class="model-size">${SUMMARY_MODEL_SIZE}</span>
          <span class="model-status ${downloaded ? "downloaded" : ""}">
            ${downloaded ? "✓ Downloaded" : "Not downloaded"}
          </span>
        </div>
        <div class="model-description" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">
          AI model for generating meeting summaries
          ${downloaded && !isSelected && !isTranscribing && !isRecording ? '<span style="color: #888; font-style: italic;"> • Click to use for summarization</span>' : ""}
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

// this is used frequently, may need to be optimized in future if performance issues arise
export async function refreshModelsList(): Promise<void> {
  try {
    const statuses = await getAllModelStatus();
    const summaryDownloaded = await checkSummarizationModelDownloaded();

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
    html += createSummaryModelHTML(summaryDownloaded);

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
        const modelId = (e.currentTarget as HTMLButtonElement).dataset.modelId;

        // if (modelId) {
        // handleCustomModelDelete(modelId);
        // }
        if (model === "summary") {
          handleSummaryModelDelete();
        } else {
          handleModelDelete(model as WhisperModelSize);
        }
      });
    });

    elements.modelsList
      .querySelectorAll(".summary-model.selectable")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          if (target.closest(".model-actions")) return;

          const modelId = (e.currentTarget as HTMLElement).dataset.modelId;
          if (modelId) {
            selectSummaryModel(modelId);
          }
        });
      });

    // custom model selection disabled for now

    // elements.modelsList.querySelectorAll(".custom-model-item.selectable").forEach((item) => {
    //   item.addEventListener("click", (e) => {
    //     const target = e.target as HTMLElement;
    //     if (target.closest(".model-actions")) return;

    //     const modelUrl = (e.currentTarget as HTMLElement).dataset.modelUrl;
    //     if (modelUrl) {
    //       selectSummaryModel(modelUrl);
    //     }
    //   });
    // });

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

function selectSummaryModel(modelId: string): void {
  if (isTranscribing) {
    console.log("Cannot change model during transcription or summarization");
    return;
  }
  if (isRecordingState()) {
    console.log("Cannot change model during recording");
    return;
  }
  saveSelectedSummaryModel(modelId);
  console.log(`Selected model for summarization: ${modelId}`);
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
