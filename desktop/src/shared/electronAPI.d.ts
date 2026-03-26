// https://www.electronjs.org/docs/latest/tutorial/context-isolation#usage-with-typescript
import type { HotkeysConfig } from "./hotkeys";
import type { UtilityProcessSettings, SummarizationSettings } from "./config";

export interface SyncUser {
  id: string;
  username: string;
  is_admin: boolean;
  is_premium: boolean;
}

export interface GgufModelInfo {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: string;
}

export interface NoteFileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export interface AudioFileInfo {
  path: string;
  name: string;
  size: number;
}

export interface DownloadProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  message: string;
}

export interface HealthCheckStatus {
  healthy?: boolean;
  modelLoaded?: boolean;
}

export type CopyMode = "copy" | "move";

export interface AppConfig {
  summarizationParameters: SummarizationSettings;
  summarization: {
    minSummaryLength: number;
    customPrompt: string;
    selectedModelPath: string;
    modelStoragePath: string;
    utilityProcess: UtilityProcessSettings;
  };
  transcription: {
    selectedModel: string;
    modelStoragePath: string;
    utilityProcess: UtilityProcessSettings;
  };
  sync: {
    enabled: boolean;
    serverUrl: string;
    authToken: string;
    userId: string;
    username: string;
    deviceId: string;
    notesCursor: string;
    autoSyncOnStartup: boolean;
    syncIntervalMinutes: number;
    lastSyncAt: string;
    lastSyncError: string;
  };
  hotkeys: HotkeysConfig;
}

// typical type response for most IPC calls, can be extended with additional fields as needed
export type IPCResponse<T = {}> = Promise<
  { success: boolean; error?: string } & T
>;

export default interface IElectronAPI {
  // config
  configGet: () => Promise<AppConfig>;
  configSet: (partialConfig: Partial<AppConfig>) => Promise<AppConfig>;

  // recording, transcription, summarization
  saveRecording: (data: {
    buffer: ArrayBuffer;
    filename: string;
  }) => IPCResponse<{ path?: string }>;
  saveTranscription: (data: {
    text: string;
    filename: string;
  }) => IPCResponse<{ path?: string }>;
  saveNote: (data: {
    transcription: string;
    summary?: string;
    filename?: string;
    metadata?: Record<string, any>;
  }) => IPCResponse<{ filename?: string }>;
  getRecordingsDir: () => Promise<string>;
  getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;

  // model management
  getModelsDir: () => Promise<string>;
  getModelsCacheDir: () => Promise<string>;
  getTranscriptionModelsDir: () => Promise<string>;
  getSummarizationModelsDir: () => Promise<string>;
  openModelsFolder: () => IPCResponse<{ path?: string }>;
  listGgufModels: () => IPCResponse<{ models: GgufModelInfo[] }>;
  importGgufModel: (data: {
    sourcePath: string;
    copyMode?: CopyMode;
  }) => IPCResponse<{ path?: string; fileName?: string }>;
  deleteGgufModel: (modelPath: string) => IPCResponse;
  selectModelFile: () => IPCResponse<{ canceled: boolean; filePath?: string }>;
  checkModelExists: (modelId: string) => IPCResponse<{ exists: boolean }>;
  deleteModel: (modelId: string) => IPCResponse;

  // summarization operations
  summarize: (data: {
    text: string;
    modelPath: string;
    params?: Partial<SummarizationSettings> & { systemPrompt?: string };
  }) => IPCResponse<{ summary?: string }>;
  checkSummarizationModel: (
    modelPath: string
  ) => IPCResponse<{ exists?: boolean; isValid?: boolean; path?: string }>;
  disposeSummarizationModel: () => IPCResponse;
  summarizationHealthCheck: () => IPCResponse<
    HealthCheckStatus & { currentModelPath?: string | null }
  >;
  onSummarizationStatus: (callback: (status: any) => void) => () => void;

  // transcription operations
  transcribe: (data: {
    audioData: number[];
    modelId: string;
    language?: string;
  }) => IPCResponse<{ text?: string }>;
  downloadWhisperModel: (modelId: string) => IPCResponse<{ modelId?: string }>;
  checkWhisperModel: (
    modelId: string
  ) => IPCResponse<{ exists?: boolean; modelId?: string; path?: string }>;
  disposeWhisperModel: () => IPCResponse;
  deleteWhisperModelFiles: (modelId: string) => IPCResponse;
  transcriptionHealthCheck: () => IPCResponse<
    HealthCheckStatus & { currentModelId?: string | null }
  >;
  onTranscriptionStatus: (callback: (status: any) => void) => () => void;

  // note management
  listNotes: () => IPCResponse<{ files: NoteFileInfo[] }>;
  readNote: (filename: string) => IPCResponse<{ content?: string }>;
  deleteNote: (filename: string, deleteRecording?: boolean) => IPCResponse;
  exportNote: (data: {
    filename: string;
    format: string;
  }) => IPCResponse<{ path?: string }>;
  getRecordingPath: (filename: string) => IPCResponse<{ path?: string }>;
  getRecordingBuffer: (
    filename: string
  ) => IPCResponse<{ buffer?: ArrayBuffer }>;

  // model downloading
  downloadGgufModel: (data: {
    url?: string;
    repo?: string;
    filename?: string;
    revision?: string;
  }) => IPCResponse<{ path?: string; fileName?: string }>;
  checkGgufModelUrl: (data: {
    url?: string;
    repo?: string;
    filename?: string;
    revision?: string;
  }) => IPCResponse<{
    fileName?: string;
    size?: number;
    sizeFormatted?: string;
    exists?: boolean;
    existingSize?: number;
    existingSizeFormatted?: string;
  }>;
  onGgufDownloadProgress: (
    callback: (progress: DownloadProgress) => void
  ) => () => void;

  // audio files
  selectAudioFiles: () => Promise<{
    canceled: boolean;
    files: AudioFileInfo[];
  }>;
  importAudioFile: (data: {
    sourcePath: string;
    mode: CopyMode;
  }) => IPCResponse<{ filename?: string }>;

  notify: (data: {
    message: string;
    type?: "success" | "error" | "info";
  }) => IPCResponse<{ suppressed?: boolean }>;

  // sync operations
  syncSignUp: (data: {
    username: string;
    password: string;
  }) => IPCResponse<{ user?: SyncUser }>;
  syncLogin: (data: {
    username: string;
    password: string;
  }) => IPCResponse<{ user?: SyncUser }>;
  syncLogout: () => IPCResponse;
  syncWhoAmI: () => IPCResponse<{ authenticated: boolean; user?: SyncUser }>;
  syncNow: () => IPCResponse<{
    pushed: number;
    pulled: number;
    skipped: number;
  }>;
}
