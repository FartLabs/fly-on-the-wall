/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';
import { 
  transcribeAudio, 
  getAllModelStatus, 
  downloadModel, 
  deleteModel as deleteModelFromCache, 
  checkModelDownloaded,
  type TranscriptionProgress,
  type ModelStatus
} from '../transcription';
import { MODEL_SIZES, type WhisperModelSize } from '../transcription/whisper';


declare global {
  interface Window {
    // Declare electronAPI exposed from preload
    electronAPI: {
      saveRecording: (data: { buffer: ArrayBuffer; filename: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
      saveTranscription: (data: { text: string; filename: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
      getRecordingsDir: () => Promise<string>;
      getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
      getModelsDir: () => Promise<string>;
      checkModelExists: (modelId: string) => Promise<{ exists: boolean }>;
      deleteModel: (modelId: string) => Promise<{ success: boolean }>;
    };
  }
}

const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
const btnIcon = document.getElementById('btnIcon') as HTMLSpanElement;
const btnText = document.getElementById('btnText') as HTMLSpanElement;
const statusIndicator = document.getElementById('statusIndicator') as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const timerDisplay = document.getElementById('timer') as HTMLDivElement;
const devicesList = document.getElementById('devicesList') as HTMLDivElement;
const refreshDevicesBtn = document.getElementById('refreshDevices') as HTMLButtonElement;
const recordingControls = document.getElementById('recordingControls') as HTMLDivElement;
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;

const transcriptionCard = document.getElementById('transcriptionCard') as HTMLDivElement;
const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
const transcriptionProgress = document.getElementById('transcriptionProgress') as HTMLDivElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLParagraphElement;
const transcriptionResult = document.getElementById('transcriptionResult') as HTMLDivElement;
const transcriptionText = document.getElementById('transcriptionText') as HTMLDivElement;
const transcriptionEmpty = document.getElementById('transcriptionEmpty') as HTMLDivElement;
const copyTranscriptionBtn = document.getElementById('copyTranscription') as HTMLButtonElement;
const saveTranscriptionBtn = document.getElementById('saveTranscription') as HTMLButtonElement;

const modelsList = document.getElementById('modelsList') as HTMLDivElement;

let downloadingModel: WhisperModelSize | null = null;

let isRecording = false;
let timerInterval: number | null = null;
let elapsedSeconds = 0;

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let activeStreams: MediaStream[] = [];
let audioContext: AudioContext | null = null;
let recordingStartTime: Date | null = null;
let lastRecordingBuffer: ArrayBuffer | null = null;
let lastTranscription: string | null = null;
let lastRecordingTimestamp: string | null = null;

const mutedDevices = new Set<string>();

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(val => val.toString().padStart(2, '0'))
    .join(':');
}

function updateTimer(): void {
  elapsedSeconds++;
  timerDisplay.textContent = formatTime(elapsedSeconds);
}

function setAudioSettingsLocked(locked: boolean): void {
  const systemAudioToggle = document.getElementById('systemAudioToggle') as HTMLInputElement;
  const systemAudioItem = document.getElementById('systemAudioItem') as HTMLDivElement;
  systemAudioToggle.disabled = locked;
  systemAudioItem.classList.toggle('disabled', locked);
  
  // lock all microphone toggles
  const micToggles = devicesList.querySelectorAll('.mute-toggle input') as NodeListOf<HTMLInputElement>;
  micToggles.forEach(toggle => {
    toggle.disabled = locked;
  });
  devicesList.classList.toggle('disabled', locked);
  
  refreshDevicesBtn.disabled = locked;
  refreshDevicesBtn.classList.toggle('disabled', locked);
}

function getActiveInputDeviceIds(): string[] {
  const allDeviceItems = Array.from(devicesList.querySelectorAll('.device-item'));
  return allDeviceItems
    .filter(el => {
      const deviceId = (el as HTMLElement).dataset.deviceId;
      const deviceType = el.querySelector('.device-type')?.textContent;
      return deviceId && 
             deviceType?.includes('Input') && 
             !mutedDevices.has(deviceId);
    })
    .map(el => (el as HTMLElement).dataset.deviceId)
    .filter((id): id is string => id !== undefined);
}

function isScreenSource (source: { id: string; name: string }): boolean {
  const screenPatterns = ['screen', 'desktop', 'monitor', 'entire'];
  const normalizedName = source.name.toLowerCase();
  const normalizedId = source.id.toLowerCase();
  
  return screenPatterns.some(pattern => 
    normalizedName.includes(pattern) || normalizedId.includes(pattern)
  );
};

async function startRecording(): Promise<void> {
  const systemAudioEnabled = (document.getElementById('systemAudioToggle') as HTMLInputElement).checked;
  const activeDeviceIds = getActiveInputDeviceIds();
  
  if (!systemAudioEnabled && activeDeviceIds.length === 0) {
    console.error('No audio sources selected');
    statusText.textContent = 'Enable system audio or a microphone!';
    setTimeout(() => {
      statusText.textContent = 'Ready to record';
    }, 2000);
    return;
  }

  try {
    // create audio ctx for mixing multiple streams
    audioContext = new AudioContext({ sampleRate: 44100 });
    const destination = audioContext.createMediaStreamDestination();
    activeStreams = [];
    let sourceCount = 0;

    // capture system audio 
    if (systemAudioEnabled) {
      console.log('Getting system audio...');
      try {
        const sources = await window.electronAPI.getDesktopSources();
        console.log('Available sources:', sources.map(s => ({ id: s.id, name: s.name })));
        
        let screenSource = sources.find(isScreenSource) || sources[0];
        
        if (screenSource) {
          console.log(`Using source: "${screenSource.name}" (${screenSource.id})`);
          const systemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-expect-error - Electron-specific constraint for system audio
              mandatory: {
                chromeMediaSource: 'desktop',
              }
            },
            video: {
              // @ts-expect-error - Electron-specific constraint
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: screenSource.id,
                maxWidth: 1,
                maxHeight: 1,
                maxFrameRate: 1,
              }
            }
          });
          
          // remove video track, keep only audio
          systemStream.getVideoTracks().forEach(track => track.stop());
          
          const audioTracks = systemStream.getAudioTracks();
          if (audioTracks.length > 0) {
            const audioOnlyStream = new MediaStream(audioTracks);
            activeStreams.push(audioOnlyStream);
            
            const source = audioContext.createMediaStreamSource(audioOnlyStream);
            source.connect(destination);
            
            console.log('✓ System audio added');
            sourceCount++;
          } else {
            console.warn('No system audio track available');
          }
        } else {
          console.warn('No screen source found for system audio');
        }
      } catch (systemAudioError) {
        console.warn('Could not capture system audio:', systemAudioError);
      }
    }

    // add only the enabled microphones
    for (const deviceId of activeDeviceIds) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          }
        });
        
        activeStreams.push(stream);
        
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
        
        const audioTrack = stream.getAudioTracks()[0];
        console.log(`✓ Microphone added: ${audioTrack.label}`);
        sourceCount++;
      } catch (deviceError) {
        console.warn(`Failed to add device ${deviceId}:`, deviceError);
      }
    }

    if (sourceCount === 0) {
      throw new Error('Could not access any audio sources');
    }

    console.log(`Recording from ${sourceCount} source(s)`);

    // record from the mixed output
    const mixedStream = destination.stream;
    
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mixedStream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
        console.log(`Chunk received: ${event.data.size} bytes (total chunks: ${audioChunks.length})`);
      }
    };

    mediaRecorder.onstart = () => {
      recordingStartTime = new Date();
      console.log(`Recording started at ${recordingStartTime.toISOString()}`);
      console.log(`MIME type: ${mediaRecorder?.mimeType}`);
      console.log(`Sources: ${sourceCount} (System: ${systemAudioEnabled}, Mics: ${activeDeviceIds.length})`);
    };

    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
    };

    mediaRecorder.onstop = async () => {
      console.log('MediaRecorder stopped, processing recording...');
      await saveRecording();
    };

    mediaRecorder.start(1000);

    isRecording = true;
    setAudioSettingsLocked(true);

    recordBtn.classList.add('hidden');
    recordingControls.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
    resumeBtn.classList.add('hidden');
    statusIndicator.classList.add('recording');
    
    const statusParts = [];
    if (systemAudioEnabled) statusParts.push('System');
    if (activeDeviceIds.length > 0) statusParts.push(`${activeDeviceIds.length} mic${activeDeviceIds.length > 1 ? 's' : ''}`);
    statusText.textContent = `Recording (${statusParts.join(' + ')})...`;
    
    elapsedSeconds = 0;
    timerDisplay.textContent = formatTime(elapsedSeconds);
    timerInterval = window.setInterval(updateTimer, 1000);

  } catch (error) {
    console.error('Error starting recording:', error);
    statusText.textContent = 'Failed to start recording';
    
    activeStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    activeStreams = [];
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    
    setTimeout(() => {
      statusText.textContent = 'Ready to record';
    }, 2000);
  }
}

