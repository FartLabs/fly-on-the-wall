/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import "./styles/index.css";
import { elements } from "./components/domNodes";
import { loadAudioDevices } from "./components/devices";
import {
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  isRecordingState
} from "./components/recorder";
import { refreshModelsList } from "./components/models";
import {
  runTranscription,
  setupTranscriptionListeners
} from "./components/transcriber";
import { setupSummarizationListeners } from "./components/summarizer";
import { setupHistoryListeners } from "./components/history";

declare global {
  interface Window {
    // Declare electronAPI exposed from preload
    electronAPI: {
      saveRecording: (data: {
        buffer: ArrayBuffer;
        filename: string;
      }) => Promise<{ success: boolean; path?: string; error?: string }>;
      saveTranscription: (data: {
        text: string;
        filename: string;
      }) => Promise<{ success: boolean; path?: string; error?: string }>;
      getRecordingsDir: () => Promise<string>;
      getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
      getModelsDir: () => Promise<string>;
      checkModelExists: (modelId: string) => Promise<{ exists: boolean }>;
      deleteModel: (modelId: string) => Promise<{ success: boolean }>;
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
    };
  }
}

console.log("Fly on the Wall recorder UI initialized");

loadAudioDevices();
elements.refreshDevicesBtn.addEventListener("click", () => {
  elements.refreshDevicesBtn.classList.add("spinning");
  loadAudioDevices().finally(() =>
    setTimeout(
      () => elements.refreshDevicesBtn.classList.remove("spinning"),
      500
    )
  );
});

navigator.mediaDevices.addEventListener("devicechange", () => {
  console.log("Audio devices changed");
  loadAudioDevices();
});

elements.recordBtn.addEventListener("click", () => {
  if (isRecordingState()) {
    stopRecording();
  } else {
    startRecording((buffer, timestamp) => {
      runTranscription(buffer, timestamp);
    });
  }
});

elements.pauseBtn.addEventListener("click", pauseRecording);
elements.resumeBtn.addEventListener("click", resumeRecording);
elements.stopBtn.addEventListener("click", stopRecording);

refreshModelsList();
setupTranscriptionListeners();
setupSummarizationListeners();
setupHistoryListeners();
