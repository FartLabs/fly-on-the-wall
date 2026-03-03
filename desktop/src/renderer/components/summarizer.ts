import { elements } from "./domNodes";
import {
  summarizeText,
  checkSummarizationModelDownloaded,
  getSelectedModelPath,
  type SummarizationProgress
} from "@/summarization";
import { saveNote } from "./saveNote";
import { showNotification } from "./notifications";

let lastSummary: string | null = null;

export function getMeetingParticipants(inputValue: string): string[] {
  // const raw = elements.meetingParticipantsInput?.value || "";
  const raw = inputValue || "";
  return (
    raw
      // split by either newlines, commas, or semicolons
      // semicolons are faster to press (pinky is right on its key) than commas imo
      .split(/[\n,;]+/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
  );
}

export function clearSummary() {
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
}

function updateSummaryProgress(progress: SummarizationProgress) {
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
  _timestamp: string
) {
  const selectedModelPath = await getSelectedModelPath();
  console.log(`Using summarization model: ${selectedModelPath || "none"}`);

  if (!selectedModelPath) {
    console.log("No summarization model selected");
    if (elements.summaryEmpty) {
      elements.summaryEmpty.classList.remove("hidden");
      elements.summaryEmpty.innerHTML = `<p class="status-warning">No summarization model selected. Please select a GGUF model in Settings → Summarization.</p>`;
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
      elements.summaryEmpty.innerHTML = `<p class="status-error">Selected model file not found. Please select a valid GGUF model file.</p>`;
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

    const participants = getMeetingParticipants(
      elements.meetingParticipantsInput?.value || ""
    );
    const result = await summarizeText(
      transcription,
      updateSummaryProgress,
      selectedModelPath,
      participants
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

    const participantsObj = participants.length > 0 ? { participants } : {};
    await saveNote(participantsObj);

    showNotification("Summary generated successfully", "success");
    console.log(`Summary generated in ${result.duration.toFixed(1)}s`);
  } catch (error) {
    console.error("Summarization failed:", error);
    if (elements.summaryProgress) {
      elements.summaryProgress.classList.add("hidden");
    }
    if (elements.summaryEmpty) {
      elements.summaryEmpty.classList.remove("hidden");
      elements.summaryEmpty.innerHTML = `<p class="status-error">Summarization failed: ${error}</p>`;
    }
  }
}

export function setupSummarizationListeners() {
  if (!elements.copySummaryBtn) {
    console.warn("Summary copy button not found");
    return;
  }

  elements.copySummaryBtn.addEventListener("click", async () => {
    if (!lastSummary) return;
    await navigator.clipboard.writeText(lastSummary);
    const originalText = elements.copySummaryBtn.textContent;
    elements.copySummaryBtn.textContent = "Copied!";
    setTimeout(
      () => (elements.copySummaryBtn.textContent = originalText),
      2000
    );
  });
}
