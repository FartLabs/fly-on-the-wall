import { elements } from "./domNodes";
import { clamp, type DeepPartial } from "@/utils";
import { AppConfig } from "@/shared/electronAPI";
import {
  DEFAULT_CONFIG,
  LIMITS,
  type AppSettings,
  type SummarizationSettings
} from "@/shared/config";
import {
  HOTKEY_DEFAULTS,
  type HotkeyModifier,
  normalizeHotkeyBindings,
  normalizeHotkeyShortcut
} from "@/shared/hotkeys";
import { refreshModelsList } from "./models";
import { refreshHotkeysFromConfig } from "./hotkeys";

const AUTO_SAVE_DEBOUNCE_MS = 400;
let autoSaveTimeoutId: number | undefined;
let hotkeyOpenSettingsBindings: string[] = [];
let isRecordingOpenSettingsHotkey = false;
let recordingModifierOrder: HotkeyModifier[] = [];

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

function getDefaultPromptTemplate(
  transcript: string,
  participants: string[] = []
): string {
  const participantsStr =
    participants.length > 0 ? participants.join(", ") : "Not specified";

  return `You are a highly efficient and helpful assistant specializing in summarizing meeting transcripts.
Please analyze the following raw text from a meeting and provide a structured summary. 
Ignore filler words (e.g., 'um', 'ah', 'like'), repeated sentences, and conversational pleasantries. 
Focus only on the substantive content. If no action items or decisions were made, explicitly state
"No specific action items or decisions were recorded." 

**IF** the transcript is empty, contains only filler words (e.g., 'um', 'ah'), or consists solely of conversational pleasantries with no substance:
    - Your **ENTIRE** output should be a single, specific statement: "This meeting concluded with no substantive discussion."

**ELSE** (if the transcript contains substantive discussion):
    - Proceed as usual with the summarization.

Participants in the meeting: ${participantsStr}

The summary should include:
1. A concise, one-paragraph overview of the meeting's purpose and key discussions.
2. A bulleted list of the main topics discussed. Go into detail about each topic based on what was said.
3. A bulleted list of any action items or decisions made.

If nothing was discussed at all, state that clearly in the overview.

Here is the transcript:
---
${transcript}
---
`;
}

async function loadCustomPromptIntoUI() {
  if (!elements.customPromptInput) return;

  const defaultPrompt = getDefaultPromptTemplate("{transcript}", [
    "{participants}"
  ]);
  elements.customPromptInput.dataset.defaultPrompt = defaultPrompt;

  const config = await window.electronAPI.configGet();
  const savedPrompt = config.summarization.customPrompt;

  if (savedPrompt) {
    elements.customPromptInput.value = savedPrompt;
    return;
  }

  elements.customPromptInput.value = defaultPrompt;
}

function getModifierFromKey(key: string): HotkeyModifier | null {
  if (key === "Control") return "Ctrl";
  if (key === "Alt") return "Alt";
  if (key === "Shift") return "Shift";
  if (key === "Meta") return "Meta";
  return null;
}

function isModifierActive(
  modifier: HotkeyModifier,
  event: KeyboardEvent
): boolean {
  if (modifier === "Ctrl") return event.ctrlKey;
  if (modifier === "Alt") return event.altKey;
  if (modifier === "Shift") return event.shiftKey;
  return event.metaKey;
}

function setModelPathHintText(
  hintEl: HTMLSpanElement | null,
  prefix: string,
  currentPath: string
) {
  if (!hintEl) return;
  hintEl.textContent = `${prefix} Current: ${currentPath}`;
}

