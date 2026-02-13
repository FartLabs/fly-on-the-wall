import { escapeHtml } from "@/utils";
import { navigateToPage } from "./navigation";
import { elements } from "./domNodes";
import {
  loadSidebarNotes,
  setActiveSidebarNote,
  onSidebarNoteOpen
} from "./sidebar";

let currentNoteFilename: string | null = null;

export function setupHistoryListeners(): void {
  // Wire sidebar note clicks → open note in standalone viewer
  onSidebarNoteOpen((filename) => {
    openNoteInViewer(filename);
  });
}

/**
 * Open a note in the standalone note viewer page (not the history page).
 */
async function openNoteInViewer(filename: string): Promise<void> {
  try {
    const result = await window.electronAPI.readNote(filename);

    if (!result.success) {
      alert("Failed to open note: " + result.error);
      return;
    }

    currentNoteFilename = filename;
    setActiveSidebarNote(filename);
    navigateToPage("noteView");

    const titleEl = elements.noteViewTitle;
    const transcriptionEl = elements.noteViewTranscription;
    const summaryEl = elements.noteViewSummary;

    if (!titleEl || !transcriptionEl || !summaryEl) return;

    transcriptionEl.textContent = "";
    summaryEl.textContent = "";

    if (result.content && typeof result.content === "object") {
      const content = result.content as any;
      const noteId = content.id || filename.replace(/\.json$/, "");

      titleEl.textContent = noteId;
      titleEl.removeAttribute("contenteditable");

      transcriptionEl.innerHTML = `<div>${escapeHtml(content.transcription || "")}</div>`;
      summaryEl.innerHTML = `<div>${escapeHtml(content.summary || "")}</div>`;

      // Recording playback
      await handleNoteViewRecording(content.metadata);
      displayNoteViewOriginalFilename(content.metadata);

      // Auto-save setup
      const autoSaveTimeoutRef = {
        current: null as ReturnType<typeof setTimeout> | null
      };
      const autoSaveDelayMs = 1500;

      const boundSaveEdits = (silent = false) =>
        saveNoteViewEdits(
          titleEl,
          transcriptionEl,
          summaryEl,
          filename,
          noteId,
          silent
        );

      const boundScheduleAutoSave = () =>
        scheduleAutoSave(
          autoSaveTimeoutRef,
          () => boundSaveEdits(true),
          autoSaveDelayMs
        );

      // Click to edit title
      titleEl.onclick = () => {
        titleEl.setAttribute("contenteditable", "true");
        titleEl.focus();
      };

      titleEl.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          boundSaveEdits().then(() => {
            titleEl.removeAttribute("contenteditable");
          });
        }
      };

      transcriptionEl.addEventListener("input", boundScheduleAutoSave);
      summaryEl.addEventListener("input", boundScheduleAutoSave);
      titleEl.addEventListener("input", boundScheduleAutoSave);

      // Copy buttons
      if (elements.noteViewCopyTranscription) {
        elements.noteViewCopyTranscription.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              transcriptionEl.textContent || ""
            );
            const orig = elements.noteViewCopyTranscription.textContent;
            elements.noteViewCopyTranscription.textContent = "Copied!";
            setTimeout(
              () => (elements.noteViewCopyTranscription.textContent = orig),
              2000
            );
          } catch (err) {
            console.error("Copy transcription failed:", err);
          }
        };
      }

      if (elements.noteViewCopySummary) {
        elements.noteViewCopySummary.onclick = async () => {
          try {
            await navigator.clipboard.writeText(summaryEl.textContent || "");
            const orig = elements.noteViewCopySummary.textContent;
            elements.noteViewCopySummary.textContent = "Copied!";
            setTimeout(
              () => (elements.noteViewCopySummary.textContent = orig),
              2000
            );
          } catch (err) {
            console.error("Copy summary failed:", err);
          }
        };
      }

      // Export
      if (elements.noteViewExportBtn) {
        elements.noteViewExportBtn.onclick = async () => {
          try {
            const res = await window.electronAPI.exportNote({
              filename: filename,
              format: "pdf"
            });
            if (res && res.success) {
              const hasRecording =
                content.metadata && content.metadata.recordingFilename;
              const message = hasRecording
                ? `Exported PDF and audio recording to ${res.path}`
                : `Exported to ${res.path}`;
              alert(message);
            } else {
              alert(`Export failed: ${res && res.error}`);
            }
          } catch (err) {
            console.error("Export failed:", err);
            alert("Export failed");
          }
        };
      }

      // Delete
      if (elements.noteViewDeleteBtn) {
        elements.noteViewDeleteBtn.onclick = async () => {
          if (!currentNoteFilename) return;
          const confirmed = confirm(
            "Are you sure you want to delete this note? This cannot be undone."
          );
          if (!confirmed) return;

          try {
            const delResult =
              await window.electronAPI.deleteNote(currentNoteFilename);
            if (!delResult.success) {
              alert("Failed to delete note: " + delResult.error);
              return;
            }
            currentNoteFilename = null;
            setActiveSidebarNote(null);
            navigateToPage("main");
            loadSidebarNotes();
          } catch (error) {
            console.error("Error deleting note:", error);
            alert("Failed to delete note");
          }
        };
      }
    } else {
      alert("Note format not supported");
    }
  } catch (error) {
    console.error("Error opening note in viewer:", error);
    alert("Failed to open note");
  }
}

