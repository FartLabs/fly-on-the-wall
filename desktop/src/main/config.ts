import { app, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "@/shared/electronAPI";
import { DEFAULT_CONFIG } from "@/shared/config";

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);

      // deep merge with defaults to handle missing keys from older configs
      return deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
    }
  } catch (error) {
    console.error("Error reading config file, using defaults:", error);
  }
  return structuredClone(DEFAULT_CONFIG);
}

function writeConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing config file:", error);
  }
}

// a recursive deep merge algo for merging partial configs into the main config,
// ensuring nested objects are merged instead of overwritten
function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Record<string, any>
): T {
  for (const key of Object.keys(source)) {
    if (
      // check if both source and target have the same key and their values are non-null objects
      // (but not arrays), then merge them recursively
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      key in target &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      (target as any)[key] = deepMerge(target[key], source[key]);
    } else {
      (target as any)[key] = source[key];
    }
  }
  return target;
}

ipcMain.handle("config-get", () => {
  return readConfig();
});

ipcMain.handle("config-set", (_event, partialConfig: Partial<AppConfig>) => {
  const current = readConfig();
  const merged = deepMerge(current, partialConfig as Record<string, any>);
  writeConfig(merged);
  return merged;
});
