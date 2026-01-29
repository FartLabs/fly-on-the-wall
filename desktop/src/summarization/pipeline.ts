import type { TextGenerationPipeline } from "@huggingface/transformers";

// other models worth using at small sizes and good performance:
// llama 3.2 1b, qwen 2.5 0.5b, smollm 135m
// since transformers js is being used, need to use ONNX versions of the models
// export const SUMMARIZATION_MODEL = 'onnx-community/Llama-3.2-1B-Instruct';
export const SUMMARIZATION_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
export const MODEL_SIZE = "~500 MB";

export class SummarizationPipeline {
  static instance: TextGenerationPipeline | null = null;
  static isDownloaded = false;
  static currentModelId: string | null = null;

  static async getInstance(
    modelId: string = SUMMARIZATION_MODEL,
    progressCallback?: (progress: {
      progress?: number;
      status?: string;
    }) => void
  ): Promise<TextGenerationPipeline> {
    // If instance exists and it's the same model, return it
    if (this.instance !== null && this.currentModelId === modelId) {
      return this.instance;
    }

    // but if switching models, dispose current instance
    if (this.instance !== null && this.currentModelId !== modelId) {
      this.dispose();
    }

    const { pipeline, env } = await import("@huggingface/transformers");

    env.allowLocalModels = true;
    env.allowRemoteModels = true;

    console.log(`Loading summarization model: ${modelId}`);

    const pipelineInstance = await pipeline(
      "text-generation",
      modelId,
      {
        progress_callback: progressCallback
      }
    );

    this.instance = pipelineInstance as TextGenerationPipeline;
    this.currentModelId = modelId;
    this.isDownloaded = true;

    console.log("Summarization model loaded successfully");
    return this.instance;
  }

  static dispose(): void {
    this.instance = null;
    this.currentModelId = null;
    console.log("SummarizationPipeline disposed");
  }
}
