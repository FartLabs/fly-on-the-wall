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

export function generateDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  } else if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined
  });
}

export function convertToLocaleTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
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
  if (filename.startsWith('.') && filename.lastIndexOf('.') === 0) {
    return filename;
  }
  return filename.replace(/\..*$/, "");
};
