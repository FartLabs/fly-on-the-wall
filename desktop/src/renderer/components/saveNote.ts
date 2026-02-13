import { elements } from "./domNodes";
import { showNotification } from "./notifications";
import { getLastRecordingFilename } from "./transcriber";

export async function saveNote() {
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
    const recordingFilename = getLastRecordingFilename();
    console.log("[saveNote] Recording filename:", recordingFilename);

    const metadata: Record<string, any> = {};

    if (recordingFilename) {
      metadata.recordingFilename = recordingFilename;
      console.log("[saveNote] Adding recording to metadata:", metadata);
    }

    const res = await window.electronAPI.saveNote({
      transcription,
      summary,
      metadata
    });

    if (res && res.success) {
      console.log(
        "[saveNote] Note saved successfully with metadata:",
        metadata
      );
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
