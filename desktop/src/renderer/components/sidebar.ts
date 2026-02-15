import { elements } from "./domNodes";
import {
  generateDateLabel,
  getBaseName,
  escapeHtml,
  toSafeName
} from "@/utils";
import { navigateToPage, openSettingsModal } from "./navigation";

interface NoteFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  isJson?: boolean;
}

interface DateGroup {
  label: string;
  sortKey: string;
  files: NoteFile[];
}

type NoteOpenCallback = (filename: string) => void;

let onNoteOpen: NoteOpenCallback | null = null;
let searchFilter = "";
let allNotes: NoteFile[] = [];
let contextMenuTarget: string | null = null;
const selectedSidebarNotes: Set<string> = new Set();
let lastSidebarClickedFilename: string | null = null;

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebarWidth";

let isSidebarResizing = false;

function updateSidebarSelectionCounter(): void {
  const el = elements.sidebarSelectedCount;
  if (!el) return;

  const count = selectedSidebarNotes.size;
  if (count === 0) {
    el.classList.add("hidden");
    return;
  }

  el.textContent = `${count} selected`;
  el.classList.remove("hidden");
}

function syncSidebarMultiSelectionClasses(): void {
  elements.sidebarFileTree
    ?.querySelectorAll(".sidebar-file-item")
    .forEach((el) => {
      const filename = (el as HTMLElement).dataset.filename;
      if (!filename) return;

      if (selectedSidebarNotes.has(filename)) {
        el.classList.add("multi-selected");
      } else {
        el.classList.remove("multi-selected");
      }
    });
}

/**
 * Register a callback invoked when a note is clicked in the sidebar.
 */
export function onSidebarNoteOpen(cb: NoteOpenCallback): void {
  onNoteOpen = cb;
}

/**
 * Load and render notes in the sidebar file tree.
 */
export async function loadSidebarNotes() {
  const tree = elements.sidebarFileTree;
  if (!tree) return;

  tree.innerHTML = '<p class="sidebar-loading">Loading...</p>';

  try {
    const result = await window.electronAPI.listNotes();

    if (!result.success || result.files.length === 0) {
      allNotes = [];
      selectedSidebarNotes.clear();
      updateSidebarSelectionCounter();
      tree.innerHTML = '<p class="sidebar-empty">No notes yet</p>';
      return;
    }

    allNotes = result.files;

    const currentNames = new Set(allNotes.map((f) => f.name));
    Array.from(selectedSidebarNotes).forEach((name) => {
      if (!currentNames.has(name)) {
        selectedSidebarNotes.delete(name);
      }
    });

    updateSidebarSelectionCounter();

    renderTree();
  } catch (error) {
    console.error("[sidebar] Error loading notes:", error);
    tree.innerHTML = '<p class="sidebar-empty">Failed to load</p>';
  }
}

/**
 * Render the file tree with virtual date-based grouping.
 */
function renderTree(): void {
  const tree = elements.sidebarFileTree;
  if (!tree) return;

  const filtered = filterNotes(allNotes, searchFilter);

  if (filtered.length === 0) {
    tree.innerHTML = searchFilter
      ? '<p class="sidebar-empty">No matching notes</p>'
      : '<p class="sidebar-empty">No notes yet</p>';
    return;
  }

  const groups = groupByDate(filtered);

  tree.innerHTML = "";

  groups.forEach((group) => {
    const groupEl = createDateGroup(group);
    tree.appendChild(groupEl);
  });
}

/**
 * Group notes by date label (Today, Yesterday, or formatted date).
 */
function groupByDate(files: NoteFile[]): DateGroup[] {
  const map = new Map<string, { sortKey: string; files: NoteFile[] }>();

  const sorted = [...files].sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
  );

  sorted.forEach((file) => {
    const date = new Date(file.modified);
    const label = generateDateLabel(date);
    const sortKey = date.toISOString().slice(0, 10);

    if (!map.has(label)) {
      map.set(label, { sortKey, files: [] });
    }
    map.get(label)!.files.push(file);
  });

  const groups: DateGroup[] = [];
  map.forEach((value, label) => {
    groups.push({ label, sortKey: value.sortKey, files: value.files });
  });

  groups.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return groups;
}

/**
 * Filter notes by search term (matches against filename).
 */
