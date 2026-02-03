import { elements } from "./domNodes";
import {
  summarizeText,
  checkSummarizationModelDownloaded,
  getSelectedModelPath,
  type SummarizationProgress
} from "@/summarization";
import { saveNote } from "./saveNote";

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

  const selectedModelPath = getSelectedModelPath();
  console.log(`Using summarization model: ${selectedModelPath || "none"}`);

  if (!selectedModelPath) {
    console.log("No summarization model selected");
    if (elements.summaryEmpty) {
      elements.summaryEmpty.classList.remove("hidden");
      elements.summaryEmpty.innerHTML = `<p style="color: #ff9800;">No summarization model selected. Please select a GGUF model in the Models section.</p>`;
    }
    return;
  }

  const isModelValid =
    await checkSummarizationModelDownloaded(selectedModelPath);
  console.log("Summarization model valid:", isModelValid);

  if (!isModelValid) {
    console.log("Selected model file not found or invalid");
    if (elements.summaryEmpty) {
      elements.summaryEmpty.classList.remove("hidden");
      elements.summaryEmpty.innerHTML = `<p style="color: #ff6b81;">Selected model file not found. Please select a valid GGUF model file.</p>`;
    }
    return;
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
    const result = await summarizeText(
      transcription,
      updateSummaryProgress,
      selectedModelPath
    );
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

    console.log("Auto-saving note after summarization...");
    await saveNote();

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
  if (!elements.copySummaryBtn) {
    console.warn("Summary copy button not found");
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
}
