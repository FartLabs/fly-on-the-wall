import {
  generateDateLabel,
  convertToLocaleTime,
  escapeHtml,
  getBaseName
} from "@/utils";
import { navigateToPage } from "./navigation";

interface NoteFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  isJson?: boolean;
}

let currentNoteFilename: string | null = null;

export function showHistoryPage(): void {
  navigateToPage("history");
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
  } catch (error) {
    console.error("Error loading history:", error);
    historyList.innerHTML =
      '<p class="error-text">Failed to load history. Please try again.</p>';
  }
}

function createHistoryItem(file: NoteFile): HTMLElement {
  const item = document.createElement("div");
  item.className = "history-item";

  const filenameLabel = getBaseName(file.name);

  const date = new Date(file.modified);
  const formattedDate = generateDateLabel(date);
  const formattedTime = convertToLocaleTime(date);

  item.innerHTML = `
    <div class="history-item-info">
      <div class="history-item-type">${filenameLabel}</div>
      <div class="history-item-date">${formattedDate} at ${formattedTime}</div>
    </div>
    <button class="history-item-btn" title="View">👁️</button>
  `;

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

      const copyTransBtn = document.getElementById("copyTranscriptionBtn");
      const copySummaryBtn = document.getElementById("copySummaryBtn");

      noteTranscription.setAttribute("contenteditable", "true");
      noteSummary.setAttribute("contenteditable", "true");
      noteTranscription.classList.add("editable-body");
      noteSummary.classList.add("editable-body");

      const exportNoteBtn = document.getElementById("exportNoteBtn");

      async function saveEdits() {
        try {
          const newTitle = (noteViewerTitle.textContent || "").trim();
          const newTrans = noteTranscription.textContent || "";
          const newSum = noteSummary.textContent || "";

          if (!newTrans && !newSum) {
            alert("Cannot save empty note.");
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
            alert("Note saved");
            loadHistory();
          } else {
            alert("Failed to save note: " + (res && res.error));
          }
        } catch (err) {
          console.error("Error saving note from viewer:", err);
          alert("Error saving note");
        }
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

      // auto-save when transcription/summary lose focus
      noteTranscription.onblur = () => {
        saveEdits();
      };
      noteSummary.onblur = () => {
        saveEdits();
      };

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
              alert(`Exported to ${res.path}`);
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

function closeNoteViewer(): void {
  const noteViewerCard = document.getElementById("noteViewerCard");
  if (noteViewerCard) {
    noteViewerCard.classList.add("hidden");
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
}
