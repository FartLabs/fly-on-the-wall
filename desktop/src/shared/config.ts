import { AppConfig } from "./electronAPI";

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
    modelStoragePath: ""
  },
  transcription: {
    selectedModel: "",
    modelStoragePath: ""
  },
  app: {
    introNoteCreated: false // TODO: offload this to localstorage instead, no need to persist this in the config lol
  }
};

export const LIMITS = {
  minSummaryLength: { min: 0, max: 1000, step: 10 },
  maxTokens: { min: 128, max: 4096, step: 64 },
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  topK: { min: 0, max: 100, step: 1 },
  repeatPenalty: { min: 1, max: 2, step: 0.05 }
} as const;

export interface AppSettings extends SummarizationSettings {
  minSummaryLength: number;
  transcriptionModelPath: string;
  summarizationModelPath: string;
}

export interface SummarizationSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
}
