import { escapeHtml, toSafeName } from "@/utils";
import { navigateToPage } from "./navigation";
import { elements } from "./domNodes";
import {
  loadSidebarNotes,
  setActiveSidebarNote,
  onSidebarNoteOpen
} from "./sidebar";
import { summarizeText } from "@/summarization";
import { getMeetingParticipants } from "./summarizer";

let currentNoteFilename: string | null = null;
let activeResummarize: { cancelled: boolean } | null = null;

type ResummarizeResult = {
  summary: string;
  participants: string[];
  previousSummaryHtml: string;
};

export function setupHistoryListeners() {
  // open note from sidebar when clicked
  onSidebarNoteOpen((filename) => {
    openNoteInViewer(filename);
  });
}

function setResummarizeIdle() {
  const btn = elements.noteResummarizeBtn;
  const cancelBtn = elements.noteResummarizeCancelBtn;
  const statusEl = elements.noteResummarizeStatus;
  const summaryEl = elements.noteViewSummary;

  if (btn) btn.disabled = false;
  if (elements.noteViewCopySummary)
    elements.noteViewCopySummary.disabled = false;

  btn?.classList.remove("hidden");
  elements.noteViewCopySummary?.classList.remove("hidden");
  cancelBtn?.classList.add("hidden");

  if (statusEl) {
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
  }

  // ensure review panel is hidden and editable summary is visible
  elements.noteResummarizeReview?.classList.add("hidden");
  summaryEl.classList.remove("hidden");
}

function setResummarizeRunning(msg: string) {
  const btn = elements.noteResummarizeBtn;
  const cancelBtn = elements.noteResummarizeCancelBtn;
  const statusEl = elements.noteResummarizeStatus;

  if (btn) btn.disabled = true;
  if (elements.noteViewCopySummary)
    elements.noteViewCopySummary.disabled = true;

  btn?.classList.add("hidden");
  elements.noteViewCopySummary?.classList.add("hidden");
  cancelBtn?.classList.remove("hidden");

  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.classList.remove("hidden");
  }
}

async function copyTextToClipboard(
  text: string,
  noteViewCopyElement: HTMLElement
) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = noteViewCopyElement.textContent;
    noteViewCopyElement.textContent = "Copied!";
    setTimeout(() => (noteViewCopyElement.textContent = orig), 2000);
  } catch (err) {
    console.error("Copy to clipboard failed:", err);
  }
}

async function handleExportNote(filename: string, content: any) {
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
}

