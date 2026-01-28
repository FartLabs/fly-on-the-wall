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
    }, 300); // Small delay to allow moving from trigger to panel
  };

  rightPanelTrigger.addEventListener("mouseenter", openRightPanel);
  rightPanelTrigger.addEventListener("mouseleave", closeRightPanel);
  rightPanel.addEventListener("mouseenter", openRightPanel);
  rightPanel.addEventListener("mouseleave", closeRightPanel);
  
  // Also close if we click outside (optional, but good UX)
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
}
