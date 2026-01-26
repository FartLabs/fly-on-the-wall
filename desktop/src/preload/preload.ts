// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveRecording: (data: { buffer: ArrayBuffer; filename: string }) => 
    ipcRenderer.invoke('save-recording', data),
  saveTranscription: (data: { text: string; filename: string }) => 
    ipcRenderer.invoke('save-transcription', data),
  getRecordingsDir: () => ipcRenderer.invoke('get-recordings-dir'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  getModelsDir: () => ipcRenderer.invoke('get-models-dir'),
  checkModelExists: (modelId: string) => ipcRenderer.invoke('check-model-exists', modelId),
  deleteModel: (modelId: string) => ipcRenderer.invoke('delete-model', modelId),
});
