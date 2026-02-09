import {
  utilityProcess,
  UtilityProcess,
  app,
  ipcMain,
  BrowserWindow
} from "electron";
import path from "node:path";
import type {
  SummarizationProcessMessage,
  SummarizationProcessResponse
} from "../summarization/utility-process";
import type { MemoryUsage } from "@/shared/utilityProcess";
import { SummarizeParams } from "@/summarization";

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

function getUtilityProcessPath(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "app.asar",
      ".vite",
      "build",
      "summarization-utility.js"
    );
  }
  return path.join(
    __dirname,
    "..",
    "..",
    ".vite",
    "build",
    "summarization-utility.js"
  );
}

export function spawnSummarizationProcess(): UtilityProcess {
  if (utilityProc) {
    console.log("[SummarizationManager] Process already running");
    return utilityProc;
  }

  console.log(
    "[SummarizationManager] Spawning summarization utility process..."
  );

  const scriptPath = getUtilityProcessPath();
  console.log(`[SummarizationManager] Script path: ${scriptPath}`);

  utilityProc = utilityProcess.fork(scriptPath, [], {
    serviceName: "summarization-utility",
    // enable manual garbage collection
    execArgv: ["--expose-gc"]
  });

  utilityProc.on("message", (message: SummarizationProcessResponse) => {
    handleUtilityMessage(message);
  });

  utilityProc.on("exit", (code) => {
    console.log(
      `[SummarizationManager] Utility process exited with code: ${code}`
    );
    handleProcessExit(code);
  });

  startMemoryMonitoring();

  console.log("[SummarizationManager] Utility process spawned successfully");
  return utilityProc;
}

function handleUtilityMessage(message: SummarizationProcessResponse): void {
  // handle memory response separately for monitoring
  if (message.type === "memory") {
    checkMemoryThreshold(message.usage);
    return;
  }

  if (message.type === "status") {
    console.log(
      `[SummarizationManager] Status: ${message.status}${message.message ? ` - ${message.message}` : ""}`
    );
  }

  // route to pending request handlers
  for (const [id, handler] of pendingRequests.entries()) {
    if (message.type === "status") {
      handler.onStatus?.(message);
    } else if (message.type === "result") {
      handler.resolve(message.result);
      pendingRequests.delete(id);
      resetProcessRecycleTimer();
    } else if (message.type === "error") {
      handler.reject(new Error(message.error));
      pendingRequests.delete(id);
      resetProcessRecycleTimer();
    }
  }

  broadcastToRenderers("summarization-status", message);
}

function handleProcessExit(code: number | null): void {
  utilityProc = null;
  stopMemoryMonitoring();

  for (const [_, handler] of pendingRequests.entries()) {
    handler.reject(new Error(`Utility process exited with code ${code}`));
  }
  pendingRequests.clear();

  // auto-restart if not intentionally stopped or recycled
  if (!isRestarting && !isRecycling && code !== 0) {
    console.log("[SummarizationManager] Scheduling automatic restart...");
    setTimeout(() => {
      isRestarting = false;
      spawnSummarizationProcess();
    }, RESTART_DELAY_MS);
    isRestarting = true;
  }
}

function startMemoryMonitoring(): void {
  if (memoryCheckTimer) return;

  memoryCheckTimer = setInterval(() => {
    if (utilityProc) {
      sendToUtility({ type: "get-memory-usage" });
    }
  }, MEMORY_CHECK_INTERVAL_MS);

  console.log("[SummarizationManager] Memory monitoring started");
}

function stopMemoryMonitoring(): void {
  if (memoryCheckTimer) {
    clearInterval(memoryCheckTimer);
    memoryCheckTimer = null;
    console.log("[SummarizationManager] Memory monitoring stopped");
  }
}

