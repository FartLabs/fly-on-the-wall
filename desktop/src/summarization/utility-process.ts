import fs from "node:fs";
import {
  UtilityProcessMessage,
  UtilityProcessResponse
} from "@/shared/utilityProcess";
import { SummarizeParams } from ".";
import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LLamaChatPromptOptions
} from "node-llama-cpp";

export type SummarizationProcessMessage =
  | UtilityProcessMessage
  | {
      type: "summarize";
      text: string;
      modelPath: string;
      params?: SummarizeParams;
    }
  | {
      type: "check-model";
      modelPath: string;
    }
  | { type: "download-model"; modelId: string; targetPath: string };

export type SummarizationProcessResponse =
  | UtilityProcessResponse
  | {
      type: "status";
      status: string;
      progress?: number;
      message?: string;
    };

let llamaInstance: Llama = null;
let currentModel: LlamaModel = null;
let currentModelPath: string | null = null;
let currentContext: LlamaContext = null;

const IDLE_TIMEOUT_MS = 30 * 1000;
let idleTimer: NodeJS.Timeout | null = null;

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(async () => {
    console.log(
      `[SummarizationProcess] Idle timeout reached, disposing model to free memory`
    );
    await disposeModel();
  }, IDLE_TIMEOUT_MS);
}

async function loadModel(modelPath: string) {
  if (currentModel && currentModelPath !== modelPath) {
    await disposeModel();
  }

  if (currentModel && currentModelPath === modelPath) {
    return;
  }

  console.log(`[SummarizationProcess] Loading model from: ${modelPath}`);

  const { getLlama } = await import("node-llama-cpp");

  llamaInstance = await getLlama();

  console.log(
    `[SummarizationProcess] getLlama() succeeded: buildType=${llamaInstance.buildType} gpu=${llamaInstance.gpu}`
  );

  currentModel = await llamaInstance.loadModel({ modelPath });
  currentContext = await currentModel.createContext();
  currentModelPath = modelPath;

  console.log(`[SummarizationProcess] Model loaded successfully`);
}

async function disposeModel() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (currentContext) {
    try {
      await currentContext.dispose();
    } catch (e) {
      console.error("[SummarizationProcess] Error disposing context:", e);
    }
    currentContext = null;
  }
  if (currentModel) {
    try {
      await currentModel.dispose();
    } catch (e) {
      console.error("[SummarizationProcess] Error disposing model:", e);
    }
    currentModel = null;
  }
  currentModelPath = null;

  // if (global.gc) {
  //   global.gc();
  // }

  console.log(`[SummarizationProcess] Model disposed`);
}

async function handleSummarize(data: {
  text: string;
  modelPath: string;
  params?: SummarizeParams;
}) {
  const { text, modelPath, params } = data;

  console.log(`[SummarizationProcess] Received summarization request`);
  console.log(`[SummarizationProcess] Text length: ${text?.length || 0}`);
  console.log(
    `[SummarizationProcess] Text preview: ${text?.substring(0, 200) || "(empty)"}...`
  );
  console.log(`[SummarizationProcess] Model path: ${modelPath}`);

  sendResponse({
    type: "status",
    status: "loading",
    message: "Loading model..."
  });

  await loadModel(modelPath);

  resetIdleTimer();

  sendResponse({
    type: "status",
    status: "summarizing",
    message: "Generating summary..."
  });

  const { LlamaChatSession } = await import("node-llama-cpp");

  const session = new LlamaChatSession({
    contextSequence: currentContext.getSequence()
  });

  console.log(
    `[SummarizationProcess] Sending prompt to model (length: ${text.length})`
  );
  console.log(
    `[SummarizationProcess] Prompt preview: ${text.substring(0, 200)}...`
  );

  let summary = "";

  const config = await window.electronAPI.configGet();

  try {
    const promptOptions: LLamaChatPromptOptions = {
      maxTokens: params?.maxTokens ?? config.summarizationParameters.maxTokens,
      temperature:
        params?.temperature ?? config.summarizationParameters.temperature,
      topP: params?.topP ?? config.summarizationParameters.topP,
      topK: params?.topK ?? config.summarizationParameters.topK
    };

    // repeatPenalty in node-llama-cpp expects an object or false
    if (params?.repeatPenalty && params.repeatPenalty > 1) {
      promptOptions.repeatPenalty = {
        penalty: params.repeatPenalty,
        frequencyPenalty: 0,
        presencePenalty: 0
      };
    }
    summary = await session.prompt(text, promptOptions);
  } finally {
    try {
      if (session && typeof session.dispose === "function") {
        session.dispose();
      }
    } catch (e) {
      console.error("[SummarizationProcess] Error disposing session:", e);
    }
  }

  sendResponse({ type: "result", result: { summary } });
}

async function handleCheckModel(data: { modelPath: string }) {
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

async function handleDispose() {
  await disposeModel();
  if (llamaInstance) {
    try {
      await llamaInstance.dispose();
    } catch (e) {
      console.error(
        "[SummarizationProcess] Error disposing llama instance:",
        e
      );
    }
    llamaInstance = null;
  }
  sendResponse({ type: "result", result: "disposed" });
}

function handleGetMemoryUsage() {
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

function handleHealthCheck() {
  sendResponse({
    type: "result",
    result: {
      healthy: true,
      modelLoaded: currentModel !== null,
      currentModelPath
    }
  });
}

function sendResponse(response: SummarizationProcessResponse) {
  if (process.parentPort) {
    process.parentPort.postMessage(response);
  }
}

process.parentPort?.on(
  "message",
  async (event: { data: SummarizationProcessMessage }) => {
    const data = event.data;
    console.log(`[SummarizationProcess] Received message: ${data.type}`);

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
          console.warn(`[SummarizationProcess] Unknown message: ${data}`);
      }
    } catch (error) {
      console.error(`[SummarizationProcess] Error handling ${data.type}:`, error);
      sendResponse({ type: "error", error: error.message || String(error) });
    }
  }
);

console.log("[SummarizationProcess] Summarization utility process started");
