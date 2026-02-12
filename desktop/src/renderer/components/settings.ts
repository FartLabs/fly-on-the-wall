import { elements } from "./domNodes";
import { clamp } from "@/utils";
import { AppConfig } from "@/shared/electronAPI";
import {
  DEFAULT_CONFIG,
  LIMITS,
  type AppSettings,
  type SummarizationSettings
} from "@/shared/config";
import { refreshModelsList } from "./models";

const AUTO_SAVE_DEBOUNCE_MS = 400;
let autoSaveTimeoutId: number | undefined;

function setModelPathHintText(
  hintEl: HTMLSpanElement | null,
  prefix: string,
  currentPath: string
) {
  if (!hintEl) return;
  hintEl.textContent = `${prefix} Current: ${currentPath}`;
}

async function refreshModelPathHints(): Promise<void> {
  try {
    const [transcriptionDir, summarizationDir] = await Promise.all([
      window.electronAPI.getTranscriptionModelsDir(),
      window.electronAPI.getSummarizationModelsDir()
    ]);

    setModelPathHintText(
      elements.transcriptionModelPathHint,
      "Directory used to store Whisper model files. Existing models are not moved automatically when this path changes.",
      transcriptionDir
    );
    setModelPathHintText(
      elements.summarizationModelPathHint,
      "Directory used to store GGUF summarization models. Existing models are not moved automatically when this path changes.",
      summarizationDir
    );
  } catch (error) {
    console.warn("Failed to refresh model path hints:", error);
  }
}

async function getSettings(): Promise<AppSettings> {
  const config = await window.electronAPI.configGet();
  return {
    minSummaryLength: clamp(
      config.summarization.minSummaryLength ??
        DEFAULT_CONFIG.summarization.minSummaryLength,
      LIMITS.minSummaryLength.min,
      LIMITS.minSummaryLength.max
    ),
    maxTokens: clamp(
      config.summarizationParameters.maxTokens ??
        DEFAULT_CONFIG.summarizationParameters.maxTokens,
      LIMITS.maxTokens.min,
      LIMITS.maxTokens.max
    ),
    temperature: clamp(
      config.summarizationParameters.temperature ??
        DEFAULT_CONFIG.summarizationParameters.temperature,
      LIMITS.temperature.min,
      LIMITS.temperature.max
    ),
    topP: clamp(
      config.summarizationParameters.topP ??
        DEFAULT_CONFIG.summarizationParameters.topP,
      LIMITS.topP.min,
      LIMITS.topP.max
    ),
    topK: clamp(
      config.summarizationParameters.topK ??
        DEFAULT_CONFIG.summarizationParameters.topK,
      LIMITS.topK.min,
      LIMITS.topK.max
    ),
    repeatPenalty: clamp(
      config.summarizationParameters.repeatPenalty ??
        DEFAULT_CONFIG.summarizationParameters.repeatPenalty,
      LIMITS.repeatPenalty.min,
      LIMITS.repeatPenalty.max
    ),
    transcriptionModelPath: config.transcription.modelStoragePath ?? "",
    summarizationModelPath: config.summarization.modelStoragePath ?? ""
  };
}

export async function getSummarizationModelParams(): Promise<SummarizationSettings> {
  const settings = await getSettings();
  return {
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
    topP: settings.topP,
    topK: settings.topK,
    repeatPenalty: settings.repeatPenalty
  };
}

export async function getMinSummaryLength(): Promise<number> {
  const settings = await getSettings();
  return settings.minSummaryLength;
}

export async function saveSettings(
  settings: Partial<AppSettings>
): Promise<void> {
  const update: Partial<AppConfig> = {};

  if (settings.minSummaryLength !== undefined) {
    update.summarization = {
      minSummaryLength: clamp(
        settings.minSummaryLength,
        LIMITS.minSummaryLength.min,
        LIMITS.minSummaryLength.max
      )
    } as any;
  }

  if (settings.summarizationModelPath !== undefined) {
    update.summarization = {
      ...(update.summarization || {}),
      modelStoragePath: settings.summarizationModelPath.trim()
    } as any;
  }

  if (settings.transcriptionModelPath !== undefined) {
    update.transcription = {
      modelStoragePath: settings.transcriptionModelPath.trim()
    } as any;
  }

  const params: Partial<AppConfig["summarizationParameters"]> = {};

  if (settings.maxTokens !== undefined) {
    params.maxTokens = clamp(
      settings.maxTokens,
      LIMITS.maxTokens.min,
      LIMITS.maxTokens.max
    );
  }
  if (settings.temperature !== undefined) {
    params.temperature = clamp(
      settings.temperature,
      LIMITS.temperature.min,
      LIMITS.temperature.max
    );
  }
  if (settings.topP !== undefined) {
    params.topP = clamp(settings.topP, LIMITS.topP.min, LIMITS.topP.max);
  }
  if (settings.topK !== undefined) {
    params.topK = clamp(settings.topK, LIMITS.topK.min, LIMITS.topK.max);
  }
  if (settings.repeatPenalty !== undefined) {
    params.repeatPenalty = clamp(
      settings.repeatPenalty,
      LIMITS.repeatPenalty.min,
      LIMITS.repeatPenalty.max
    );
  }

  if (Object.keys(params).length > 0) {
    update.summarizationParameters = params as any;
  }

  await window.electronAPI.configSet(update);
}

