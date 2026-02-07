import fs from "node:fs";
import path from "node:path";

// import transformers.js early so we can configure it
// TODO: in the future, will use an existing node bindings for whisper.cpp (or one from scratch in this
// project) since i believe some of the current solutions are not actively maintained

export type TranscriptionMessage =
  | {
      type: "transcribe";
      audioData: number[]; // Float32Array sent as normal array (will later be converted back)
      modelId: string;
      language?: string;
    }
  | { type: "download-model"; modelId: string }
  | { type: "check-model"; modelId: string }
  | { type: "dispose" }
  | { type: "get-memory-usage" }
  | { type: "health-check" }
  | { type: "set-models-path"; modelsPath: string };

export type TranscriptionResponse =
  | {
      type: "status";
      status: string;
      progress?: number;
      message?: string;
      file?: string;
    }
  | { type: "result"; result: any }
  | { type: "error"; error: string }
  | { type: "memory"; usage: MemoryUsage };

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

let transcriber: any = null;
let currentModelId: string | null = null;
let modelsPath: string | null = null;

const IDLE_TIMEOUT_MS = 30 * 1000;
let idleTimer: NodeJS.Timeout | null = null;

function sendMessage(message: TranscriptionResponse): void {
  process.parentPort?.postMessage(message);
}

function sendStatus(
  status: string,
  message?: string,
  progress?: number,
  file?: string
): void {
  sendMessage({ type: "status", status, message, progress, file });
}

function sendResult(result: any): void {
  console.log(`[TranscriptionProcess] Sending result:`, result);
  sendMessage({ type: "result", result });
}

function sendError(error: string): void {
  console.log(`[TranscriptionProcess] Sending error:`, error);
  sendMessage({ type: "error", error });
}

function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(async () => {
    console.log(`[TranscriptionProcess] Idle timeout reached, disposing model`);
    await disposeModel();
  }, IDLE_TIMEOUT_MS);
}

async function loadModel(modelId: string): Promise<void> {
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
  transcriber = await pipeline("automatic-speech-recognition", modelId, {
    progress_callback: (progress: any) => {
      console.log(`[TranscriptionProcess] Progress:`, progress);
      if (
        progress.status === "progress" ||
        typeof progress.progress === "number"
      ) {
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
  });

  currentModelId = modelId;
  console.log(`[TranscriptionProcess] Model loaded successfully: ${modelId}`);
  sendStatus("complete", `Model ${modelId} loaded successfully`);
}

async function disposeModel(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (transcriber) {
    try {
      // transformers.js pipelines don't have explicit dispose, but we can null them
      transcriber = null;
      currentModelId = null;
      console.log(`[TranscriptionProcess] Model disposed`);
    } catch (e) {
      console.error("[TranscriptionProcess] Error disposing model:", e);
    }
  }

  if (global.gc) {
    global.gc();
  }
}

async function handleTranscribe(data: {
  audioData: number[];
  modelId: string;
  language?: string;
}): Promise<void> {
  const { audioData, modelId, language } = data;

  try {
    resetIdleTimer();

    await loadModel(modelId);

    sendStatus("transcribing", "Processing audio...");

    let audioFloat32: Float32Array | null = new Float32Array(audioData);
    // release the incoming array now that we've copied to Float32Array
    data.audioData = null as any;

    console.log(
      `[TranscriptionProcess] Running inference on ${audioFloat32.length} samples...`
    );

    const result = await transcriber(audioFloat32, {
      language: language || "en",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false
    });

    // free audio buffer after inference
    audioFloat32 = null;

    console.log(`[TranscriptionProcess] Transcription complete`);
    sendResult(result);
  } catch (error: any) {
    console.error("[TranscriptionProcess] Transcription failed:", error);
    sendError(error.message || String(error));
  }
}

async function handleDownloadModel(data: { modelId: string }): Promise<void> {
  try {
    console.log(
      `[TranscriptionProcess] Starting download for model: ${data.modelId}`
    );
    sendStatus("downloading", `Downloading model ${data.modelId}...`, 0);

    await loadModel(data.modelId);

    console.log(
      `[TranscriptionProcess] Download complete, sending result for: ${data.modelId}`
    );
    sendResult({ success: true, modelId: data.modelId });
  } catch (error: any) {
    console.error("[TranscriptionProcess] Download failed:", error);
    sendError(error.message || String(error));
  }
}

async function handleCheckModel(data: { modelId: string }): Promise<void> {
  try {
    if (!modelsPath) {
      console.log(
        `[TranscriptionProcess] Models path not set, model ${data.modelId} not downloaded`
      );
      sendResult({ exists: false, modelId: data.modelId });
      return;
    }

    // transformers.js stores models preserving the org/name structure
    // for "Xenova/whisper-base", it becomes "Xenova/whisper-base/" directly
    // but it can also be in "models/Xenova/whisper-base/" or "Xenova--whisper-base/"
    const possiblePaths = [
      // Direct: Xenova/whisper-base
      path.join(modelsPath, data.modelId),
      // In models subdir: models/Xenova/whisper-base
      path.join(modelsPath, "models", data.modelId),
      // Flattened: Xenova--whisper-base
      path.join(modelsPath, data.modelId.replace("/", "--")),
      // Flattened in models: models/Xenova--whisper-base
      path.join(modelsPath, "models", data.modelId.replace("/", "--"))
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

    sendResult({
      exists,
      modelId: data.modelId,
      path: foundPath || possiblePaths[0]
    });
  } catch (error: any) {
    console.error("[TranscriptionProcess] Check model failed:", error);
    sendError(error.message || String(error));
  }
}

async function handleDispose(): Promise<void> {
  await disposeModel();
  sendResult({ success: true });
}

function handleGetMemoryUsage(): void {
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

function handleHealthCheck(): void {
  sendResult({
    healthy: true,
    modelLoaded: transcriber !== null,
    currentModelId
  });
}

async function handleSetModelsPath(data: {
  modelsPath: string;
}): Promise<void> {
  modelsPath = data.modelsPath;
  console.log(`[TranscriptionProcess] Models path set to: ${modelsPath}`);

  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }

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

  sendResult({ success: true, modelsPath });
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
          await handleDispose();
          break;
        case "get-memory-usage":
          handleGetMemoryUsage();
          break;
        case "health-check":
          handleHealthCheck();
          break;
        case "set-models-path":
          await handleSetModelsPath(message);
          break;
        default:
          console.warn(
            `[TranscriptionProcess] Unknown message type: ${(message as any).type}`
          );
      }
    } catch (error: any) {
      console.error(
        `[TranscriptionProcess] Error handling ${message.type}:`,
        error
      );
      sendError(error.message || String(error));
    }
  }
);

console.log("[TranscriptionProcess] Utility process started");