async function refreshModelPathHints() {
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
  const rawOpenSettings = (
    config.hotkeys as { openSettings?: string | string[] }
  )?.openSettings;
  const normalizedOpenSettings = normalizeHotkeyBindings(rawOpenSettings);
  const hasExplicitOpenSettingsValue =
    Array.isArray(rawOpenSettings) || typeof rawOpenSettings === "string";

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
    summarizationModelPath: config.summarization.modelStoragePath ?? "",
    hotkeyOpenSettings: hasExplicitOpenSettingsValue
      ? normalizedOpenSettings
      : [...HOTKEY_DEFAULTS.openSettings]
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

async function saveSettings(settings: Partial<AppSettings>) {
  // i've never heard of deeppartial until now, and it seems useful if
  // i wanted to only update parts of an object
  const update: DeepPartial<AppConfig> = {};

  if (settings.minSummaryLength !== undefined) {
    update.summarization = {
      minSummaryLength: clamp(
        settings.minSummaryLength,
        LIMITS.minSummaryLength.min,
        LIMITS.minSummaryLength.max
      )
    };
  }

  if (settings.summarizationModelPath !== undefined) {
    update.summarization = {
      ...(update.summarization || {}),
      modelStoragePath: settings.summarizationModelPath.trim()
    };
  }

  if (settings.transcriptionModelPath !== undefined) {
    update.transcription = {
      modelStoragePath: settings.transcriptionModelPath.trim()
    };
  }

  if (settings.hotkeyOpenSettings !== undefined) {
    update.hotkeys = {
      openSettings: normalizeHotkeyBindings(settings.hotkeyOpenSettings)
    };
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
    update.summarizationParameters = params;
  }

  await window.electronAPI.configSet(update as Partial<AppConfig>);
}

async function resetSettings() {
  await window.electronAPI.configSet(DEFAULT_CONFIG);
  if (elements.customPromptInput) {
    const defaultPrompt =
      elements.customPromptInput.dataset.defaultPrompt ||
      getDefaultPromptTemplate("{transcript}", ["{participants}"]);
    elements.customPromptInput.dataset.defaultPrompt = defaultPrompt;
    elements.customPromptInput.value = defaultPrompt;
  }
}

async function loadSettingsIntoUI() {
  const settings = await getSettings();
  await loadCustomPromptIntoUI();

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

  hotkeyOpenSettingsBindings = [...settings.hotkeyOpenSettings];
  renderHotkeyOpenSettingsBindings();
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
    summarizationModelPath: elements.summarizationModelPathInput?.value || "",
    hotkeyOpenSettings: [...hotkeyOpenSettingsBindings]
  };
}

function getHotkeyFromKeyboardEvent(event: KeyboardEvent): string {
  const key = event.key;
  if (!key || MODIFIER_KEYS.has(key)) return "";

  const modifiers = recordingModifierOrder.filter((modifier) =>
    isModifierActive(modifier, event)
  );

  const activeInFallbackOrder: HotkeyModifier[] = [];
  if (event.ctrlKey) activeInFallbackOrder.push("Ctrl");
  if (event.altKey) activeInFallbackOrder.push("Alt");
  if (event.shiftKey) activeInFallbackOrder.push("Shift");
  if (event.metaKey) activeInFallbackOrder.push("Meta");

  activeInFallbackOrder.forEach((modifier) => {
    if (!modifiers.includes(modifier)) {
      modifiers.push(modifier);
    }
  });

  return normalizeHotkeyShortcut([...modifiers, key].join("+"));
}

function setHotkeyCaptureHint(message: string) {
  if (!elements.hotkeyCaptureHint) return;
  elements.hotkeyCaptureHint.textContent = message;
}

function updateAddHotkeyButtonState() {
  if (!elements.hotkeyOpenSettingsAddBtn) return;
  elements.hotkeyOpenSettingsAddBtn.textContent = isRecordingOpenSettingsHotkey
    ? "•"
    : "+";
  elements.hotkeyOpenSettingsAddBtn.classList.toggle(
    "recording",
    isRecordingOpenSettingsHotkey
  );
  elements.hotkeyOpenSettingsAddBtn.title = isRecordingOpenSettingsHotkey
    ? "Recording..."
    : "Add hotkey";
}

