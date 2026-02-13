import {
  utilityProcess,
  UtilityProcess,
  app,
  ipcMain,
  BrowserWindow
} from "electron";
import path from "node:path";
import type {
  TranscriptionMessage,
  TranscriptionResponse
} from "../transcription/utility-process";
import { getTranscriptionModelsDir } from "./models";
import { MemoryUsage } from "@/shared/utilityProcess";

// TODO: Make these configurable via a settings page
const MEMORY_CHECK_INTERVAL_MS = 10_000;
const MEMORY_THRESHOLD_MB = 4096; // restart if RSS exceeds the specified threshold
const RESTART_DELAY_MS = 1000;
const PROCESS_RECYCLE_TIMEOUT_MS = 5 * 60 * 1000;

let utilityProc: UtilityProcess | null = null;
let memoryCheckTimer: NodeJS.Timeout | null = null;
let processRecycleTimer: NodeJS.Timeout | null = null;
const pendingRequests: Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    onStatus?: (status: any) => void;
  }
> = new Map();
let requestIdCounter = 0;
let isRestarting = false;
let isRecycling = false;
let initializedModelsPath: string | null = null;

function getUtilityProcessPath(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "app.asar",
      ".vite",
      "build",
      "transcription-utility.js"
    );
  }
  return path.join(
    __dirname,
    "..",
    "..",
    ".vite",
    "build",
    "transcription-utility.js"
  );
}

async function spawnTranscriptionProcess(): Promise<UtilityProcess> {
  if (utilityProc) {
    console.log("[TranscriptionManager] Process already running");
    return utilityProc;
  }

  console.log(
    "[TranscriptionManager] Spawning transcription utility process..."
  );

  const scriptPath = getUtilityProcessPath();
  console.log(`[TranscriptionManager] Script path: ${scriptPath}`);

  utilityProc = utilityProcess.fork(scriptPath, [], {
    serviceName: "transcription-utility"
    // execArgv: ["--expose-gc"]
  });

  utilityProc.on("message", (message: TranscriptionResponse) => {
    handleUtilityMessage(message);
  });

  utilityProc.on("exit", (code) => {
    console.log(
      `[TranscriptionManager] Utility process exited with code: ${code}`
    );
    handleProcessExit(code);
  });

  await initializeModelsPath();

  startMemoryMonitoring();

  console.log("[TranscriptionManager] Utility process spawned successfully");
  return utilityProc;
}

async function initializeModelsPath() {
  const modelsDir = getTranscriptionModelsDir();
  if (initializedModelsPath === modelsDir) return;

  try {
    await sendMessageAndWait(
      { type: "set-models-path", modelsPath: modelsDir },
      5000
    );
    initializedModelsPath = modelsDir;
    console.log(`[TranscriptionManager] Models path initialized: ${modelsDir}`);
  } catch (error) {
    console.error(
      `[TranscriptionManager] Failed to initialize models path:`,
      error
    );
    throw error;
  }
}

function handleUtilityMessage(message: TranscriptionResponse) {
  // console.log(`[TranscriptionManager] Received message:`, message);

  if (message.type === "memory") {
    checkMemoryThreshold(message.usage);
    return;
  }

  for (const [id, handler] of pendingRequests.entries()) {
    if (message.type === "status") {
      handler.onStatus?.(message);
    } else if (message.type === "result") {
      console.log(
        `[TranscriptionManager] Resolving request ${id} with result:`,
        message.result
      );
      handler.resolve(message.result);
      pendingRequests.delete(id);
      resetProcessRecycleTimer();
    } else if (message.type === "error") {
      console.log(
        `[TranscriptionManager] Rejecting request ${id} with error:`,
        message.error
      );
      handler.reject(new Error(message.error));
      pendingRequests.delete(id);
      resetProcessRecycleTimer();
    }
  }

  broadcastToRenderers("transcription-status", message);
}

function handleProcessExit(code: number | null) {
  utilityProc = null;
  initializedModelsPath = null;
  stopMemoryMonitoring();

  for (const [_, handler] of pendingRequests.entries()) {
    handler.reject(new Error(`Utility process exited with code ${code}`));
  }
  pendingRequests.clear();

  if (!isRestarting && !isRecycling && code !== 0) {
    console.log("[TranscriptionManager] Scheduling automatic restart...");
    setTimeout(async () => {
      isRestarting = false;
      await spawnTranscriptionProcess();
    }, RESTART_DELAY_MS);
    isRestarting = true;
  }
}

