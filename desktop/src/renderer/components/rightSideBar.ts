import { elements } from "./domNodes";
import { saveNote } from "./saveNote";

export function setupRightPanelListeners() {
  const { rightPanel, rightPanelTrigger } = elements;

  if (!rightPanel || !rightPanelTrigger) {
    console.error("Right panel elements not found");
    return;
  }

  let closeTimeout: number | undefined;

  const openRightPanel = () => {
    rightPanel.classList.add("open");
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = undefined;
    }
  };

  const closeRightPanel = () => {
    closeTimeout = window.setTimeout(() => {
      rightPanel.classList.remove("open");
    }, 300);
  };

  rightPanelTrigger.addEventListener("mouseenter", openRightPanel);
  rightPanelTrigger.addEventListener("mouseleave", closeRightPanel);
  rightPanel.addEventListener("mouseenter", openRightPanel);
  rightPanel.addEventListener("mouseleave", closeRightPanel);

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      !rightPanel.contains(target) &&
      !rightPanelTrigger.contains(target) &&
      rightPanel.classList.contains("open")
    ) {
      rightPanel.classList.remove("open");
    }
  });

  // manual save button (in case auto-save didn't work)
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