async function saveRecording(): Promise<void> {
  if (audioChunks.length === 0) {
    console.log('No audio data to save');
    return;
  }

  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  console.log(`Total recording size: ${audioBlob.size} bytes`);

  const timestamp = recordingStartTime 
    ? recordingStartTime.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `recording_${timestamp}.webm`;
  
  lastRecordingTimestamp = timestamp;

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    lastRecordingBuffer = arrayBuffer.slice(0);
    
    console.log(`Saving recording as: ${filename}`);
    const result = await window.electronAPI.saveRecording({
      buffer: arrayBuffer,
      filename: filename
    });

    if (result.success) {
      console.log(`✅ Recording saved successfully: ${result.path}`);
      statusText.textContent = 'Recording saved! Starting transcription...';
      
      transcriptionCard.classList.remove('hidden');
      startTranscription();
    } else {
      console.error('Failed to save recording:', result.error);
      statusText.textContent = 'Failed to save recording';
    }
  } catch (error) {
    console.error('Error saving recording:', error);
    statusText.textContent = 'Error saving recording';
  }

  setTimeout(() => {
    if (!isRecording) {
      resetRecordingState();
      statusText.textContent = 'Ready to record';
    }
  }, 1500);
}

function stopRecording(): void {
  console.log(`Stopping recording. Duration: ${formatTime(elapsedSeconds)}`);

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  activeStreams.forEach(stream => {
    stream.getTracks().forEach(track => {
      track.stop();
      console.log(`Track stopped: ${track.label}`);
    });
  });
  activeStreams = [];

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  isRecording = false;
  setAudioSettingsLocked(false);
  recordBtn.classList.remove('hidden', 'recording');
  recordingControls.classList.add('hidden');
  btnIcon.textContent = '⏺';
  btnText.textContent = 'Start Recording';
  statusIndicator.classList.remove('recording', 'paused');
  statusText.textContent = 'Saving recording...';
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function resetRecordingState(): void {
  mediaRecorder = null;
  audioChunks = [];
  activeStreams = [];
  audioContext = null;
  recordingStartTime = null;
  elapsedSeconds = 0;
  timerDisplay.textContent = formatTime(0);
  console.log('Recording state reset - ready for new recording');
}

function toggleRecording(): void {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function pauseRecording(): void {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  
  mediaRecorder.pause();
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  pauseBtn.classList.add('hidden');
  resumeBtn.classList.remove('hidden');
  statusIndicator.classList.add('paused');
  statusText.textContent = 'Paused';
  
  console.log(`Recording paused at ${formatTime(elapsedSeconds)}`);
}

function resumeRecording(): void {
  if (!mediaRecorder || mediaRecorder.state !== 'paused') return;
  
  mediaRecorder.resume();
  
  timerInterval = window.setInterval(updateTimer, 1000);
  
  resumeBtn.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
  statusIndicator.classList.remove('paused');
  statusText.textContent = 'Recording...';
  
  console.log('Recording resumed');
}

recordBtn.addEventListener('click', toggleRecording);
pauseBtn.addEventListener('click', pauseRecording);
resumeBtn.addEventListener('click', resumeRecording);
stopBtn.addEventListener('click', stopRecording);

interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

function getDeviceIcon(kind: MediaDeviceKind): string {
  switch (kind) {
    case 'audioinput':
      return '🎤';
    case 'audiooutput':
      return '🔊';
    default:
      return '🎧';
  }
}

function getDeviceType(kind: MediaDeviceKind): string {
  switch (kind) {
    case 'audioinput':
      return 'Input (Microphone)';
    case 'audiooutput':
      return 'Output (Speaker)';
    default:
      return 'Audio';
  }
}

function createDeviceElement(device: AudioDeviceInfo): HTMLElement {
  const isMuted = mutedDevices.has(device.deviceId);
  const deviceItem = document.createElement('div');
  deviceItem.className = `device-item${isMuted ? ' muted' : ''}`;
  deviceItem.dataset.deviceId = device.deviceId;

  const label = device.label || `Unknown ${device.kind} device`;

  deviceItem.innerHTML = `
    <div class="device-info">
      <span class="device-icon">${getDeviceIcon(device.kind)}</span>
      <div class="device-details">
        <div class="device-name" title="${label}">${label}</div>
        <div class="device-type">${getDeviceType(device.kind)}</div>
      </div>
    </div>
    <label class="mute-toggle" title="${isMuted ? 'Unmute' : 'Mute'} device">
      <input type="checkbox" ${!isMuted ? 'checked' : ''}>
      <span class="mute-slider"></span>
    </label>
  `;

  const checkbox = deviceItem.querySelector('input') as HTMLInputElement;
  checkbox.addEventListener('change', () => {
    toggleDeviceMute(device.deviceId, !checkbox.checked);
    deviceItem.classList.toggle('muted', !checkbox.checked);
    const toggle = deviceItem.querySelector('.mute-toggle') as HTMLLabelElement;
    toggle.title = checkbox.checked ? 'Mute device' : 'Unmute device';
  });

  return deviceItem;
}

function toggleDeviceMute(deviceId: string, muted: boolean): void {
  if (muted) {
    mutedDevices.add(deviceId);
    console.log(`Device muted: ${deviceId}`);
  } else {
    mutedDevices.delete(deviceId);
    console.log(`Device unmuted: ${deviceId}`);
  }
  console.log('Active devices:', getActiveDevices());
}

function getActiveDevices(): string[] {
  const allDeviceIds = Array.from(devicesList.querySelectorAll('.device-item'))
    .map(el => (el as HTMLElement).dataset.deviceId)
    .filter((id): id is string => id !== undefined);
  return allDeviceIds.filter(id => !mutedDevices.has(id));
}

async function loadAudioDevices(): Promise<void> {
  devicesList.innerHTML = '<p class="loading-text">Loading microphones...</p>';

  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // only show input devices 
    const audioDevices = devices.filter(
      device => device.kind === 'audioinput'
    );

    if (audioDevices.length === 0) {
      devicesList.innerHTML = '<p class="no-devices">No microphones found</p>';
      return;
    }

    devicesList.innerHTML = '';

    audioDevices.forEach(device => {
      const deviceElement = createDeviceElement({
        deviceId: device.deviceId,
        label: device.label,
        kind: device.kind,
      });
      devicesList.appendChild(deviceElement);
    });

    console.log(`Loaded ${audioDevices.length} microphone(s)`);
  } catch (error) {
    console.error('Error loading audio devices:', error);
    devicesList.innerHTML = `
      <p class="error-text">
        Unable to access audio devices.<br>
        Please grant microphone permission.
      </p>
    `;
  }
}

function refreshDevices(): void {
  refreshDevicesBtn.classList.add('spinning');
  loadAudioDevices().finally(() => {
    setTimeout(() => {
      refreshDevicesBtn.classList.remove('spinning');
    }, 500);
  });
}

refreshDevicesBtn.addEventListener('click', refreshDevices);

navigator.mediaDevices.addEventListener('devicechange', () => {
  console.log('Audio devices changed');
  loadAudioDevices();
});

loadAudioDevices();


function updateTranscriptionProgress(progress: TranscriptionProgress): void {
  transcriptionProgress.classList.remove('hidden');
  transcriptionResult.classList.add('hidden');
  transcriptionEmpty.classList.add('hidden');
  
  progressText.textContent = progress.message;
  
  if (progress.progress !== undefined) {
    progressFill.style.width = `${progress.progress}%`;
  } else if (progress.status === 'transcribing') {
    progressFill.classList.add('indeterminate');
  }
  
  if (progress.status !== 'transcribing') {
    progressFill.classList.remove('indeterminate');
  }
}

async function startTranscription(): Promise<void> {
  if (!lastRecordingBuffer) {
    console.error('No recording buffer available for transcription');
    return;
  }

  const modelSize = modelSelect.value as WhisperModelSize;
  
  const isDownloaded = await checkModelDownloaded(modelSize);
  if (!isDownloaded) {
    const shouldDownload = confirm(
      `The Whisper ${modelSize} model (${MODEL_SIZES[modelSize]}) is not downloaded.\n\n` +
      `Would you like to download it now?`
    );
    
    if (shouldDownload) {
      await handleModelDownload(modelSize);
      const nowDownloaded = await checkModelDownloaded(modelSize);
      if (!nowDownloaded) {
        alert('Model download failed. Please try again from the AI Models section.');
        return;
      }
    } else {
      return;
    }
  }
  
  console.log(`Starting transcription with model: ${modelSize}`);

  transcriptionProgress.classList.remove('hidden');
  transcriptionResult.classList.add('hidden');
  transcriptionEmpty.classList.add('hidden');
  progressFill.style.width = '0%';
  progressFill.classList.remove('indeterminate');

  try {
    const result = await transcribeAudio(lastRecordingBuffer, {
      modelSize,
      onProgress: updateTranscriptionProgress
    });

    lastTranscription = result.text;
    
    progressFill.classList.remove('indeterminate');
    transcriptionProgress.classList.add('hidden');
    transcriptionResult.classList.remove('hidden');
    transcriptionText.textContent = result.text || '(No speech detected)';
    
    console.log(`Transcription complete in ${result.duration.toFixed(1)}s`);
    statusText.textContent = 'Transcription complete!';
    
  } catch (error) {
    console.error('Transcription failed:', error);
    transcriptionProgress.classList.add('hidden');
    transcriptionEmpty.classList.remove('hidden');
    transcriptionEmpty.innerHTML = `<p style="color: #ff6b81;">Transcription failed: ${error}</p>`;
    statusText.textContent = 'Transcription failed';
  }
}

async function copyTranscription(): Promise<void> {
  if (!lastTranscription) return;
  
  try {
    await navigator.clipboard.writeText(lastTranscription);
    copyTranscriptionBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyTranscriptionBtn.textContent = '📋 Copy';
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

async function saveTranscriptionToFile(): Promise<void> {
  if (!lastTranscription || !lastRecordingTimestamp) return;
  
  const filename = `transcription_${lastRecordingTimestamp}.txt`;
  
  try {
    const result = await window.electronAPI.saveTranscription({
      text: lastTranscription,
      filename: filename
    });
    
    if (result.success) {
      saveTranscriptionBtn.textContent = '✓ Saved!';
      console.log(`Transcription saved: ${result.path}`);
      setTimeout(() => {
        saveTranscriptionBtn.textContent = '💾 Save';
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to save transcription:', error);
  }
}

copyTranscriptionBtn.addEventListener('click', copyTranscription);
saveTranscriptionBtn.addEventListener('click', saveTranscriptionToFile);

const MODEL_DESCRIPTIONS: Record<WhisperModelSize, string> = {
  'tiny': 'Fastest, lower accuracy',
  'base': 'Balanced speed & accuracy',
  'small': 'Better accuracy, slower',
  'medium': 'Best accuracy, slowest',
  'large': 'Highest accuracy, requires more resources'
};

function createModelItemHTML(status: ModelStatus): string {
  const isDownloading = downloadingModel === status.modelSize;
  
  return `
    <div class="model-item ${status.downloaded ? 'downloaded' : ''}" data-model="${status.modelSize}">
      <div class="model-info">
        <div class="model-name">Whisper ${status.modelSize.charAt(0).toUpperCase() + status.modelSize.slice(1)}</div>
        <div class="model-meta">
          <span class="model-size">${status.size}</span>
          <span class="model-status ${status.downloaded ? 'downloaded' : ''}">
            ${status.downloaded ? '✓ Downloaded' : 'Not downloaded'}
          </span>
        </div>
        <div class="model-description" style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">
          ${MODEL_DESCRIPTIONS[status.modelSize]}
        </div>
      </div>
      <div class="model-actions">
        ${status.downloaded 
          ? `<button class="model-btn delete-btn" data-model="${status.modelSize}" ${isDownloading ? 'disabled' : ''}>Delete</button>`
          : `<button class="model-btn download-btn" data-model="${status.modelSize}" ${isDownloading ? 'disabled' : ''}>
              ${isDownloading ? 'Downloading...' : 'Download'}
            </button>`
        }
      </div>
      ${isDownloading ? `
        <div class="model-download-progress">
          <div class="model-progress-bar">
            <div class="model-progress-fill" id="model-progress-${status.modelSize}"></div>
          </div>
          <div class="model-progress-text" id="model-progress-text-${status.modelSize}">Starting...</div>
        </div>
      ` : ''}
    </div>
  `;
}

async function refreshModelsList(): Promise<void> {
  try {
    const statuses = await getAllModelStatus();
    
    modelsList.innerHTML = statuses.map(status => createModelItemHTML(status)).join('');
    
    // Add event listeners to buttons
    modelsList.querySelectorAll('.download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modelSize = (e.currentTarget as HTMLButtonElement).dataset.model as WhisperModelSize;
        handleModelDownload(modelSize);
      });
    });
    
    modelsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modelSize = (e.currentTarget as HTMLButtonElement).dataset.model as WhisperModelSize;
        handleModelDelete(modelSize);
      });
    });
    
    // Update the model select dropdown to only show downloaded models
    updateModelSelectOptions(statuses);
  } catch (error) {
    console.error('Failed to refresh models list:', error);
    modelsList.innerHTML = '<p class="error-text">Failed to load models</p>';
  }
}

