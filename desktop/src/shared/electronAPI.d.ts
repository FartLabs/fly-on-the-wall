// https://www.electronjs.org/docs/latest/tutorial/context-isolation#usage-with-typescript
export default interface IElectronAPI {
  saveRecording: (data: {
    buffer: ArrayBuffer;
    filename: string;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveTranscription: (data: {
    text: string;
    filename: string;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
  saveNote: (data: {
    transcription: string;
    summary?: string;
    filename?: string;
    metadata?: Record<string, any>;
  }) => Promise<{ success: boolean; filename?: string; error?: string }>;
  getRecordingsDir: () => Promise<string>;
  getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;

  getModelsDir: () => Promise<string>;
  getModelsCacheDir: () => Promise<string>;
  openModelsFolder: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  listGgufModels: () => Promise<{
    success: boolean;
    models: Array<{
      name: string;
      path: string;
      size: number;
      sizeFormatted: string;
      modified: string;
    }>;
    error?: string;
  }>;
  importGgufModel: (data: {
    sourcePath: string;
    copyMode?: "copy" | "move";
  }) => Promise<{
    success: boolean;
    path?: string;
    fileName?: string;
    error?: string;
  }>;
  deleteGgufModel: (
    modelPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  selectModelFile: () => Promise<{ canceled: boolean; filePath?: string }>;
  checkModelExists: (modelId: string) => Promise<{ exists: boolean }>;
  deleteModel: (modelId: string) => Promise<{ success: boolean }>;

  summarize: (data: {
    text: string;
    modelPath: string;
    params?: {
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      repeatPenalty?: number;
      systemPrompt?: string;
    };
  }) => Promise<{ success: boolean; summary?: string; error?: string }>;
  checkSummarizationModel: (modelPath: string) => Promise<{
    success: boolean;
    exists?: boolean;
    isValid?: boolean;
    path?: string;
    error?: string;
  }>;
  disposeSummarizationModel: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  summarizationHealthCheck: () => Promise<{
    success: boolean;
    healthy?: boolean;
    modelLoaded?: boolean;
    currentModelPath?: string | null;
    error?: string;
  }>;
  onSummarizationStatus: (callback: (status: any) => void) => () => void;

  transcribe: (data: {
    audioData: number[];
    modelId: string;
    language?: string;
  }) => Promise<{
    success: boolean;
    text?: string;
    error?: string;
  }>;
  downloadWhisperModel: (modelId: string) => Promise<{
    success: boolean;
    modelId?: string;
    error?: string;
  }>;
  checkWhisperModel: (modelId: string) => Promise<{
    success: boolean;
    exists?: boolean;
    modelId?: string;
    path?: string;
    error?: string;
  }>;
  disposeWhisperModel: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  deleteWhisperModelFiles: (modelId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  transcriptionHealthCheck: () => Promise<{
    success: boolean;
    healthy?: boolean;
    modelLoaded?: boolean;
    currentModelId?: string | null;
    error?: string;
  }>;
  onTranscriptionStatus: (callback: (status: any) => void) => () => void;

  listNotes: () => Promise<{
    success: boolean;
    files: Array<{
      name: string;
      path: string;
      size: number;
      modified: string;
    }>;
    error?: string;
  }>;
  readNote: (
    filename: string
  ) => Promise<{ success: boolean; content?: string; error?: string }>;
  deleteNote: (
    filename: string
  ) => Promise<{ success: boolean; error?: string }>;
  exportNote: (data: {
    filename: string;
    format: string;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
}
