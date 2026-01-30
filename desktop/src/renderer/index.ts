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
import { refreshModelsList, getSelectedTranscriptionModel, getSelectedSummaryModel } from "./components/models";
import {
  runTranscription,
  setupTranscriptionListeners
} from "./components/transcriber";
import { setupSummarizationListeners } from "./components/summarizer";
import { setupHistoryListeners } from "./components/history";
import { setupPromptCustomizer } from "./components/promptCustomizer";
import { setupSidebarListeners } from "./components/leftSideBar";
import { setupRightPanelListeners } from "./components/rightSideBar";

declare global {
  interface Window {
    electronAPI: {
      saveRecording: (data: {
        buffer: ArrayBuffer;
        filename: string;
      }) => Promise<{ success: boolean; path?: string; error?: string }>;
      saveTranscription: (data: {
        text: string;
        filename: string;
      }) => Promise<{ success: boolean; path?: string; error?: string }>;
      saveNote: (data: { transcription: string; summary?: string; filename?: string; metadata?: Record<string, any> }) => Promise<{ success: boolean; filename?: string; error?: string }>;
      getRecordingsDir: () => Promise<string>;
      getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
      getModelsDir: () => Promise<string>;
      checkModelExists: (modelId: string) => Promise<{ exists: boolean }>;
      deleteModel: (modelId: string) => Promise<{ success: boolean }>;
      // selectCustomModelFolder: () => Promise<{ 
      //   success: boolean; 
      //   path?: string; 
      //   canceled?: boolean;
      //   error?: string;
      // }>;
      // validateCustomModel: (modelPath: string) => Promise<{
      //   valid: boolean;
      //   error?: string;
      //   modelType?: string;
      //   modelName?: string;
      // }>;
      // importCustomModel: (data: { 
      //   sourcePath: string; 
      //   modelName: string 
      // }) => Promise<{ 
      //   success: boolean; 
      //   path?: string;
      //   modelId?: string;
      //   error?: string;
      // }>;
      // listCustomModels: () => Promise<{
      //   success: boolean;
      //   models: Array<{
      //     id: string;
      //     name: string;
      //     path: string;
      //   }>;
      //   error?: string;
      // }>;
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
      exportNote: (data: { filename: string; format: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
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

refreshModelsList()
  .then(async () => {
    const selTranscription = getSelectedTranscriptionModel();
    const selSummary = getSelectedSummaryModel();
    console.log(`selected transcription model: ${selTranscription}`);
    console.log(`selected summarization model: ${selSummary}`);

    const firstRunKey = "introNoteCreated";
    const alreadyCreated = localStorage.getItem(firstRunKey) === "true";

    console.log("Is user's first run?", !alreadyCreated);
 
    // create a introductory note if none exist yet
    // this will not run if user already has notes saved
      try {
      if (alreadyCreated) return;
          const r = await window.electronAPI.listNotes();
          if (r.success && Array.isArray(r.files) && r.files.length === 0) {
            console.log("First run with empty notes — creating introductory note");
            try {
              const res = await window.electronAPI.saveNote({
                transcription: "Welcome to Fly on the Wall! This note demonstrates the new structured notes format. Your transcriptions and summaries will be stored here.",
                summary: "This is your introductory summary. Enjoy the app!"
              });
              if (res.success) {
                localStorage.setItem(firstRunKey, "true");
                console.log("Introductory note created:", res.filename);
              } else {
                console.error("Failed to create introductory note:", res.error);
              }
            } catch (err) {
              console.error("Error saving introductory note:", err);
            }
        }
      } catch (err) {
        console.error("Error checking/creating introductory note:", err);
      }
  }).catch((err) => console.error("Error refreshing models on startup:", err));

setupTranscriptionListeners();
setupSummarizationListeners();
setupHistoryListeners();
setupPromptCustomizer();
setupSidebarListeners();
setupRightPanelListeners();
