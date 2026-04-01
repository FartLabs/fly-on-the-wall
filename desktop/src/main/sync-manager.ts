import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { readConfig, setConfig, onConfigUpdated } from "./config";
import { toSafeName } from "../utils";
import { getNotesDir, getPendingDeletesPath } from "./userData";

type SyncUser = {
  id: string;
  username: string;
  is_admin: boolean;
  is_premium: boolean;
};

type LocalNote = {
  filename: string;
  filePath: string;
  mtimeMs: number;
  content: any;
};

type SyncMeta = {
  remoteId: string;
  remoteVersion: number;
  localMtimeMs: number;
  lastSyncedAt: string;
};

type SyncResult = {
  success: boolean;
  pushed: number;
  pulled: number;
  skipped: number;
  error?: string;
};

type PendingDelete = { remoteId: string; filename: string };

function readPendingDeletes(): PendingDelete[] {
  try {
    const filePath = getPendingDeletesPath();
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PendingDelete[];
  } catch {
    return [];
  }
}

function writePendingDeletes(items: PendingDelete[]): void {
  try {
    fs.writeFileSync(
      getPendingDeletesPath(),
      JSON.stringify(items, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[sync] Failed to write pending-deletes.json:", err);
  }
}

export function enqueuePendingDelete(remoteId: string, filename: string): void {
  const existing = readPendingDeletes();
  if (!existing.some((d) => d.remoteId === remoteId)) {
    writePendingDeletes([...existing, { remoteId, filename }]);
  }
}

let syncIntervalId: NodeJS.Timeout | null = null;
let syncInFlight = false;

function getServerUrl(): string {
  const raw = readConfig().sync.serverUrl || "";
  return raw.trim().replace(/\/+$/, ""); // remove trailing slashes
}

function readLocalNotes(): LocalNote[] {
  const notesDir = getNotesDir();
  const files = fs
    .readdirSync(notesDir)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const notes: LocalNote[] = [];
  for (const filename of files) {
    const filePath = path.join(notesDir, filename);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const content = JSON.parse(raw);
      const stat = fs.statSync(filePath);
      notes.push({ filename, filePath, mtimeMs: stat.mtimeMs, content });
    } catch (error) {
      console.warn("[sync] skipping invalid note file:", filename, error);
    }
  }

  return notes;
}

function extractSyncMeta(note: any): SyncMeta | null {
  const sync = note?.metadata?.sync;
  if (!sync || typeof sync !== "object") return null;
  if (!sync.remoteId || typeof sync.remoteId !== "string") return null;
  return {
    remoteId: sync.remoteId,
    remoteVersion: Number(sync.remoteVersion || 0),
    localMtimeMs: Number(sync.localMtimeMs || 0),
    lastSyncedAt: String(sync.lastSyncedAt || "")
  };
}

function ensureNoteMetadata(note: any): Record<string, any> {
  if (!note.metadata || typeof note.metadata !== "object") {
    note.metadata = {};
  }
  return note.metadata as Record<string, any>;
}

function setSyncMeta(note: any, meta: SyncMeta) {
  const metadata = ensureNoteMetadata(note);
  metadata.sync = {
    remoteId: meta.remoteId,
    remoteVersion: meta.remoteVersion,
    localMtimeMs: meta.localMtimeMs,
    lastSyncedAt: meta.lastSyncedAt
  };
}

function isDirty(local: LocalNote): boolean {
  const syncMeta = extractSyncMeta(local.content);
  if (!syncMeta) return true;
  return local.mtimeMs - syncMeta.localMtimeMs > 2000;
}

function buildRemotePayload(note: any): Buffer {
  const copy = JSON.parse(JSON.stringify(note));
  if (copy.metadata && typeof copy.metadata === "object") {
    delete copy.metadata.sync;
  }
  return Buffer.from(JSON.stringify(copy), "utf-8");
}

function decodeRemotePayload(encoded: string): any {
  const payload = Buffer.from(encoded, "base64").toString("utf-8");
  return JSON.parse(payload);
}

function writeNoteFile(filePath: string, note: any): LocalNote {
  fs.writeFileSync(filePath, JSON.stringify(note, null, 2), "utf-8");
  const stat = fs.statSync(filePath);
  return {
    filename: path.basename(filePath),
    filePath,
    mtimeMs: stat.mtimeMs,
    content: note
  };
}

function findByRemoteId(
  localNotes: LocalNote[],
  remoteId: string
): LocalNote | null {
  for (const local of localNotes) {
    const syncMeta = extractSyncMeta(local.content);
    if (syncMeta?.remoteId === remoteId) return local;
  }
  return null;
}

function pickFilename(localNotes: LocalNote[], preferred: string): string {
  const notesDir = getNotesDir();
  const existing = new Set(localNotes.map((n) => n.filename));
  const base = toSafeName(preferred) || `note_${Date.now()}`;
  let candidate = `${base}.json`;
  let index = 1;
  while (
    existing.has(candidate) ||
    fs.existsSync(path.join(notesDir, candidate))
  ) {
    candidate = `${base}_${index}.json`;
    index++;
  }
  return candidate;
}

async function requestJSON<T>(
  method: string,
  endpoint: string,
  body?: Record<string, any>,
  requireAuth = true
): Promise<T> {
  const cfg = readConfig();
  const baseUrl = getServerUrl();
  if (!baseUrl) {
    console.warn("[sync] Server URL not configured, skipping request");
    throw new Error("Server URL is not configured");
  }

  console.log(`[sync] ${method} ${endpoint}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (requireAuth) {
    if (!cfg.sync.authToken) {
      console.warn("[sync] Not authenticated, skipping request");
      throw new Error("Not authenticated");
    }
    headers.Authorization = `Bearer ${cfg.sync.authToken}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const json = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const message =
      typeof json?.error === "string" ? json.error : `HTTP ${response.status}`;
    console.error(`[sync] Request failed: ${message}`);
    throw new Error(message);
  }

  console.log(`[sync] Request succeeded: ${method} ${endpoint}`);
  return json as T;
}

async function syncPull(
  localNotes: LocalNote[]
): Promise<{ pulled: number; skipped: number; cursor: string }> {
  console.log("[sync] Pulling changes from server...");

  const cfg = readConfig();
  const params = new URLSearchParams();
  if (cfg.sync.notesCursor) params.set("since", cfg.sync.notesCursor);

  const delta = await requestJSON<{
    notes: Array<{ id: string; version: number; deleted_at?: string | null }>;
    cursor: string;
  }>(
    "GET",
    `/api/v1/sync/delta${params.toString() ? `?${params.toString()}` : ""}`
  );

  console.log(`[sync] Pulled ${delta.notes?.length || 0} notes from server`);

  let pulled = 0;
  let skipped = 0;

  for (const remote of delta.notes || []) {
    const existing = findByRemoteId(localNotes, remote.id);

    if (remote.deleted_at) {
      if (!existing) {
        skipped += 1;
        continue;
      }
      if (isDirty(existing)) {
        skipped += 1;
        continue;
      }
      fs.unlinkSync(existing.filePath);
      const idx = localNotes.findIndex((n) => n.filename === existing.filename);
      if (idx >= 0) localNotes.splice(idx, 1);
      pulled += 1;
      continue;
    }

    // if pending delete, skip pulling it
    // pushDeletes will tombstone it on the server on the next sync cycle
    const pendingDeleteIds = new Set(
      readPendingDeletes().map((d) => d.remoteId)
    );
    if (pendingDeleteIds.has(remote.id)) {
      skipped += 1;
      continue;
    }

    const existingSync = existing ? extractSyncMeta(existing.content) : null;
    const localVersion = existingSync?.remoteVersion || 0;
    const localDirty = existing ? isDirty(existing) : false;

    if (
      existing &&
      !localDirty &&
      localVersion >= Number(remote.version || 0)
    ) {
      skipped += 1;
      continue;
    }

    if (existing && localDirty && Number(remote.version || 0) > localVersion) {
      const conflictFile = pickFilename(
        localNotes,
        `${path.basename(existing.filename, ".json")}_conflict_${Date.now()}`
      );
      const conflictPath = path.join(getNotesDir(), conflictFile);
      const conflictWritten = writeNoteFile(conflictPath, existing.content);
      localNotes.push(conflictWritten);
    }

    const noteResponse = await requestJSON<{
      content: string;
      encrypted_content?: string;
      id: string;
      version: number;
    }>("GET", `/api/v1/notes/${encodeURIComponent(remote.id)}`);

    const content = noteResponse.content ?? noteResponse.encrypted_content;
    if (!content) {
      skipped += 1;
      continue;
    }

    const now = Date.now();

    const payload = decodeRemotePayload(content);
    const syncMeta: SyncMeta = {
      remoteId: remote.id,
      remoteVersion: Number(noteResponse.version || remote.version || 0),
      localMtimeMs: now,
      lastSyncedAt: new Date().toISOString()
    };
    setSyncMeta(payload, syncMeta);

    let targetFilePath: string;
    if (existing) {
      targetFilePath = existing.filePath;
    } else {
      const preferred = String(payload?.id || remote.id || `note_${now}`);
      targetFilePath = path.join(
        getNotesDir(),
        pickFilename(localNotes, preferred)
      );
    }

    const written = writeNoteFile(targetFilePath, payload);
    const idx = localNotes.findIndex((n) => n.filename === written.filename);
    if (idx >= 0) {
      localNotes[idx] = written;
    } else {
      localNotes.push(written);
    }
    pulled += 1;
  }

  return {
    pulled,
    skipped,
    cursor: String(delta.cursor || cfg.sync.notesCursor || "")
  };
}

async function syncPush(
  localNotes: LocalNote[]
): Promise<{ pushed: number; skipped: number }> {
  console.log("[sync] Pushing changes to server...");

  let pushed = 0;
  let skipped = 0;

  for (const local of localNotes) {
    if (!isDirty(local)) {
      skipped += 1;
      continue;
    }

    const syncMeta = extractSyncMeta(local.content);
    const payload = buildRemotePayload(local.content);

    const response = await requestJSON<{ id: string; version: number }>(
      "POST",
      "/api/v1/notes",
      {
        id: syncMeta?.remoteId || "",
        content: payload.toString("base64"),
        recording_ref: "",
        version: syncMeta?.remoteVersion || 0
      }
    );

    const now = Date.now();

    const newMeta: SyncMeta = {
      remoteId: response.id,
      remoteVersion: Number(response.version || 0),
      localMtimeMs: now,
      lastSyncedAt: new Date().toISOString()
    };
    setSyncMeta(local.content, newMeta);
    const written = writeNoteFile(local.filePath, local.content);
    local.mtimeMs = written.mtimeMs;
    local.content = written.content;
    pushed += 1;
  }

  console.log(`[sync] Pushed ${pushed} notes to server`);

  return { pushed, skipped };
}

export async function pushDeletes() {
  const pending = readPendingDeletes();
  if (pending.length === 0) return;

  console.log(
    `[sync] Processing ${pending.length} pending remote delete(s)...`
  );

  const remaining: Array<{ remoteId: string; filename: string }> = [];

  for (const item of pending) {
    try {
      await requestJSON<unknown>(
        "DELETE",
        `/api/v1/notes/${encodeURIComponent(item.remoteId)}`
      );
      console.log(`[sync] Remote delete succeeded: ${item.remoteId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorRegex = /404|not found/i;
      if (errorRegex.test(msg)) {
        console.log(
          `[sync] Note already gone on server (404): ${item.remoteId}`
        );
      } else {
        console.warn(
          `[sync] Remote delete failed, will retry next sync: ${item.remoteId} — ${msg}`
        );
        remaining.push(item);
      }
    }
  }

  writePendingDeletes(remaining);
}

async function syncNowInternal(updateErrorState = true): Promise<SyncResult> {
  if (syncInFlight) {
    return { success: true, pushed: 0, pulled: 0, skipped: 0 };
  }

  const cfg = readConfig();
  const serverUrl = getServerUrl();

  if (!cfg.sync.enabled) {
    console.log("[sync] Sync disabled, skipping sync");
    return { success: true, pushed: 0, pulled: 0, skipped: 0 };
  }

  if (!serverUrl) {
    console.log("[sync] Server URL not configured, skipping sync");
    return { success: true, pushed: 0, pulled: 0, skipped: 0 };
  }

  if (!cfg.sync.authToken) {
    console.log("[sync] Not authenticated, skipping sync");
    return { success: true, pushed: 0, pulled: 0, skipped: 0 };
  }

  console.log("[sync] Starting sync...");
  syncInFlight = true;
  try {
    const localNotes = readLocalNotes();
    await pushDeletes();
    const pull = await syncPull(localNotes);
    const push = await syncPush(localNotes);

    setConfig({
      sync: {
        ...readConfig().sync,
        notesCursor: pull.cursor,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: ""
      }
    });

    console.log(
      `[sync] Sync completed: pushed ${push.pushed}, pulled ${pull.pulled}, skipped ${pull.skipped + push.skipped}`
    );

    return {
      success: true,
      pushed: push.pushed,
      pulled: pull.pulled,
      skipped: pull.skipped + push.skipped
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync] Sync failed:", message);
    if (updateErrorState) {
      setConfig({
        sync: {
          ...readConfig().sync,
          lastSyncError: message
        }
      });
    }
    return { success: false, pushed: 0, pulled: 0, skipped: 0, error: message };
  } finally {
    syncInFlight = false;
  }
}

function clearSyncTimer() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

function refreshSyncTimer() {
  clearSyncTimer();
  const cfg = readConfig();
  const serverUrl = getServerUrl();

  if (!cfg.sync.enabled) {
    console.log("[sync] Sync disabled, sync timer not started");
    return;
  }

  if (!serverUrl) {
    console.log("[sync] Server URL not configured, sync timer not started");
    return;
  }

  if (!cfg.sync.authToken) {
    console.log("[sync] Not authenticated, sync timer not started");
    return;
  }

  const intervalMinutes = Math.max(
    1,
    Number(cfg.sync.syncIntervalMinutes || 5)
  );

  console.log(`[sync] Starting sync timer: every ${intervalMinutes} minute(s)`);

  syncIntervalId = setInterval(
    () => {
      syncNowInternal(false).catch((error) => {
        console.error("[sync] periodic sync failed:", error);
      });
    },
    intervalMinutes * 60 * 1000
  );
}

async function signUpOrLogin(
  mode: "register" | "login",
  data: { username: string; password: string }
): Promise<{ success: boolean; user?: SyncUser; error?: string }> {
  try {
    const endpoint =
      mode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login";

    const cfg = readConfig();
    const deviceId = cfg.sync.deviceId || crypto.randomUUID();

    const deviceInfo = {
      username: data.username,
      password: data.password,
      device_id: deviceId,
      device_os: process.platform,
      device_version: os.release(),
      device_name: os.hostname()
    };

    const response = await requestJSON<{ user: SyncUser; token: string }>(
      "POST",
      endpoint,
      deviceInfo,
      false
    );

    setConfig({
      sync: {
        ...cfg.sync,
        authToken: response.token,
        userId: response.user.id,
        username: response.user.username,
        deviceId,
        lastSyncError: ""
      }
    });
    refreshSyncTimer();
    return { success: true, user: response.user };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function whoAmI(): Promise<{
  success: boolean;
  authenticated: boolean;
  user?: SyncUser;
  error?: string;
}> {
  try {
    const user = await requestJSON<SyncUser>("GET", "/api/v1/auth/me");
    const cfg = readConfig();
    setConfig({
      sync: {
        ...cfg.sync,
        userId: user.id,
        username: user.username
      }
    });
    return { success: true, authenticated: true, user };
  } catch (error) {
    return {
      success: true,
      authenticated: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function logout(): Promise<{ success: boolean; error?: string }> {
  try {
    await requestJSON("POST", "/api/v1/auth/logout", undefined, true);
  } catch {
    // ignore logout errors
  }

  try {
    const cfg = readConfig();
    setConfig({
      sync: {
        ...cfg.sync,
        authToken: "",
        userId: "",
        username: "",
        notesCursor: ""
      }
    });
    refreshSyncTimer();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

ipcMain.handle(
  "sync-signup",
  async (_event, data: { username: string; password: string }) => {
    return signUpOrLogin("register", data);
  }
);

ipcMain.handle(
  "sync-login",
  async (_event, data: { username: string; password: string }) => {
    return signUpOrLogin("login", data);
  }
);

ipcMain.handle("sync-logout", async () => {
  return logout();
});

ipcMain.handle("sync-whoami", async () => {
  return whoAmI();
});

ipcMain.handle("sync-now", async () => {
  return syncNowInternal(true);
});

onConfigUpdated(() => {
  refreshSyncTimer();
});

app.on("ready", () => {
  refreshSyncTimer();
  const cfg = readConfig();
  if (cfg.sync.enabled && cfg.sync.authToken && cfg.sync.autoSyncOnStartup) {
    syncNowInternal(false).catch((error) => {
      console.error("[sync] startup sync failed:", error);
    });
  }
});
