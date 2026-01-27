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

  static async getInstance(
    progressCallback?: (progress: {
      progress?: number;
      status?: string;
    }) => void
  ): Promise<TextGenerationPipeline> {
    if (this.instance !== null) {
      return this.instance;
    }

    const { pipeline, env } = await import("@huggingface/transformers");

    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    console.log(`Loading summarization model: ${SUMMARIZATION_MODEL}`);

    const pipelineInstance = await pipeline(
      "text-generation",
      SUMMARIZATION_MODEL,
      {
        progress_callback: progressCallback
      }
    );

    this.instance = pipelineInstance as TextGenerationPipeline;
    this.isDownloaded = true;

    console.log("Summarization model loaded successfully");
    return this.instance;
  }

  static dispose(): void {
    this.instance = null;
    console.log("SummarizationPipeline disposed");
  }
}
