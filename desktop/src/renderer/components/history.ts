import {
  generateDateLabel,
  convertToLocaleTime,
  escapeHtml,
  getBaseName
} from "@/utils";
import { navigateToPage } from "./navigation";
import { elements } from "./domNodes";

interface NoteFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  isJson?: boolean;
}

let currentNoteFilename: string | null = null;
let selectedNotes: Set<string> = new Set();

export function showHistoryPage(): void {
  navigateToPage("history");
  selectedNotes.clear();
  loadHistory();
}

export function showMainPage(): void {
  navigateToPage("main");
  closeNoteViewer();
}

export async function loadHistory(): Promise<void> {
  const historyList = document.getElementById("historyList");
  if (!historyList) return;

  historyList.innerHTML = '<p class="loading-text">Loading history...</p>';

  try {
    const result = await window.electronAPI.listNotes();

    if (!result.success || result.files.length === 0) {
      historyList.innerHTML =
        '<p class="empty-text">No saved notes yet. Record a meeting to get started!</p>';
      return;
    }

    historyList.innerHTML = "";

    result.files.forEach((file: NoteFile) => {
      const item = createHistoryItem(file);
      historyList.appendChild(item);
    });

    updateBatchOperationsUI();
  } catch (error) {
    console.error("Error loading history:", error);
    historyList.innerHTML =
      '<p class="error-text">Failed to load history. Please try again.</p>';
  }
}

function createHistoryItem(file: NoteFile): HTMLElement {
  const item = document.createElement("div");
  item.className = "history-item";
  item.dataset.filename = file.name;

  const filenameLabel = getBaseName(file.name);

  const date = new Date(file.modified);
  const formattedDate = generateDateLabel(date);
  const formattedTime = convertToLocaleTime(date);

  const isSelected = selectedNotes.has(file.name);

  item.innerHTML = `
    <label class="history-item-checkbox">
      <input type="checkbox" class="note-checkbox" data-filename="${escapeHtml(file.name)}" ${isSelected ? "checked" : ""} />
    </label>
    <div class="history-item-info">
      <div class="history-item-type">${filenameLabel}</div>
      <div class="history-item-date">${formattedDate} at ${formattedTime}</div>
    </div>
    <button class="history-item-btn" title="View">👁️</button>
  `;

  const checkbox = item.querySelector(".note-checkbox") as HTMLInputElement;
  checkbox?.addEventListener("change", (e) => {
    e.stopPropagation();
    handleNoteCheckboxChange(file.name, checkbox.checked);
  });

  const viewBtn = item.querySelector(".history-item-btn");
  viewBtn?.addEventListener("click", () => openNote(file.name));

  return item;
}

