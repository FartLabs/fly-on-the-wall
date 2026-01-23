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

// Declare electronAPI exposed from preload
declare global {
  interface Window {
    electronAPI: {
      saveRecording: (data: { buffer: ArrayBuffer; filename: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
      getRecordingsDir: () => Promise<string>;
      getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
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

let isRecording = false;
let timerInterval: number | null = null;
let elapsedSeconds = 0;

// Recording state
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let activeStreams: MediaStream[] = [];
let audioContext: AudioContext | null = null;
let recordingStartTime: Date | null = null;

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
  
  // then lock refresh button
  refreshDevicesBtn.disabled = locked;
  refreshDevicesBtn.classList.toggle('disabled', locked);
}

// get active input devices (non-muted microphones)
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
        console.log('Available sources:', sources);
        
        // use the first screen source for system audio
        const screenSource = sources.find(s => s.name === 'Entire Screen' || s.name.includes('Screen'));
        
        if (screenSource) {
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
    recordBtn.classList.add('recording');
    btnIcon.textContent = '⏹';
    btnText.textContent = 'Stop Recording';
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
    // TODO: consider other audio file extensions 
  const filename = `recording_${timestamp}.webm`;

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    console.log(`Saving recording as: ${filename}`);
    const result = await window.electronAPI.saveRecording({
      buffer: arrayBuffer,
      filename: filename
    });

    if (result.success) {
      console.log(`✅ Recording saved successfully: ${result.path}`);
      statusText.textContent = 'Recording saved!';
    } else {
      console.error('Failed to save recording:', result.error);
      statusText.textContent = 'Failed to save recording';
    }
  } catch (error) {
    console.error('Error saving recording:', error);
    statusText.textContent = 'Error saving recording';
  }

  // Reset after brief delay
  setTimeout(() => {
    if (!isRecording) {
      statusText.textContent = 'Ready to record';
    }
  }, 2000);
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
  recordBtn.classList.remove('recording');
  btnIcon.textContent = '⏺';
  btnText.textContent = 'Start Recording';
  statusIndicator.classList.remove('recording');
  statusText.textContent = 'Saving recording...';
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function toggleRecording(): void {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

recordBtn.addEventListener('click', toggleRecording);

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

console.log('🎙️ Fly on the Wall recorder UI initialized');
