// TODO: this is getting quite large, find a better way to organize DOM nodes
// i.e see history.ts that maintains its own DOM references
export const elements = {
  recordBtn: document.getElementById("recordBtn") as HTMLButtonElement,
  btnIcon: document.getElementById("btnIcon") as HTMLSpanElement,
  btnText: document.getElementById("btnText") as HTMLSpanElement,
  statusIndicator: document.getElementById("statusIndicator") as HTMLDivElement,
  statusText: document.getElementById("statusText") as HTMLSpanElement,
  timerDisplay: document.getElementById("timer") as HTMLDivElement,
  recordingControls: document.getElementById(
    "recordingControls"
  ) as HTMLDivElement,
  pauseBtn: document.getElementById("pauseBtn") as HTMLButtonElement,
  resumeBtn: document.getElementById("resumeBtn") as HTMLButtonElement,
  stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,

  devicesList: document.getElementById("devicesList") as HTMLDivElement,
  refreshDevicesBtn: document.getElementById(
    "refreshDevices"
  ) as HTMLButtonElement,
  systemAudioToggle: document.getElementById(
    "systemAudioToggle"
  ) as HTMLInputElement,
  systemAudioItem: document.getElementById("systemAudioItem") as HTMLDivElement,

  transcriptionCard: document.getElementById(
    "rightPanelTranscriptionCard"
  ) as HTMLDivElement,
  transcriptionProgress: document.getElementById(
    "rightPanelTranscriptionProgress"
  ) as HTMLDivElement,
  progressFill: document.getElementById(
    "rightPanelProgressFill"
  ) as HTMLDivElement,
  progressText: document.getElementById(
    "rightPanelProgressText"
  ) as HTMLParagraphElement,
  transcriptionResult: document.getElementById(
    "rightPanelTranscriptionResult"
  ) as HTMLDivElement,
  transcriptionText: document.getElementById(
    "rightPanelTranscriptionText"
  ) as HTMLDivElement,
  transcriptionEmpty: document.getElementById(
    "rightPanelTranscriptionEmpty"
  ) as HTMLDivElement,
  copyTranscriptionBtn: document.getElementById(
    "rightPanelCopyTranscription"
  ) as HTMLButtonElement,
  saveTranscriptionBtn: document.getElementById(
    "rightPanelSaveTranscription"
  ) as HTMLButtonElement,

  summaryCard: document.getElementById(
    "rightPanelSummaryCard"
  ) as HTMLDivElement,
  summaryProgress: document.getElementById(
    "rightPanelSummaryProgress"
  ) as HTMLDivElement,
  summaryProgressFill: document.getElementById(
    "rightPanelSummaryProgressFill"
  ) as HTMLDivElement,
  summaryProgressText: document.getElementById(
    "rightPanelSummaryProgressText"
  ) as HTMLParagraphElement,
  summaryResult: document.getElementById(
    "rightPanelSummaryResult"
  ) as HTMLDivElement,
  summaryText: document.getElementById(
    "rightPanelSummaryText"
  ) as HTMLDivElement,
  summaryEmpty: document.getElementById(
    "rightPanelSummaryEmpty"
  ) as HTMLDivElement,
  copySummaryBtn: document.getElementById(
    "rightPanelCopySummary"
  ) as HTMLButtonElement,
  saveSummaryBtn: document.getElementById(
    "rightPanelSaveSummary"
  ) as HTMLButtonElement,

  modelsList: document.getElementById("modelsList") as HTMLDivElement,

  customPromptInput: document.getElementById(
    "customPromptInput"
  ) as HTMLTextAreaElement,
  savePromptBtn: document.getElementById("savePromptBtn") as HTMLButtonElement,
  resetPromptBtn: document.getElementById(
    "resetPromptBtn"
  ) as HTMLButtonElement,
  viewDefaultPromptBtn: document.getElementById(
    "viewDefaultPromptBtn"
  ) as HTMLButtonElement,

  sidebar: document.getElementById("sidebar") as HTMLDivElement,
  sidebarTrigger: document.getElementById("sidebarTrigger") as HTMLDivElement,

  rightPanel: document.getElementById("rightPanel") as HTMLDivElement,
  rightPanelTrigger: document.getElementById(
    "rightPanelTrigger"
  ) as HTMLDivElement
};

export function setUiLocked(locked: boolean): void {
  elements.systemAudioToggle.disabled = locked;
  elements.systemAudioItem.classList.toggle("disabled", locked);

  // lock all microphone toggles
  const micToggles = elements.devicesList.querySelectorAll(
    ".mute-toggle input"
  ) as NodeListOf<HTMLInputElement>;
  micToggles.forEach((toggle) => {
    toggle.disabled = locked;
  });
  elements.devicesList.classList.toggle("disabled", locked);

  elements.refreshDevicesBtn.disabled = locked;
  elements.refreshDevicesBtn.classList.toggle("disabled", locked);
}
