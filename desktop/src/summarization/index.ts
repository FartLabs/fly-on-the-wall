import {
  getSummarizationModelParams,
  getMinSummaryLength
} from "@/renderer/components/settings";
import { getDefaultPromptTemplate } from "@/shared/config";

export interface SummarizationProgress {
  status: "loading" | "downloading" | "summarizing" | "complete" | "error";
  progress?: number;
  message: string;
}

interface SummarizationResult {
  summary: string;
  duration: number;
  timestamp: string;
}

export interface SummarizeParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  systemPrompt?: string;
}

type ProgressCallback = (progress: SummarizationProgress) => void;

async function getCustomPrompt(): Promise<string | null> {
  const config = await window.electronAPI.configGet();
  return config.summarization.customPrompt || null;
}

export async function getSelectedModelPath(): Promise<string | null> {
  const config = await window.electronAPI.configGet();
  return config.summarization.selectedModelPath || null;
}

export async function saveSelectedModelPath(modelPath: string) {
  const config = await window.electronAPI.configGet();
  await window.electronAPI.configSet({
    ...config,
    summarization: {
      ...config.summarization,
      selectedModelPath: modelPath.trim()
    }
  });
}

export async function checkSummarizationModelDownloaded(
  modelPath?: string
): Promise<boolean> {
  const path = modelPath || (await getSelectedModelPath());
  if (!path) {
    return false;
  }

  try {
    const result = await window.electronAPI.checkSummarizationModel(path);
    return result.success && result.exists === true && result.isValid === true;
  } catch (error) {
    console.error("Failed to check summarization model:", error);
    return false;
  }
}


export async function summarizeText(
  text: string,
  onProgress?: ProgressCallback,
  modelPath?: string | null,
  participants: string[] = [],
  timestamp: string = new Date().toISOString()
): Promise<SummarizationResult> {
  const startTime = Date.now();

  const minLength = await getMinSummaryLength();
  if (text.trim().length < minLength) {
    return {
      summary: "This meeting concluded with no substantive discussion.",
      duration: 0,
      timestamp
    };
  }

  const actualModelPath = modelPath || (await getSelectedModelPath());
  if (!actualModelPath) {
    throw new Error(
      "No summarization model selected. Please select a GGUF model file in settings."
    );
  }

  onProgress?.({
    status: "loading",
    message: "Loading summarization model..."
  });

  let cleanupListener: (() => void) | undefined;
  if (onProgress) {
    // still need to find good types for these statuses, but for now just use "any"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusHandler = (status: any) => {
      if (status.type === "status") {
        if (status.status === "loading") {
          onProgress({
            status: "loading",
            message: status.message || "Loading model..."
          });
        } else if (status.status === "summarizing") {
          onProgress({
            status: "summarizing",
            message: status.message || "Generating summary..."
          });
        }
      }
    };
    const removeListener =
      window.electronAPI.onSummarizationStatus(statusHandler);
    cleanupListener =
      typeof removeListener === "function" ? removeListener : undefined;
  }

  const customPrompt = await getCustomPrompt();
  const prompt = customPrompt
    ? customPrompt
        .replace("{transcript}", text)
        .replace("{participants}", participants.join(", ") || "Not specified")
    : getDefaultPromptTemplate(text, participants);

  console.log(`Using summarization model: ${actualModelPath}`);
  console.log(`[Summarization] Raw transcript length: ${text.length}`);
  console.log(
    `[Summarization] Raw transcript preview: ${text.substring(0, 200)}...`
  );
  console.log(`[Summarization] Final prompt length: ${prompt.length}`);
  console.log(`[Summarization] Final prompt: ${prompt}...`);

  try {
    const summarizationParams = await getSummarizationModelParams();

    const { maxTokens, temperature, topP, topK, repeatPenalty } =
      summarizationParams;

    console.log(
      `[Summarization] Parameters: maxTokens=${maxTokens}, temperature=${temperature}, topP=${topP}, topK=${topK}, repeatPenalty=${repeatPenalty}`
    );

    const result = await window.electronAPI.summarize({
      text: prompt,
      modelPath: actualModelPath,
      params: {
        maxTokens,
        temperature,
        topP,
        topK,
        repeatPenalty
      }
    });

    if (!result.success) {
      throw new Error(result.error || "Summarization failed");
    }

    const summary = (result.summary || "Could not generate summary.").trim();
    const duration = (Date.now() - startTime) / 1000;

    onProgress?.({
      status: "complete",
      progress: 100,
      message: `Summary complete in ${duration.toFixed(1)}s`
    });

    return {
      summary,
      duration,
      timestamp
    };
  } catch (error) {
    console.error("Summarization error:", error);
    onProgress?.({
      status: "error",
      message: `Summarization failed: ${error}`
    });
    throw new Error(`Failed to generate summary: ${error}`);
  } finally {
    cleanupListener?.();
  }
}
