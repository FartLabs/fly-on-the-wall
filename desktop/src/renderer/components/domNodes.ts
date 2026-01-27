// TODO: this is getting quite large, find a better way to organize DOM nodes
// i.e see history.ts that maintains its own DOM references
export const elements = {
  recordBtn: document.getElementById('recordBtn') as HTMLButtonElement,
  btnIcon: document.getElementById('btnIcon') as HTMLSpanElement,
  btnText: document.getElementById('btnText') as HTMLSpanElement,
  statusIndicator: document.getElementById('statusIndicator') as HTMLDivElement,
  statusText: document.getElementById('statusText') as HTMLSpanElement,
  timerDisplay: document.getElementById('timer') as HTMLDivElement,
  recordingControls: document.getElementById('recordingControls') as HTMLDivElement,
  pauseBtn: document.getElementById('pauseBtn') as HTMLButtonElement,
  resumeBtn: document.getElementById('resumeBtn') as HTMLButtonElement,
  stopBtn: document.getElementById('stopBtn') as HTMLButtonElement,

  devicesList: document.getElementById('devicesList') as HTMLDivElement,
  refreshDevicesBtn: document.getElementById('refreshDevices') as HTMLButtonElement,
  systemAudioToggle: document.getElementById('systemAudioToggle') as HTMLInputElement,
  systemAudioItem: document.getElementById('systemAudioItem') as HTMLDivElement,

  transcriptionCard: document.getElementById('transcriptionCard') as HTMLDivElement,
  modelSelect: document.getElementById('modelSelect') as HTMLSelectElement,
  transcriptionProgress: document.getElementById('transcriptionProgress') as HTMLDivElement,
  progressFill: document.getElementById('progressFill') as HTMLDivElement,
  progressText: document.getElementById('progressText') as HTMLParagraphElement,
  transcriptionResult: document.getElementById('transcriptionResult') as HTMLDivElement,
  transcriptionText: document.getElementById('transcriptionText') as HTMLDivElement,
  transcriptionEmpty: document.getElementById('transcriptionEmpty') as HTMLDivElement,
  copyTranscriptionBtn: document.getElementById('copyTranscription') as HTMLButtonElement,
  saveTranscriptionBtn: document.getElementById('saveTranscription') as HTMLButtonElement,
  
  summaryCard: document.getElementById('summaryCard') as HTMLDivElement,
  summaryProgress: document.getElementById('summaryProgress') as HTMLDivElement,
  summaryProgressFill: document.getElementById('summaryProgressFill') as HTMLDivElement,
  summaryProgressText: document.getElementById('summaryProgressText') as HTMLParagraphElement,
  summaryResult: document.getElementById('summaryResult') as HTMLDivElement,
  summaryText: document.getElementById('summaryText') as HTMLDivElement,
  summaryEmpty: document.getElementById('summaryEmpty') as HTMLDivElement,
  copySummaryBtn: document.getElementById('copySummary') as HTMLButtonElement,
  saveSummaryBtn: document.getElementById('saveSummary') as HTMLButtonElement,

  modelsList: document.getElementById('modelsList') as HTMLDivElement,
};

export function setUiLocked(locked: boolean): void {
  elements.systemAudioToggle.disabled = locked;
  elements.systemAudioItem.classList.toggle('disabled', locked);
  
  // lock all microphone toggles
  const micToggles = elements.devicesList.querySelectorAll('.mute-toggle input') as NodeListOf<HTMLInputElement>;
  micToggles.forEach(toggle => {
    toggle.disabled = locked;
  });
  elements.devicesList.classList.toggle('disabled', locked);
  
  elements.refreshDevicesBtn.disabled = locked;
  elements.refreshDevicesBtn.classList.toggle('disabled', locked);
}