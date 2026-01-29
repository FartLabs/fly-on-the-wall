// TODO: let users drop in their own onnx models for summarization

import {
  SUMMARIZATION_MODEL,
  MODEL_SIZE,
} from "./pipeline";
import { sendWorkerMessage } from "../worker-client";

export interface SummarizationProgress {
  status: "loading" | "downloading" | "summarizing" | "complete" | "error";
  progress?: number;
  message: string;
}

export interface SummarizationResult {
  summary: string;
  duration: number;
}

type ProgressCallback = (progress: SummarizationProgress) => void;

const MIN_LENGTH_FOR_SUMMARIZATION = 20;
const STORAGE_KEY_CUSTOM_PROMPT = "customSummarizationPrompt";

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

export function getDefaultPromptTemplate(
  transcript: string,
  participants: string[] = []
): string {
  return createDefaultPrompt(transcript, participants);
}

export async function checkSummarizationModelDownloaded(): Promise<boolean> {
  // check the browser's Cache API
  try {
    const cache = await caches.open("transformers-cache");
    const testUrl = `https://huggingface.co/${SUMMARIZATION_MODEL}/resolve/main/config.json`;
    const cached = await cache.match(testUrl);
    if (cached) {
      return true;
    }
  } catch (e) {
    console.log("Could not check summarization model cache:", e);
  }

  return false;
}

export async function downloadSummarizationModel(
  onProgress?: ProgressCallback
): Promise<void> {
  onProgress?.({
    status: "downloading",
    progress: 0,
    message: `Downloading summarization model (${MODEL_SIZE})...`
  });

  await sendWorkerMessage({ type: "download-summarization" }, (data) => {
    if (data.status === "downloading") {
      onProgress?.({
        status: "downloading",
        progress: data.progress,
        message: `Downloading: ${data.progress}%`
      });
    }
  });

  onProgress?.({
    status: "complete",
    progress: 100,
    message: "Model ready!"
  });
}

export async function deleteSummarizationModel(): Promise<boolean> {
  try {
    const cache = await caches.open("transformers-cache");

    const cacheKeys = await cache.keys();
    const modelKeys = cacheKeys.filter((request) =>
      request.url.includes(SUMMARIZATION_MODEL)
    );

    for (const key of modelKeys) {
      await cache.delete(key);
    }

    console.log(
      `Summarization model deleted from cache: ${SUMMARIZATION_MODEL}`
    );

    // Dispose from worker memory
    await sendWorkerMessage({ type: "dispose-summarization" });
    console.log("Disposed Summarization model from worker memory");

    return true;
  } catch (error) {
    console.error("Failed to delete summarization model:", error);
    return false;
  }
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
  modelId?: string | null,
  participants: string[] = []
): Promise<SummarizationResult> {
  const startTime = Date.now();

  if (text.trim().length < MIN_LENGTH_FOR_SUMMARIZATION) {
    return {
      summary: "This meeting concluded with no substantive discussion.",
      duration: 0
    };
  }

  onProgress?.({
    status: "loading",
    message: "Loading summarization model..."
  });

  const customPrompt = getCustomPrompt();
  const prompt = customPrompt
    ? customPrompt
        .replace("{transcript}", text)
        .replace("{participants}", participants.join(", ") || "Not specified")
    : createDefaultPrompt(text, participants);

  const actualModelId = modelId || SUMMARIZATION_MODEL;
  console.log(`Using summarization model: ${actualModelId}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await sendWorkerMessage(
      {
        type: "summarize",
        text: prompt, 
        modelId: actualModelId, 
     },
      (data) => {
        if (data.status === "downloading") {
          onProgress?.({
            status: "downloading",
            progress: data.progress,
            message: `Downloading model: ${data.progress}%`
          });
        } else if (data.status === "summarizing") {
          onProgress?.({
            status: "summarizing",
            message: "Generating summary..."
          });
        }
      }
    );

    console.log("Raw summarization result:", result);

    const generatedText = Array.isArray(result)
      ? result[0]?.generated_text
      : result?.generated_text;
    const summary = (generatedText || "Could not generate summary.").trim();

    console.log("Generated summary:", summary);

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
  }
}