async function handleNoteViewRecording(
  metadata?: Record<string, any>
): Promise<void> {
  if (!elements.noteViewRecordingPlayer || !elements.noteViewAudioPlayer)
    return;

  elements.noteViewRecordingPlayer.classList.add("hidden");
  elements.noteViewAudioPlayer.src = "";

  if (!metadata || !metadata.recordingFilename) return;

  try {
    const result = await window.electronAPI.getRecordingPath(
      metadata.recordingFilename
    );
    if (result.success && result.path) {
      elements.noteViewAudioPlayer.src = `recording://${encodeURIComponent(result.path)}`;
      elements.noteViewRecordingPlayer.classList.remove("hidden");
    }
  } catch (error) {
    console.error("Error loading recording:", error);
  }
}

function displayNoteViewOriginalFilename(metadata?: Record<string, any>): void {
  const el = elements.noteViewOriginalFilename;
  if (!el) return;

  if (metadata && metadata.originalFilename) {
    el.textContent = `Imported from: ${metadata.originalFilename}`;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

async function saveNoteViewEdits(
  titleEl: HTMLElement,
  transcriptionEl: HTMLElement,
  summaryEl: HTMLElement,
  filename: string,
  noteId: string,
  silent = false
): Promise<void> {
  try {
    const newTitle = (titleEl.textContent || "").trim();
    const newTrans = transcriptionEl.textContent || "";
    const newSum = summaryEl.textContent || "";

    if (!newTrans && !newSum) {
      if (!silent) alert("Cannot save empty note.");
      return;
    }

    const safeBase = (newTitle || noteId)
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const newFilename = `${safeBase || noteId}.json`;

    let existingMetadata: Record<string, any> = {};
    try {
      const readRes = await window.electronAPI.readNote(filename);
      if (
        readRes.success &&
        readRes.content &&
        typeof readRes.content === "object"
      ) {
        const existingContent = readRes.content as any;
        existingMetadata = existingContent.metadata || {};
      }
    } catch (readErr) {
      console.warn(
        "Unable to read existing note metadata before save:",
        readErr
      );
    }

    const res = await window.electronAPI.saveNote({
      transcription: newTrans,
      summary: newSum,
      filename: newFilename,
      metadata: existingMetadata
    });

    if (res && res.success) {
      if (newFilename !== filename) {
        await window.electronAPI.deleteNote(filename);
        currentNoteFilename = newFilename;
      }
      loadSidebarNotes();
    } else {
      if (!silent) alert("Failed to save note: " + (res && res.error));
    }
  } catch (err) {
    console.error("Error saving note from viewer:", err);
    if (!silent) alert("Error saving note");
  }
}

function scheduleAutoSave(
  autoSaveTimeoutRef: { current: ReturnType<typeof setTimeout> | null },
  saveCallback: () => void,
  delayMs: number
): void {
  if (autoSaveTimeoutRef.current) {
    clearTimeout(autoSaveTimeoutRef.current);
  }
  autoSaveTimeoutRef.current = setTimeout(() => {
    saveCallback();
  }, delayMs);
}
