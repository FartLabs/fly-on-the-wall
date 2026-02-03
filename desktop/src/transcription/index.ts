// TODO: let users drop in their own transcription models, onnx compatible with transformers.js

import {
  WHISPER_MODELS,
  type WhisperModelSize,
  MODEL_SIZES,
  preprocessAudioWhisper
} from "./whisper";
import { sendWorkerMessage } from "../worker-client";

export interface TranscriptionProgress {
  status: "loading" | "downloading" | "transcribing" | "complete" | "error";
  progress?: number;
  message: string;
}

export interface TranscriptionResult {
  text: string;
  duration: number;
  model: string;
}

export interface ModelStatus {
  modelSize: WhisperModelSize;
  modelId: string;
  downloaded: boolean;
  size: string;
}

type ProgressCallback = (progress: TranscriptionProgress) => void;

export async function initModelsDir(): Promise<string> {
  console.log("Models stored in browser Cache API");
  return "browser-cache";
}

export async function checkModelDownloaded(
  modelSize: WhisperModelSize
): Promise<boolean> {
  const modelId = WHISPER_MODELS[modelSize];

  // check the browser's Cache API
  try {
    const cache = await caches.open("transformers-cache");
    const testUrl = `https://huggingface.co/${modelId}/resolve/main/config.json`;
    const cached = await cache.match(testUrl);
    if (cached) {
      return true;
    }
  } catch (e) {
    console.log("Could not check cache:", e);
  }

  return false;
}

export async function getAllModelStatus(): Promise<ModelStatus[]> {
  const statuses: ModelStatus[] = [];

  for (const [size, modelId] of Object.entries(WHISPER_MODELS)) {
    const modelSize = size as WhisperModelSize;
    const downloaded = await checkModelDownloaded(modelSize);
    statuses.push({
      modelSize,
      modelId,
      downloaded,
      size: MODEL_SIZES[modelSize]
    });
  }

  return statuses;
}

export async function downloadModel(
  modelSize: WhisperModelSize,
  onProgress?: ProgressCallback
): Promise<void> {
  const modelId = WHISPER_MODELS[modelSize];

  onProgress?.({
    status: "downloading",
    progress: 0,
    message: `Downloading Whisper ${modelSize} model (${MODEL_SIZES[modelSize]})...`
  });

  console.log(`Downloading model: ${modelId}`);

  await sendWorkerMessage(
    { type: "download-whisper", model: modelId },
    (data) => {
      if (data.status === "downloading") {
        onProgress?.({
          status: "downloading",
          progress: data.progress,
          message: `Downloading: ${data.progress}%${data.file ? ` (${data.file})` : ""}`
        });
      } else if (data.status === "loading") {
        onProgress?.({
          status: "loading",
          progress: 0,
          message: data.message || "Loading..."
        });
      }
    }
  );

  onProgress?.({
    status: "complete",
    progress: 100,
    message: "Model downloaded successfully!"
  });
}

export async function deleteModel(
  modelSize: WhisperModelSize
): Promise<boolean> {
  const modelId = WHISPER_MODELS[modelSize];

  // Delete from browser Cache API
  try {
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();

    let deletedCount = 0;
    for (const request of keys) {
      // delete all cached files for the selected model
      if (
        request.url.includes(modelId.replace("/", "%2F")) ||
        request.url.includes(modelId)
      ) {
        await cache.delete(request);
        deletedCount++;
      }
    }

    console.log(`Deleted ${deletedCount} cached files for model ${modelId}`);

    // Also dispose from worker memory
    await sendWorkerMessage({ type: "dispose-whisper" });
    console.log("Disposed Whisper model from worker memory");

    return deletedCount > 0;
  } catch (error) {
    console.error("Error deleting model:", error);
    return false;
  }
}

/**
 * Transcribe audio using Whisper worker
 */
export async function transcribeAudio(
  audioData: ArrayBuffer,
  options: {
    modelSize?: WhisperModelSize;
    language?: string;
    onProgress?: ProgressCallback;
  } = {}
): Promise<TranscriptionResult> {
  const { modelSize = "base", language, onProgress } = options;
  const startTime = Date.now();
  const modelId = WHISPER_MODELS[modelSize];

  try {
    console.log("Preparing audio...");
    const audioArray = await preprocessAudioWhisper(audioData);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await sendWorkerMessage(
      { type: "transcribe", audioData: audioArray, model: modelId, language },
      (data) => {
        onProgress?.({
          status: data.status as any,
          message: data.message || "",
          progress: data.progress
        });
      }
    );

    const transcription = Array.isArray(result)
      ? (result[0] as any).text
      : (result as any).text;

    const duration = (Date.now() - startTime) / 1000;

    onProgress?.({
      status: "complete",
      message: "Transcription complete!"
    });

    return {
      text: transcription.trim(),
      duration,
      model: modelId
    };
  } catch (error: any) {
    onProgress?.({
      status: "error",
      message: `Transcription failed: ${error.message || error}`
    });
    throw error;
  }
}