function updateModelSelectOptions(statuses: ModelStatus[]): void {
  const downloadedModels = statuses.filter(s => s.downloaded);
  const currentValue = modelSelect.value as WhisperModelSize;
  
  // Clear and repopulate
  modelSelect.innerHTML = '';
  
  if (downloadedModels.length === 0) {
    modelSelect.innerHTML = '<option value="" disabled selected>No models downloaded</option>';
    modelSelect.disabled = true;
  } else {
    downloadedModels.forEach(status => {
      const option = document.createElement('option');
      option.value = status.modelSize;
      option.textContent = `Whisper ${status.modelSize.charAt(0).toUpperCase() + status.modelSize.slice(1)} (${MODEL_SIZES[status.modelSize]})`;
      modelSelect.appendChild(option);
    });
    modelSelect.disabled = false;
    
    // Restore selection if still available
    if (downloadedModels.some(m => m.modelSize === currentValue)) {
      modelSelect.value = currentValue;
    }
  }
}

async function handleModelDownload(modelSize: WhisperModelSize): Promise<void> {
  if (downloadingModel) {
    console.warn('Already downloading a model');
    return;
  }
  
  downloadingModel = modelSize;
  await refreshModelsList(); // Update UI to show downloading state
  
  try {
    await downloadModel(modelSize, (progress: TranscriptionProgress) => {
      const progressFill = document.getElementById(`model-progress-${modelSize}`);
      const progressText = document.getElementById(`model-progress-text-${modelSize}`);
      
      if (progressFill && progress.progress !== undefined) {
        progressFill.style.width = `${progress.progress}%`;
      }
      if (progressText) {
        progressText.textContent = progress.message;
      }
    });
    
    console.log(`Model ${modelSize} downloaded successfully`);
  } catch (error) {
    console.error(`Failed to download model ${modelSize}:`, error);
    alert(`Failed to download model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    downloadingModel = null;
    await refreshModelsList();
  }
}

async function handleModelDelete(modelSize: WhisperModelSize): Promise<void> {
  const confirmed = confirm(`Are you sure you want to delete the Whisper ${modelSize} model?`);
  if (!confirmed) return;
  
  try {
    const success = await deleteModelFromCache(modelSize);
    if (success) {
      console.log(`Model ${modelSize} deleted successfully`);
    } else {
      console.warn(`Failed to delete model ${modelSize}`);
    }
  } catch (error) {
    console.error(`Failed to delete model ${modelSize}:`, error);
  }
  
  await refreshModelsList();
}

refreshModelsList();

console.log('🎙️ Fly on the Wall recorder UI initialized');
