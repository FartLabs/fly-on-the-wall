import { showNotification } from "./notifications";
import { formatBytes } from "@/utils";
import {
  transcribeAudio,
  checkModelDownloaded,
  type TranscriptionProgress
} from "@/transcription";
import {
  summarizeText,
  checkSummarizationModelDownloaded,
  getSelectedModelPath,
  type SummarizationProgress
} from "@/summarization";
import {
  getSelectedTranscriptionModel,
  setTranscriptionInProgress
} from "./models";
import { elements } from "./domNodes";
import { getMinSummaryLength } from "./settings";

// 1 GB threshold for large file warning
// TODO: make this configurable via settings
const LARGE_FILE_THRESHOLD = 1024 * 1024 * 1024;

type ImportStatus =
  | "pending"
  | "importing"
  | "transcribing"
  | "summarizing"
  | "saving"
  | "done"
  | "error";

interface ImportQueueItem {
  sourcePath: string;
  originalName: string;
  size: number;
  mode: "copy" | "move";
  status: ImportStatus;
  error?: string;
  recordingFilename?: string;
}

let importQueue: ImportQueueItem[] = [];
let isProcessing = false;

function statusLabel(status: ImportStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "importing":
      return "Copying file…";
    case "transcribing":
      return "Transcribing…";
    case "summarizing":
      return "Summarizing…";
    case "saving":
      return "Saving note…";
    case "done":
      return "Saved";
    case "error":
      return "Failed";
  }
}

function statusClass(status: ImportStatus): string {
  switch (status) {
    case "done":
      return "import-status-done";
    case "error":
      return "import-status-error";
    case "pending":
      return "import-status-pending";
    default:
      return "import-status-active";
  }
}

