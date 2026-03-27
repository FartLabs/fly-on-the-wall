import fs from "node:fs";
import path from "node:path";
import {
  UtilityProcessMessage,
  UtilityProcessResponse
} from "@/shared/utilityProcess";
import type {
  PretrainedModelOptions,
  AutomaticSpeechRecognitionPipeline,
  ProgressInfo
} from "@huggingface/transformers";

// TODO: in the future, will use an existing node bindings for whisper.cpp (or one from scratch in this
// project) since i believe some of the current solutions are not actively maintained

export type TranscriptionMessage =
  | UtilityProcessMessage
  | {
      type: "transcribe";
      audioData: number[]; // Float32Array sent as normal array (will later be converted back)
      modelId: string;
      language?: string;
      requestId?: string;
    }
  | { type: "download-model"; modelId: string; requestId?: string }
  | { type: "check-model"; modelId: string; requestId?: string }
  | { type: "set-models-path"; modelsPath: string; requestId?: string };

export type TranscriptionResponse =
  | UtilityProcessResponse
  | {
      type: "status";
      status: string;
      progress?: number;
      message?: string;
      file?: string;
      requestId?: string;
    };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentModelId: string | null = null;
let modelsPath: string | null = null;

const IDLE_TIMEOUT_MS = 30 * 1000;
let idleTimer: NodeJS.Timeout | null = null;

function sendMessage(message: TranscriptionResponse) {
  process.parentPort?.postMessage(message);
}

function sendStatus(
  status: string,
  message?: string,
  progress?: number,
  file?: string,
  requestId?: string
) {
  sendMessage({ type: "status", status, message, progress, file, requestId });
}

// anything serializable can be sent in the result
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendResult(result: any, requestId?: string) {
  console.log(`[TranscriptionProcess] Sending result:`, result);
  sendMessage({ type: "result", result, requestId });
}

function sendError(error: string, requestId?: string) {
  console.log(`[TranscriptionProcess] Sending error:`, error);
  sendMessage({ type: "error", error, requestId });
}

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(async () => {
    console.log(`[TranscriptionProcess] Idle timeout reached, disposing model`);
    await disposeModel();
  }, IDLE_TIMEOUT_MS);
}

