import { elements } from "./domNodes";
import { getCustomPrompt, getDefaultPromptTemplate } from "@/summarization";

export function setupPromptCustomizer(): void {
  loadSavedPrompt();
}

async function loadSavedPrompt(): Promise<void> {
  if (!elements.customPromptInput) return;

  const defaultPrompt = getDefaultPromptTemplate("{transcript}", [
    "{participants}"
  ]);
  elements.customPromptInput.dataset.defaultPrompt = defaultPrompt;

  const savedPrompt = await getCustomPrompt();
  if (savedPrompt) {
    elements.customPromptInput.value = savedPrompt;
    return;
  }

  elements.customPromptInput.value = defaultPrompt;
}