function checkMemoryThreshold(usage: MemoryUsage): void {
  const rssMb = usage.rss / (1024 * 1024);
  console.log(
    `[SummarizationManager] Memory usage: ${rssMb.toFixed(1)} MB RSS`
  );

  if (rssMb > MEMORY_THRESHOLD_MB) {
    console.warn(
      `[SummarizationManager] Memory threshold exceeded (${rssMb.toFixed(1)} MB > ${MEMORY_THRESHOLD_MB} MB). Restarting...`
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
      "[SummarizationManager] Dispose during restart failed, proceeding to kill process"
    );
  }

  if (utilityProc) {
    utilityProc.kill();
    utilityProc = null;
  }

  setTimeout(() => {
    isRestarting = false;
    spawnSummarizationProcess();
  }, RESTART_DELAY_MS);
}

function resetProcessRecycleTimer(): void {
  if (processRecycleTimer) {
    clearTimeout(processRecycleTimer);
  }
  processRecycleTimer = setTimeout(() => {
    if (utilityProc && pendingRequests.size === 0) {
      console.log(
        "[SummarizationManager] Process idle timeout reached, recycling utility process"
      );
      recycleProcess();
    }
  }, PROCESS_RECYCLE_TIMEOUT_MS);
}

function recycleProcess(): void {
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
  isRecycling = false;
  console.log(
    "[SummarizationManager] Utility process recycled, will respawn on next request"
  );
}

function sendToUtility(message: SummarizationProcessMessage): void {
  if (!utilityProc) {
    console.warn("[SummarizationManager] No utility process running");
    return;
  }
  utilityProc.postMessage(message);
}

function sendMessageAndWait(
  message: SummarizationProcessMessage,
  timeoutMs = 30000
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!utilityProc) {
      spawnSummarizationProcess();
    }

    const requestId = String(++requestIdCounter);

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
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

// public API for main process
export async function summarize(
  text: string,
  modelPath: string,
  params?: SummarizeParams,
  onStatus?: (status: any) => void
): Promise<{ summary: string }> {
  if (!utilityProc) {
    spawnSummarizationProcess();
  }

  return new Promise((resolve, reject) => {
    const requestId = String(++requestIdCounter);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      onStatus
    });

    sendToUtility({ type: "summarize", text, modelPath, params });
  });
}

export async function checkModel(modelPath: string): Promise<{
  exists: boolean;
  isValid: boolean;
  path: string;
}> {
  if (!utilityProc) {
    spawnSummarizationProcess();
  }
  return sendMessageAndWait({ type: "check-model", modelPath });
}

export async function disposeModel(): Promise<void> {
  if (!utilityProc) return;
  await sendMessageAndWait({ type: "dispose" });
}

export async function healthCheck(): Promise<{
  healthy: boolean;
  modelLoaded: boolean;
  currentModelPath: string | null;
}> {
  if (!utilityProc) {
    return { healthy: false, modelLoaded: false, currentModelPath: null };
  }
  return sendMessageAndWait({ type: "health-check" });
}

export function stopSummarizationProcess(): void {
  if (processRecycleTimer) {
    clearTimeout(processRecycleTimer);
    processRecycleTimer = null;
  }
  stopMemoryMonitoring();
  if (utilityProc) {
    utilityProc.kill();
    utilityProc = null;
  }
  pendingRequests.clear();
  console.log("[SummarizationManager] Utility process stopped");
}

ipcMain.handle(
  "summarize",
  async (
    _event,
    data: {
      text: string;
      modelPath: string;
      params?: SummarizeParams;
    }
  ) => {
    try {
      const result = await summarize(data.text, data.modelPath, data.params);
      return { success: true, ...result };
    } catch (error) {
      console.error("[SummarizationManager] Summarization failed:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle(
  "check-summarization-model",
  async (_event, modelPath: string) => {
    try {
      const result = await checkModel(modelPath);
      return { success: true, ...result };
    } catch (error) {
      console.error("[SummarizationManager] Model check failed:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("dispose-summarization-model", async () => {
  try {
    await disposeModel();
    return { success: true };
  } catch (error) {
    console.error("[SummarizationManager] Model dispose failed:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("summarization-health-check", async () => {
  try {
    const result = await healthCheck();
    return { success: true, ...result };
  } catch (error) {
    console.error("[SummarizationManager] Health check failed:", error);
    return { success: false, error: String(error) };
  }
});

app.on("before-quit", () => {
  stopSummarizationProcess();
});
