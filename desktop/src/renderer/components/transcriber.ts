import { elements } from "./domNodes";
import {
  transcribeAudio,
  checkModelDownloaded,
  type TranscriptionProgress
} from "@/transcription";
import { runSummarization, clearSummary } from "./summarizer";
import {
  getSelectedTranscriptionModel,
  setTranscriptionInProgress
} from "./models";

let lastTranscription: string | null = null;
let lastTimestamp: string | null = null;
let lastRecordingFilename: string | null = null;

function updateProgress(progress: TranscriptionProgress): void {
  if (
    !elements.transcriptionProgress ||
    !elements.transcriptionResult ||
    !elements.transcriptionEmpty ||
    !elements.progressText ||
    !elements.progressFill
  ) {
    console.warn("Transcription UI elements not found");
    return;
  }

  elements.transcriptionProgress.classList.remove("hidden");
  elements.transcriptionResult.classList.add("hidden");
  elements.transcriptionEmpty.classList.add("hidden");
  elements.progressText.textContent = progress.message;

  if (progress.progress !== undefined) {
    elements.progressFill.style.width = `${progress.progress}%`;
  } else if (progress.status === "transcribing") {
    elements.progressFill.classList.add("indeterminate");
  }
}

export async function runTranscription(
  buffer: ArrayBuffer,
  timestamp: string,
  recordingFilename?: string
): Promise<void> {
  console.log(
    "[runTranscription] Recording filename received:",
    recordingFilename
  );
  lastTimestamp = timestamp;
  lastRecordingFilename = recordingFilename || null;
  console.log(
    "[runTranscription] Set lastRecordingFilename to:",
    lastRecordingFilename
  );
  clearSummary();

  // hide unified save while processing
  try {
    elements.saveNoteBtn?.classList.add("hidden");
  } catch (err) {
    console.warn("Save note button not found to hide");
  }

  const modelSize = await getSelectedTranscriptionModel();

  if (!modelSize) {
    alert(
      "No model selected. Please click on a model in the AI Models section to select it for transcription."
    );
    return;
  }

  const isDownloaded = await checkModelDownloaded(modelSize);
  if (!isDownloaded) {
    alert("Model not found. Please download it in the AI Models section.");
    return;
  }

  // NOTE: lots of weird null UI elements and having to make null checks for them,
  // may want to fix this in the future;
  if (
    !elements.transcriptionCard ||
    !elements.transcriptionProgress ||
    !elements.progressFill
  ) {
    console.error("Transcription UI elements not found");
    return;
  }

  elements.transcriptionCard.classList.remove("hidden");
  elements.transcriptionProgress.classList.remove("hidden");
  elements.progressFill.style.width = "0%";

  setTranscriptionInProgress(true);

  try {
    const result = await transcribeAudio(buffer, {
      modelSize,
      onProgress: updateProgress
    });
    lastTranscription = result.text;

    if (elements.progressFill) {
      elements.progressFill.classList.remove("indeterminate");
    }
    if (elements.transcriptionProgress) {
      elements.transcriptionProgress.classList.add("hidden");
    }
    if (elements.transcriptionResult) {
      elements.transcriptionResult.classList.remove("hidden");
    }
    if (elements.transcriptionText) {
      elements.transcriptionText.textContent =
        result.text || "(No speech detected)";
    }
    if (elements.statusText) {
      elements.statusText.textContent = "Transcription complete!";
    }

    console.log(`Transcription length: ${result.text.length} chars`);

    if (result.text && result.text.trim().length > 20) {
      console.log("Starting summarization...");
      if (elements.statusText) {
        elements.statusText.textContent = "Generating summary...";
      }
      try {
        await runSummarization(result.text, timestamp);
        if (elements.statusText) {
          elements.statusText.textContent = "Transcription & summary complete!";
        }
      } catch (error) {
        console.error("Summarization error in transcriber:", error);
        if (elements.statusText) {
          elements.statusText.textContent =
            "Transcription complete! (Summary failed)";
        }
      }
    } else {
      console.log("Skipping summarization - text too short");
    }
  } catch (error) {
    if (elements.transcriptionProgress) {
      elements.transcriptionProgress.classList.add("hidden");
    }
    if (elements.transcriptionEmpty) {
      elements.transcriptionEmpty.classList.remove("hidden");
      elements.transcriptionEmpty.innerHTML = `<p style="color: #ff6b81;">Failed: ${error}</p>`;
    }
  } finally {
    setTranscriptionInProgress(false);
  }
}

export function setupTranscriptionListeners() {
  if (!elements.copyTranscriptionBtn) {
    console.warn("Transcription copy button not found");
    return;
  }

  elements.copyTranscriptionBtn.addEventListener("click", async () => {
    if (!lastTranscription) return;
    await navigator.clipboard.writeText(lastTranscription);
    const originalText = elements.copyTranscriptionBtn.textContent;
    elements.copyTranscriptionBtn.textContent = "Copied!";
    setTimeout(
      () => (elements.copyTranscriptionBtn.textContent = originalText),
      2000
    );
  });
}

export function getLastRecordingFilename(): string | null {
  return lastRecordingFilename;
}
