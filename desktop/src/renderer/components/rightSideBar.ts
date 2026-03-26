import { elements } from "./domNodes";
import { saveNote } from "./saveNote";
import { clamp } from "@/utils";

// track the recordings for which we've already auto-opened the sidebar to avoid repeated openings on transcription updates
const autoOpenedRecordings = new Set<string>();

const RIGHT_SIDEBAR_DEFAULT_WIDTH = 340;
const RIGHT_SIDEBAR_MIN_WIDTH = 280;
const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "rightSidebarWidth";

let isRightSidebarResizing = false;

function getRightSidebarMaxWidth(): number {
  return Math.max(420, Math.min(720, window.innerWidth - 220));
}

function applyRightSidebarWidth(width: number) {
  const clamped = clamp(
    width,
    RIGHT_SIDEBAR_MIN_WIDTH,
    getRightSidebarMaxWidth()
  );

  document.documentElement.style.setProperty(
    "--right-sidebar-width",
    `${clamped}px`
  );
}

function loadSavedRightSidebarWidth() {
  const raw = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;

  if (!Number.isFinite(parsed)) {
    applyRightSidebarWidth(RIGHT_SIDEBAR_DEFAULT_WIDTH);
    return;
  }

  applyRightSidebarWidth(parsed);
}

function setupRightSidebarResize() {
  const handle = elements.rightSidebarResizeHandle;
  const sidebar = elements.rightSidebar;
  if (!handle || !sidebar) return;

  handle.addEventListener("mousedown", (e) => {
    if (sidebar.classList.contains("collapsed")) return;

    e.preventDefault();
    isRightSidebarResizing = true;
    sidebar.classList.add("resizing");
    elements.appContent?.classList.add("right-sidebar-resizing");
    document.body.classList.add("sidebar-resizing");
  });

  document.addEventListener("mousemove", (e) => {
    if (!isRightSidebarResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    applyRightSidebarWidth(newWidth);
  });

  document.addEventListener("mouseup", () => {
    if (!isRightSidebarResizing) return;

    isRightSidebarResizing = false;
    sidebar.classList.remove("resizing");
    elements.appContent?.classList.remove("right-sidebar-resizing");
    document.body.classList.remove("sidebar-resizing");

    const currentWidth = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--right-sidebar-width"
      ),
      10
    );

    if (Number.isFinite(currentWidth)) {
      localStorage.setItem(
        RIGHT_SIDEBAR_WIDTH_STORAGE_KEY,
        String(currentWidth)
      );
    }
  });

  window.addEventListener("resize", () => {
    const currentWidth = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--right-sidebar-width"
      ),
      10
    );

    if (Number.isFinite(currentWidth)) {
      applyRightSidebarWidth(currentWidth);
    }
  });
}

/**
 * Sync the app-content margin class with sidebar state.
 */
function syncAppContentMargin() {
  if (elements.rightSidebar?.classList.contains("collapsed")) {
    elements.appContent?.classList.add("right-sidebar-collapsed");
  } else {
    elements.appContent?.classList.remove("right-sidebar-collapsed");
  }
}

function openRightSidebar() {
  elements.rightSidebar?.classList.remove("collapsed");
  syncAppContentMargin();
}

function toggleRightSidebar() {
  elements.rightSidebar?.classList.toggle("collapsed");
  syncAppContentMargin();
}

export function showRightSidebarProcessing() {
  elements.rightSidebarEmpty?.classList.add("hidden");
}

/**
 * Auto-open the right sidebar once per recording when transcription starts.
 * Uses recordingFilename as key to avoid repeated openings.
 */
export function autoOpenForRecording(recordingFilename: string | null) {
  if (!recordingFilename) return;

  if (autoOpenedRecordings.has(recordingFilename)) {
    return; // Already auto-opened for this recording
  }

  autoOpenedRecordings.add(recordingFilename);
  showRightSidebarProcessing();
  openRightSidebar();
}

export function setupRightSidebarListeners() {
  const { rightSidebar, rightSidebarCollapseBtn } = elements;

  if (!rightSidebar || !rightSidebarCollapseBtn) {
    console.error("Right sidebar elements not found");
    return;
  }


  rightSidebarCollapseBtn.addEventListener("click", () => {
    toggleRightSidebar();
  });

  loadSavedRightSidebarWidth();
  setupRightSidebarResize();

  syncAppContentMargin();

  // Manual save button (in case auto-save didn't work)
  try {
    const saveBtn = elements.saveNoteBtn;
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        const original = saveBtn.textContent;
        saveBtn.textContent = "Saving...";

        try {
          await saveNote();
        } finally {
          saveBtn.textContent = original;
          saveBtn.disabled = false;
        }
      });
    }
  } catch (err) {
    console.warn("Save note button not initialized yet", err);
  }
}