function renderHotkeyOpenSettingsBindings() {
  const listEl = elements.hotkeyOpenSettingsList;
  if (!listEl) return;

  listEl.replaceChildren();

  if (hotkeyOpenSettingsBindings.length === 0) {
    const emptyEl = document.createElement("span");
    emptyEl.className = "hotkey-bindings-empty";
    emptyEl.textContent = "No hotkeys assigned";
    listEl.appendChild(emptyEl);
    updateAddHotkeyButtonState();
    return;
  }

  hotkeyOpenSettingsBindings.forEach((binding) => {
    const itemEl = document.createElement("div");
    itemEl.className = "hotkey-chip";

    const keyEl = document.createElement("span");
    keyEl.className = "hotkey-chip-key";
    keyEl.textContent = binding;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "hotkey-chip-remove";
    removeBtn.setAttribute("aria-label", `Remove ${binding}`);
    removeBtn.textContent = "x";
    removeBtn.addEventListener("click", () => {
      hotkeyOpenSettingsBindings = hotkeyOpenSettingsBindings.filter(
        (value) => value !== binding
      );
      renderHotkeyOpenSettingsBindings();
      scheduleAutoSave();
      setHotkeyCaptureHint("Ready. Click + to record a new hotkey.");
    });

    itemEl.appendChild(keyEl);
    itemEl.appendChild(removeBtn);
    listEl.appendChild(itemEl);
  });

  updateAddHotkeyButtonState();
}

function startHotkeyRecording() {
  isRecordingOpenSettingsHotkey = true;
  recordingModifierOrder = [];
  updateAddHotkeyButtonState();
  setHotkeyCaptureHint("Recording...");
}

function stopHotkeyRecording(message?: string) {
  isRecordingOpenSettingsHotkey = false;
  recordingModifierOrder = [];
  updateAddHotkeyButtonState();
  if (message) {
    setHotkeyCaptureHint(message);
  }
}

function setupHotkeyEditorListeners() {
  elements.hotkeyOpenSettingsAddBtn?.addEventListener("click", () => {
    if (isRecordingOpenSettingsHotkey) {
      stopHotkeyRecording("Recording canceled.");
      return;
    }
    startHotkeyRecording();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isRecordingOpenSettingsHotkey) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        stopHotkeyRecording("Recording canceled.");
        return;
      }

      const modifier = getModifierFromKey(event.key);
      if (modifier) {
        if (!recordingModifierOrder.includes(modifier)) {
          recordingModifierOrder.push(modifier);
        }
        setHotkeyCaptureHint("Recording... now press the final key.");
        return;
      }

      if (!(event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)) {
        setHotkeyCaptureHint(
          "Invalid shortcut. Include at least one modifier key."
        );
        return;
      }

      const shortcut = getHotkeyFromKeyboardEvent(event);
      if (!shortcut) return;

      if (hotkeyOpenSettingsBindings.includes(shortcut)) {
        stopHotkeyRecording("That hotkey already exists.");
        return;
      }

      hotkeyOpenSettingsBindings.push(shortcut);
      renderHotkeyOpenSettingsBindings();
      stopHotkeyRecording(`Added ${shortcut}.`);
      scheduleAutoSave();
    },
    true
  );
}

async function persistSettingsFromUI() {
  const settings = readSettingsFromUI();
  await saveSettings(settings);

  const customPrompt = elements.customPromptInput?.value?.trim() ?? "";
  await window.electronAPI.configSet({
    summarization: { customPrompt } as any
  });

  await refreshModelsList();
  await refreshModelPathHints();
  await refreshHotkeysFromConfig();

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

async function handleResetSettings() {
  if (!confirm("Reset all settings to defaults? This cannot be undone."))
    return;
  await resetSettings();
  await loadSettingsIntoUI();
  await refreshModelPathHints();
  await refreshModelsList();
  await refreshHotkeysFromConfig();
  console.log("Settings reset to defaults");
}

export function setupSettingsListeners() {
  loadSettingsIntoUI().then(() => {
    refreshModelPathHints();
  });

  setupHotkeyEditorListeners();

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
