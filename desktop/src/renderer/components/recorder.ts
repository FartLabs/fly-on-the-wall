import { elements } from "./domNodes";
import { getActiveInputDeviceIds } from "./devices";
import { formatSecondsToTime, isScreenSource } from "@/utils";
import { refreshModelsList } from "./models";
import { showNotification } from "./notifications";

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let activeStreams: MediaStream[] = [];
let audioContext: AudioContext | null = null;
let recordingStartTime: Date | null = null;
let timerInterval: number | null = null;
let elapsedSeconds = 0;

// allow the main renderer to receive the buffer when recording stops
type OnRecordingComplete = (
  buffer: ArrayBuffer,
  timestamp: string,
  filename?: string
) => void;

function updateTimer(): void {
  elapsedSeconds++;
  elements.timerDisplay.textContent = formatSecondsToTime(elapsedSeconds);
}

function setUiLocked(locked: boolean): void {
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

export async function startRecording(
  onComplete: OnRecordingComplete
): Promise<void> {
  const systemAudioEnabled = elements.systemAudioToggle.checked;
  const activeDeviceIds = getActiveInputDeviceIds();

  if (!systemAudioEnabled && activeDeviceIds.length === 0) {
    elements.statusText.textContent = "Enable system audio or a microphone!";
    return;
  }

  try {
    audioContext = new AudioContext({ sampleRate: 44100 });
    const destination = audioContext.createMediaStreamDestination();
    activeStreams = [];
    let sourceCount = 0;

    if (systemAudioEnabled) {
      try {
        const sources = await window.electronAPI.getDesktopSources();
        const screenSource = sources.find(isScreenSource) || sources[0];

        if (screenSource) {
          const systemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-expect-error - Electron constraint
              mandatory: { chromeMediaSource: "desktop" }
            },
            video: {
              // @ts-expect-error - Electron constraint
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: screenSource.id,
                maxWidth: 1,
                maxHeight: 1,
                maxFrameRate: 1
              }
            }
          });

          systemStream.getVideoTracks().forEach((track) => track.stop());
          const audioTracks = systemStream.getAudioTracks();
          if (audioTracks.length > 0) {
            const audioOnlyStream = new MediaStream(audioTracks);
            activeStreams.push(audioOnlyStream);
            const source =
              audioContext.createMediaStreamSource(audioOnlyStream);
            source.connect(destination);
            sourceCount++;
          }
        }
      } catch (err) {
        console.warn("System audio error", err);
      }
    }

    for (const deviceId of activeDeviceIds) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100
          }
        });
        activeStreams.push(stream);
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
        sourceCount++;
      } catch (err) {
        console.warn("Mic error", err);
      }
    }

    if (sourceCount === 0) throw new Error("No sources available");

    audioChunks = [];
    mediaRecorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm;codecs=opus"
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstart = () => {
      recordingStartTime = new Date();
    };

    mediaRecorder.onstop = async () => {
      await processRecording(onComplete);
    };

    mediaRecorder.start(1000);

    setUiLocked(true);
    elements.recordBtn.classList.add("hidden");
    elements.recordingControls.classList.remove("hidden");
    elements.pauseBtn.classList.remove("hidden");
    elements.resumeBtn.classList.add("hidden");
    elements.statusIndicator.classList.add("recording");
    elements.statusText.textContent = `Recording...`;

    elapsedSeconds = 0;
    elements.timerDisplay.textContent = formatSecondsToTime(0);
    timerInterval = window.setInterval(updateTimer, 1000);

    refreshModelsList();
  } catch (error) {
    console.error("Error starting:", error);
    stopRecording();
    elements.statusText.textContent = "Failed to start recording";
  }
}

export function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  activeStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  activeStreams = [];
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  setUiLocked(false);
  elements.recordBtn.classList.remove("hidden", "recording");
  elements.recordingControls.classList.add("hidden");
  elements.btnIcon.textContent = "⏺";
  elements.btnText.textContent = "Start Recording";
  elements.statusIndicator.classList.remove("recording", "paused");

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  refreshModelsList();
}

export function pauseRecording(): void {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;
  mediaRecorder.pause();
  if (timerInterval) clearInterval(timerInterval);

  elements.pauseBtn.classList.add("hidden");
  elements.resumeBtn.classList.remove("hidden");
  elements.statusIndicator.classList.add("paused");
  elements.statusText.textContent = "Paused";
}

export function resumeRecording(): void {
  if (!mediaRecorder || mediaRecorder.state !== "paused") return;
  mediaRecorder.resume();
  timerInterval = window.setInterval(updateTimer, 1000);

  elements.resumeBtn.classList.add("hidden");
  elements.pauseBtn.classList.remove("hidden");
  elements.statusIndicator.classList.remove("paused");
  elements.statusText.textContent = "Recording...";
}

async function processRecording(onComplete: OnRecordingComplete) {
  if (audioChunks.length === 0) return;

  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  // free the raw chunks now that we have the blob
  audioChunks = [];
  const timestamp = recordingStartTime
    ? recordingStartTime.toISOString().replace(/[:.]/g, "-").slice(0, 19)
    : new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const arrayBuffer = await audioBlob.arrayBuffer();

  elements.statusText.textContent = "Saving recording...";
  const filename = `recording_${timestamp}.webm`;
  const result = await window.electronAPI.saveRecording({
    buffer: arrayBuffer,
    filename
  });

  if (result.success) {
    elements.statusText.textContent = "Recording saved!";
    showNotification("Recording saved successfully", "success");
    onComplete(arrayBuffer, timestamp, filename);
  } else {
    elements.statusText.textContent = "Failed to save recording";
  }

  setTimeout(() => {
    elements.statusText.textContent = "Ready to record";
  }, 2000);
}

export function isRecordingState(): boolean {
  return mediaRecorder !== null && mediaRecorder.state !== "inactive";
}