function filterNotes(files: NoteFile[], term: string): NoteFile[] {
  if (!term) return files;
  const lower = term.toLowerCase();
  return files.filter((f) => getBaseName(f.name).toLowerCase().includes(lower));
}

/**
 * Create a collapsible date group DOM element.
 */
function createDateGroup(group: DateGroup): HTMLElement {
  const container = document.createElement("div");
  container.className = "sidebar-date-group";

  const header = document.createElement("div");
  header.className = "sidebar-date-header";
  header.innerHTML = `
    <span class="sidebar-date-chevron">▼</span>
    <span class="sidebar-date-label">${escapeHtml(group.label)}</span>
    <span class="sidebar-date-count">${group.files.length}</span>
  `;

  header.addEventListener("click", () => {
    container.classList.toggle("collapsed");
  });

  const items = document.createElement("div");
  items.className = "sidebar-date-items";

  group.files.forEach((file) => {
    const item = createFileItem(file);
    items.appendChild(item);
  });

  container.appendChild(header);
  container.appendChild(items);

  return container;
}

/**
 * Create a single file item in the sidebar tree.
 */
function createFileItem(file: NoteFile): HTMLElement {
  const item = document.createElement("div");
  item.className = "sidebar-file-item";
  item.dataset.filename = file.name;

  if (selectedSidebarNotes.has(file.name)) {
    item.classList.add("multi-selected");
  }

  const displayName = getBaseName(file.name);

  item.innerHTML = `
    <span class="sidebar-file-icon">📄</span>
    <span class="sidebar-file-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
  `;

  item.addEventListener("click", (e) => {
    if (e.shiftKey) {
      const orderedItems = Array.from(
        elements.sidebarFileTree?.querySelectorAll(".sidebar-file-item") || []
      ) as HTMLElement[];

      const orderedFilenames = orderedItems
        .map((el) => el.dataset.filename)
        .filter((name): name is string => Boolean(name));

      const anchor = lastSidebarClickedFilename || file.name;
      const anchorIndex = orderedFilenames.indexOf(anchor);
      const targetIndex = orderedFilenames.indexOf(file.name);

      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [from, to] =
          anchorIndex <= targetIndex
            ? [anchorIndex, targetIndex]
            : [targetIndex, anchorIndex];

        selectedSidebarNotes.clear();
        orderedFilenames.slice(from, to + 1).forEach((name) => {
          selectedSidebarNotes.add(name);
        });

        syncSidebarMultiSelectionClasses();
        updateSidebarSelectionCounter();
        lastSidebarClickedFilename = file.name;
      }

      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (selectedSidebarNotes.has(file.name)) {
        selectedSidebarNotes.delete(file.name);
        item.classList.remove("multi-selected");
      } else {
        selectedSidebarNotes.add(file.name);
        item.classList.add("multi-selected");
      }
      updateSidebarSelectionCounter();
      lastSidebarClickedFilename = file.name;
      return;
    }

    selectedSidebarNotes.clear();
    updateSidebarSelectionCounter();
    elements.sidebarFileTree
      ?.querySelectorAll(".sidebar-file-item.multi-selected")
      .forEach((el) => el.classList.remove("multi-selected"));

    // Highlight active item
    elements.sidebarFileTree
      ?.querySelectorAll(".sidebar-file-item.active")
      .forEach((el) => el.classList.remove("active"));
    item.classList.add("active");

    // Fire callback
    if (onNoteOpen) {
      onNoteOpen(file.name);
    }

    lastSidebarClickedFilename = file.name;
  });

  // Right-click context menu
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const clickedIsSelected = selectedSidebarNotes.has(file.name);
    if (selectedSidebarNotes.size <= 1 || !clickedIsSelected) {
      selectedSidebarNotes.clear();
      selectedSidebarNotes.add(file.name);
      syncSidebarMultiSelectionClasses();
      updateSidebarSelectionCounter();
      lastSidebarClickedFilename = file.name;
    }

    showContextMenu(e.clientX, e.clientY, file.name);
  });

  return item;
}

/**
 * Show context menu at position for a given filename.
 */