export async function resetSettings(): Promise<void> {
  await window.electronAPI.configSet(DEFAULT_CONFIG);
  if (elements.customPromptInput) {
    const defaultPrompt = elements.customPromptInput.dataset.defaultPrompt;
    elements.customPromptInput.value = defaultPrompt || "";
  }
}

async function loadSettingsIntoUI(): Promise<void> {
  const settings = await getSettings();

  if (elements.minSummaryLengthInput) {
    elements.minSummaryLengthInput.value = String(settings.minSummaryLength);
  }
  if (elements.maxTokensInput) {
    elements.maxTokensInput.value = String(settings.maxTokens);
  }
  if (elements.temperatureInput) {
    elements.temperatureInput.value = String(settings.temperature);
  }
  if (elements.topPInput) {
    elements.topPInput.value = String(settings.topP);
  }
  if (elements.topKInput) {
    elements.topKInput.value = String(settings.topK);
  }
  if (elements.repeatPenaltyInput) {
    elements.repeatPenaltyInput.value = String(settings.repeatPenalty);
  }
  if (elements.transcriptionModelPathInput) {
    elements.transcriptionModelPathInput.value =
      settings.transcriptionModelPath;
  }
  if (elements.summarizationModelPathInput) {
    elements.summarizationModelPathInput.value =
      settings.summarizationModelPath;
  }
}

function readSettingsFromUI(): AppSettings {
  return {
    minSummaryLength:
      parseFloat(elements.minSummaryLengthInput?.value) ||
      DEFAULT_CONFIG.summarization.minSummaryLength,
    maxTokens:
      parseFloat(elements.maxTokensInput?.value) ||
      DEFAULT_CONFIG.summarizationParameters.maxTokens,
    temperature:
      parseFloat(elements.temperatureInput?.value) ||
      DEFAULT_CONFIG.summarizationParameters.temperature,
    topP:
      parseFloat(elements.topPInput?.value) ||
      DEFAULT_CONFIG.summarizationParameters.topP,
    topK:
      parseFloat(elements.topKInput?.value) ||
      DEFAULT_CONFIG.summarizationParameters.topK,
    repeatPenalty:
      parseFloat(elements.repeatPenaltyInput?.value) ||
      DEFAULT_CONFIG.summarizationParameters.repeatPenalty,
    transcriptionModelPath: elements.transcriptionModelPathInput?.value || "",
    summarizationModelPath: elements.summarizationModelPathInput?.value || ""
  };
}

async function persistSettingsFromUI(): Promise<void> {
  const settings = readSettingsFromUI();
  await saveSettings(settings);

  const customPrompt = elements.customPromptInput?.value?.trim() ?? "";
  await window.electronAPI.configSet({
    summarization: { customPrompt } as any
  });

  await refreshModelsList();
  await refreshModelPathHints();

  console.log("Settings saved:", settings);
}

function scheduleAutoSave() {
  if (autoSaveTimeoutId !== undefined) {
    window.clearTimeout(autoSaveTimeoutId);
  }

  autoSaveTimeoutId = window.setTimeout(() => {
    persistSettingsFromUI();
  }, AUTO_SAVE_DEBOUNCE_MS);
}

async function handleResetSettings(): Promise<void> {
  if (!confirm("Reset all settings to defaults? This cannot be undone."))
    return;
  await resetSettings();
  await loadSettingsIntoUI();
  await refreshModelPathHints();
  await refreshModelsList();
  console.log("Settings reset to defaults");
}

export function setupSettingsListeners() {
  loadSettingsIntoUI().then(() => {
    refreshModelPathHints();
  });

  if (elements.resetSettingsBtn) {
    elements.resetSettingsBtn.addEventListener("click", handleResetSettings);
  }

  // TODO: might be better to dynamically retrieve all inputs here instead of hardcoding them
  const autoSaveInputs: Array<HTMLInputElement | HTMLTextAreaElement | null> = [
    elements.minSummaryLengthInput,
    elements.maxTokensInput,
    elements.temperatureInput,
    elements.topPInput,
    elements.topKInput,
    elements.repeatPenaltyInput,
    elements.transcriptionModelPathInput,
    elements.summarizationModelPathInput,
    elements.customPromptInput
  ];

  autoSaveInputs.forEach((input) => {
    input?.addEventListener("input", scheduleAutoSave);
    input?.addEventListener("change", scheduleAutoSave);
  });

  setupSettingsNavigation();
}

function setupSettingsNavigation() {
  const navItems =
    document.querySelectorAll<HTMLButtonElement>(".settings-nav-item");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const sectionId = item.getAttribute("data-settings-section");
      if (!sectionId) return;

      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      const panels =
        document.querySelectorAll<HTMLDivElement>(".settings-panel");
      panels.forEach((panel) => panel.classList.remove("active"));

      const targetPanel = document.getElementById(`settingsPanel-${sectionId}`);
      targetPanel?.classList.add("active");
    });
  });
}
