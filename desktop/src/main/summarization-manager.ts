import { utilityProcess, UtilityProcess, app, ipcMain } from "electron";
import path from "node:path";
import type {
  SummarizationProcessMessage,
  SummarizationProcessResponse
} from "../summarization/utility-process";
import type { MemoryUsage } from "@/shared/utilityProcess";
import type { SummarizeParams } from "@/summarization";
import { broadcastToRenderer } from "./models";
import {
  DEFAULT_CONFIG,
  LIMITS,
  type UtilityProcessSettings
} from "@/shared/config";
import { AppConfig } from "@/shared/electronAPI";
import { onConfigUpdated, readConfig } from "./config";
import { clamp } from "@/utils";

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
let utilitySettings: UtilityProcessSettings =
  getSummarizationUtilitySettings(readConfig());

function getSummarizationUtilitySettings(
  config: AppConfig
): UtilityProcessSettings {
  const defaults = DEFAULT_CONFIG.summarization.utilityProcess;
  const current = config.summarization.utilityProcess ?? defaults;

  return {
    memoryCheckIntervalMs: clamp(
      current.memoryCheckIntervalMs ?? defaults.memoryCheckIntervalMs,
      LIMITS.memoryCheckIntervalMs.min,
      LIMITS.memoryCheckIntervalMs.max
    ),
    memoryThresholdMb: clamp(
      current.memoryThresholdMb ?? defaults.memoryThresholdMb,
      LIMITS.memoryThresholdMb.min,
      LIMITS.memoryThresholdMb.max
    ),
    restartDelayMs: clamp(
      current.restartDelayMs ?? defaults.restartDelayMs,
      LIMITS.restartDelayMs.min,
      LIMITS.restartDelayMs.max
    ),
    processRecycleTimeoutMs: clamp(
      current.processRecycleTimeoutMs ?? defaults.processRecycleTimeoutMs,
      LIMITS.processRecycleTimeoutMs.min,
      LIMITS.processRecycleTimeoutMs.max
    )
  };
}

function applyUtilitySettings(config: AppConfig) {
  const previous = utilitySettings;
  utilitySettings = getSummarizationUtilitySettings(config);

  const changed: string[] = [];
  if (
    previous.memoryCheckIntervalMs !== utilitySettings.memoryCheckIntervalMs
  ) {
    changed.push(
      `memoryCheckIntervalMs: ${previous.memoryCheckIntervalMs} -> ${utilitySettings.memoryCheckIntervalMs}`
    );
  }
  if (previous.memoryThresholdMb !== utilitySettings.memoryThresholdMb) {
    changed.push(
      `memoryThresholdMb: ${previous.memoryThresholdMb} -> ${utilitySettings.memoryThresholdMb}`
    );
  }
  if (previous.restartDelayMs !== utilitySettings.restartDelayMs) {
    changed.push(
      `restartDelayMs: ${previous.restartDelayMs} -> ${utilitySettings.restartDelayMs}`
    );
  }
  if (
    previous.processRecycleTimeoutMs !== utilitySettings.processRecycleTimeoutMs
  ) {
    changed.push(
      `processRecycleTimeoutMs: ${previous.processRecycleTimeoutMs} -> ${utilitySettings.processRecycleTimeoutMs}`
    );
  }

  if (changed.length > 0) {
    console.log(
      `[SummarizationManager] Applied utility settings update (${changed.join(", ")})`
    );
  }

  if (
    memoryCheckTimer &&
    previous.memoryCheckIntervalMs !== utilitySettings.memoryCheckIntervalMs
  ) {
    console.log(
      `[SummarizationManager] Reconfiguring memory check timer to ${utilitySettings.memoryCheckIntervalMs}ms`
    );
    startMemoryMonitoring(true);
  }

  if (
    processRecycleTimer &&
    previous.processRecycleTimeoutMs !== utilitySettings.processRecycleTimeoutMs
  ) {
    console.log(
      `[SummarizationManager] Reconfiguring recycle timeout to ${utilitySettings.processRecycleTimeoutMs}ms`
    );
    resetProcessRecycleTimer();
  }
}

const unsubscribeConfigUpdates = onConfigUpdated((config) => {
  applyUtilitySettings(config);
});

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

function spawnSummarizationProcess(): UtilityProcess {
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
    serviceName: "summarization-utility"
    // execArgv: ["--expose-gc"]
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

  applyUtilitySettings(readConfig());
  startMemoryMonitoring();

  console.log("[SummarizationManager] Utility process spawned successfully");
  return utilityProc;
}

function handleUtilityMessage(message: SummarizationProcessResponse) {
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

  broadcastToRenderer("summarization-status", message);
}

function handleProcessExit(code: number | null) {
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
    }, utilitySettings.restartDelayMs);
    isRestarting = true;
  }
}

function startMemoryMonitoring(force = false) {
  if (memoryCheckTimer) {
    if (!force) return;
    clearInterval(memoryCheckTimer);
    memoryCheckTimer = null;
  }

  memoryCheckTimer = setInterval(() => {
    if (utilityProc) {
      sendToUtility({ type: "get-memory-usage" });
    }
  }, utilitySettings.memoryCheckIntervalMs);

  console.log("[SummarizationManager] Memory monitoring started");
}

function stopMemoryMonitoring() {
  if (memoryCheckTimer) {
    clearInterval(memoryCheckTimer);
    memoryCheckTimer = null;
    console.log("[SummarizationManager] Memory monitoring stopped");
  }
}

function checkMemoryThreshold(usage: MemoryUsage) {
  const rssMb = usage.rss / (1024 * 1024);
  console.log(
    `[SummarizationManager] Memory usage: ${rssMb.toFixed(1)} MB RSS`
  );

  if (rssMb > utilitySettings.memoryThresholdMb) {
    console.warn(
      `[SummarizationManager] Memory threshold exceeded (${rssMb.toFixed(1)} MB > ${utilitySettings.memoryThresholdMb} MB). Restarting...`
    );
    restartProcess();
  }
}

async function restartProcess() {
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
  }, utilitySettings.restartDelayMs);
}

function resetProcessRecycleTimer() {
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
  }, utilitySettings.processRecycleTimeoutMs);
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
  isRecycling = false;
  console.log(
    "[SummarizationManager] Utility process recycled, will respawn on next request"
  );
}

function sendToUtility(message: SummarizationProcessMessage) {
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

// public API for main process
async function summarize(
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

async function checkModel(modelPath: string): Promise<{
  exists: boolean;
  isValid: boolean;
  path: string;
}> {
  if (!utilityProc) {
    spawnSummarizationProcess();
  }
  return sendMessageAndWait({ type: "check-model", modelPath });
}

async function disposeModel() {
  if (!utilityProc) return;
  await sendMessageAndWait({ type: "dispose" });
}

async function healthCheck(): Promise<{
  healthy: boolean;
  modelLoaded: boolean;
  currentModelPath: string | null;
}> {
  if (!utilityProc) {
    return { healthy: false, modelLoaded: false, currentModelPath: null };
  }
  return sendMessageAndWait({ type: "health-check" });
}

function stopSummarizationProcess() {
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
  unsubscribeConfigUpdates();
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