function showContextMenu(x: number, y: number, filename: string): void {
  contextMenuTarget = filename;
  const menu = elements.sidebarContextMenu;
  if (!menu) return;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");

  if (elements.ctxRenameNote) {
    elements.ctxRenameNote.disabled = selectedSidebarNotes.size > 1;
  }

  // Ensure menu stays within viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}

/**
 * Hide the context menu.
 */
function hideContextMenu(): void {
  elements.sidebarContextMenu?.classList.add("hidden");
  contextMenuTarget = null;
}

/**
 * Rename a note from sidebar: show inline input, then save+delete old.
 */
async function renameNote(filename: string) {
  const item = elements.sidebarFileTree?.querySelector(
    `.sidebar-file-item[data-filename="${CSS.escape(filename)}"]`
  );
  if (!item) return;

  const nameEl = item.querySelector(".sidebar-file-name") as HTMLElement;
  if (!nameEl) return;

  const currentName = getBaseName(filename);

  // Replace name span with an input
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sidebar-rename-input";
  input.value = currentName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let renameHandled = false;

  const finishRename = async () => {
    if (renameHandled) return;
    renameHandled = true;

    const newName = input.value.trim();
    if (!newName || newName === currentName) {
      // Revert
      const span = document.createElement("span");
      span.className = "sidebar-file-name";
      span.title = currentName;
      span.textContent = currentName;
      input.replaceWith(span);
      return;
    }

    const safeBase = toSafeName(newName);
    const newFilename = `${safeBase || currentName}.json`;

    try {
      // Read existing note content
      const readResult = await window.electronAPI.readNote(filename);
      if (!readResult.success || !readResult.content) {
        alert("Failed to read note for rename");
        return;
      }

      const content = readResult.content as any;

      // Save with new filename
      const saveResult = await window.electronAPI.saveNote({
        transcription: content.transcription || "",
        summary: content.summary || "",
        filename: newFilename,
        metadata: content.metadata || {}
      });

      if (!saveResult.success) {
        alert(
          "Failed to rename note: " + (saveResult.error || "Unknown error")
        );
        loadSidebarNotes();
        return;
      }

      if (saveResult.success && newFilename !== filename) {
        await window.electronAPI.deleteNote(filename);
      }

      await loadSidebarNotes();

      // If this note is currently open, re-open with new name
      if (onNoteOpen && newFilename !== filename) {
        onNoteOpen(newFilename);
      }
    } catch (err) {
      console.error("Error renaming note:", err);
      alert("Failed to rename note");
      loadSidebarNotes();
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishRename();
    } else if (e.key === "Escape") {
      if (renameHandled) return;
      renameHandled = true;

      const span = document.createElement("span");
      span.className = "sidebar-file-name";
      span.title = currentName;
      span.textContent = currentName;
      input.replaceWith(span);
    }
  });

  input.addEventListener("blur", () => {
    finishRename();
  });
}

/**
 * Delete a note from sidebar context menu.
 */
async function deleteNoteFromSidebar(filename: string) {
  const confirmed = confirm(
    `Delete "${getBaseName(filename)}"? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const result = await window.electronAPI.deleteNote(filename);
    if (!result.success) {
      alert("Failed to delete note: " + result.error);
      return;
    }

    // If this note is currently being viewed, go back to recorder
    if (elements.noteViewPage && !elements.noteViewPage.classList.contains("hidden")) {
      navigateToPage("main");
    }

    loadSidebarNotes();
  } catch (error) {
    console.error("Error deleting note:", error);
    alert("Failed to delete note");
  }
}

/**
 * Highlight the active note in the sidebar.
 */
export function setActiveSidebarNote(filename: string | null): void {
  elements.sidebarFileTree
    ?.querySelectorAll(".sidebar-file-item.active")
    .forEach((el) => el.classList.remove("active"));

  if (filename) {
    const item = elements.sidebarFileTree?.querySelector(
      `.sidebar-file-item[data-filename="${CSS.escape(filename)}"]`
    );
    if (item) {
      item.classList.add("active");
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;

  if (el.isContentEditable) return true;
  if (el.closest("[contenteditable='true']")) return true;

  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

async function deleteSelectedSidebarNotes() {
  const count = selectedSidebarNotes.size;
  if (count === 0) return;

  const confirmed = confirm(
    `Delete ${count} selected note${count > 1 ? "s" : ""}? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const filenames = Array.from(selectedSidebarNotes);
    const results = await Promise.all(
      filenames.map((filename) => window.electronAPI.deleteNote(filename))
    );

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `Failed to delete ${failed.length} note${failed.length > 1 ? "s" : ""}.`
      );
    }

    selectedSidebarNotes.clear();
    updateSidebarSelectionCounter();
    lastSidebarClickedFilename = null;
    setActiveSidebarNote(null);

    const noteViewPage = document.getElementById("noteViewPage");
    if (noteViewPage && !noteViewPage.classList.contains("hidden")) {
      navigateToPage("main");
    }

    await loadSidebarNotes();
  } catch (error) {
    console.error("Error deleting selected sidebar notes:", error);
    alert("Failed to delete selected notes");
  }
}

