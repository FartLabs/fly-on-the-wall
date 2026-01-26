// prior art: https://github.com/huggingface/transformers.js/blob/main/examples/electron/src/model.js
// adapted for loading whisper models

import type { AutomaticSpeechRecognitionPipeline, ProgressCallback as TransformersProgressCallback } from '@huggingface/transformers';

export const WHISPER_MODELS = {
  'tiny': 'Xenova/whisper-tiny',
  'base': 'Xenova/whisper-base', // BUG: base doesn't download for some reason, need to look into it
  'small': 'Xenova/whisper-small',
  'medium': 'Xenova/whisper-medium',
'large': 'Xenova/whisper-large',
} as const;

export type WhisperModelSize = keyof typeof WHISPER_MODELS;

export const MODEL_SIZES: Record<WhisperModelSize, string> = {
  'tiny': '~75 MB',
  'base': '~150 MB',
  'small': '~500 MB',
  'medium': '~1.5 GB',
  'large': '~3.2 GB',
};

export class WhisperPipeline {
  static task = 'automatic-speech-recognition' as const;
  static instance: AutomaticSpeechRecognitionPipeline | null = null;
  static currentModel: string | null = null;
  static downloadedModels = new Set<string>();

  static async getInstance(
    modelId: string = WHISPER_MODELS['base'],
    progressCallback: TransformersProgressCallback | null = null
  ): Promise<AutomaticSpeechRecognitionPipeline> {
    if (this.instance !== null && this.currentModel === modelId) {
      return this.instance;
    }

    if (this.instance !== null && this.currentModel !== modelId) {
      this.dispose();
    }

    const { pipeline, env } = await import('@huggingface/transformers');

    // TODO: focus more on local models; this may mean bundling models themselves with the app?
    // need to look into legality, packaging, and other implications to make this work
    // ideally, in the future it would be really cool to let users switch out transcription models
    // and have a local models directory managed by the app. this'll give users much more control over
    // their data/privacy 
    env.allowLocalModels = false; 
    env.allowRemoteModels = true;

    console.log(`Loading Whisper model: ${modelId}`);

    const pipelineInstance = await pipeline(this.task, modelId, {
      progress_callback: progressCallback,
    });
    this.instance = pipelineInstance as AutomaticSpeechRecognitionPipeline;

    this.currentModel = modelId;
    this.downloadedModels.add(modelId);
    
    console.log('Whisper model loaded successfully');
    return this.instance;
  }

  static dispose(): void {
    this.instance = null;
    this.currentModel = null;
    console.log('WhisperPipeline disposed');
  }

  static isLoaded(modelId?: string): boolean {
    if (!this.instance) return false;
    if (!modelId) return true;
    return this.currentModel === modelId;
  }
}

// Convert audio blob/buffer to format suitable for Whisper
// Whisper expects 16kHz mono audio
export async function preprocessAudioWhisper(audioData: ArrayBuffer): Promise<Float32Array> {
  // create an offline audio context for resampling
  const audioCtx = new OfflineAudioContext(1, 1, 16000);
  
  const audioBuffer = await audioCtx.decodeAudioData(audioData.slice(0));
  
  const duration = audioBuffer.duration;
  const targetSampleRate = 16000;
  const targetLength = Math.ceil(duration * targetSampleRate);
  const newAudioCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
  
  const source = newAudioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(newAudioCtx.destination);
  source.start(0);
  
  const renderedBuffer = await newAudioCtx.startRendering();
  
  return renderedBuffer.getChannelData(0);
}
