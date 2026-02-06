/**
 * Transcription module - now using Electron IPC to communicate with utility process
 *
 * Audio preprocessing still happens in the renderer (which has access to Web APIs),
 * then the preprocessed audio data is sent to the utility process for inference.
 */

import {
  WHISPER_MODELS,
  type WhisperModelSize,
  MODEL_SIZES,
  preprocessAudioWhisper
} from "./whisper";

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

export async function checkModelDownloaded(
  modelSize: WhisperModelSize
): Promise<boolean> {
  const modelId = WHISPER_MODELS[modelSize];

  try {
    const result = await window.electronAPI.checkWhisperModel(modelId);
    if (result.exists) {
      console.log(`[Transcription] Model ${modelId} is downloaded.`);
    }
    return result.success && result.exists;
  } catch (e) {
    console.error("Error checking model status:", e);
    return false;
  }
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

  let unsubscribe: (() => void) | undefined;
  if (onProgress) {
    unsubscribe = window.electronAPI.onTranscriptionStatus((status: any) => {
      if (status.type === "status") {
        if (status.status === "downloading") {
          onProgress({
            status: "downloading",
            progress: status.progress,
            message: `Downloading: ${Math.round(status.progress || 0)}%${status.file ? ` (${status.file})` : ""}`
          });
        } else if (status.status === "loading") {
          onProgress({
            status: "loading",
            progress: 0,
            message: status.message || "Loading..."
          });
        }
      }
    });
  }

  try {
    const result = await window.electronAPI.downloadWhisperModel(modelId);

    if (!result.success) {
      throw new Error(result.error || "Download failed");
    }

    onProgress?.({
      status: "complete",
      progress: 100,
      message: "Model downloaded successfully!"
    });
  } finally {
    unsubscribe?.();
  }
}

export async function deleteModel(
  modelSize: WhisperModelSize
): Promise<boolean> {
  const modelId = WHISPER_MODELS[modelSize];

  try {
    console.log(`Deleting model ${modelId} (${modelSize})...`);

    // note: this deletes the files but doesn't free memory
    const result = await window.electronAPI.deleteWhisperModelFiles(modelId);

    if (!result.success) {
      console.error(`Failed to delete model files: ${result.error}`);
      return false;
    }

    console.log(`Model ${modelId} deleted successfully`);
    return true;
  } catch (error) {
    console.error("Error deleting model:", error);
    return false;
  }
}

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

  let unsubscribe: (() => void) | undefined;
  if (onProgress) {
    unsubscribe = window.electronAPI.onTranscriptionStatus((status: any) => {
      if (status.type === "status") {
        onProgress({
          status: status.status as TranscriptionProgress["status"],
          message: status.message || "",
          progress: status.progress
        });
      }
    });
  }

  try {
    onProgress?.({
      status: "loading",
      message: "Preparing audio..."
    });

    // preprocess audio in the renderer (which has access to OfflineAudioContext)
    console.log("Preprocessing audio...");
    const audioArray = await preprocessAudioWhisper(audioData);
    console.log(`Audio preprocessed: ${audioArray.length} samples`);

    onProgress?.({
      status: "transcribing",
      message: "Starting transcription..."
    });

    const audioDataArray = Array.from(audioArray);
    const result = await window.electronAPI.transcribe({
      audioData: audioDataArray,
      modelId,
      language
    });

    if (!result.success) {
      throw new Error(result.error || "Transcription failed");
    }

    // result can be: { text: "..." } or { text: { text: "..." } } or { text: [{ text: "..." }] }
    let transcription: string;
    const resultText: unknown = result.text;
    if (Array.isArray(resultText)) {
      const first = resultText[0];
      transcription =
        first && typeof first === "object" && "text" in first
          ? String(first.text)
          : String(first || "");
    } else if (
      resultText &&
      typeof resultText === "object" &&
      "text" in resultText
    ) {
      transcription = String((resultText as { text: string }).text);
    } else {
      transcription = String(resultText || "");
    }

    const duration = (Date.now() - startTime) / 1000;

    onProgress?.({
      status: "complete",
      message: "Transcription complete!"
    });

    return {
      text: String(transcription).trim(),
      duration,
      model: modelId
    };
  } catch (error: any) {
    onProgress?.({
      status: "error",
      message: `Transcription failed: ${error.message || error}`
    });
    throw error;
  } finally {
    unsubscribe?.();
  }
}