function getSidebarMaxWidth(): number {
  return Math.max(360, Math.min(640, window.innerWidth - 220));
}

function applySidebarWidth(width: number): void {
  const clamped = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(width, getSidebarMaxWidth())
  );
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
}

function loadSavedSidebarWidth(): void {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;

  if (!Number.isFinite(parsed)) {
    applySidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    return;
  }

  applySidebarWidth(parsed);
}

function setupSidebarResize(): void {
  const handle = elements.sidebarResizeHandle;
  const sidebar = elements.leftSidebar;
  if (!handle || !sidebar) return;

  handle.addEventListener("mousedown", (e) => {
    if (sidebar.classList.contains("collapsed")) return;

    e.preventDefault();
    isSidebarResizing = true;
    sidebar.classList.add("resizing");
    document.body.classList.add("sidebar-resizing");
  });

  document.addEventListener("mousemove", (e) => {
    if (!isSidebarResizing) return;
    applySidebarWidth(e.clientX);
  });

  document.addEventListener("mouseup", () => {
    if (!isSidebarResizing) return;

    isSidebarResizing = false;
    sidebar.classList.remove("resizing");
    document.body.classList.remove("sidebar-resizing");

    const currentWidth = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--sidebar-width"
      ),
      10
    );
    if (Number.isFinite(currentWidth)) {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(currentWidth));
    }
  });

  window.addEventListener("resize", () => {
    const currentWidth = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--sidebar-width"
      ),
      10
    );
    if (Number.isFinite(currentWidth)) {
      applySidebarWidth(currentWidth);
    }
  });
}

/**
 * Set up all sidebar event listeners.
 */
export function setupSidebarListeners(): void {
  loadSavedSidebarWidth();

  // Collapse/expand sidebar
  elements.sidebarCollapseBtn?.addEventListener("click", () => {
    elements.leftSidebar?.classList.toggle("collapsed");
  });

  setupSidebarResize();

  // Nav: Recorder
  elements.sidebarNavRecorder?.addEventListener("click", () => {
    navigateToPage("main");
    setActiveSidebarNote(null);
  });

  // Nav: Settings
  elements.sidebarNavSettings?.addEventListener("click", () => {
    openSettingsModal();
  });

  // Refresh sidebar notes
  elements.sidebarRefreshBtn?.addEventListener("click", () => {
    elements.sidebarRefreshBtn.classList.add("spinning");
    loadSidebarNotes().finally(() => {
      setTimeout(
        () => elements.sidebarRefreshBtn?.classList.remove("spinning"),
        500
      );
    });
  });

  // Search
  elements.sidebarSearchInput?.addEventListener("input", () => {
    searchFilter = elements.sidebarSearchInput.value.trim();
    renderTree();
  });

  // Context menu actions
  elements.ctxRenameNote?.addEventListener("click", () => {
    if (contextMenuTarget) {
      if (selectedSidebarNotes.size > 1) {
        hideContextMenu();
        return;
      }
      renameNote(contextMenuTarget);
    }
    hideContextMenu();
  });

  elements.ctxDeleteNote?.addEventListener("click", () => {
    if (selectedSidebarNotes.size > 1) {
      deleteSelectedSidebarNotes();
    } else if (contextMenuTarget) {
      deleteNoteFromSidebar(contextMenuTarget);
    }
    hideContextMenu();
  });

  // Close context menu on click elsewhere
  document.addEventListener("click", () => {
    hideContextMenu();
  });

  document.addEventListener("contextmenu", (e) => {
    // Close our custom menu if right-clicking outside sidebar items
    const target = e.target as HTMLElement;
    if (!target.closest(".sidebar-file-item")) {
      hideContextMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Delete") return;
    if (isEditableTarget(e.target)) return;
    if (selectedSidebarNotes.size === 0) return;

    e.preventDefault();
    deleteSelectedSidebarNotes();
  });

  loadSidebarNotes();
}
