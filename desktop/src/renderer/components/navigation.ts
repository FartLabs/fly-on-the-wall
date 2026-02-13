import { elements } from "./domNodes";

// TODO: rather than having one html file to hold all pages like a SPA,
// multiple html files can be used to split pages more cleanly.

type Page = "main" | "noteView";

export function navigateToPage(page: Page): void {
  elements.mainPage?.classList.add("hidden");

  const noteViewPage = document.getElementById("noteViewPage");
  noteViewPage?.classList.add("hidden");

  switch (page) {
    case "main":
      elements.mainPage?.classList.remove("hidden");
      break;
    case "noteView":
      noteViewPage?.classList.remove("hidden");
      break;
  }

  // Sync sidebar nav active state
  const navItems = document.querySelectorAll(".sidebar-nav-item[data-page]");
  navItems.forEach((item) => {
    item.classList.remove("active");
    if ((item as HTMLElement).dataset.page === page) {
      item.classList.add("active");
    }
  });

  // If viewing a note, no nav item should be highlighted (it's a content page)
  if (page === "noteView") {
    navItems.forEach((item) => item.classList.remove("active"));
  }

  console.log(`Navigated to ${page} page`);
}

export function openSettingsModal(): void {
  elements.settingsModal?.classList.remove("hidden");
  console.log("Settings modal opened");
}

function closeSettingsModal(): void {
  elements.settingsModal?.classList.add("hidden");
  console.log("Settings modal closed");
}

export function setupNavigationListeners(): void {
  if (elements.viewSettingsBtn) {
    elements.viewSettingsBtn.addEventListener("click", () => {
      openSettingsModal();
    });
  }

  if (elements.closeSettingsModal) {
    elements.closeSettingsModal.addEventListener("click", () => {
      closeSettingsModal();
    });
  }

  // close modal when clicking outside
  if (elements.settingsModal) {
    elements.settingsModal.addEventListener("click", (e) => {
      if (e.target === elements.settingsModal) {
        closeSettingsModal();
      }
    });
  }

  // TODO: add keybindings tab in settings page
  // close modal with Escape key
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      !elements.settingsModal?.classList.contains("hidden")
    ) {
      closeSettingsModal();
    }
  });
}