async function openNote(filename: string): Promise<void> {
  try {
    const result = await window.electronAPI.readNote(filename);

    if (!result.success) {
      alert("Failed to open note: " + result.error);
      return;
    }

    currentNoteFilename = filename;

    const noteViewerCard = document.getElementById("noteViewerCard");
    const noteViewerTitle = document.getElementById("noteViewerTitle");
    const noteTranscription = document.getElementById("noteTranscription");
    const noteSummary = document.getElementById("noteSummary");

    if (
      !noteViewerCard ||
      !noteViewerTitle ||
      !noteTranscription ||
      !noteSummary
    )
      return;

    noteTranscription.textContent = "";
    noteSummary.textContent = "";

    if (result.content && typeof result.content === "object") {
      const noteId = result.content.id || filename.replace(/\.json$/, "");
      noteViewerTitle.textContent = noteId;
      noteViewerTitle.removeAttribute("contenteditable");
      noteViewerTitle.classList.remove("editable");

      noteTranscription.innerHTML = `<div>${escapeHtml(result.content.transcription || "")}</div>`;
      noteSummary.innerHTML = `<div>${escapeHtml(result.content.summary || "")}</div>`;
      noteTranscription.removeAttribute("contenteditable");
      noteSummary.removeAttribute("contenteditable");
      noteTranscription.classList.remove("editable-body");
      noteSummary.classList.remove("editable-body");

      if (result.content) {
        const content = result.content as any;
        await handleRecordingPlayback(content.metadata);
      }

      const copyTransBtn = document.getElementById("copyTranscriptionBtn");
      const copySummaryBtn = document.getElementById("copySummaryBtn");

      noteTranscription.setAttribute("contenteditable", "true");
      noteSummary.setAttribute("contenteditable", "true");
      noteTranscription.classList.add("editable-body");
      noteSummary.classList.add("editable-body");

      const exportNoteBtn = document.getElementById("exportNoteBtn");
      let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

      async function saveEdits(silent = false) {
        try {
          const newTitle = (noteViewerTitle.textContent || "").trim();
          const newTrans = noteTranscription.textContent || "";
          const newSum = noteSummary.textContent || "";

          if (!newTrans && !newSum) {
            if (!silent) alert("Cannot save empty note.");
            return;
          }

          const safeBase = (newTitle || noteId)
            .replace(/[^a-zA-Z0-9-_ ]/g, "")
            .trim()
            .replace(/\s+/g, "_");
          const newFilename = `${safeBase || noteId}.json`;

          const res = await window.electronAPI.saveNote({
            transcription: newTrans,
            summary: newSum,
            filename: newFilename
          });

          if (res && res.success) {
            if (newFilename !== filename) {
              await window.electronAPI.deleteNote(filename);
              currentNoteFilename = newFilename;
            }
            loadHistory();
          } else {
            if (!silent) alert("Failed to save note: " + (res && res.error));
          }
        } catch (err) {
          console.error("Error saving note from viewer:", err);
          if (!silent) alert("Error saving note");
        }
      }

      const autoSaveDelayMs = 1500;

      function scheduleAutoSave() {
        if (autoSaveTimeout) {
          clearTimeout(autoSaveTimeout);
        }
        autoSaveTimeout = setTimeout(() => {
          // autosave silently
          saveEdits(true);
        }, autoSaveDelayMs);
      }

      noteViewerTitle.onclick = () => {
        noteViewerTitle.setAttribute("contenteditable", "true");
        noteViewerTitle.classList.add("editable");
        noteViewerTitle.focus();
      };

      // save on Enter when editing title
      noteViewerTitle.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          // remove title editable styling after saving
          saveEdits().then(() => {
            noteViewerTitle.removeAttribute("contenteditable");
            noteViewerTitle.classList.remove("editable");
          });
        }
      };

      noteTranscription.addEventListener("input", scheduleAutoSave);
      noteSummary.addEventListener("input", scheduleAutoSave);
      noteViewerTitle.addEventListener("input", scheduleAutoSave);

      if (copyTransBtn) {
        copyTransBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              noteTranscription.textContent || ""
            );
            const orig = copyTransBtn.textContent;
            copyTransBtn.textContent = "Copied!";
            setTimeout(() => (copyTransBtn.textContent = orig), 2000);
          } catch (err) {
            console.error("Copy transcription failed:", err);
          }
        };
      }

      if (copySummaryBtn) {
        copySummaryBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(noteSummary.textContent || "");
            const orig = copySummaryBtn.textContent;
            copySummaryBtn.textContent = "Copied!";
            setTimeout(() => (copySummaryBtn.textContent = orig), 2000);
          } catch (err) {
            console.error("Copy summary failed:", err);
          }
        };
      }

      if (exportNoteBtn) {
        exportNoteBtn.onclick = async () => {
          try {
            const res = await window.electronAPI.exportNote({
              filename: filename,
              format: "pdf"
            });
            if (res && res.success) {
              const hasRecording =
                result.content &&
                (result.content as any).metadata &&
                (result.content as any).metadata.recordingFilename;

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
    } else {
      alert("Note format not supported");
      return;
    }

    noteViewerCard.classList.remove("hidden");
  } catch (error) {
    console.error("Error opening note:", error);
    alert("Failed to open note");
  }
}

async function handleRecordingPlayback(
  metadata?: Record<string, any>
): Promise<void> {
  console.log("[handleRecordingPlayback] Called with metadata:", metadata);

  if (!elements.noteRecordingPlayer || !elements.noteAudioPlayer) {
    console.log("[handleRecordingPlayback] Player elements not found");
    return;
  }

  elements.noteRecordingPlayer.classList.add("hidden");
  elements.noteAudioPlayer.src = "";

  if (!metadata || !metadata.recordingFilename) {
    console.log("[handleRecordingPlayback] No recording filename in metadata");
    return;
  }

  const recordingFilename = metadata.recordingFilename;
  console.log(
    "[handleRecordingPlayback] Found recording filename:",
    recordingFilename
  );

  try {
    const result = await window.electronAPI.getRecordingPath(recordingFilename);
    console.log(
      "[handleRecordingPlayback] getRecordingPath result:",
      result.success
    );

    if (result.success && result.path) {
      elements.noteAudioPlayer.src = `recording://${encodeURIComponent(result.path)}`;
      elements.noteRecordingPlayer.classList.remove("hidden");
      console.log(`Loaded recording: ${recordingFilename}`);
    } else {
      console.warn(
        `Recording file not found: ${recordingFilename}`,
        result.error
      );
    }
  } catch (error) {
    console.error("Error loading recording:", error);
  }
}

function closeNoteViewer(): void {
  const noteViewerCard = document.getElementById("noteViewerCard");
  if (noteViewerCard) {
    noteViewerCard.classList.add("hidden");
  }

  if (elements.noteAudioPlayer) {
    elements.noteAudioPlayer.pause();
    elements.noteAudioPlayer.src = "";
  }
  if (elements.noteRecordingPlayer) {
    elements.noteRecordingPlayer.classList.add("hidden");
  }

  currentNoteFilename = null;
}

async function deleteCurrentNote(): Promise<void> {
  if (!currentNoteFilename) return;

  const confirmed = confirm(
    "Are you sure you want to delete this note? This cannot be undone."
  );
  if (!confirmed) return;

  try {
    const result = await window.electronAPI.deleteNote(currentNoteFilename);

    if (!result.success) {
      alert("Failed to delete note: " + result.error);
      return;
    }

    closeNoteViewer();
    loadHistory();
  } catch (error) {
    console.error("Error deleting note:", error);
    alert("Failed to delete note");
  }
}

export function setupHistoryListeners(): void {
  const viewHistoryBtn = document.getElementById("viewHistoryBtn");
  const backToMainBtn = document.getElementById("backToMainBtn");
  const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
  const closeNoteBtn = document.getElementById("closeNoteBtn");
  const deleteNoteBtn = document.getElementById("deleteNoteBtn");

  viewHistoryBtn?.addEventListener("click", showHistoryPage);
  backToMainBtn?.addEventListener("click", showMainPage);
  refreshHistoryBtn?.addEventListener("click", () => {
    refreshHistoryBtn.classList.add("spinning");
    loadHistory().finally(() => {
      setTimeout(() => refreshHistoryBtn.classList.remove("spinning"), 500);
    });
  });

  closeNoteBtn?.addEventListener("click", closeNoteViewer);
  deleteNoteBtn?.addEventListener("click", deleteCurrentNote);

  elements.selectAllNotesCheckbox?.addEventListener("change", handleSelectAll);
  elements.deleteSelectedBtn?.addEventListener("click", deleteSelectedNotes);
}

function handleNoteCheckboxChange(filename: string, checked: boolean): void {
  if (checked) {
    selectedNotes.add(filename);
  } else {
    selectedNotes.delete(filename);
  }
  updateBatchOperationsUI();
}

function handleSelectAll(e: Event): void {
  const target = e.target as HTMLInputElement;
  const checkboxes = document.querySelectorAll(
    ".note-checkbox"
  ) as NodeListOf<HTMLInputElement>;

  checkboxes.forEach((checkbox) => {
    checkbox.checked = target.checked;
    const filename = checkbox.dataset.filename;
    if (filename) {
      if (target.checked) {
        selectedNotes.add(filename);
      } else {
        selectedNotes.delete(filename);
      }
    }
  });

  updateBatchOperationsUI();
}

function updateBatchOperationsUI(): void {
  const count = selectedNotes.size;
  const hasNotes = document.querySelectorAll(".history-item").length > 0;

  if (hasNotes && elements.batchOperationsToolbar) {
    elements.batchOperationsToolbar.classList.remove("hidden");
  } else if (elements.batchOperationsToolbar) {
    elements.batchOperationsToolbar.classList.add("hidden");
  }

  if (elements.selectedCount) {
    elements.selectedCount.textContent = `${count} selected`;
  }

  if (elements.selectAllNotesCheckbox) {
    const totalCheckboxes = document.querySelectorAll(".note-checkbox").length;
    const allSelected = count > 0 && count === totalCheckboxes;
    const someSelected = count > 0 && count < totalCheckboxes;

    elements.selectAllNotesCheckbox.checked = allSelected;
    elements.selectAllNotesCheckbox.indeterminate = someSelected;
  }

  if (elements.deleteSelectedBtn) {
    elements.deleteSelectedBtn.disabled = count === 0;
  }
}

async function deleteSelectedNotes(): Promise<void> {
  const count = selectedNotes.size;

  if (count === 0) {
    return;
  }

  const confirmed = confirm(
    `Are you sure you want to delete ${count} note${count > 1 ? "s" : ""}? This cannot be undone.`
  );

  if (!confirmed) {
    return;
  }

  try {
    const deletePromises = Array.from(selectedNotes).map((filename) =>
      window.electronAPI.deleteNote(filename)
    );

    const results = await Promise.all(deletePromises);

    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      alert(
        `Failed to delete ${failed.length} note${failed.length > 1 ? "s" : ""}`
      );
    }

    selectedNotes.clear();
    closeNoteViewer();
    loadHistory();
  } catch (error) {
    console.error("Error deleting notes:", error);
    alert("Failed to delete notes");
  }
}
