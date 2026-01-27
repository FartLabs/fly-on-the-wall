// TODO: let users drop in their own onnx models for summarization

import { SUMMARIZATION_MODEL, MODEL_SIZE, SummarizationPipeline } from './pipeline';

export interface SummarizationProgress {
  status: 'loading' | 'downloading' | 'summarizing' | 'complete' | 'error';
  progress?: number;
  message: string;
}

export interface SummarizationResult {
  summary: string;
  duration: number;
}

type ProgressCallback = (progress: SummarizationProgress) => void;

const MIN_LENGTH_FOR_SUMMARIZATION = 20;

export async function checkSummarizationModelDownloaded(): Promise<boolean> {
  if (SummarizationPipeline.isDownloaded) {
    return true;
  }

  try {
    const cache = await caches.open('transformers-cache');
    const testUrl = `https://huggingface.co/${SUMMARIZATION_MODEL}/resolve/main/config.json`;
    const cached = await cache.match(testUrl);
    if (cached) {
      SummarizationPipeline.isDownloaded = true;
      return true;
    }
  } catch (e) {
    console.log('Could not check summarization model cache:', e);
  }

  return false;
}

export async function downloadSummarizationModel(
  onProgress?: ProgressCallback
): Promise<void> {
  onProgress?.({
    status: 'downloading',
    progress: 0,
    message: `Downloading summarization model (${MODEL_SIZE})...`,
  });

  await SummarizationPipeline.getInstance((progress) => {
    if ('progress' in progress && progress.progress !== undefined) {
      const percent = Math.round(progress.progress as number);
      onProgress?.({
        status: 'downloading',
        progress: percent,
        message: `Downloading: ${percent}%`,
      });
    }
  });

  onProgress?.({
    status: 'complete',
    progress: 100,
    message: 'Model ready!',
  });
}

export async function deleteSummarizationModel(): Promise<boolean> {
  try {
    if (SummarizationPipeline.instance) {
      SummarizationPipeline.dispose();
    }

    const cache = await caches.open('transformers-cache');
    
    const cacheKeys = await cache.keys();
    const modelKeys = cacheKeys.filter(request => 
      request.url.includes(SUMMARIZATION_MODEL)
    );
    
    for (const key of modelKeys) {
      await cache.delete(key);
    }

    SummarizationPipeline.isDownloaded = false;
    
    console.log(`Summarization model deleted: ${SUMMARIZATION_MODEL}`);
    return true;
  } catch (error) {
    console.error('Failed to delete summarization model:', error);
    return false;
  }
}

function createSummarizationPrompt(transcript: string, participants: string[] = []): string {
  const participantsStr = participants.length > 0 ? participants.join(', ') : 'Not specified';
  
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
  participants: string[] = []
): Promise<SummarizationResult> {
  const startTime = Date.now();

  if (text.trim().length < MIN_LENGTH_FOR_SUMMARIZATION) {
    return {
      summary: 'This meeting concluded with no substantive discussion.',
      duration: 0,
    };
  }

  onProgress?.({
    status: 'loading',
    message: 'Loading summarization model...',
  });

  const generator = await SummarizationPipeline.getInstance((progress) => {
    if ('progress' in progress && progress.progress !== undefined) {
      const percent = Math.round(progress.progress as number);
      onProgress?.({
        status: 'downloading',
        progress: percent,
        message: `Downloading model: ${percent}%`,
      });
    }
  });

  onProgress?.({
    status: 'summarizing',
    message: 'Generating summary...',
  });

  const prompt = createSummarizationPrompt(text, participants);

  try {
    const result = await generator(prompt, {
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      return_full_text: false, 
    });

    console.log('Raw summarization result:', result);

    // @ts-expect-error - result type varies
    const generatedText = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
    const summary = (generatedText || 'Could not generate summary.').trim();

    console.log('Generated summary:', summary);

    const duration = (Date.now() - startTime) / 1000;

    onProgress?.({
      status: 'complete',
      progress: 100,
      message: `Summary complete in ${duration.toFixed(1)}s`,
    });

    return {
      summary,
      duration,
    };
  } catch (error) {
    console.error('Summarization error:', error);
    throw new Error(`Failed to generate summary: ${error}`);
  }
}