function startMemoryMonitoring() {
  if (memoryCheckTimer) return;

  memoryCheckTimer = setInterval(() => {
    if (utilityProc) {
      sendToUtility({ type: "get-memory-usage" });
    }
  }, MEMORY_CHECK_INTERVAL_MS);

  console.log("[TranscriptionManager] Memory monitoring started");
}

function stopMemoryMonitoring() {
  if (memoryCheckTimer) {
    clearInterval(memoryCheckTimer);
    memoryCheckTimer = null;
    console.log("[TranscriptionManager] Memory monitoring stopped");
  }
}

function checkMemoryThreshold(usage: MemoryUsage) {
  const rssMb = usage.rss / (1024 * 1024);
  console.log(
    `[TranscriptionManager] Memory usage: ${rssMb.toFixed(1)} MB RSS`
  );

  if (rssMb > MEMORY_THRESHOLD_MB) {
    console.warn(
      `[TranscriptionManager] Memory threshold exceeded (${rssMb.toFixed(1)} MB > ${MEMORY_THRESHOLD_MB} MB). Restarting...`
    );
    restartProcess();
  }
}

async function restartProcess(): Promise<void> {
  if (isRestarting) return;
  isRestarting = true;

  try {
    await sendMessageAndWait({ type: "dispose" }, 5000);
  } catch {
    console.warn(
      "[TranscriptionManager] Dispose during restart failed, proceeding to kill process"
    );
  }

  if (utilityProc) {
    utilityProc.kill();
    utilityProc = null;
  }

  initializedModelsPath = null;

  setTimeout(async () => {
    isRestarting = false;
    await spawnTranscriptionProcess();
  }, RESTART_DELAY_MS);
}

function resetProcessRecycleTimer() {
  if (processRecycleTimer) {
    clearTimeout(processRecycleTimer);
  }
  processRecycleTimer = setTimeout(() => {
    if (utilityProc && pendingRequests.size === 0) {
      console.log(
        "[TranscriptionManager] Process idle timeout reached, recycling utility process"
      );
      recycleProcess();
    }
  }, PROCESS_RECYCLE_TIMEOUT_MS);
}

function recycleProcess() {
  if (processRecycleTimer) {
    clearTimeout(processRecycleTimer);
    processRecycleTimer = null;
  }
  stopMemoryMonitoring();
  isRecycling = true;
  if (utilityProc) {
    utilityProc.kill();
    utilityProc = null;
  }
  initializedModelsPath = null;
  isRecycling = false;
  console.log(
    "[TranscriptionManager] Utility process recycled, will respawn on next request"
  );
}

function sendToUtility(message: TranscriptionMessage) {
  if (!utilityProc) {
    console.warn("[TranscriptionManager] No utility process running");
    return;
  }
  utilityProc.postMessage(message);
}

function sendMessageAndWait(
  message: TranscriptionMessage,
  timeoutMs = 300000
): Promise<any> {
  return new Promise((resolve, reject) => {
    (async () => {
      if (!utilityProc) {
        console.log(`[TranscriptionManager] No utility process, spawning...`);
        await spawnTranscriptionProcess();
      }

      const requestId = String(++requestIdCounter);
      console.log(
        `[TranscriptionManager] Sending message (request ${requestId}):`,
        message
      );

      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        console.log(
          `[TranscriptionManager] Request ${requestId} timed out after ${timeoutMs}ms`
        );
        reject(new Error("Request timed out"));
      }, timeoutMs);

      pendingRequests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      sendToUtility(message);
    })();
  });
}

function broadcastToRenderers(channel: string, data: any): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

async function transcribe(
  audioData: Float32Array,
  modelId: string,
  language?: string,
  onStatus?: (status: any) => void
): Promise<{ text: string }> {
  if (!utilityProc) {
    await spawnTranscriptionProcess();
  }
  await initializeModelsPath();

  return new Promise((resolve, reject) => {
    const requestId = String(++requestIdCounter);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      onStatus
    });

    // IPC accepts normal arrays
    const audioArray = Array.from(audioData);
    sendToUtility({
      type: "transcribe",
      audioData: audioArray,
      modelId,
      language
    });
  });
}

// 10 minutes
const timeoutMs = 600000;

