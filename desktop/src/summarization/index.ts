import {
  getSummarizationModelParams,
  LOCAL_STORAGE_KEYS,
  getMinSummaryLength
} from "@/renderer/components/settings";

export interface SummarizationProgress {
  status: "loading" | "downloading" | "summarizing" | "complete" | "error";
  progress?: number;
  message: string;
}

export interface SummarizationResult {
  summary: string;
  duration: number;
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

// TODO: move all localstorage related logic to settings.ts

const STORAGE_KEY_CUSTOM_PROMPT =
  LOCAL_STORAGE_KEYS.CUSTOM_SUMMARIZATION_PROMPT;
const STORAGE_KEY_MODEL_PATH =
  LOCAL_STORAGE_KEYS.SELECTED_SUMMARIZATION_MODEL_PATH;

export function getCustomPrompt(): string | null {
  return localStorage.getItem(STORAGE_KEY_CUSTOM_PROMPT);
}

export function saveCustomPrompt(prompt: string): void {
  if (prompt.trim()) {
    localStorage.setItem(STORAGE_KEY_CUSTOM_PROMPT, prompt.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_CUSTOM_PROMPT);
  }
}

export function getSelectedModelPath(): string | null {
  return localStorage.getItem(STORAGE_KEY_MODEL_PATH);
}

export function saveSelectedModelPath(modelPath: string): void {
  if (modelPath.trim()) {
    localStorage.setItem(STORAGE_KEY_MODEL_PATH, modelPath.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_MODEL_PATH);
  }
}

export function getDefaultPromptTemplate(
  transcript: string,
  participants: string[] = []
): string {
  return createDefaultPrompt(transcript, participants);
}

export async function checkSummarizationModelDownloaded(
  modelPath?: string
): Promise<boolean> {
  const path = modelPath || getSelectedModelPath();
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

export async function deleteSummarizationModel(): Promise<boolean> {
  try {
    const result = await window.electronAPI.disposeSummarizationModel();
    return result.success;
  } catch (error) {
    console.error("Failed to dispose summarization model:", error);
    return false;
  }
}

export async function getModelsCacheDir(): Promise<string> {
  return window.electronAPI.getModelsCacheDir();
}

export async function getModelsDir(): Promise<string> {
  return window.electronAPI.getModelsDir();
}

function createDefaultPrompt(
  transcript: string,
  participants: string[] = []
): string {
  const participantsStr =
    participants.length > 0 ? participants.join(", ") : "Not specified";

  return `You are a highly efficient and helpful assistant specializing in summarizing meeting transcripts.
Please analyze the following raw text from a meeting and provide a structured summary. 
Ignore filler words (e.g., 'um', 'ah', 'like'), repeated sentences, and conversational pleasantries. 
Focus only on the substantive content. If no action items or decisions were made, explicitly state
"No specific action items or decisions were recorded." 

**IF** the transcript is empty, contains only filler words (e.g., 'um', 'ah'), or consists solely of conversational pleasantries with no substance:
    - Your **ENTIRE** output should be a single, specific statement: "This meeting concluded with no substantive discussion."

**ELSE** (if the transcript contains substantive discussion):
    - Proceed as usual with the summarization.

Participants in the meeting: ${participantsStr}

The summary should include:
1. A concise, one-paragraph overview of the meeting's purpose and key discussions.
2. A bulleted list of the main topics discussed. Go into detail about each topic based on what was said.
3. A bulleted list of any action items or decisions made.

If nothing was discussed at all, state that clearly in the overview.

Here is the transcript:
---
${transcript}
---
`;
}

export async function summarizeText(
  text: string,
  onProgress?: ProgressCallback,
  modelPath?: string | null,
  participants: string[] = []
): Promise<SummarizationResult> {
  const startTime = Date.now();

  if (text.trim().length < getMinSummaryLength()) {
    return {
      summary: "This meeting concluded with no substantive discussion.",
      duration: 0
    };
  }

  const actualModelPath = modelPath || getSelectedModelPath();
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

  const customPrompt = getCustomPrompt();
  const prompt = customPrompt
    ? customPrompt
        .replace("{transcript}", text)
        .replace("{participants}", participants.join(", ") || "Not specified")
    : createDefaultPrompt(text, participants);

  console.log(`Using summarization model: ${actualModelPath}`);
  console.log(`[Summarization] Raw transcript length: ${text.length}`);
  console.log(
    `[Summarization] Raw transcript preview: ${text.substring(0, 200)}...`
  );
  console.log(`[Summarization] Final prompt length: ${prompt.length}`);
  console.log(`[Summarization] Final prompt: ${prompt}...`);

  try {
    const summarizationParams = getSummarizationModelParams();

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
      duration
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

export async function checkSummarizationHealth(): Promise<{
  healthy: boolean;
  modelLoaded: boolean;
  currentModelPath: string | null;
}> {
  try {
    const result = await window.electronAPI.summarizationHealthCheck();
    if (!result.success) {
      return { healthy: false, modelLoaded: false, currentModelPath: null };
    }
    return {
      healthy: result.healthy ?? false,
      modelLoaded: result.modelLoaded ?? false,
      currentModelPath: result.currentModelPath ?? null
    };
  } catch (error) {
    console.error("Health check failed:", error);
    return { healthy: false, modelLoaded: false, currentModelPath: null };
  }
}
