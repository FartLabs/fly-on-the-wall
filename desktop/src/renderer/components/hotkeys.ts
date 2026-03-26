import {
  HOTKEY_DEFAULTS,
  type HotkeyModifier,
  normalizeHotkeyBindings,
  normalizeHotkeyShortcut
} from "@/shared/hotkeys";
import { openSettingsModal } from "./navigation";

const currentHotkeys = {
  ...HOTKEY_DEFAULTS
};
let activeModifierOrder: HotkeyModifier[] = [];

function getModifierFromKey(key: string): HotkeyModifier | null {
  if (key === "Control") return "Ctrl";
  if (key === "Alt") return "Alt";
  if (key === "Shift") return "Shift";
  if (key === "Meta") return "Meta";
  return null;
}

function isModifierActive(
  modifier: HotkeyModifier,
  event: KeyboardEvent
): boolean {
  if (modifier === "Ctrl") return event.ctrlKey;
  if (modifier === "Alt") return event.altKey;
  if (modifier === "Shift") return event.shiftKey;
  return event.metaKey;
}

function eventToShortcut(event: KeyboardEvent): string {
  const modifiers = activeModifierOrder.filter((modifier) =>
    isModifierActive(modifier, event)
  );

  const activeInFallbackOrder: HotkeyModifier[] = [];
  if (event.ctrlKey) activeInFallbackOrder.push("Ctrl");
  if (event.altKey) activeInFallbackOrder.push("Alt");
  if (event.shiftKey) activeInFallbackOrder.push("Shift");
  if (event.metaKey) activeInFallbackOrder.push("Meta");

  activeInFallbackOrder.forEach((modifier) => {
    if (!modifiers.includes(modifier)) {
      modifiers.push(modifier);
    }
  });

  let key = event.key;
  if (!key) return modifiers.join("+");

  if (key === " ") key = "Space";
  if (key.length === 1 && /[a-z]/i.test(key)) key = key.toUpperCase();

  return [...modifiers, key].join("+");
}

export async function refreshHotkeysFromConfig() {
  const config = await window.electronAPI.configGet();
  const rawOpenSettings = (
    config.hotkeys as { openSettings?: string | string[] }
  )?.openSettings;
  const configured = normalizeHotkeyBindings(rawOpenSettings);
  const hasExplicitValue =
    Array.isArray(rawOpenSettings) || typeof rawOpenSettings === "string";

  currentHotkeys.openSettings = hasExplicitValue
    ? configured
    : [...HOTKEY_DEFAULTS.openSettings];
}

export function setupHotkeysListeners() {
  refreshHotkeysFromConfig().catch((error) => {
    console.warn("Failed to load hotkeys config:", error);
  });

  document.addEventListener("keydown", (event) => {
    const modifier = getModifierFromKey(event.key);
    if (modifier) {
      if (!activeModifierOrder.includes(modifier)) {
        activeModifierOrder.push(modifier);
      }
      return;
    }

    if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      return;
    }

    const pressed = normalizeHotkeyShortcut(eventToShortcut(event));

    if (pressed && currentHotkeys.openSettings.includes(pressed)) {
      event.preventDefault();
      openSettingsModal();
    }
  });

  document.addEventListener("keyup", (event) => {
    const modifier = getModifierFromKey(event.key);
    if (!modifier) return;

    activeModifierOrder = activeModifierOrder.filter((m) => m !== modifier);

    if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      activeModifierOrder = [];
    }
  });

  window.addEventListener("blur", () => {
    activeModifierOrder = [];
  });
}
