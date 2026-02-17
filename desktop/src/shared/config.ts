import { AppConfig } from "./electronAPI";
import { HOTKEY_DEFAULTS } from "./hotkeys";

export const DEFAULT_CONFIG: AppConfig = {
  summarizationParameters: {
    maxTokens: 1024,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1
  },
  summarization: {
    minSummaryLength: 20,
    customPrompt: "",
    selectedModelPath: "",
    modelStoragePath: "",
    utilityProcess: {
      memoryCheckIntervalMs: 10_000,
      memoryThresholdMb: 4096,
      restartDelayMs: 1000,
      processRecycleTimeoutMs: 5 * 60 * 1000
    }
  },
  transcription: {
    selectedModel: "",
    modelStoragePath: "",
    utilityProcess: {
      memoryCheckIntervalMs: 10_000,
      memoryThresholdMb: 4096,
      restartDelayMs: 1000,
      processRecycleTimeoutMs: 5 * 60 * 1000
    }
  },
  hotkeys: {
    ...HOTKEY_DEFAULTS
  }
};

export type UtilityProcessSettings = {
  memoryCheckIntervalMs: number;
  memoryThresholdMb: number;
  restartDelayMs: number;
  processRecycleTimeoutMs: number;
};

export const LIMITS = {
  minSummaryLength: { min: 0, max: 1000, step: 10 },
  maxTokens: { min: 128, max: 4096, step: 64 },
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  topK: { min: 0, max: 100, step: 1 },
  repeatPenalty: { min: 1, max: 2, step: 0.05 },
  memoryCheckIntervalMs: { min: 1000, max: 600_000, step: 1000 },
  memoryThresholdMb: { min: 256, max: 32_768, step: 256 },
  restartDelayMs: { min: 0, max: 60_000, step: 1000 },
  processRecycleTimeoutMs: { min: 60_000, max: 7_200_000, step: 60_000 }
} as const;

export interface AppSettings extends SummarizationSettings {
  minSummaryLength: number;
  transcriptionModelPath: string;
  summarizationModelPath: string;
  transcriptionMemoryCheckIntervalSeconds: number;
  transcriptionMemoryThresholdMb: number;
  transcriptionRestartDelaySeconds: number;
  transcriptionProcessRecycleTimeoutMinutes: number;
  summarizationMemoryCheckIntervalSeconds: number;
  summarizationMemoryThresholdMb: number;
  summarizationRestartDelaySeconds: number;
  summarizationProcessRecycleTimeoutMinutes: number;
  hotkeyOpenSettings: string[];
}

export interface SummarizationSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
}
