// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

export interface SummarizeParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  saveRecording: (data: { buffer: ArrayBuffer; filename: string }) =>
    ipcRenderer.invoke("save-recording", data),
  saveTranscription: (data: { text: string; filename: string }) =>
    ipcRenderer.invoke("save-transcription", data),
  saveNote: (data: {
    transcription: string;
    summary?: string;
    filename?: string;
    metadata?: Record<string, any>;
  }) => ipcRenderer.invoke("save-note", data),
  getRecordingsDir: () => ipcRenderer.invoke("get-recordings-dir"),
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),

  getModelsDir: () => ipcRenderer.invoke("get-models-dir"),
  getModelsCacheDir: () => ipcRenderer.invoke("get-models-cache-dir"),
  openModelsFolder: () => ipcRenderer.invoke("open-models-folder"),
  listGgufModels: () => ipcRenderer.invoke("list-gguf-models"),
  importGgufModel: (data: { sourcePath: string; copyMode?: "copy" | "move" }) =>
    ipcRenderer.invoke("import-gguf-model", data),
  deleteGgufModel: (modelPath: string) =>
    ipcRenderer.invoke("delete-gguf-model", modelPath),
  selectModelFile: () => ipcRenderer.invoke("select-model-file"),
  checkModelExists: (modelId: string) =>
    ipcRenderer.invoke("check-model-exists", modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke("delete-model", modelId),

  summarize: (data: {
    text: string;
    modelPath: string;
    params?: SummarizeParams;
  }) => ipcRenderer.invoke("summarize", data),
  checkSummarizationModel: (modelPath: string) =>
    ipcRenderer.invoke("check-summarization-model", modelPath),
  disposeSummarizationModel: () =>
    ipcRenderer.invoke("dispose-summarization-model"),
  summarizationHealthCheck: () =>
    ipcRenderer.invoke("summarization-health-check"),
  onSummarizationStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on("summarization-status", handler);
    return () => ipcRenderer.removeListener("summarization-status", handler);
  },

  transcribe: (data: {
    audioData: number[];
    modelId: string;
    language?: string;
  }) => ipcRenderer.invoke("transcribe", data),
  downloadWhisperModel: (modelId: string) =>
    ipcRenderer.invoke("download-whisper-model", modelId),
  checkWhisperModel: (modelId: string) =>
    ipcRenderer.invoke("check-whisper-model", modelId),
  disposeWhisperModel: () => ipcRenderer.invoke("dispose-whisper-model"),
  deleteWhisperModelFiles: (modelId: string) =>
    ipcRenderer.invoke("delete-whisper-model-files", modelId),
  transcriptionHealthCheck: () =>
    ipcRenderer.invoke("transcription-health-check"),
  onTranscriptionStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on("transcription-status", handler);
    return () => ipcRenderer.removeListener("transcription-status", handler);
  },

  listNotes: () => ipcRenderer.invoke("list-notes"),
  readNote: (filename: string) => ipcRenderer.invoke("read-note", filename),
  deleteNote: (filename: string) => ipcRenderer.invoke("delete-note", filename),
  exportNote: (data: { filename: string; format: string }) =>
    ipcRenderer.invoke("export-note", data)
});
