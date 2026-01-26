/**
 * Transcription service using Whisper models via transformers.js
 * Reference: https://huggingface.co/docs/transformers.js
 * 
 * Uses a singleton pipeline pattern for efficient model loading and caching.
 * In Electron's renderer process (browser context), transformers.js uses
 * the browser's Cache API for model storage. This is automatic and persistent.
 */

import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { WHISPER_MODELS, WhisperPipeline, type WhisperModelSize, MODEL_SIZES, preprocessAudioWhisper } from './whisper';

export interface TranscriptionProgress {
  status: 'loading' | 'downloading' | 'transcribing' | 'complete' | 'error';
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
  // In browser context, models are stored in Cache API
  console.log('Models stored in browser Cache API');
  return 'browser-cache';
}

export async function checkModelDownloaded(modelSize: WhisperModelSize): Promise<boolean> {
  const modelId = WHISPER_MODELS[modelSize];
  
  if (WhisperPipeline.downloadedModels.has(modelId)) {
    return true;
  }
  
  // check the browser's Cache API
  try {
    const cache = await caches.open('transformers-cache');
    const testUrl = `https://huggingface.co/${modelId}/resolve/main/config.json`;
    const cached = await cache.match(testUrl);
    if (cached) {
      WhisperPipeline.downloadedModels.add(modelId);
      return true;
    }
  } catch (e) {
    console.log('Could not check cache:', e);
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
      size: MODEL_SIZES[modelSize],
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
    status: 'downloading',
    progress: 0,
    message: `Downloading Whisper ${modelSize} model (${MODEL_SIZES[modelSize]})...`
  });

  console.log(`Downloading model: ${modelId}`);
 
  // TODO: fix type check below
  await WhisperPipeline.getInstance(modelId, (progress) => {
    if (progress.progress !== undefined) {
      const percent = Math.round(progress.progress);
      onProgress?.({
        status: 'downloading',
        progress: percent,
        message: `Downloading: ${percent}%${progress.file ? ` (${progress.file})` : ''}`
      });
    }
  });
  
  console.log('Model downloaded and loaded successfully');
  
  onProgress?.({
    status: 'complete',
    progress: 100,
    message: 'Model downloaded successfully!'
  });
}

export async function deleteModel(modelSize: WhisperModelSize): Promise<boolean> {
  const modelId = WHISPER_MODELS[modelSize];
  
  if (WhisperPipeline.currentModel === modelId) {
    WhisperPipeline.dispose();
  }
  
  // Delete from browser Cache API
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    
    let deletedCount = 0;
    for (const request of keys) {
      // delete all cached files for the selected model
      if (request.url.includes(modelId.replace('/', '%2F')) || request.url.includes(modelId)) {
        await cache.delete(request);
        deletedCount++;
      }
    }
    
    WhisperPipeline.downloadedModels.delete(modelId);
    console.log(`Deleted ${deletedCount} cached files for model ${modelId}`);
    return deletedCount > 0;
  } catch (error) {
    console.error('Error deleting model from cache:', error);
    return false;
  }
}

async function getTranscriber(
  modelSize: WhisperModelSize = 'base',
  onProgress?: ProgressCallback
): Promise<AutomaticSpeechRecognitionPipeline> {
  const modelId = WHISPER_MODELS[modelSize];
  
  if (!WhisperPipeline.isLoaded(modelId)) {
    const isDownloaded = await checkModelDownloaded(modelSize);
    if (!isDownloaded) {
      throw new Error(`Model "${modelSize}" is not downloaded. Please download it first.`);
    }
  }

  onProgress?.({
    status: 'loading',
    progress: 0,
    message: `Loading Whisper ${modelSize} model...`
  });

  const transcriber = await WhisperPipeline.getInstance(modelId, (progress) => {
    if (progress.progress !== undefined) {
      onProgress?.({
        status: 'loading',
        progress: progress.progress,
        message: `Loading model: ${Math.round(progress.progress)}%`
      });
    }
  });
  
  return transcriber;
}

/**
 * Transcribe audio using Whisper
 * Uses the singleton pipeline for efficient model management
 */
export async function transcribeAudio(
  audioData: ArrayBuffer,
  options: {
    modelSize?: WhisperModelSize;
    language?: string;
    onProgress?: ProgressCallback;
  } = {}
): Promise<TranscriptionResult> {
  const { modelSize = 'base', language, onProgress } = options;
  const startTime = Date.now();

  try {
    const transcriber = await getTranscriber(modelSize, onProgress);

    onProgress?.({
      status: 'transcribing',
      message: 'Preparing audio...'
    });

    const audioArray = await preprocessAudioWhisper(audioData);

    onProgress?.({
      status: 'transcribing',
      message: 'Transcribing audio...'
    });

    console.log('Starting transcription...');
    console.log(`Audio length: ${audioArray.length} samples (${audioArray.length / 16000}s)`);

    const result = await transcriber(audioArray, {
      language: language || 'en',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    // Extract text from result (handle both single and array results)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transcription = Array.isArray(result) ? (result[0] as any).text : (result as any).text;
    const duration = (Date.now() - startTime) / 1000;

    console.log(`Transcription complete in ${duration.toFixed(1)}s`);

    onProgress?.({
      status: 'complete',
      message: 'Transcription complete!'
    });

    return {
      text: transcription.trim(),
      duration,
      model: WHISPER_MODELS[modelSize]
    };
  } catch (error) {
    console.error('Transcription error:', error);
    onProgress?.({
      status: 'error',
      message: `Transcription failed: ${error}`
    });
    throw error;
  }
}
