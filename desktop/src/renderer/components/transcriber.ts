import { elements } from "./domNodes";
import {
  transcribeAudio,
  checkModelDownloaded,
  type TranscriptionProgress
} from "@/transcription";
import { type WhisperModelSize } from "@/transcription/whisper";
import { runSummarization } from "./summarizer";

let lastTranscription: string | null = null;
let lastTimestamp: string | null = null;

function updateProgress(progress: TranscriptionProgress): void {
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
  timestamp: string
): Promise<void> {
  lastTimestamp = timestamp;
  const modelSize = elements.modelSelect.value as WhisperModelSize;

  const isDownloaded = await checkModelDownloaded(modelSize);
  if (!isDownloaded) {
    alert("Model not found. Please download it in the AI Models section.");
    return;
  }

  elements.transcriptionCard.classList.remove("hidden");
  elements.transcriptionProgress.classList.remove("hidden");
  elements.progressFill.style.width = "0%";

  try {
    const result = await transcribeAudio(buffer, {
      modelSize,
      onProgress: updateProgress
    });
    lastTranscription = result.text;

    elements.progressFill.classList.remove("indeterminate");
    elements.transcriptionProgress.classList.add("hidden");
    elements.transcriptionResult.classList.remove("hidden");
    elements.transcriptionText.textContent =
      result.text || "(No speech detected)";
    elements.statusText.textContent = "Transcription complete!";

    console.log(`Transcription length: ${result.text.length} chars`);

    if (result.text && result.text.trim().length > 20) {
      console.log("Starting summarization...");
      elements.statusText.textContent = "Generating summary...";
      try {
        await runSummarization(result.text, timestamp);
        elements.statusText.textContent = "Transcription & summary complete!";
      } catch (error) {
        console.error("Summarization error in transcriber:", error);
        elements.statusText.textContent =
          "Transcription complete! (Summary failed)";
      }
    } else {
      console.log("Skipping summarization - text too short");
    }
  } catch (error) {
    elements.transcriptionProgress.classList.add("hidden");
    elements.transcriptionEmpty.classList.remove("hidden");
    elements.transcriptionEmpty.innerHTML = `<p style="color: #ff6b81;">Failed: ${error}</p>`;
  }
}

export function setupTranscriptionListeners() {
  elements.copyTranscriptionBtn.addEventListener("click", async () => {
    if (!lastTranscription) return;
    await navigator.clipboard.writeText(lastTranscription);
    const originalText = elements.copyTranscriptionBtn.textContent;
    elements.copyTranscriptionBtn.textContent = "✓ Copied!";
    setTimeout(
      () => (elements.copyTranscriptionBtn.textContent = originalText),
      2000
    );
  });

  elements.saveTranscriptionBtn.addEventListener("click", async () => {
    if (!lastTranscription || !lastTimestamp) return;
    const filename = `transcription_${lastTimestamp}.txt`;
    const result = await window.electronAPI.saveTranscription({
      text: lastTranscription,
      filename
    });
    if (result.success) {
      elements.saveTranscriptionBtn.textContent = "✓ Saved!";
      setTimeout(
        () => (elements.saveTranscriptionBtn.textContent = "💾 Save"),
        2000
      );
    }
  });
}
