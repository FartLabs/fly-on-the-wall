import { elements } from "./domNodes";
import { showNotification } from "./notifications";

export async function saveNote(): Promise<void> {
  const transcription = elements.transcriptionText?.textContent || "";
  const summary = elements.summaryText?.textContent || "";

  if (!transcription && !summary) {
    showNotification(
      "Nothing to save: transcription and summary are both empty.",
      "error"
    );
    return;
  }

  try {
    const res = await window.electronAPI.saveNote({
      transcription,
      summary
    });

    if (res && res.success) {
      showNotification("Note saved successfully", "success");
    } else {
      const errorMsg = res && res.error ? res.error : "Unknown error";
      console.error("Failed to save note:", errorMsg);
      showNotification(`Failed to save note: ${errorMsg}`, "error");
    }
  } catch (err) {
    console.error("Error saving note:", err);
    showNotification(
      `Error saving note: ${err instanceof Error ? err.message : String(err)}`,
      "error"
    );
  }
}
