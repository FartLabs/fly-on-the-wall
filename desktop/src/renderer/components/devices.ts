import { elements } from "./domNodes";

interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

const mutedDevices = new Set<string>();

export function getActiveInputDeviceIds(): string[] {
  const allDeviceItems = Array.from(
    elements.devicesList.querySelectorAll(".device-item")
  );
  return allDeviceItems
    .filter((el) => {
      const deviceId = (el as HTMLElement).dataset.deviceId;
      const deviceType = el.querySelector(".device-type")?.textContent;
      return (
        deviceId && deviceType?.includes("Input") && !mutedDevices.has(deviceId)
      );
    })
    .map((el) => (el as HTMLElement).dataset.deviceId)
    .filter((id): id is string => id !== undefined);
}

function getDeviceIcon(kind: MediaDeviceKind): string {
  switch (kind) {
    case "audioinput":
      return "🎤";
    case "audiooutput":
      return "🔊";
    default:
      return "🎧";
  }
}

function createDeviceElement(device: AudioDeviceInfo): HTMLElement {
  const isMuted = mutedDevices.has(device.deviceId);
  const deviceItem = document.createElement("div");
  deviceItem.className = `device-item${isMuted ? " muted" : ""}`;
  deviceItem.dataset.deviceId = device.deviceId;

  const label = device.label || `Unknown ${device.kind} device`;

  deviceItem.innerHTML = `
    <div class="device-info">
      <span class="device-icon">${getDeviceIcon(device.kind)}</span>
      <div class="device-details">
        <div class="device-name" title="${label}">${label}</div>
        <div class="device-type">Input (Microphone)</div>
      </div>
    </div>
    <label class="mute-toggle" title="${isMuted ? "Unmute" : "Mute"} device">
      <input type="checkbox" ${!isMuted ? "checked" : ""}>
      <span class="mute-slider"></span>
    </label>
  `;

  const checkbox = deviceItem.querySelector("input") as HTMLInputElement;
  checkbox.addEventListener("change", () => {
    if (!checkbox.checked) {
      mutedDevices.add(device.deviceId);
      deviceItem.classList.add("muted");
    } else {
      mutedDevices.delete(device.deviceId);
      deviceItem.classList.remove("muted");
    }
  });

  return deviceItem;
}

export async function loadAudioDevices(): Promise<void> {
  elements.devicesList.innerHTML =
    '<p class="loading-text">Loading microphones...</p>';

  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter((d) => d.kind === "audioinput");

    if (audioDevices.length === 0) {
      elements.devicesList.innerHTML =
        '<p class="no-devices">No microphones found</p>';
      return;
    }

    elements.devicesList.innerHTML = "";
    audioDevices.forEach((device) => {
      elements.devicesList.appendChild(createDeviceElement(device));
    });
  } catch (error) {
    console.error("Error loading audio devices:", error);
    elements.devicesList.innerHTML = `<p class="error-text">Unable to access audio devices.</p>`;
  }
}
