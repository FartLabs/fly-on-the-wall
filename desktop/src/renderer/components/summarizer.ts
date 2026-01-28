import { elements } from "./domNodes";
import {
  summarizeText,
  checkSummarizationModelDownloaded,
  downloadSummarizationModel,
  type SummarizationProgress
} from "@/summarization";

let lastSummary: string | null = null;
let lastTimestamp: string | null = null;

export function clearSummary(): void {
  if (elements.summaryCard) {
    elements.summaryCard.classList.add("hidden");
  }
  if (elements.summaryProgress) {
    elements.summaryProgress.classList.add("hidden");
  }
  if (elements.summaryResult) {
    elements.summaryResult.classList.add("hidden");
  }
  if (elements.summaryEmpty) {
    elements.summaryEmpty.classList.remove("hidden");
  }
  if (elements.summaryText) {
    elements.summaryText.textContent = "";
  }
  lastSummary = null;
  lastTimestamp = null;
}

function updateSummaryProgress(progress: SummarizationProgress): void {
  if (
    !elements.summaryProgress ||
    !elements.summaryResult ||
    !elements.summaryEmpty ||
    !elements.summaryProgressText ||
    !elements.summaryProgressFill
  ) {
    console.warn("Summary UI elements not found");
    return;
  }

  elements.summaryProgress.classList.remove("hidden");
  elements.summaryResult.classList.add("hidden");
  elements.summaryEmpty.classList.add("hidden");
  elements.summaryProgressText.textContent = progress.message;

  if (progress.progress !== undefined) {
    elements.summaryProgressFill.style.width = `${progress.progress}%`;
    elements.summaryProgressFill.classList.remove("indeterminate");
  } else if (progress.status === "summarizing") {
    elements.summaryProgressFill.classList.add("indeterminate");
  }
}

export async function runSummarization(
  transcription: string,
  timestamp: string
): Promise<void> {
  lastTimestamp = timestamp;

  const isDownloaded = await checkSummarizationModelDownloaded();
  console.log("Summarization model downloaded:", isDownloaded);

  if (!isDownloaded) {
    const shouldDownload = await checkAndDownloadSummarizationModel();
    if (!shouldDownload) {
      console.log("User declined to download summarization model");
      return;
    }
  }

  if (
    !elements.summaryCard ||
    !elements.summaryProgress ||
    !elements.summaryProgressFill
  ) {
    console.error("Summary UI elements not found");
    return;
  }

  elements.summaryCard.classList.remove("hidden");
  elements.summaryProgress.classList.remove("hidden");
  elements.summaryProgressFill.style.width = "0%";
  elements.summaryProgressFill.classList.remove("indeterminate");

  try {
    console.log("Calling summarizeText...");
    const result = await summarizeText(transcription, updateSummaryProgress);
    lastSummary = result.summary;

    console.log("Summary result:", result);

    if (elements.summaryProgressFill) {
      elements.summaryProgressFill.classList.remove("indeterminate");
    }
    if (elements.summaryProgress) {
      elements.summaryProgress.classList.add("hidden");
    }
    if (elements.summaryResult) {
      elements.summaryResult.classList.remove("hidden");
    }
    if (elements.summaryText) {
      elements.summaryText.textContent =
        result.summary || "(Could not generate summary)";
    }

    console.log(`Summary generated in ${result.duration.toFixed(1)}s`);
  } catch (error) {
    console.error("Summarization failed:", error);
    if (elements.summaryProgress) {
      elements.summaryProgress.classList.add("hidden");
    }
    if (elements.summaryEmpty) {
      elements.summaryEmpty.classList.remove("hidden");
      elements.summaryEmpty.innerHTML = `<p style="color: #ff6b81;">Summarization failed: ${error}</p>`;
    }
  }
}

export function setupSummarizationListeners(): void {
  if (!elements.copySummaryBtn || !elements.saveSummaryBtn) {
    console.warn("Summary button elements not found");
    return;
  }

  elements.copySummaryBtn.addEventListener("click", async () => {
    if (!lastSummary) return;
    await navigator.clipboard.writeText(lastSummary);
    const originalText = elements.copySummaryBtn.textContent;
    elements.copySummaryBtn.textContent = "✓ Copied!";
    setTimeout(
      () => (elements.copySummaryBtn.textContent = originalText),
      2000
    );
  });

  elements.saveSummaryBtn.addEventListener("click", async () => {
    if (!lastSummary || !lastTimestamp) return;
    const filename = `summary_${lastTimestamp}.txt`;
    const result = await window.electronAPI.saveTranscription({
      text: lastSummary,
      filename
    });
    if (result.success) {
      elements.saveSummaryBtn.textContent = "✓ Saved!";
      setTimeout(() => (elements.saveSummaryBtn.textContent = "Save"), 2000);
    }
  });
}

export async function checkAndDownloadSummarizationModel(): Promise<boolean> {
  const isDownloaded = await checkSummarizationModelDownloaded();
  if (isDownloaded) {
    return true;
  }

  const shouldDownload = confirm(
    "The AI summarization model needs to be downloaded.\n\n" +
      "This only happens once and provides high-quality summaries. Download now?"
  );

  if (shouldDownload) {
    try {
      await downloadSummarizationModel((progress) => {
        console.log(`Downloading summarization model: ${progress.message}`);
      });
      return true;
    } catch (error) {
      console.error("Failed to download summarization model:", error);
      return false;
    }
  }

  return false;
}
