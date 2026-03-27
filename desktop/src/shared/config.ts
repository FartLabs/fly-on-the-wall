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
  sync: {
    enabled: false,
    serverUrl: "",
    authToken: "",
    userId: "",
    username: "",
    deviceId: "",
    notesCursor: "",
    autoSyncOnStartup: true,
    syncIntervalMinutes: 5,
    lastSyncAt: "",
    lastSyncError: ""
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
  serverUrl: string;
  syncIntervalMinutes: number;
  hotkeyOpenSettings: string[];
}

export interface SummarizationSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
}

export function getDefaultPromptTemplate(
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
