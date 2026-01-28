import { pipeline, env } from "@huggingface/transformers";
import {
  WhisperPipeline,
  WHISPER_MODELS,
  preprocessAudioWhisper
} from "./transcription/whisper";
import {
  SummarizationPipeline,
  SUMMARIZATION_MODEL
} from "./summarization/pipeline";

// Configure environment for worker
env.allowLocalModels = false;
env.allowRemoteModels = true;

// Define message types
export type WorkerMessage =
  | {
      type: "transcribe";
      audioData: Float32Array;
      model: string;
      language?: string;
    }
  | { type: "summarize"; text: string; params?: any }
  | { type: "download-whisper"; model: string }
  | { type: "download-summarization" }
  | { type: "check-whisper"; model: string }
  | { type: "check-summarization" }
  | { type: "dispose" }
  | { type: "dispose-whisper" }
  | { type: "dispose-summarization" };

export type WorkerResponse =
  | {
      type: "status";
      status: string;
      progress?: number;
      message?: string;
      file?: string;
    }
  | { type: "result"; result: any }
  | { type: "error"; error: string };

self.addEventListener("message", async (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;
  console.log(`[Worker] Received message: ${data.type}`);

  try {
    switch (data.type) {
      case "transcribe":
        await handleTranscribe(data);
        break;
      case "summarize":
        await handleSummarize(data);
        break;
      case "download-whisper":
        await handleDownloadWhisper(data);
        break;
      case "download-summarization":
        await handleDownloadSummarization();
        break;
      case "dispose":
        await handleDispose();
        break;
      case "dispose-whisper":
        await handleDisposeWhisper();
        break;
      case "dispose-summarization":
        await handleDisposeSummarization();
        break;
      default:
        console.warn(`[Worker] Unknown message type: ${data.type}`);
    }
  } catch (err: any) {
    console.error(`[Worker] Error handling ${data.type}:`, err);
    self.postMessage({ type: "error", error: err.message || String(err) });
  }
});

async function handleTranscribe(data: {
  audioData: Float32Array;
  model: string;
  language?: string;
}) {
  const { audioData, model, language } = data;
  console.log(`[Worker] Starting transcription with model ${model}...`);

  self.postMessage({
    type: "status",
    status: "loading",
    message: "Loading model..."
  });

  const transcriber = await WhisperPipeline.getInstance(
    model,
    (progress: any) => {
      // Only send progress if it's a download status (transformers.js sends different objects)
      if (
        progress.status === "progress" ||
        typeof progress.progress === "number"
      ) {
        self.postMessage({
          type: "status",
          status: "downloading",
          progress: progress.progress,
          file: progress.file
        });
      }
    }
  );

  self.postMessage({
    type: "status",
    status: "transcribing",
    message: "Processing audio..."
  });

  // Audio is already preprocessed in the main thread now

  console.log(`[Worker] Running inference...`);
  const result = await transcriber(audioData, {
    language: language || "en",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false
  });

  console.log(`[Worker] Transcription complete.`);
  self.postMessage({ type: "result", result });
}

async function handleSummarize(data: { text: string; params?: any }) {
  const { text, params } = data;
  console.log(`[Worker] Starting summarization...`);

  self.postMessage({
    type: "status",
    status: "loading",
    message: "Loading summarization model..."
  });

  const generator = await SummarizationPipeline.getInstance((progress: any) => {
    if (
      progress.status === "progress" ||
      typeof progress.progress === "number"
    ) {
      self.postMessage({
        type: "status",
        status: "downloading",
        progress: progress.progress,
        file: progress.file
      });
    }
  });

  self.postMessage({
    type: "status",
    status: "summarizing",
    message: "Generating summary..."
  });

  console.log(`[Worker] Running summarization inference...`);
  const result = await generator(text, {
    max_new_tokens: 1024,
    do_sample: true,
    temperature: 0.7,
    top_p: 0.9,
    return_full_text: false,
    ...params
  });

  console.log(`[Worker] Summarization complete.`);
  self.postMessage({ type: "result", result });
}

async function handleDownloadWhisper(data: { model: string }) {
  console.log(`[Worker] Downloading Whisper model: ${data.model}`);
  await WhisperPipeline.getInstance(data.model, (progress: any) => {
    if (
      progress.status === "progress" ||
      typeof progress.progress === "number"
    ) {
      self.postMessage({
        type: "status",
        status: "downloading",
        progress: progress.progress,
        file: progress.file
      });
    }
  });
  console.log(`[Worker] Whisper model downloaded.`);
  self.postMessage({ type: "result", result: "complete" });
}

async function handleDownloadSummarization() {
  console.log(`[Worker] Downloading summarization model...`);
  await SummarizationPipeline.getInstance((progress: any) => {
    if (
      progress.status === "progress" ||
      typeof progress.progress === "number"
    ) {
      self.postMessage({
        type: "status",
        status: "downloading",
        progress: progress.progress,
        file: progress.file
      });
    }
  });
  console.log(`[Worker] Summarization model downloaded.`);
  self.postMessage({ type: "result", result: "complete" });
}

async function handleDispose() {
  console.log(`[Worker] Disposing all models...`);
  WhisperPipeline.dispose();
  SummarizationPipeline.dispose();
  self.postMessage({ type: "result", result: "disposed" });
}

async function handleDisposeWhisper() {
  console.log(`[Worker] Disposing Whisper model...`);
  WhisperPipeline.dispose();
  self.postMessage({ type: "result", result: "disposed-whisper" });
}

async function handleDisposeSummarization() {
  console.log(`[Worker] Disposing Summarization model...`);
  SummarizationPipeline.dispose();
  self.postMessage({ type: "result", result: "disposed-summarization" });
}
