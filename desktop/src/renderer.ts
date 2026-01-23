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

let isRecording = false;
let timerInterval: number | null = null;
let elapsedSeconds = 0;

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

console.log('🎙️ Fly on the Wall recorder UI initialized');
