import fs from "fs";

export function formatSecondsToTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((val) => val.toString().padStart(2, "0"))
    .join(":");
}

// there might be a better way to do this that doesn't rely on string matching
const screenPatterns = ["screen", "desktop", "monitor", "entire"];

export function isScreenSource(source: { id: string; name: string }): boolean {
  const normalizedName = source.name.toLowerCase();
  const normalizedId = source.id.toLowerCase();

  return screenPatterns.some(
    (pattern) =>
      normalizedName.includes(pattern) || normalizedId.includes(pattern)
  );
}

export function generateDateLabel(date: Date, locale = "en-US"): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  } else if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined
  });
}

export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function getBaseName(filename: string): string {
  // preserve filenames that are just an extension (e.g., ".gitignore")
  if (filename.startsWith(".") && filename.lastIndexOf(".") === 0) {
    return filename;
  }
  return filename.replace(/\..*$/, "");
}

const sizes = ["Bytes", "KB", "MB", "GB"];

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ensureDir(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}
// a recursive variant of Partial<T> for use in updating settings
// https://stackoverflow.com/a/61132308
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export function toSafeName(input: string) {
  if (!input) return "";
  return (
    input
      // remove all characters except alphanumeric, hyphen, underscore, and space
      .replace(/[^a-zA-Z0-9-_\s]/g, "")
      .trim()
      // replace remaining spaces (including multiple in a row) with a single underscore
      .replace(/\s+/g, "_")
  );
}

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60_000;

export function msToSeconds(ms: number): number {
  return Math.round(ms / MS_PER_SEC);
}

export function msToMinutes(ms: number): number {
  return Math.round(ms / MS_PER_MIN);
}

export function secondsToMs(seconds: number): number {
  return seconds * MS_PER_SEC;
}

export function minutesToMs(minutes: number): number {
  return minutes * MS_PER_MIN;
}
