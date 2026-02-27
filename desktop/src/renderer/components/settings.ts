import { elements } from "./domNodes";
import {
  clamp,
  type DeepPartial,
  msToMinutes,
  msToSeconds,
  minutesToMs,
  secondsToMs
} from "@/utils";
import { AppConfig } from "@/shared/electronAPI";
import {
  DEFAULT_CONFIG,
  LIMITS,
  getDefaultPromptTemplate,
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
    transcriptionMemoryCheckIntervalSeconds: msToSeconds(
      clamp(
        config.transcription.utilityProcess?.memoryCheckIntervalMs ??
          DEFAULT_CONFIG.transcription.utilityProcess.memoryCheckIntervalMs,
        LIMITS.memoryCheckIntervalMs.min,
        LIMITS.memoryCheckIntervalMs.max
      )
    ),
    transcriptionMemoryThresholdMb: clamp(
      config.transcription.utilityProcess?.memoryThresholdMb ??
        DEFAULT_CONFIG.transcription.utilityProcess.memoryThresholdMb,
      LIMITS.memoryThresholdMb.min,
      LIMITS.memoryThresholdMb.max
    ),
    transcriptionRestartDelaySeconds: msToSeconds(
      clamp(
        config.transcription.utilityProcess?.restartDelayMs ??
          DEFAULT_CONFIG.transcription.utilityProcess.restartDelayMs,
        LIMITS.restartDelayMs.min,
        LIMITS.restartDelayMs.max
      )
    ),
    transcriptionProcessRecycleTimeoutMinutes: msToMinutes(
      clamp(
        config.transcription.utilityProcess?.processRecycleTimeoutMs ??
          DEFAULT_CONFIG.transcription.utilityProcess.processRecycleTimeoutMs,
        LIMITS.processRecycleTimeoutMs.min,
        LIMITS.processRecycleTimeoutMs.max
      )
    ),
    summarizationMemoryCheckIntervalSeconds: msToSeconds(
      clamp(
        config.summarization.utilityProcess?.memoryCheckIntervalMs ??
          DEFAULT_CONFIG.summarization.utilityProcess.memoryCheckIntervalMs,
        LIMITS.memoryCheckIntervalMs.min,
        LIMITS.memoryCheckIntervalMs.max
      )
    ),
    summarizationMemoryThresholdMb: clamp(
      config.summarization.utilityProcess?.memoryThresholdMb ??
        DEFAULT_CONFIG.summarization.utilityProcess.memoryThresholdMb,
      LIMITS.memoryThresholdMb.min,
      LIMITS.memoryThresholdMb.max
    ),
    summarizationRestartDelaySeconds: msToSeconds(
      clamp(
        config.summarization.utilityProcess?.restartDelayMs ??
          DEFAULT_CONFIG.summarization.utilityProcess.restartDelayMs,
        LIMITS.restartDelayMs.min,
        LIMITS.restartDelayMs.max
      )
    ),
    summarizationProcessRecycleTimeoutMinutes: msToMinutes(
      clamp(
        config.summarization.utilityProcess?.processRecycleTimeoutMs ??
          DEFAULT_CONFIG.summarization.utilityProcess.processRecycleTimeoutMs,
        LIMITS.processRecycleTimeoutMs.min,
        LIMITS.processRecycleTimeoutMs.max
      )
    ),
    serverUrl: config.sync.serverUrl || DEFAULT_CONFIG.sync.serverUrl,
    syncIntervalMinutes: clamp(
      Number(
        config.sync.syncIntervalMinutes ||
          DEFAULT_CONFIG.sync.syncIntervalMinutes
      ),
      1,
      240
    ),
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

  const transcriptionUtilityUpdate: Partial<
    AppConfig["transcription"]["utilityProcess"]
  > = {};
  if (settings.transcriptionMemoryCheckIntervalSeconds !== undefined) {
    transcriptionUtilityUpdate.memoryCheckIntervalMs = clamp(
      secondsToMs(settings.transcriptionMemoryCheckIntervalSeconds),
      LIMITS.memoryCheckIntervalMs.min,
      LIMITS.memoryCheckIntervalMs.max
    );
  }
  if (settings.transcriptionMemoryThresholdMb !== undefined) {
    transcriptionUtilityUpdate.memoryThresholdMb = clamp(
      settings.transcriptionMemoryThresholdMb,
      LIMITS.memoryThresholdMb.min,
      LIMITS.memoryThresholdMb.max
    );
  }
  if (settings.transcriptionRestartDelaySeconds !== undefined) {
    transcriptionUtilityUpdate.restartDelayMs = clamp(
      secondsToMs(settings.transcriptionRestartDelaySeconds),
      LIMITS.restartDelayMs.min,
      LIMITS.restartDelayMs.max
    );
  }
  if (settings.transcriptionProcessRecycleTimeoutMinutes !== undefined) {
    transcriptionUtilityUpdate.processRecycleTimeoutMs = clamp(
      minutesToMs(settings.transcriptionProcessRecycleTimeoutMinutes),
      LIMITS.processRecycleTimeoutMs.min,
      LIMITS.processRecycleTimeoutMs.max
    );
  }
  if (Object.keys(transcriptionUtilityUpdate).length > 0) {
    update.transcription = {
      ...(update.transcription || {}),
      utilityProcess: transcriptionUtilityUpdate
    };
  }

  const summarizationUtilityUpdate: Partial<
    AppConfig["summarization"]["utilityProcess"]
  > = {};
  if (settings.summarizationMemoryCheckIntervalSeconds !== undefined) {
    summarizationUtilityUpdate.memoryCheckIntervalMs = clamp(
      secondsToMs(settings.summarizationMemoryCheckIntervalSeconds),
      LIMITS.memoryCheckIntervalMs.min,
      LIMITS.memoryCheckIntervalMs.max
    );
  }
  if (settings.summarizationMemoryThresholdMb !== undefined) {
    summarizationUtilityUpdate.memoryThresholdMb = clamp(
      settings.summarizationMemoryThresholdMb,
      LIMITS.memoryThresholdMb.min,
      LIMITS.memoryThresholdMb.max
    );
  }
  if (settings.summarizationRestartDelaySeconds !== undefined) {
    summarizationUtilityUpdate.restartDelayMs = clamp(
      secondsToMs(settings.summarizationRestartDelaySeconds),
      LIMITS.restartDelayMs.min,
      LIMITS.restartDelayMs.max
    );
  }
  if (settings.summarizationProcessRecycleTimeoutMinutes !== undefined) {
    summarizationUtilityUpdate.processRecycleTimeoutMs = clamp(
      minutesToMs(settings.summarizationProcessRecycleTimeoutMinutes),
      LIMITS.processRecycleTimeoutMs.min,
      LIMITS.processRecycleTimeoutMs.max
    );
  }
  if (Object.keys(summarizationUtilityUpdate).length > 0) {
    update.summarization = {
      ...(update.summarization || {}),
      utilityProcess: summarizationUtilityUpdate
    };
  }

  if (settings.hotkeyOpenSettings !== undefined) {
    update.hotkeys = {
      openSettings: normalizeHotkeyBindings(settings.hotkeyOpenSettings)
    };
  }

  if (
    settings.serverUrl !== undefined ||
    settings.syncIntervalMinutes !== undefined
  ) {
    update.sync = {
      ...(update.sync || {}),
      ...(settings.serverUrl !== undefined
        ? { serverUrl: settings.serverUrl.trim() }
        : {}),
      ...(settings.syncIntervalMinutes !== undefined
        ? {
            syncIntervalMinutes: clamp(settings.syncIntervalMinutes, 1, 240)
          }
        : {})
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
  if (elements.transcriptionMemoryCheckIntervalInput) {
    elements.transcriptionMemoryCheckIntervalInput.value = String(
      settings.transcriptionMemoryCheckIntervalSeconds
    );
  }
  if (elements.transcriptionMemoryThresholdInput) {
    elements.transcriptionMemoryThresholdInput.value = String(
      settings.transcriptionMemoryThresholdMb
    );
  }
  if (elements.transcriptionRestartDelayInput) {
    elements.transcriptionRestartDelayInput.value = String(
      settings.transcriptionRestartDelaySeconds
    );
  }
  if (elements.transcriptionProcessRecycleTimeoutInput) {
    elements.transcriptionProcessRecycleTimeoutInput.value = String(
      settings.transcriptionProcessRecycleTimeoutMinutes
    );
  }
  if (elements.summarizationMemoryCheckIntervalInput) {
    elements.summarizationMemoryCheckIntervalInput.value = String(
      settings.summarizationMemoryCheckIntervalSeconds
    );
  }
  if (elements.summarizationMemoryThresholdInput) {
    elements.summarizationMemoryThresholdInput.value = String(
      settings.summarizationMemoryThresholdMb
    );
  }
  if (elements.summarizationRestartDelayInput) {
    elements.summarizationRestartDelayInput.value = String(
      settings.summarizationRestartDelaySeconds
    );
  }
  if (elements.summarizationProcessRecycleTimeoutInput) {
    elements.summarizationProcessRecycleTimeoutInput.value = String(
      settings.summarizationProcessRecycleTimeoutMinutes
    );
  }
  if (elements.serverUrlInput) {
    elements.serverUrlInput.value = settings.serverUrl;
  }
  if (elements.syncIntervalMinutesInput) {
    elements.syncIntervalMinutesInput.value = String(
      settings.syncIntervalMinutes
    );
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
    transcriptionMemoryCheckIntervalSeconds:
      parseFloat(elements.transcriptionMemoryCheckIntervalInput?.value) ||
      msToSeconds(
        DEFAULT_CONFIG.transcription.utilityProcess.memoryCheckIntervalMs
      ),
    transcriptionMemoryThresholdMb:
      parseFloat(elements.transcriptionMemoryThresholdInput?.value) ||
      DEFAULT_CONFIG.transcription.utilityProcess.memoryThresholdMb,
    transcriptionRestartDelaySeconds:
      parseFloat(elements.transcriptionRestartDelayInput?.value) ||
      msToSeconds(DEFAULT_CONFIG.transcription.utilityProcess.restartDelayMs),
    transcriptionProcessRecycleTimeoutMinutes:
      parseFloat(elements.transcriptionProcessRecycleTimeoutInput?.value) ||
      msToMinutes(
        DEFAULT_CONFIG.transcription.utilityProcess.processRecycleTimeoutMs
      ),
    summarizationMemoryCheckIntervalSeconds:
      parseFloat(elements.summarizationMemoryCheckIntervalInput?.value) ||
      msToSeconds(
        DEFAULT_CONFIG.summarization.utilityProcess.memoryCheckIntervalMs
      ),
    summarizationMemoryThresholdMb:
      parseFloat(elements.summarizationMemoryThresholdInput?.value) ||
      DEFAULT_CONFIG.summarization.utilityProcess.memoryThresholdMb,
    summarizationRestartDelaySeconds:
      parseFloat(elements.summarizationRestartDelayInput?.value) ||
      msToSeconds(DEFAULT_CONFIG.summarization.utilityProcess.restartDelayMs),
    summarizationProcessRecycleTimeoutMinutes:
      parseFloat(elements.summarizationProcessRecycleTimeoutInput?.value) ||
      msToMinutes(
        DEFAULT_CONFIG.summarization.utilityProcess.processRecycleTimeoutMs
      ),
    serverUrl: elements.serverUrlInput?.value || DEFAULT_CONFIG.sync.serverUrl,
    syncIntervalMinutes:
      parseFloat(elements.syncIntervalMinutesInput?.value) ||
      DEFAULT_CONFIG.sync.syncIntervalMinutes,
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
  await refreshSyncStatus();
  console.log("Settings reset to defaults");
}

function openSyncAuthModal() {
  elements.syncAuthModal?.classList.remove("hidden");
  if (elements.syncAuthStatusText) {
    elements.syncAuthStatusText.textContent = "";
  }
}

function closeSyncAuthModal() {
  elements.syncAuthModal?.classList.add("hidden");
}

async function refreshSyncStatus() {
  try {
    const config = await window.electronAPI.configGet();
    const hasToken = Boolean(config.sync.authToken);

    if (elements.syncStatusText) {
      elements.syncStatusText.textContent = hasToken
        ? `Connected as ${config.sync.username || "user"}`
        : "Not connected";
    }

    if (elements.syncLastSyncText) {
      elements.syncLastSyncText.textContent = config.sync.lastSyncAt
        ? `Last sync: ${new Date(config.sync.lastSyncAt).toLocaleString()}`
        : "Last sync: never";
    }

    if (elements.syncLastErrorText) {
      elements.syncLastErrorText.textContent = config.sync.lastSyncError
        ? `Last error: ${config.sync.lastSyncError}`
        : "";
    }

    if (hasToken) {
      const whoami = await window.electronAPI.syncWhoAmI();
      if (!whoami.authenticated && elements.syncStatusText) {
        elements.syncStatusText.textContent =
          "Session expired. Please reconnect.";
      }
    }
  } catch (error) {
    if (elements.syncStatusText) {
      elements.syncStatusText.textContent = "Sync unavailable";
    }
  }
}

async function handleSyncAuth(mode: "login" | "signup") {
  const username = elements.syncAuthUsernameInput?.value?.trim() || "";
  const password = elements.syncAuthPasswordInput?.value || "";

  if (!username || !password) {
    if (elements.syncAuthStatusText) {
      elements.syncAuthStatusText.textContent =
        "Username and password are required.";
    }
    return;
  }

  const response =
    mode === "login"
      ? await window.electronAPI.syncLogin({ username, password })
      : await window.electronAPI.syncSignUp({ username, password });

  if (!response.success) {
    if (elements.syncAuthStatusText) {
      elements.syncAuthStatusText.textContent =
        response.error || "Request failed";
    }
    return;
  }

  if (elements.syncAuthStatusText) {
    elements.syncAuthStatusText.textContent =
      mode === "login"
        ? "Logged in successfully."
        : "Account created and connected.";
  }

  await refreshSyncStatus();
  closeSyncAuthModal();
}

async function handleSyncNow() {
  if (elements.syncStatusText) {
    elements.syncStatusText.textContent = "Syncing...";
  }

  const result = await window.electronAPI.syncNow();
  if (elements.syncLastErrorText) {
    elements.syncLastErrorText.textContent = result.success
      ? ""
      : `Last error: ${result.error || "Sync failed"}`;
  }

  if (elements.syncLastSyncText && result.success) {
    elements.syncLastSyncText.textContent = `Last sync: ${new Date().toLocaleString()} (pushed ${result.pushed}, pulled ${result.pulled})`;
  }

  await refreshSyncStatus();
}

async function handleSyncLogout() {
  await window.electronAPI.syncLogout();
  await refreshSyncStatus();
}

function setupSyncControlsListeners() {
  elements.syncConnectBtn?.addEventListener("click", () => {
    openSyncAuthModal();
  });

  elements.syncLogoutBtn?.addEventListener("click", () => {
    handleSyncLogout();
  });

  elements.syncNowBtn?.addEventListener("click", () => {
    handleSyncNow();
  });

  elements.syncLoginBtn?.addEventListener("click", () => {
    handleSyncAuth("login");
  });

  elements.syncSignupBtn?.addEventListener("click", () => {
    handleSyncAuth("signup");
  });

  elements.closeSyncAuthModal?.addEventListener("click", () => {
    closeSyncAuthModal();
  });

  elements.syncAuthModal?.addEventListener("click", (event) => {
    if (event.target === elements.syncAuthModal) {
      closeSyncAuthModal();
    }
  });
}

export function setupSettingsListeners() {
  loadSettingsIntoUI().then(() => {
    refreshModelPathHints();
    refreshSyncStatus();
  });

  setupHotkeyEditorListeners();
  setupSyncControlsListeners();

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
    elements.transcriptionMemoryCheckIntervalInput,
    elements.transcriptionMemoryThresholdInput,
    elements.transcriptionRestartDelayInput,
    elements.transcriptionProcessRecycleTimeoutInput,
    elements.summarizationMemoryCheckIntervalInput,
    elements.summarizationMemoryThresholdInput,
    elements.summarizationRestartDelayInput,
    elements.summarizationProcessRecycleTimeoutInput,
    elements.serverUrlInput,
    elements.syncIntervalMinutesInput,
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
  const panels = document.querySelectorAll<HTMLDivElement>(".settings-panel");

  const activateSection = (sectionId: string) => {
    navItems.forEach((nav) => {
      const navSection = nav.getAttribute("data-settings-section");
      nav.classList.toggle("active", navSection === sectionId);
    });

    panels.forEach((panel) => {
      panel.classList.toggle(
        "active",
        panel.id === `settingsPanel-${sectionId}`
      );
    });
  };

  const activeNavItem = Array.from(navItems).find((item) =>
    item.classList.contains("active")
  );
  const activeNavSection = activeNavItem?.getAttribute("data-settings-section");
  const activePanel = Array.from(panels).find((panel) =>
    panel.classList.contains("active")
  );
  const activePanelSection = activePanel?.id.replace("settingsPanel-", "");

  const initialSection =
    activeNavSection &&
    document.getElementById(`settingsPanel-${activeNavSection}`)
      ? activeNavSection
      : activePanelSection &&
          Array.from(navItems).some(
            (item) =>
              item.getAttribute("data-settings-section") === activePanelSection
          )
        ? activePanelSection
        : navItems[0]?.getAttribute("data-settings-section");

  if (initialSection) {
    activateSection(initialSection);
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const sectionId = item.getAttribute("data-settings-section");
      if (!sectionId) return;

      activateSection(sectionId);
    });
  });
}
