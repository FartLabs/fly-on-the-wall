import fs from "node:fs";

export type UtilityMessage =
  | { type: "summarize"; text: string; modelPath: string; params?: SummarizeParams }
  | { type: "download-model"; modelId: string; targetPath: string }
  | { type: "check-model"; modelPath: string }
  | { type: "dispose" }
  | { type: "get-memory-usage" }
  | { type: "health-check" };

export type UtilityResponse =
  | { type: "status"; status: string; progress?: number; message?: string }
  | { type: "result"; result: any }
  | { type: "error"; error: string }
  | { type: "memory"; usage: MemoryUsage };

export interface SummarizeParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
}

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

let llamaInstance: any = null;
let currentModel: any = null;
let currentModelPath: string | null = null;
let currentContext: any = null;

const IDLE_TIMEOUT_MS = 1 * 60 * 1000; 
let idleTimer: NodeJS.Timeout | null = null;

function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  
  idleTimer = setTimeout(async () => {
    console.log(`[UtilityProcess] Idle timeout reached, disposing model to free memory`);
    await disposeModel();
    
    if (global.gc) {
      console.log(`[UtilityProcess] Running garbage collection`);
      global.gc();
    }
  }, IDLE_TIMEOUT_MS);
}

async function loadModel(modelPath: string): Promise<void> {
  if (currentModel && currentModelPath !== modelPath) {
    await disposeModel();
  }

  if (currentModel && currentModelPath === modelPath) {
    return;
  }

  console.log(`[UtilityProcess] Loading model from: ${modelPath}`);

  const { getLlama } = await import("node-llama-cpp");

  llamaInstance = await getLlama();
  currentModel = await llamaInstance.loadModel({ modelPath });
  currentContext = await currentModel.createContext();
  currentModelPath = modelPath;

  console.log(`[UtilityProcess] Model loaded successfully`);
}

async function disposeModel(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  
  if (currentContext) {
    try {
      await currentContext.dispose();
    } catch (e) {
      console.error('[UtilityProcess] Error disposing context:', e);
    }
    currentContext = null;
  }
  if (currentModel) {
    try {
      await currentModel.dispose();
    } catch (e) {
      console.error('[UtilityProcess] Error disposing model:', e);
    }
    currentModel = null;
  }
  currentModelPath = null;
  
  if (global.gc) {
    global.gc();
  }
  
  console.log(`[UtilityProcess] Model disposed`);
}

async function handleSummarize(data: {
  text: string;
  modelPath: string;
  params?: SummarizeParams;
}): Promise<void> {
  const { text, modelPath, params } = data;

  console.log(`[UtilityProcess] Received summarization request`);
  console.log(`[UtilityProcess] Text length: ${text?.length || 0}`);
  console.log(`[UtilityProcess] Text preview: ${text?.substring(0, 200) || '(empty)'}...`);
  console.log(`[UtilityProcess] Model path: ${modelPath}`);

  sendResponse({ type: "status", status: "loading", message: "Loading model..." });

  await loadModel(modelPath);
  
  resetIdleTimer();

  sendResponse({ type: "status", status: "summarizing", message: "Generating summary..." });

  const { LlamaChatSession } = await import("node-llama-cpp");

  const session = new LlamaChatSession({
    contextSequence: currentContext.getSequence()
  });

  console.log(`[UtilityProcess] Sending prompt to model (length: ${text.length})`);
  console.log(`[UtilityProcess] Prompt preview: ${text.substring(0, 200)}...`);

  let summary = "";

  try {
    summary = await session.prompt(text, {
      maxTokens: params?.maxTokens ?? 1024,
      temperature: params?.temperature ?? 0.7,
      topP: params?.topP ?? 0.9,
      // TODO: maybe implement streaming text for the UI?
    //   onTextChunk: (chunk: string) => {
    //     // Could stream chunks back if needed
    //   }
    });
  } finally {
    try {
      if (session && typeof session.dispose === 'function') {
        session.dispose();
      }
    } catch (e) {
      console.error('[UtilityProcess] Error disposing session:', e);
    }
  }

  sendResponse({ type: "result", result: { summary } });
}

async function handleCheckModel(data: { modelPath: string }): Promise<void> {
  const exists = fs.existsSync(data.modelPath);
  const isFile = exists && fs.statSync(data.modelPath).isFile();
  const isGGUF = data.modelPath.toLowerCase().endsWith(".gguf");

  sendResponse({
    type: "result",
    result: {
      exists,
      isValid: exists && isFile && isGGUF,
      path: data.modelPath
    }
  });
}

async function handleDispose(): Promise<void> {
  await disposeModel();
  if (llamaInstance) {
    try {
      await llamaInstance.dispose();
    } catch (e) {
      console.error('[UtilityProcess] Error disposing llama instance:', e);
    }
    llamaInstance = null;
  }
  sendResponse({ type: "result", result: "disposed" });
}

function handleGetMemoryUsage(): void {
  const usage = process.memoryUsage();
  sendResponse({
    type: "memory",
    usage: {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    }
  });
}

function handleHealthCheck(): void {
  sendResponse({
    type: "result",
    result: {
      healthy: true,
      modelLoaded: currentModel !== null,
      currentModelPath
    }
  });
}

function sendResponse(response: UtilityResponse): void {
  if (process.parentPort) {
    process.parentPort.postMessage(response);
  }
}

process.parentPort?.on("message", async (event: { data: UtilityMessage }) => {
  const data = event.data;
  console.log(`[UtilityProcess] Received message: ${data.type}`);

  try {
    switch (data.type) {
      case "summarize":
        await handleSummarize(data);
        break;
      case "check-model":
        await handleCheckModel(data);
        break;
      case "dispose":
        await handleDispose();
        break;
      case "get-memory-usage":
        handleGetMemoryUsage();
        break;
      case "health-check":
        handleHealthCheck();
        break;
      default:
        console.warn(`[UtilityProcess] Unknown message type: ${(data as any).type}`);
    }
  } catch (err: any) {
    console.error(`[UtilityProcess] Error handling ${data.type}:`, err);
    sendResponse({ type: "error", error: err.message || String(err) });
  }
});

console.log("[UtilityProcess] Summarization utility process started");
