export const WHISPER_MODELS = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
  medium: "Xenova/whisper-medium",
  large: "Xenova/whisper-large"
} as const;

export type WhisperModelSize = keyof typeof WHISPER_MODELS;

export const MODEL_SIZES: Record<WhisperModelSize, string> = {
  tiny: "~75 MB",
  base: "~150 MB",
  small: "~500 MB",
  medium: "~1.5 GB",
  large: "~3.2 GB"
};

export const MODEL_DESCRIPTIONS: Record<WhisperModelSize, string> = {
  tiny: "Fastest, lower accuracy",
  base: "Balanced speed & accuracy",
  small: "Better accuracy, slower",
  medium: "Best accuracy, slower",
  large: "Highest accuracy, requires more resources"
};

// Convert audio blob/buffer to format suitable for Whisper
// Whisper expects 16kHz mono audio
// this'll be used in the renderer process before sending to the utility process
export async function preprocessAudioWhisper(
  audioData: ArrayBuffer
): Promise<Float32Array> {
  // create an offline audio context for resampling
  const audioCtx = new OfflineAudioContext(1, 1, 16000);

  const audioBuffer = await audioCtx.decodeAudioData(audioData.slice(0));

  const duration = audioBuffer.duration;
  const targetSampleRate = 16000;
  const targetLength = Math.ceil(duration * targetSampleRate);
  const newAudioCtx = new OfflineAudioContext(
    1,
    targetLength,
    targetSampleRate
  );

  const source = newAudioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(newAudioCtx.destination);
  source.start(0);

  const renderedBuffer = await newAudioCtx.startRendering();

  return renderedBuffer.getChannelData(0);
}
