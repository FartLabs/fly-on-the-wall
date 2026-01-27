import { elements } from './domNodes';
import { summarizeText, checkSummarizationModelDownloaded, downloadSummarizationModel, type SummarizationProgress } from '../../summarization';

let lastSummary: string | null = null;
let lastTimestamp: string | null = null;

function updateSummaryProgress(progress: SummarizationProgress): void {
  elements.summaryProgress.classList.remove('hidden');
  elements.summaryResult.classList.add('hidden');
  elements.summaryEmpty.classList.add('hidden');
  elements.summaryProgressText.textContent = progress.message;

  if (progress.progress !== undefined) {
    elements.summaryProgressFill.style.width = `${progress.progress}%`;
    elements.summaryProgressFill.classList.remove('indeterminate');
  } else if (progress.status === 'summarizing') {
    elements.summaryProgressFill.classList.add('indeterminate');
  }
}

export async function runSummarization(transcription: string, timestamp: string): Promise<void> {
  lastTimestamp = timestamp;

  const isDownloaded = await checkSummarizationModelDownloaded();
  console.log('Summarization model downloaded:', isDownloaded);
  
  if (!isDownloaded) {
    const shouldDownload = await checkAndDownloadSummarizationModel();
    if (!shouldDownload) {
      console.log('User declined to download summarization model');
      return;
    }
  }

  elements.summaryCard.classList.remove('hidden');
  elements.summaryProgress.classList.remove('hidden');
  elements.summaryProgressFill.style.width = '0%';
  elements.summaryProgressFill.classList.remove('indeterminate');

  try {
    console.log('Calling summarizeText...');
    const result = await summarizeText(transcription, updateSummaryProgress);
    lastSummary = result.summary;

    console.log('Summary result:', result);

    elements.summaryProgressFill.classList.remove('indeterminate');
    elements.summaryProgress.classList.add('hidden');
    elements.summaryResult.classList.remove('hidden');
    elements.summaryText.textContent = result.summary || '(Could not generate summary)';

    console.log(`Summary generated in ${result.duration.toFixed(1)}s`);
  } catch (error) {
    console.error('Summarization failed:', error);
    elements.summaryProgress.classList.add('hidden');
    elements.summaryEmpty.classList.remove('hidden');
    elements.summaryEmpty.innerHTML = `<p style="color: #ff6b81;">Summarization failed: ${error}</p>`;
  }
}

export function setupSummarizationListeners(): void {
  elements.copySummaryBtn.addEventListener('click', async () => {
    if (!lastSummary) return;
    await navigator.clipboard.writeText(lastSummary);
    const originalText = elements.copySummaryBtn.textContent;
    elements.copySummaryBtn.textContent = '✓ Copied!';
    setTimeout(() => elements.copySummaryBtn.textContent = originalText, 2000);
  });

  elements.saveSummaryBtn.addEventListener('click', async () => {
    if (!lastSummary || !lastTimestamp) return;
    const filename = `summary_${lastTimestamp}.txt`;
    const result = await window.electronAPI.saveTranscription({ text: lastSummary, filename });
    if (result.success) {
      elements.saveSummaryBtn.textContent = '✓ Saved!';
      setTimeout(() => elements.saveSummaryBtn.textContent = '💾 Save', 2000);
    }
  });
}

export async function checkAndDownloadSummarizationModel(): Promise<boolean> {
  const isDownloaded = await checkSummarizationModelDownloaded();
  if (isDownloaded) {
    return true;
  }

  const shouldDownload = confirm(
    'The AI summarization model (Llama 3.2 1B, ~1.2 GB) needs to be downloaded.\n\n' +
    'This only happens once and provides high-quality summaries. Download now?'
  );

  if (shouldDownload) {
    try {
      await downloadSummarizationModel((progress) => {
        console.log(`Downloading summarization model: ${progress.message}`);
      });
      return true;
    } catch (error) {
      console.error('Failed to download summarization model:', error);
      return false;
    }
  }

  return false;
}