async function loadModel(modelId: string) {
  if (transcriber && currentModelId === modelId) {
    console.log(`[TranscriptionProcess] Model ${modelId} already loaded`);
    return;
  }

  if (transcriber && currentModelId !== modelId) {
    await disposeModel();
  }

  console.log(`[TranscriptionProcess] Loading model: ${modelId}`);
  sendStatus("loading", `Loading model ${modelId}...`);

  // import transformers.js, env should already be configured from handleSetModelsPath
  const { pipeline } = await import("@huggingface/transformers");

  console.log(`[TranscriptionProcess] Creating pipeline for ${modelId}...`);
  const pipelineOptions: PretrainedModelOptions = {
    progress_callback: (progress: ProgressInfo) => {
      console.log(`[TranscriptionProcess] Progress:`, progress);
      if (progress.status === "progress") {
        sendStatus(
          "downloading",
          `Downloading ${progress.file || "model"}...`,
          progress.progress,
          progress.file
        );
      } else if (progress.status === "done") {
        sendStatus("loading", "Loading model...");
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore: union type is too complex to represent according to TS, but it's fine
  transcriber = await pipeline(
    "automatic-speech-recognition",
    modelId,
    pipelineOptions
  );

  currentModelId = modelId;
  console.log(`[TranscriptionProcess] Model loaded successfully: ${modelId}`);
  sendStatus("complete", `Model ${modelId} loaded successfully`);
}

async function disposeModel() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (transcriber) {
    try {
      // transformers.js pipelines don't have explicit dispose, but null them
      transcriber = null;
      currentModelId = null;
      console.log(`[TranscriptionProcess] Model disposed`);
    } catch (e) {
      console.error("[TranscriptionProcess] Error disposing model:", e);
    }
  }

  // if (global.gc) {
  //   global.gc();
  // }
}

async function handleTranscribe(data: {
  audioData: number[];
  modelId: string;
  language?: string;
  requestId?: string;
}) {
  const { audioData, modelId, language, requestId } = data;

  try {
    resetIdleTimer();
    await loadModel(modelId);
    sendStatus(
      "transcribing",
      "Processing audio...",
      undefined,
      undefined,
      requestId
    );

    let audioFloat32: Float32Array = new Float32Array(audioData);

    console.log(
      `[TranscriptionProcess] Running inference on ${audioFloat32.length} samples...`
    );

    if (!transcriber) {
      throw new Error("Model not loaded");
    }

    const result = await transcriber(audioFloat32, {
      language: language || "en",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true
    });

    // no need to keep the audio in memory after transcription
    audioFloat32 = null;

    console.log(`[TranscriptionProcess] Transcription complete`);
    sendResult(result, requestId);
  } catch (error) {
    console.error("[TranscriptionProcess] Transcription failed:", error);
    sendError(error.message || String(error), requestId);
  }
}

async function handleDownloadModel(data: {
  modelId: string;
  requestId?: string;
}) {
  try {
    console.log(
      `[TranscriptionProcess] Starting download for model: ${data.modelId}`
    );
    sendStatus(
      "downloading",
      `Downloading model ${data.modelId}...`,
      0,
      undefined,
      data.requestId
    );

    if (modelsPath && !fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }

    if (modelsPath && !fs.existsSync(modelsPath)) {
      fs.mkdirSync(modelsPath, { recursive: true });
    }

    await loadModel(data.modelId);

    console.log(
      `[TranscriptionProcess] Download complete, sending result for: ${data.modelId}`
    );
    sendResult({ success: true, modelId: data.modelId }, data.requestId);
  } catch (error) {
    console.error("[TranscriptionProcess] Download failed:", error);
    sendError(error.message || String(error), data.requestId);
  }
}

async function handleCheckModel(data: { modelId: string; requestId?: string }) {
  try {
    if (!modelsPath) {
      console.log(
        `[TranscriptionProcess] Models path not set, model ${data.modelId} not downloaded`
      );
      sendResult({ exists: false, modelId: data.modelId }, data.requestId);
      return;
    }

    const flatModelId = data.modelId.replaceAll("/", "--");

    const possiblePaths = [
      path.join(modelsPath, data.modelId),
      path.join(modelsPath, "models", data.modelId),

      // fallback: flattened org--repo structure (if for some reason the directory is not cleaned up beforehand)
      // and resorts to checking transformers.js's default directory names
      // transformers.js stores models preserving the org/name structure
      // for "Xenova/whisper-base", it becomes "Xenova/whisper-base/" directly
      // but it can also be in "models/Xenova/whisper-base/" or "Xenova--whisper-base/"

      path.join(modelsPath, flatModelId),
      path.join(modelsPath, "models", flatModelId)
    ];

    let exists = false;
    let foundPath = "";

    for (const modelDir of possiblePaths) {
      console.log(`[TranscriptionProcess] Checking path: ${modelDir}`);
      if (!fs.existsSync(modelDir)) continue;

      const onnxDir = path.join(modelDir, "onnx");
      const hasOnnxFiles =
        fs.existsSync(onnxDir) &&
        fs.readdirSync(onnxDir).some((f) => f.endsWith(".onnx"));
      const hasConfig = fs.existsSync(path.join(modelDir, "config.json"));

      console.log(
        `[TranscriptionProcess] Path ${modelDir} - hasOnnx: ${hasOnnxFiles}, hasConfig: ${hasConfig}`
      );

      if (hasOnnxFiles || hasConfig) {
        exists = true;
        foundPath = modelDir;
        console.log(
          `[TranscriptionProcess] Found model ${data.modelId} at ${foundPath}`
        );
        break;
      }
    }

    if (!exists) {
      console.log(
        `[TranscriptionProcess] Model ${data.modelId} not found in any expected location`
      );
      console.log(`[TranscriptionProcess] Checked paths:`, possiblePaths);
    }

    sendResult(
      {
        exists,
        modelId: data.modelId,
        path: foundPath || possiblePaths[0]
      },
      data.requestId
    );
  } catch (error) {
    console.error("[TranscriptionProcess] Check model failed:", error);
    sendError(error.message || String(error), data.requestId);
  }
}

async function handleDispose(requestId?: string) {
  await disposeModel();
  sendResult({ success: true }, requestId);
}

function handleGetMemoryUsage() {
  const usage = process.memoryUsage();
  sendMessage({
    type: "memory",
    usage: {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    }
  });
}

function handleHealthCheck(requestId?: string) {
  sendResult(
    {
      healthy: true,
      modelLoaded: transcriber !== null,
      currentModelId
    },
    requestId
  );
}

async function handleSetModelsPath(data: {
  modelsPath: string;
  requestId?: string;
}) {
  modelsPath = data.modelsPath;
  console.log(`[TranscriptionProcess] Models path set to: ${modelsPath}`);

  try {
    const { env } = await import("@huggingface/transformers");
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    env.cacheDir = modelsPath;
    console.log(
      `[TranscriptionProcess] Transformers.js configured with cache dir: ${modelsPath}`
    );
  } catch (error) {
    console.error(
      "[TranscriptionProcess] Failed to initialize transformers.js:",
      error
    );
  }

  sendResult({ success: true, modelsPath }, data.requestId);
}

process.parentPort?.on(
  "message",
  async (event: { data: TranscriptionMessage }) => {
    const message = event.data;
    console.log(`[TranscriptionProcess] Received message: ${message.type}`);

    try {
      switch (message.type) {
        case "transcribe":
          await handleTranscribe(message);
          break;
        case "download-model":
          await handleDownloadModel(message);
          break;
        case "check-model":
          await handleCheckModel(message);
          break;
        case "dispose":
          await handleDispose(message.requestId);
          break;
        case "get-memory-usage":
          handleGetMemoryUsage();
          break;
        case "health-check":
          handleHealthCheck(message.requestId);
          break;
        case "set-models-path":
          await handleSetModelsPath(message);
          break;
        default:
          console.warn(`[TranscriptionProcess] Unknown message: ${message}`);
      }
    } catch (error) {
      console.error(
        `[TranscriptionProcess] Error handling ${message.type}:`,
        error
      );
      sendError(error.message || String(error));
    }
  }
);

console.log("[TranscriptionProcess] Utility process started");