function renderQueue(): void {
  const container = elements.importQueue;
  const list = elements.importQueueList;
  const count = elements.importQueueCount;

  if (!container || !list || !count) return;

  if (importQueue.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");

  const doneCount = importQueue.filter((i) => i.status === "done").length;
  count.textContent = `${doneCount} / ${importQueue.length} complete`;

  list.innerHTML = "";
  for (const item of importQueue) {
    const row = document.createElement("div");
    row.className = "import-queue-item";

    const nameEl = document.createElement("span");
    nameEl.className = "import-queue-name";
    nameEl.textContent = item.originalName;
    nameEl.title = item.sourcePath;

    const sizeEl = document.createElement("span");
    sizeEl.className = "import-queue-size";
    sizeEl.textContent = formatBytes(item.size);

    const statusEl = document.createElement("span");
    statusEl.className = `import-queue-status ${statusClass(item.status)}`;
    statusEl.textContent = statusLabel(item.status);
    if (item.error) {
      statusEl.title = item.error;
    }

    row.appendChild(nameEl);
    row.appendChild(sizeEl);
    row.appendChild(statusEl);
    list.appendChild(row);
  }
}

function showLargeFileDialog(
  fileName: string,
  fileSize: number
): Promise<"copy" | "move" | "skip"> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "import-dialog-overlay";

    const dialog = document.createElement("div");
    dialog.className = "import-dialog";
    dialog.innerHTML = `
      <h3>Large File Detected</h3>
      <p><strong>${fileName}</strong> is <strong>${formatBytes(fileSize)}</strong>.</p>
      <p>Copying this file will use additional disk space. You can also move it instead (the original file stays intact).</p>
      <div class="import-dialog-actions">
        <button class="action-btn primary" id="importDialogCopy">Copy</button>
        <button class="action-btn" id="importDialogMove">Move</button>
        <button class="action-btn secondary" id="importDialogSkip">Skip</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => document.body.removeChild(overlay);

    dialog.querySelector("#importDialogCopy")!.addEventListener("click", () => {
      cleanup();
      resolve("copy");
    });
    dialog.querySelector("#importDialogMove")!.addEventListener("click", () => {
      cleanup();
      resolve("move");
    });
    dialog.querySelector("#importDialogSkip")!.addEventListener("click", () => {
      cleanup();
      resolve("skip");
    });
  });
}

async function openImportDialog() {
  if (isProcessing) {
    showNotification(
      "An import is already in progress. Please wait for it to finish.",
      "info"
    );
    return;
  }

  const result = await window.electronAPI.selectAudioFiles();
  if (result.canceled || result.files.length === 0) return;

  const newItems: ImportQueueItem[] = [];

  for (const file of result.files) {
    let mode: "copy" | "move" = "copy";

    if (file.size >= LARGE_FILE_THRESHOLD) {
      const choice = await showLargeFileDialog(file.name, file.size);
      if (choice === "skip") continue;
      mode = choice;
    }

    newItems.push({
      sourcePath: file.path,
      originalName: file.name,
      size: file.size,
      mode,
      status: "pending"
    });
  }

  if (newItems.length === 0) return;

  importQueue = newItems;
  renderQueue();

  showNotification(
    `Importing ${newItems.length} file${newItems.length > 1 ? "s" : ""}…`,
    "info"
  );

  await processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  // disable the import button while processing
  const importBtn = document.getElementById(
    "importAudioBtn"
  ) as HTMLButtonElement | null;
  if (importBtn) importBtn.disabled = true;

  for (const item of importQueue) {
    if (item.status !== "pending") continue;

    try {
      // import file
      item.status = "importing";
      renderQueue();

      const importResult = await window.electronAPI.importAudioFile({
        sourcePath: item.sourcePath,
        mode: item.mode
      });

      if (!importResult.success || !importResult.filename) {
        throw new Error(importResult.error || "Import failed");
      }

      item.recordingFilename = importResult.filename;

      // read buffer for transcription
      const bufferResult = await window.electronAPI.getRecordingBuffer(
        importResult.filename
      );
      if (!bufferResult.success || !bufferResult.buffer) {
        throw new Error(bufferResult.error || "Failed to read imported file");
      }

      // transcribe
      item.status = "transcribing";
      renderQueue();

      const modelSize = await getSelectedTranscriptionModel();
      if (!modelSize) {
        throw new Error(
          "No transcription model selected. Please select one in AI Models."
        );
      }

      const isDownloaded = await checkModelDownloaded(modelSize);
      if (!isDownloaded) {
        throw new Error(
          "Transcription model not downloaded. Please download it first."
        );
      }

      setTranscriptionInProgress(true);

      const transcriptionResult = await transcribeAudio(bufferResult.buffer, {
        modelSize,
        onProgress: (_progress: TranscriptionProgress) => {
          item.status = "transcribing";
          renderQueue();
        }
      });

      setTranscriptionInProgress(false);

      const transcription = transcriptionResult.text;
      showNotification("Transcription complete", "success");

      // summarize if long enough
      let summary = "";
      if (
        transcription &&
        transcription.trim().length > (await getMinSummaryLength())
      ) {
        item.status = "summarizing";
        renderQueue();

        const selectedModelPath = await getSelectedModelPath();
        if (selectedModelPath) {
          const isModelValid =
            await checkSummarizationModelDownloaded(selectedModelPath);
          if (isModelValid) {
            try {
              const sumResult = await summarizeText(
                transcription,
                (_progress: SummarizationProgress) => {
                  item.status = "summarizing";
                  renderQueue();
                },
                selectedModelPath
              );
              summary = sumResult.summary;
              showNotification("Summary generated successfully", "success");
            } catch (err) {
              console.warn("Summarization failed for import, continuing:", err);
            }
          }
        }
      }

      item.status = "saving";
      renderQueue();

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);

      const metadata: Record<string, any> = {
        recordingFilename: importResult.filename,
        originalFilename: item.originalName,
        importedFrom: item.sourcePath,
        importedAt: new Date().toISOString()
      };

      const noteResult = await window.electronAPI.saveNote({
        transcription,
        summary: summary || undefined,
        filename: `import_${timestamp}_${item.originalName.replace(/\.[^.]+$/, "")}.json`,
        metadata
      });

      if (!noteResult.success) {
        throw new Error(noteResult.error || "Failed to save note");
      }

      item.status = "done";
      renderQueue();
    } catch (err: any) {
      console.error(`Import failed for ${item.originalName}:`, err);
      item.status = "error";
      item.error = err.message || String(err);
      renderQueue();
      setTranscriptionInProgress(false);
    }
  }

  isProcessing = false;
  if (importBtn) importBtn.disabled = false;

  const doneCount = importQueue.filter((i) => i.status === "done").length;
  const errorCount = importQueue.filter((i) => i.status === "error").length;

  if (errorCount === 0) {
    showNotification(
      `All ${doneCount} file${doneCount > 1 ? "s" : ""} imported and saved as notes!`,
      "success"
    );
  } else {
    showNotification(
      `${doneCount} imported, ${errorCount} failed. Hover status for details.`,
      errorCount === importQueue.length ? "error" : "info"
    );
  }
}

export function setupImportListeners(): void {
  const importBtn = document.getElementById("importAudioBtn");
  importBtn?.addEventListener("click", openImportDialog);
}
