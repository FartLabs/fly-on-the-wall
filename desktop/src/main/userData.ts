import { ensureDir } from "@/utils";
import { app } from "electron/main";
import path from "node:path";
import { readConfig } from "./config";

function resolveConfiguredDir(
  configuredPath: string,
  fallbackPath: string
): string {
  const raw = configuredPath.trim();
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

export const getRecordingsDir = (): string => {
  const recordingsDir = path.join(app.getPath("userData"), "recordings");
  return ensureDir(recordingsDir);
};

export const getConfigPath = (): string => {
  return path.join(app.getPath("userData"), "config.json");
};

export const getModelsDir = (): string => {
  const modelsDir = path.join(app.getPath("userData"), "models");
  return ensureDir(modelsDir);
};

export const getModelsCacheDir = (): string => {
  const cacheDir = path.join(app.getPath("userData"), "cache", "models");
  return ensureDir(cacheDir);
};

export const getSummarizationModelsDir = (): string => {
  const config = readConfig();
  return resolveConfiguredDir(
    config.summarization.modelStoragePath || "",
    path.join(app.getPath("userData"), "models", "summarization")
  );
};

export const getTranscriptionModelsDir = (): string => {
  const config = readConfig();
  return resolveConfiguredDir(
    config.transcription.modelStoragePath || "",
    path.join(app.getPath("userData"), "models", "transcription")
  );
};

export const getNotesDir = (): string => {
  const notesDir = path.join(app.getPath("userData"), "notes");
  return ensureDir(notesDir);
};

export const getPendingDeletesPath = (): string => {
  return path.join(app.getPath("userData"), "pending-deletes.json");
};
