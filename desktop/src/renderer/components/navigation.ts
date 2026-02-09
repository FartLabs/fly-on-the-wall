import { elements } from "./domNodes";

// TODO: rather than having one html file to hold all pages like a SPA,
// multiple html files can be used to split pages more cleanly.

type Page = "main" | "history" | "settings";

export function navigateToPage(page: Page): void {
  elements.mainPage?.classList.add("hidden");
  elements.historyPage?.classList.add("hidden");
  elements.settingsPage?.classList.add("hidden");

  switch (page) {
    case "main":
      elements.mainPage?.classList.remove("hidden");
      break;
    case "history":
      elements.historyPage?.classList.remove("hidden");
      break;
    case "settings":
      elements.settingsPage?.classList.remove("hidden");
      break;
  }

  console.log(`Navigated to ${page} page`);
}

export function setupNavigationListeners(): void {
  if (elements.viewSettingsBtn) {
    elements.viewSettingsBtn.addEventListener("click", () => {
      navigateToPage("settings");
    });
  }

  if (elements.backToMainFromSettings) {
    elements.backToMainFromSettings.addEventListener("click", () => {
      navigateToPage("main");
    });
  }
}
