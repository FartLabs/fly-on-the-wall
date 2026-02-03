import { elements } from "./domNodes";

const STORAGE_KEYS = {
  MIN_SUMMARY_LENGTH: "minSummaryLength",
  MAX_TOKENS: "summarizationMaxTokens",
  TEMPERATURE: "summarizationTemperature",
  TOP_P: "summarizationTopP",
  TOP_K: "summarizationTopK",
  REPEAT_PENALTY: "summarizationRepeatPenalty"
} as const;

export const DEFAULT_SETTINGS = {
  minSummaryLength: 20,
  maxTokens: 1024,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1
} as const;

const LIMITS = {
  minSummaryLength: { min: 0, max: 1000, step: 10 },
  maxTokens: { min: 128, max: 4096, step: 64 },
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  topK: { min: 0, max: 100, step: 1 },
  repeatPenalty: { min: 1, max: 2, step: 0.05 }
} as const;

export interface AppSettings {
  minSummaryLength: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
}

export interface SummarizationSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseNumericSetting(
  value: string | null,
  defaultValue: number,
  limits: { min: number; max: number }
): number {
  if (value === null) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return defaultValue;
  return clamp(parsed, limits.min, limits.max);
}

export function getSettings(): AppSettings {
  return {
    minSummaryLength: parseNumericSetting(
      localStorage.getItem(STORAGE_KEYS.MIN_SUMMARY_LENGTH),
      DEFAULT_SETTINGS.minSummaryLength,
      LIMITS.minSummaryLength
    ),
    maxTokens: parseNumericSetting(
      localStorage.getItem(STORAGE_KEYS.MAX_TOKENS),
      DEFAULT_SETTINGS.maxTokens,
      LIMITS.maxTokens
    ),
    temperature: parseNumericSetting(
      localStorage.getItem(STORAGE_KEYS.TEMPERATURE),
      DEFAULT_SETTINGS.temperature,
      LIMITS.temperature
    ),
    topP: parseNumericSetting(
      localStorage.getItem(STORAGE_KEYS.TOP_P),
      DEFAULT_SETTINGS.topP,
      LIMITS.topP
    ),
    topK: parseNumericSetting(
      localStorage.getItem(STORAGE_KEYS.TOP_K),
      DEFAULT_SETTINGS.topK,
      LIMITS.topK
    ),
    repeatPenalty: parseNumericSetting(
      localStorage.getItem(STORAGE_KEYS.REPEAT_PENALTY),
      DEFAULT_SETTINGS.repeatPenalty,
      LIMITS.repeatPenalty
    )
  };
}

export function getSummarizationSettings(): SummarizationSettings {
  const settings = getSettings();
  return {
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
    topP: settings.topP,
    topK: settings.topK,
    repeatPenalty: settings.repeatPenalty
  };
}

export function getMinSummaryLength(): number {
  return getSettings().minSummaryLength;
}

export function saveSettings(settings: Partial<AppSettings>): void {
  if (settings.minSummaryLength !== undefined) {
    const clamped = clamp(
      settings.minSummaryLength,
      LIMITS.minSummaryLength.min,
      LIMITS.minSummaryLength.max
    );
    localStorage.setItem(STORAGE_KEYS.MIN_SUMMARY_LENGTH, String(clamped));
  }
  if (settings.maxTokens !== undefined) {
    const clamped = clamp(
      settings.maxTokens,
      LIMITS.maxTokens.min,
      LIMITS.maxTokens.max
    );
    localStorage.setItem(STORAGE_KEYS.MAX_TOKENS, String(clamped));
  }
  if (settings.temperature !== undefined) {
    const clamped = clamp(
      settings.temperature,
      LIMITS.temperature.min,
      LIMITS.temperature.max
    );
    localStorage.setItem(STORAGE_KEYS.TEMPERATURE, String(clamped));
  }
  if (settings.topP !== undefined) {
    const clamped = clamp(settings.topP, LIMITS.topP.min, LIMITS.topP.max);
    localStorage.setItem(STORAGE_KEYS.TOP_P, String(clamped));
  }
  if (settings.topK !== undefined) {
    const clamped = clamp(settings.topK, LIMITS.topK.min, LIMITS.topK.max);
    localStorage.setItem(STORAGE_KEYS.TOP_K, String(clamped));
  }
  if (settings.repeatPenalty !== undefined) {
    const clamped = clamp(
      settings.repeatPenalty,
      LIMITS.repeatPenalty.min,
      LIMITS.repeatPenalty.max
    );
    localStorage.setItem(STORAGE_KEYS.REPEAT_PENALTY, String(clamped));
  }
}

export function resetSettings(): void {
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}

function loadSettingsIntoUI(): void {
  const settings = getSettings();

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
}

function readSettingsFromUI(): AppSettings {
  return {
    minSummaryLength:
      parseFloat(elements.minSummaryLengthInput?.value) ||
      DEFAULT_SETTINGS.minSummaryLength,
    maxTokens:
      parseFloat(elements.maxTokensInput?.value) || DEFAULT_SETTINGS.maxTokens,
    temperature:
      parseFloat(elements.temperatureInput?.value) ||
      DEFAULT_SETTINGS.temperature,
    topP: parseFloat(elements.topPInput?.value) || DEFAULT_SETTINGS.topP,
    topK: parseFloat(elements.topKInput?.value) || DEFAULT_SETTINGS.topK,
    repeatPenalty:
      parseFloat(elements.repeatPenaltyInput?.value) ||
      DEFAULT_SETTINGS.repeatPenalty
  };
}

function handleSaveSettings(): void {
  const settings = readSettingsFromUI();
  saveSettings(settings);

  loadSettingsIntoUI();

  if (elements.saveSettingsBtn) {
    const originalText = elements.saveSettingsBtn.textContent;
    elements.saveSettingsBtn.textContent = "✓ Saved!";
    setTimeout(() => {
      elements.saveSettingsBtn.textContent = originalText;
    }, 2000);
  }

  console.log("Settings saved:", settings);
}

function handleResetSettings(): void {
  if (confirm("Reset all settings to defaults? This cannot be undone.")) {
    resetSettings();
    loadSettingsIntoUI();
    console.log("Settings reset to defaults");
  }
}

export function setupSettingsListeners(): void {
  loadSettingsIntoUI();

  // Save/reset buttons
  if (elements.saveSettingsBtn) {
    elements.saveSettingsBtn.addEventListener("click", handleSaveSettings);
  }
  if (elements.resetSettingsBtn) {
    elements.resetSettingsBtn.addEventListener("click", handleResetSettings);
  }
}
