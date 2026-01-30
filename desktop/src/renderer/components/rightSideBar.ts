import { elements } from "./domNodes";

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

  // save both transcription + summary
  try {
    const saveBtn = elements.saveNoteBtn;
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const transcription = elements.transcriptionText?.textContent || "";
        const summary = elements.summaryText?.textContent || "";

        if (!transcription && !summary) {
          alert("Nothing to save: transcription and summary are both empty.");
          return;
        }

        try {
          saveBtn.disabled = true;
          const original = saveBtn.textContent;
          saveBtn.textContent = "Saving...";
          const res = await window.electronAPI.saveNote({
            transcription,
            summary
          });
          if (res && res.success) {
            saveBtn.textContent = "✓ Saved";
            setTimeout(() => (saveBtn.textContent = original), 2000);
          } else {
            console.error("Failed to save note:", res && res.error);
            alert("Failed to save note");
            saveBtn.textContent = original;
          }
        } catch (err) {
          console.error("Error saving note:", err);
          alert("Error saving note");
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  } catch (err) {
    console.warn("Save note button not initialized yet", err);
  }
}
