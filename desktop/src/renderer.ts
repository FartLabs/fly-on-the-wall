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

function startRecording(): void {
  isRecording = true;
  
  recordBtn.classList.add('recording');
  btnIcon.textContent = '⏹';
  btnText.textContent = 'Stop Recording';
  
  statusIndicator.classList.add('recording');
  statusText.textContent = 'Recording...';
  
  elapsedSeconds = 0;
  timerDisplay.textContent = formatTime(elapsedSeconds);
  timerInterval = window.setInterval(updateTimer, 1000);
  
  console.log('Recording started');
}

function stopRecording(): void {
  isRecording = false;
  
  recordBtn.classList.remove('recording');
  btnIcon.textContent = '⏺';
  btnText.textContent = 'Start Recording';
  
  statusIndicator.classList.remove('recording');
  statusText.textContent = 'Ready to record';
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  console.log(`Recording stopped. Duration: ${formatTime(elapsedSeconds)}`);
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
  devicesList.innerHTML = '<p class="loading-text">Loading audio devices...</p>';

  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(
      device => device.kind === 'audioinput' || device.kind === 'audiooutput'
    );

    if (audioDevices.length === 0) {
      devicesList.innerHTML = '<p class="no-devices">No audio devices found</p>';
      return;
    }

    devicesList.innerHTML = '';

    const inputs = audioDevices.filter(d => d.kind === 'audioinput');
    const outputs = audioDevices.filter(d => d.kind === 'audiooutput');

    [...inputs, ...outputs].forEach(device => {
      const deviceElement = createDeviceElement({
        deviceId: device.deviceId,
        label: device.label,
        kind: device.kind,
      });
      devicesList.appendChild(deviceElement);
    });

    console.log(`Loaded ${audioDevices.length} audio devices`);
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