async function downloadModel(
  modelId: string
): Promise<{ success: boolean; modelId: string }> {
  console.log(`[TranscriptionManager] downloadModel called for: ${modelId}`);
  if (!utilityProc) {
    await spawnTranscriptionProcess();
  }
  await initializeModelsPath();
  console.log(
    `[TranscriptionManager] Sending download-model message to utility process`
  );
  const result = await sendMessageAndWait(
    { type: "download-model", modelId },
    timeoutMs
  );
  console.log(
    `[TranscriptionManager] downloadModel completed with result:`,
    result
  );
  return result;
}

async function checkModel(
  modelId: string
): Promise<{ exists: boolean; modelId: string; path?: string }> {
  if (!utilityProc) {
    await spawnTranscriptionProcess();
  }
  await initializeModelsPath();
  return sendMessageAndWait({ type: "check-model", modelId });
}

async function disposeModel(): Promise<void> {
  if (!utilityProc) return;
  await sendMessageAndWait({ type: "dispose" });
}

async function deleteModelFiles(
  modelId: string
): Promise<{ success: boolean; error?: string }> {
  const fs = await import("node:fs");
  const modelsDir = getTranscriptionModelsDir();

  try {
    await disposeModel();

    // transformers.js stores models as Xenova/whisper-tiny, etc.
    const modelPath = path.join(modelsDir, modelId);

    console.log(`[TranscriptionManager] Deleting model files at: ${modelPath}`);

    if (fs.existsSync(modelPath)) {
      fs.rmSync(modelPath, { recursive: true, force: true });
      console.log(
        `[TranscriptionManager] Successfully deleted model: ${modelId}`
      );
      return { success: true };
    } else {
      console.log(
        `[TranscriptionManager] Model path does not exist: ${modelPath}`
      );
      return { success: false, error: "Model files not found" };
    }
  } catch (error) {
    console.error(
      `[TranscriptionManager] Failed to delete model files:`,
      error
    );
    return { success: false, error: String(error) };
  }
}

async function healthCheck(): Promise<{
  healthy: boolean;
  modelLoaded: boolean;
  currentModelId: string | null;
}> {
  if (!utilityProc) {
    return { healthy: false, modelLoaded: false, currentModelId: null };
  }
  return sendMessageAndWait({ type: "health-check" });
}

function stopTranscriptionProcess(): void {
  if (processRecycleTimer) {
    clearTimeout(processRecycleTimer);
    processRecycleTimer = null;
  }
  stopMemoryMonitoring();
  if (utilityProc) {
    utilityProc.kill();
    utilityProc = null;
  }
  initializedModelsPath = null;
  pendingRequests.clear();
  console.log("[TranscriptionManager] Utility process stopped");
}

ipcMain.handle(
  "transcribe",
  async (
    _event,
    data: {
      audioData: number[];
      modelId: string;
      language?: string;
    }
  ) => {
    try {
      const audioFloat32 = new Float32Array(data.audioData);
      const result = await transcribe(
        audioFloat32,
        data.modelId,
        data.language
      );
      return { success: true, ...result };
    } catch (error) {
      console.error("[TranscriptionManager] Transcription failed:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("download-whisper-model", async (_event, modelId: string) => {
  try {
    const result = await downloadModel(modelId);
    return { success: true, ...result };
  } catch (error) {
    console.error("[TranscriptionManager] Model download failed:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("check-whisper-model", async (_event, modelId: string) => {
  try {
    const result = await checkModel(modelId);
    return { success: true, ...result };
  } catch (error) {
    console.error("[TranscriptionManager] Model check failed:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("dispose-whisper-model", async () => {
  try {
    await disposeModel();
    return { success: true };
  } catch (error) {
    console.error("[TranscriptionManager] Model dispose failed:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  "delete-whisper-model-files",
  async (_event, modelId: string) => {
    try {
      const result = await deleteModelFiles(modelId);
      return result;
    } catch (error) {
      console.error(
        "[TranscriptionManager] Model file deletion failed:",
        error
      );
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("transcription-health-check", async () => {
  try {
    const result = await healthCheck();
    return { success: true, ...result };
  } catch (error) {
    console.error("[TranscriptionManager] Health check failed:", error);
    return { success: false, error: String(error) };
  }
});

// don't spawn process on app ready, spawn on first request
// since transcription w/ AI is heavy, may not always be needed
// same with the summarization process
app.on("before-quit", () => {
  stopTranscriptionProcess();
});
