import { elements } from "./domNodes";
import {
  getCustomPrompt,
  saveCustomPrompt,
  getDefaultPromptTemplate
} from "@/summarization";

export function setupPromptCustomizer(): void {
  loadSavedPrompt();

  elements.savePromptBtn.addEventListener("click", handleSavePrompt);
  elements.resetPromptBtn.addEventListener("click", handleResetPrompt);
  elements.viewDefaultPromptBtn.addEventListener("click", handleViewDefault);
}

function loadSavedPrompt(): void {
  const savedPrompt = getCustomPrompt();
  if (savedPrompt) {
    elements.customPromptInput.value = savedPrompt;
  }
}

function handleSavePrompt(): void {
  const prompt = elements.customPromptInput.value.trim();
  saveCustomPrompt(prompt);

  const originalText = elements.savePromptBtn.textContent;
  elements.savePromptBtn.textContent = "✓ Saved!";
  setTimeout(() => {
    elements.savePromptBtn.textContent = originalText;
  }, 2000);

  console.log("Custom prompt saved");
}

function handleResetPrompt(): void {
  if (confirm("Reset to default prompt? This will clear your custom prompt.")) {
    elements.customPromptInput.value = "";
    saveCustomPrompt("");
    console.log("Prompt reset to default");
  }
}

function handleViewDefault(): void {
  const defaultPrompt = getDefaultPromptTemplate("{transcript}", []);

  const modal = document.createElement("div");
  modal.className = "prompt-modal";
  modal.innerHTML = `
    <div class="prompt-modal-content">
      <div class="prompt-modal-header">
        <h3>Default Summarization Prompt</h3>
        <button class="close-modal" id="closeModal">x</button>
      </div>
      <div class="prompt-modal-body">
        <p style="font-size: 0.85rem; color: #888; margin-bottom: 1rem;">
          You can use <code>{transcript}</code> and <code>{participants}</code> as placeholders in your custom prompt.
        </p>
        <pre class="default-prompt-display">${escapeHtml(defaultPrompt)}</pre>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = document.getElementById("closeModal");
  const closeModal = () => {
    modal.remove();
  };

  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
