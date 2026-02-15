// TODO: this is getting quite large, find a better way to organize DOM nodes
// i.e see history.ts that maintains its own DOM references
export const elements = {
  preflightWarning: document.getElementById(
    "preflightWarning"
  ) as HTMLDivElement,
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
  saveNoteBtn: document.getElementById(
    "rightPanelSaveNote"
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

  customPromptInput: document.getElementById(
    "customPromptInput"
  ) as HTMLTextAreaElement,

  rightSidebar: document.getElementById("rightSidebar") as HTMLElement,
  rightSidebarCollapseBtn: document.getElementById(
    "rightSidebarCollapseBtn"
  ) as HTMLButtonElement,
  rightSidebarResizeHandle: document.getElementById(
    "rightSidebarResizeHandle"
  ) as HTMLDivElement,
  rightSidebarContent: document.getElementById(
    "rightSidebarContent"
  ) as HTMLDivElement,
  rightSidebarEmpty: document.getElementById(
    "rightSidebarEmpty"
  ) as HTMLDivElement,
  exportNoteBtn: document.getElementById("exportNoteBtn") as HTMLButtonElement,

  mainPage: document.getElementById("main-page") as HTMLDivElement,

  settingsModal: document.getElementById("settingsModal") as HTMLDivElement,
  closeSettingsModal: document.getElementById(
    "closeSettingsModal"
  ) as HTMLButtonElement,

  viewSettingsBtn: document.getElementById(
    "viewSettingsBtn"
  ) as HTMLButtonElement,

  batchOperationsToolbar: document.getElementById(
    "batchOperationsToolbar"
  ) as HTMLDivElement,
  selectAllNotesCheckbox: document.getElementById(
    "selectAllNotesCheckbox"
  ) as HTMLInputElement,
  selectedCount: document.getElementById("selectedCount") as HTMLSpanElement,
  deleteSelectedBtn: document.getElementById(
    "deleteSelectedBtn"
  ) as HTMLButtonElement,

  noteRecordingPlayer: document.getElementById(
    "noteRecordingPlayer"
  ) as HTMLDivElement,
  noteAudioPlayer: document.getElementById(
    "noteAudioPlayer"
  ) as HTMLAudioElement,

  minSummaryLengthInput: document.getElementById(
    "minSummaryLengthInput"
  ) as HTMLInputElement,
  maxTokensInput: document.getElementById("maxTokensInput") as HTMLInputElement,
  temperatureInput: document.getElementById(
    "temperatureInput"
  ) as HTMLInputElement,
  topPInput: document.getElementById("topPInput") as HTMLInputElement,
  topKInput: document.getElementById("topKInput") as HTMLInputElement,
  repeatPenaltyInput: document.getElementById(
    "repeatPenaltyInput"
  ) as HTMLInputElement,
  transcriptionModelPathInput: document.getElementById(
    "transcriptionModelPathInput"
  ) as HTMLInputElement,
  hotkeyOpenSettingsList: document.getElementById(
    "hotkeyOpenSettingsList"
  ) as HTMLDivElement,
  hotkeyOpenSettingsAddBtn: document.getElementById(
    "hotkeyOpenSettingsAddBtn"
  ) as HTMLButtonElement,
  hotkeyCaptureHint: document.getElementById(
    "hotkeyCaptureHint"
  ) as HTMLSpanElement,
  summarizationModelPathInput: document.getElementById(
    "summarizationModelPathInput"
  ) as HTMLInputElement,
  resetSettingsBtn: document.getElementById(
    "resetSettingsBtn"
  ) as HTMLButtonElement,

  transcriptionModelPathHint: document.getElementById(
    "transcriptionModelPathHint"
  ) as HTMLSpanElement,
  summarizationModelPathHint: document.getElementById(
    "summarizationModelPathHint"
  ) as HTMLSpanElement,

  importQueue: document.getElementById("importQueue") as HTMLDivElement,
  importQueueList: document.getElementById("importQueueList") as HTMLDivElement,
  importQueueCount: document.getElementById(
    "importQueueCount"
  ) as HTMLSpanElement,

  meetingParticipantsInput: document.getElementById(
    "meetingParticipantsInput"
  ) as HTMLTextAreaElement,

  leftSidebar: document.getElementById("leftSidebar") as HTMLElement,
  appContent: document.getElementById("appContent") as HTMLDivElement,
  sidebarCollapseBtn: document.getElementById(
    "sidebarCollapseBtn"
  ) as HTMLButtonElement,
  sidebarResizeHandle: document.getElementById(
    "sidebarResizeHandle"
  ) as HTMLDivElement,
  sidebarNavRecorder: document.getElementById(
    "sidebarNavRecorder"
  ) as HTMLButtonElement,
  sidebarNavSettings: document.getElementById(
    "sidebarNavSettings"
  ) as HTMLButtonElement,
  sidebarRefreshBtn: document.getElementById(
    "sidebarRefreshBtn"
  ) as HTMLButtonElement,
  sidebarSelectedCount: document.getElementById(
    "sidebarSelectedCount"
  ) as HTMLSpanElement,
  sidebarSearchInput: document.getElementById(
    "sidebarSearchInput"
  ) as HTMLInputElement,
  sidebarFileTree: document.getElementById("sidebarFileTree") as HTMLDivElement,
  sidebarFilesSection: document.getElementById(
    "sidebarFilesSection"
  ) as HTMLDivElement,
  sidebarContextMenu: document.getElementById(
    "sidebarContextMenu"
  ) as HTMLDivElement,
  ctxRenameNote: document.getElementById("ctxRenameNote") as HTMLButtonElement,
  ctxDeleteNote: document.getElementById("ctxDeleteNote") as HTMLButtonElement,

  noteViewPage: document.getElementById("note-view-page") as HTMLDivElement,
  noteViewTitle: document.getElementById("noteViewTitle") as HTMLHeadingElement,
  noteViewTranscription: document.getElementById(
    "noteViewTranscription"
  ) as HTMLDivElement,
  noteViewSummary: document.getElementById("noteViewSummary") as HTMLDivElement,
  noteViewRecordingPlayer: document.getElementById(
    "noteViewRecordingPlayer"
  ) as HTMLDivElement,
  noteViewAudioPlayer: document.getElementById(
    "noteViewAudioPlayer"
  ) as HTMLAudioElement,
  noteViewOriginalFilename: document.getElementById(
    "noteViewOriginalFilename"
  ) as HTMLDivElement,
  noteViewExportBtn: document.getElementById(
    "noteViewExportBtn"
  ) as HTMLButtonElement,
  noteViewDeleteBtn: document.getElementById(
    "noteViewDeleteBtn"
  ) as HTMLButtonElement,
  noteViewCopyTranscription: document.getElementById(
    "noteViewCopyTranscription"
  ) as HTMLButtonElement,
  noteViewCopySummary: document.getElementById(
    "noteViewCopySummary"
  ) as HTMLButtonElement
};