async function handleDeleteNote() {
  if (!currentNoteFilename) return;
  const confirmed = confirm(
    "Are you sure you want to delete this note? This cannot be undone."
  );
  if (!confirmed) return;

  try {
    const delResult = await window.electronAPI.deleteNote(currentNoteFilename);
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
}

async function openNoteInViewer(filename: string) {
  if (activeResummarize) {
    activeResummarize.cancelled = true;
    activeResummarize = null;
  }
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
      const content = result.content;
      const noteId = content.id || filename.replace(/\.json$/, "");

      titleEl.textContent = noteId;
      titleEl.removeAttribute("contenteditable");

      transcriptionEl.innerHTML = `<div>${escapeHtml(content.transcription || "")}</div>`;
      summaryEl.innerHTML = `<div>${escapeHtml(content.summary || "")}</div>`;

      await handleNoteViewRecording(content.metadata);
      displayNoteViewOriginalFilename(content.metadata);
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

      // click to edit title
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

      if (elements.noteViewCopyTranscription) {
        elements.noteViewCopyTranscription.onclick = async () => {
          await copyTextToClipboard(
            transcriptionEl.textContent || "",
            elements.noteViewCopyTranscription
          );
        };
      }

      if (elements.noteViewCopySummary) {
        elements.noteViewCopySummary.onclick = async () => {
          await copyTextToClipboard(
            summaryEl.textContent || "",
            elements.noteViewCopySummary
          );
        };
      }

      if (elements.noteViewExportBtn) {
        elements.noteViewExportBtn.onclick = async () => {
          await handleExportNote(filename, content);
        };
      }

      if (elements.noteViewDeleteBtn) {
        elements.noteViewDeleteBtn.onclick = async () => {
          await handleDeleteNote();
        };
      }

      // reset previous run's state
      setResummarizeIdle();

      // Show participants input only when the summarization prompt uses {participants}
      // should always true for the default template; false only for custom prompts without it.
      // populate from note metadata if available
      const savedParticipants: string[] =
        (content.metadata && content.metadata.participants) || [];
      if (elements.noteResummarizeParticipantsInput) {
        // always overwrite to clear stale value from previously viewed note
        elements.noteResummarizeParticipantsInput.value =
          savedParticipants.join(", ");
      }

      window.electronAPI
        .configGet()
        .then((config) => {
          const customPrompt = config.summarization.customPrompt || "";
          const showParticipants =
            !customPrompt || customPrompt.includes("{participants}");
          if (elements.noteResummarizeParticipants) {
            elements.noteResummarizeParticipants.classList.toggle(
              "hidden",
              !showParticipants
            );
          }
        })
        .catch(() => {
          elements.noteResummarizeParticipants?.classList.add("hidden");
        });

      if (elements.noteResummarizeCancelBtn) {
        elements.noteResummarizeCancelBtn.onclick = () => {
          if (activeResummarize) {
            activeResummarize.cancelled = true;
            activeResummarize = null;
          }
          setResummarizeIdle();
        };
      }

      let pendingReview: ResummarizeResult | null = null;

      if (elements.noteResummarizeAcceptBtn) {
        elements.noteResummarizeAcceptBtn.onclick = async () => {
          if (!pendingReview) return;
          const {
            summary,
            participants,
            previousSummaryHtml: _prev
          } = pendingReview;
          pendingReview = null;

          summaryEl.innerHTML = `<div>${escapeHtml(summary)}</div>`;
          summaryEl.classList.remove("hidden");

          elements.noteResummarizeReview?.classList.add("hidden");
          elements.noteResummarizeBtn?.classList.remove("hidden");
          elements.noteViewCopySummary?.classList.remove("hidden");

          const targetFilename = currentNoteFilename ?? filename;
          try {
            const readRes = await window.electronAPI.readNote(targetFilename);
            if (
              readRes.success &&
              readRes.content &&
              typeof readRes.content === "object"
            ) {
              const existing = readRes.content;
              const meta = { ...(existing.metadata || {}) };
              meta.participants = participants;
              await window.electronAPI.saveNote({
                transcription:
                  existing.transcription || transcriptionEl.textContent || "",
                summary,
                filename: targetFilename,
                metadata: meta
              });
              loadSidebarNotes();
            } else {
              await boundSaveEdits(true);
            }
          } catch {
            await boundSaveEdits(true);
          }
        };
      }

      if (elements.noteResummarizeRejectBtn) {
        elements.noteResummarizeRejectBtn.onclick = () => {
          if (!pendingReview) return;
          const { previousSummaryHtml } = pendingReview;
          pendingReview = null;

          summaryEl.innerHTML = previousSummaryHtml;
          summaryEl.classList.remove("hidden");
          elements.noteResummarizeReview?.classList.add("hidden");
          elements.noteResummarizeBtn?.classList.remove("hidden");
          elements.noteViewCopySummary?.classList.remove("hidden");
        };
      }

      if (elements.noteResummarizeBtn) {
        elements.noteResummarizeBtn.onclick = async () => {
          const transcript = (transcriptionEl.textContent || "").trim();
          if (!transcript) {
            alert("No transcript available to summarize.");
            return;
          }

          const previousSummaryHtml = summaryEl.innerHTML;
          const previousSummaryText = summaryEl.textContent || "";

          const raw = elements.noteResummarizeParticipantsInput?.value ?? "";
          const participants = getMeetingParticipants(raw);

          // nav-away or a second click cancels the prior run
          const run = { cancelled: false };
          activeResummarize = run;

          setResummarizeRunning("Loading summarization model...");

          try {
            const result = await summarizeText(
              transcript,
              (progress) => {
                if (!run.cancelled) {
                  setResummarizeRunning(progress.message);
                }
              },
              null,
              participants
            );

            if (run.cancelled) return;

            activeResummarize = null;
            setResummarizeIdle();

            pendingReview = {
              summary: result.summary,
              participants,
              previousSummaryHtml
            };

            // show review panel comparing old and new summaries
            if (elements.noteResummarizeOldText) {
              elements.noteResummarizeOldText.textContent = previousSummaryText;
            }
            if (elements.noteResummarizeReviewText) {
              elements.noteResummarizeReviewText.textContent = result.summary;
            }

            elements.noteResummarizeReview?.classList.remove("hidden");
            summaryEl.classList.add("hidden");

            elements.noteResummarizeBtn?.classList.add("hidden");
            elements.noteViewCopySummary?.classList.add("hidden");
          } catch (err) {
            if (run.cancelled) return;
            activeResummarize = null;
            console.error("Re-summarization failed:", err);

            const statusEl = elements.noteResummarizeStatus;
            if (statusEl) {
              statusEl.textContent = `Error: ${
                err instanceof Error ? err.message : String(err)
              }`;
              statusEl.classList.remove("hidden");
            }
            if (elements.noteResummarizeBtn) {
              elements.noteResummarizeBtn.disabled = false;
              elements.noteResummarizeBtn.classList.remove("hidden");
            }
            if (elements.noteViewCopySummary) {
              elements.noteViewCopySummary.disabled = false;
              elements.noteViewCopySummary.classList.remove("hidden");
            }
            elements.noteResummarizeCancelBtn?.classList.add("hidden");

            setTimeout(() => {
              if (!run.cancelled && statusEl) {
                statusEl.classList.add("hidden");
              }
            }, 6000);
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

async function handleNoteViewRecording(metadata?: Record<string, any>) {
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

function displayNoteViewOriginalFilename(metadata?: Record<string, any>) {
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
) {
  try {
    const newTitle = (titleEl.textContent || "").trim();
    const newTrans = transcriptionEl.textContent || "";
    const newSum = summaryEl.textContent || "";

    if (!newTrans && !newSum) {
      if (!silent) alert("Cannot save empty note.");
      return;
    }

    const safeBase = toSafeName(newTitle || noteId);
    const newFilename = `${safeBase || noteId}.json`;

    let existingMetadata: Record<string, any> = {};
    try {
      const readRes = await window.electronAPI.readNote(filename);
      if (
        readRes.success &&
        readRes.content &&
        typeof readRes.content === "object"
      ) {
        const existingContent = readRes.content;
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
) {
  if (autoSaveTimeoutRef.current) {
    clearTimeout(autoSaveTimeoutRef.current);
  }
  autoSaveTimeoutRef.current = setTimeout(() => {
    saveCallback();
  }, delayMs);
}
