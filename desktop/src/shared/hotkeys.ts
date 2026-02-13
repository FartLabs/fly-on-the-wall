export interface HotkeysConfig {
  openSettings: string[];
}

export const HOTKEY_DEFAULTS: HotkeysConfig = {
  openSettings: ["Ctrl+,"]
};

export type HotkeyModifier = "Ctrl" | "Alt" | "Shift" | "Meta";

const MODIFIER_ALIASES: Record<string, HotkeyModifier> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  win: "Meta",
  super: "Meta"
};

function toModifier(token: string): HotkeyModifier | null {
  return MODIFIER_ALIASES[token.toLowerCase()] ?? null;
}

function normalizeKeyToken(token: string): string {
  const t = token.trim();
  if (!t) return "";

  if (t === "," || t.toLowerCase() === "comma") return ",";
  if (t.toLowerCase() === "space") return "Space";

  if (t.length === 1) {
    return /[a-z]/i.test(t) ? t.toUpperCase() : t;
  }

  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function normalizeHotkeyShortcut(input: string): string {
  if (!input || !input.trim()) return "";

  const tokens = input
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);

  const modifiers: HotkeyModifier[] = [];
  const keyTokens: string[] = [];

  tokens.forEach((token) => {
    const modifier = toModifier(token);
    if (modifier) {
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier);
      }
      return;
    }
    keyTokens.push(token);
  });

  const key = normalizeKeyToken(keyTokens[keyTokens.length - 1] || "");

  return [...modifiers, key].filter(Boolean).join("+");
}

export function normalizeHotkeyBindings(
  input: string | string[] | null | undefined
): string[] {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const shortcut = normalizeHotkeyShortcut(value);
    if (!shortcut || seen.has(shortcut)) return;
    seen.add(shortcut);
    normalized.push(shortcut);
  });

  return normalized;
}
