// ── Settings Store ──
// Solid reactive store for overlay settings.
// Extracted from app.js DEFAULT_OVERLAY_SETTINGS, applyOverlaySettings,
// browserOverlaySettings, and persistOverlaySettings.

import { createStore } from "solid-js/store";
import { DEFAULT_SERVER } from "../services/api";
import { sanitizeLocale } from "../utils/i18n";

// ── Types ──

export interface OverlaySettings {
  serverUrl: string;
  autoServer: boolean;
  password: string;
  username: string;
  executor: string;
  initGit: boolean;
  alwaysOnTop: boolean;
  unattended: boolean;
  autoPermission: boolean;
  autoQuestion: boolean;
  showTranscriptDetails: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number | null;
  sectionsWidth: number | null;
  opacity: number;
  zoom: number;
  theme: string;
  locale: string;
  directoryMode: string;
  directory: string;
  workspaceTaskID: string;
  workspaceDirectory: string;
  // ── Runtime directory state (mirrors state.savedDirectory / state.tempDirectory) ──
  /** Last persisted directory value; used to detect uncommitted changes and revert */
  savedDirectory: string;
  /** Temporary directory path assigned by the server for the current session */
  tempDirectory: string;
  // ── Epoch counters (mirrors state.workspaceEpoch / state.directoryEpoch) ──
  /** Incremented each time the workspace is invalidated/reset */
  workspaceEpoch: number;
  /** Incremented each time the working directory changes */
  directoryEpoch: number;
}

// ── Sanitisers (mirror app.js helpers) ──

function sanitizeTheme(value: any): string {
  const text = String(value || "").trim();
  return text === "light" || text === "dark" ? text : "dark";
}

export const MIN_WINDOW_OPACITY = 0.5;

export function sanitizeOpacity(value: any): number {
  const n = parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return 0.8;
  return Math.max(
    MIN_WINDOW_OPACITY,
    Math.min(1, Math.round(n * 100) / 100),
  );
}

function sanitizeZoom(value: any): number {
  const n = parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.6, Math.max(0.8, n));
}

function sanitizePaneWidth(value: any): number | null {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function defaultAutoServer(url: string): boolean {
  // Mirror app.js: autoServer defaults to true only when URL equals the
  // browser origin or the default loopback server.
  return !url || url === DEFAULT_SERVER;
}

function sanitizeAutoServer(value: any, serverUrl: string): boolean {
  if (value === true || value === false) return value;
  return defaultAutoServer(serverUrl);
}

// ── Default locale ──

const DEFAULT_LOCALE = sanitizeLocale(
  typeof document !== "undefined"
    ? document.documentElement.lang
    : typeof navigator !== "undefined"
      ? navigator.language
      : "en-US",
);

// ── Defaults ──

export const DEFAULT_SETTINGS: OverlaySettings = {
  serverUrl: DEFAULT_SERVER,
  autoServer: true,
  password: "",
  username: "opencorvus",
  executor: "opencode",
  initGit: true,
  alwaysOnTop: false,
  unattended: true,
  autoPermission: false,
  autoQuestion: false,
  showTranscriptDetails: false,
  sidebarCollapsed: false,
  sidebarWidth: null,
  sectionsWidth: null,
  opacity: 0.8,
  zoom: 1,
  theme: "dark",
  locale: DEFAULT_LOCALE,
  directoryMode: "temp",
  directory: "",
  workspaceTaskID: "",
  workspaceDirectory: "",
  savedDirectory: "",
  tempDirectory: "",
  workspaceEpoch: 0,
  directoryEpoch: 0,
};

// ── Store ──

export const [settingsStore, setSettingsStore] =
  createStore<OverlaySettings>({ ...DEFAULT_SETTINGS });

// ── applySettings ──
// Validates and writes a partial settings object into the store.
// Mirrors app.js applyOverlaySettings validation logic exactly.

export function applySettings(input: Partial<OverlaySettings>): void {
  const serverUrl =
    typeof input?.serverUrl === "string" && input.serverUrl.trim()
      ? input.serverUrl.trim()
      : DEFAULT_SETTINGS.serverUrl;

  setSettingsStore({
    serverUrl,
    autoServer: sanitizeAutoServer(input?.autoServer, serverUrl),
    password:
      typeof input?.password === "string"
        ? input.password
        : DEFAULT_SETTINGS.password,
    username:
      typeof input?.username === "string" && input.username.trim()
        ? input.username.trim()
        : DEFAULT_SETTINGS.username,
    executor:
      typeof input?.executor === "string" && input.executor.trim()
        ? input.executor.trim()
        : DEFAULT_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: input?.alwaysOnTop === true,
    unattended: input?.unattended !== false,
    autoPermission: input?.autoPermission === true,
    autoQuestion: input?.autoQuestion === true,
    showTranscriptDetails: input?.showTranscriptDetails === true,
    sidebarCollapsed: input?.sidebarCollapsed === true,
    sidebarWidth: sanitizePaneWidth(input?.sidebarWidth),
    sectionsWidth: sanitizePaneWidth(input?.sectionsWidth),
    opacity: sanitizeOpacity(input?.opacity),
    zoom: sanitizeZoom(input?.zoom),
    theme: sanitizeTheme(input?.theme),
    locale: sanitizeLocale(
      (typeof input?.locale === "string" ? input.locale : "") ||
        DEFAULT_SETTINGS.locale,
    ),
    directoryMode:
      typeof input?.directory === "string" && input.directory.trim()
        ? "custom"
        : "temp",
    directory:
      typeof input?.directory === "string" ? input.directory.trim() : "",
    workspaceTaskID:
      typeof input?.workspaceTaskID === "string"
        ? input.workspaceTaskID.trim()
        : DEFAULT_SETTINGS.workspaceTaskID,
    workspaceDirectory:
      typeof input?.workspaceDirectory === "string"
        ? input.workspaceDirectory.trim()
        : DEFAULT_SETTINGS.workspaceDirectory,
  });
}

// ── saveSettings ──
// Persists current store values to localStorage.
// Mirrors app.js persistOverlaySettings (localStorage keys only; Tauri
// invoke is handled by app.js for now).

export function saveSettings(): void {
  const s = settingsStore;
  localStorage.setItem("oc_server_url", s.serverUrl);
  localStorage.setItem("oc_auto_server", String(s.autoServer));
  localStorage.setItem("oc_password", s.password);
  localStorage.setItem("oc_username", s.username);
  localStorage.setItem("oc_executor", s.executor || DEFAULT_SETTINGS.executor);
  localStorage.setItem("oc_always_on_top", String(s.alwaysOnTop));
  localStorage.setItem("oc_unattended", String(s.unattended));
  localStorage.setItem("oc_auto_permission", String(s.autoPermission));
  localStorage.setItem("oc_auto_question", String(s.autoQuestion));
  localStorage.setItem(
    "oc_show_transcript_details",
    String(s.showTranscriptDetails),
  );
  localStorage.setItem("oc_sidebar_collapsed", String(s.sidebarCollapsed));
  if (s.sidebarWidth != null) {
    localStorage.setItem("oc_sidebar_width", String(s.sidebarWidth));
  } else {
    localStorage.removeItem("oc_sidebar_width");
  }
  if (s.sectionsWidth != null) {
    localStorage.setItem("oc_sections_width", String(s.sectionsWidth));
  } else {
    localStorage.removeItem("oc_sections_width");
  }
  localStorage.setItem("oc_opacity", String(s.opacity));
  localStorage.setItem("oc_zoom", String(s.zoom));
  localStorage.setItem("oc_theme", s.theme || DEFAULT_SETTINGS.theme);
  localStorage.setItem("oc_locale", s.locale || DEFAULT_SETTINGS.locale);
  if (s.workspaceTaskID) {
    localStorage.setItem("oc_workspace_task", s.workspaceTaskID);
  } else {
    localStorage.removeItem("oc_workspace_task");
  }
  if (s.workspaceDirectory) {
    localStorage.setItem("oc_workspace_directory", s.workspaceDirectory);
  } else {
    localStorage.removeItem("oc_workspace_directory");
  }
  if (s.directory) {
    localStorage.setItem("oc_directory", s.directory);
    localStorage.setItem("oc_directory_mode", s.directoryMode);
  } else {
    localStorage.removeItem("oc_directory");
    localStorage.removeItem("oc_directory_mode");
  }

  const invoke = (window as any).__TAURI__?.core?.invoke as
    | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  if (typeof invoke === "function") {
    void invoke("overlay_settings_save", {
      settings: bootstrapOverlaySettings(s),
    }).catch(() => undefined);
  }
}

// ── loadSettings ──
// Reads localStorage and populates the store.
// Mirrors app.js browserOverlaySettings.

export function loadSettings(): void {
  const serverUrl =
    localStorage.getItem("oc_server_url") || DEFAULT_SETTINGS.serverUrl;
  const autoServerRaw = localStorage.getItem("oc_auto_server");
  const autoServer =
    autoServerRaw === null
      ? defaultAutoServer(serverUrl)
      : autoServerRaw !== "false";
  const directory = (() => {
    const raw = localStorage.getItem("oc_directory") || "";
    return raw.trim();
  })();

  setSettingsStore({
    serverUrl,
    autoServer,
    password:
      localStorage.getItem("oc_password") || DEFAULT_SETTINGS.password,
    username:
      localStorage.getItem("oc_username") || DEFAULT_SETTINGS.username,
    executor:
      localStorage.getItem("oc_executor") || DEFAULT_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: localStorage.getItem("oc_always_on_top") === "true",
    unattended: localStorage.getItem("oc_unattended") !== "false",
    autoPermission: localStorage.getItem("oc_auto_permission") === "true",
    autoQuestion: localStorage.getItem("oc_auto_question") === "true",
    showTranscriptDetails:
      localStorage.getItem("oc_show_transcript_details") === "true",
    sidebarCollapsed:
      localStorage.getItem("oc_sidebar_collapsed") === "true",
    sidebarWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sidebar_width"),
    ),
    sectionsWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sections_width"),
    ),
    opacity: sanitizeOpacity(localStorage.getItem("oc_opacity")),
    zoom: sanitizeZoom(localStorage.getItem("oc_zoom")),
    theme: sanitizeTheme(localStorage.getItem("oc_theme")),
    locale: sanitizeLocale(
      localStorage.getItem("oc_locale") || DEFAULT_SETTINGS.locale,
    ),
    directoryMode: directory ? "custom" : "temp",
    directory,
    workspaceTaskID:
      localStorage.getItem("oc_workspace_task") ||
      DEFAULT_SETTINGS.workspaceTaskID,
    workspaceDirectory:
      localStorage.getItem("oc_workspace_directory") ||
      DEFAULT_SETTINGS.workspaceDirectory,
    // Runtime-only fields — not persisted in localStorage; reset to defaults on load.
    savedDirectory: directory,
    tempDirectory: DEFAULT_SETTINGS.tempDirectory,
    workspaceEpoch: DEFAULT_SETTINGS.workspaceEpoch,
    directoryEpoch: DEFAULT_SETTINGS.directoryEpoch,
  });
}

// ── Runtime directory setters ──
// These fields are not persisted to localStorage; they are managed by app.js
// at runtime and exposed here so Solid components can read them reactively.

export function setTempDirectory(path: string): void {
  setSettingsStore("tempDirectory", typeof path === "string" ? path : "");
}

export function setSavedDirectory(path: string): void {
  setSettingsStore("savedDirectory", typeof path === "string" ? path : "");
}

export function bumpWorkspaceEpoch(): void {
  setSettingsStore("workspaceEpoch", (n) => n + 1);
}

export function bumpDirectoryEpoch(): void {
  setSettingsStore("directoryEpoch", (n) => n + 1);
}

// ── Directory helpers ──

/**
 * Resolve whether a directory + mode combination should be stored as a
 * "custom" persisted path or discarded (returning "").
 *
 * Mirrors app.js sanitizeDirectoryMode (line 1251) and savedDirectoryValue
 * (line 1257).
 */
export function sanitizeDirectoryMode(value: any, directory: string): "custom" | "temp" {
  if (value === "custom") return "custom";
  if (typeof value === "string" && value.trim() === "temp") return "temp";
  return typeof directory === "string" && directory.trim()
    ? "custom"
    : (DEFAULT_SETTINGS.directoryMode as "custom" | "temp");
}

export function savedDirectoryValue(directory: any, mode: any): string {
  const next = typeof directory === "string" ? directory.trim() : "";
  if (!next) return "";
  return sanitizeDirectoryMode(mode, next) === "custom" ? next : "";
}

/**
 * Extract the `directory` field from a settings-like object.
 * Mirrors app.js settingsDirectory (line 1263).
 */
export function settingsDirectory(settings: Partial<OverlaySettings> | null | undefined): string {
  return typeof settings?.directory === "string" ? settings.directory.trim() : "";
}

// ── bootstrapOverlaySettings ──
//
// Serialize the current store (or a provided snapshot) back into a plain
// settings object suitable for persistence or for passing to Tauri.
// Mirrors app.js bootstrapOverlaySettings (lines 1427–1452).

export function bootstrapOverlaySettings(
  input: Partial<OverlaySettings> = settingsStore,
): Omit<OverlaySettings, "savedDirectory" | "tempDirectory" | "workspaceEpoch" | "directoryEpoch"> & {
  directory?: string;
  sidebarWidth?: number;
  sectionsWidth?: number;
  workspaceTaskID?: string;
  workspaceDirectory?: string;
} {
  return {
    serverUrl: input.serverUrl ?? DEFAULT_SETTINGS.serverUrl,
    autoServer: input.autoServer ?? DEFAULT_SETTINGS.autoServer,
    password: input.password ?? DEFAULT_SETTINGS.password,
    username: input.username ?? DEFAULT_SETTINGS.username,
    executor: input.executor ?? DEFAULT_SETTINGS.executor,
    initGit: true,
    alwaysOnTop: input.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop,
    unattended: input.unattended ?? DEFAULT_SETTINGS.unattended,
    autoPermission: input.autoPermission ?? DEFAULT_SETTINGS.autoPermission,
    autoQuestion: input.autoQuestion ?? DEFAULT_SETTINGS.autoQuestion,
    showTranscriptDetails: input.showTranscriptDetails ?? DEFAULT_SETTINGS.showTranscriptDetails,
    sidebarCollapsed: input.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth || undefined,
    sectionsWidth: input.sectionsWidth || undefined,
    opacity: input.opacity ?? DEFAULT_SETTINGS.opacity,
    zoom: input.zoom ?? DEFAULT_SETTINGS.zoom,
    theme: input.theme ?? DEFAULT_SETTINGS.theme,
    locale: input.locale ?? DEFAULT_SETTINGS.locale,
    directoryMode: input.savedDirectory ? "custom" : "temp",
    directory: input.savedDirectory || undefined,
    workspaceTaskID: input.workspaceTaskID || undefined,
    workspaceDirectory: input.workspaceDirectory || undefined,
  };
}

// ── Workspace memory helpers ──
//
// These helpers manage the workspaceTaskID / workspaceDirectory fields that
// survive a page reload (persisted to localStorage by saveSettings).
// Mirrors app.js workspaceRestoreDirectory, looksLikeExecutionWorkspace,
// rememberWorkspace, and clearWorkspaceMemory (lines 1454–1483).

/**
 * Returns true when `value` looks like a goal execution workspace path
 * (i.e. contains "goal-workspace" as a path component).
 * These paths should never be restored across sessions.
 *
 * Mirrors app.js looksLikeExecutionWorkspace (line 1467).
 */
export function looksLikeExecutionWorkspace(value: any): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(^|[\\/])goal-workspace([\\/]|$)/i.test(text);
}

/**
 * Normalise a workspace directory value for restore:
 * returns an empty string when the path is blank or looks like an
 * execution workspace.
 *
 * Mirrors app.js workspaceRestoreDirectory (line 1473).
 */
export function workspaceRestoreDirectory(value: any): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (looksLikeExecutionWorkspace(text)) return "";
  return text;
}

/**
 * Persist the current task selection + directory into the store so they can
 * be restored after a page reload.
 *
 * `input.taskID` and `input.directory` override the store values when
 * provided; otherwise the current `settingsStore` values are used.
 *
 * Mirrors app.js rememberWorkspace (line 1454).
 */
export function rememberWorkspace(
  input: { taskID?: string; directory?: string; selectedTaskID?: string } = {},
): void {
  const taskID =
    typeof input.taskID === "string"
      ? input.taskID.trim()
      : (input.selectedTaskID || settingsStore.workspaceTaskID || "").trim();

  const directory =
    workspaceRestoreDirectory(
      typeof input.directory === "string"
        ? input.directory.trim()
        : (settingsStore.savedDirectory || settingsStore.directory || "").trim(),
    ) || workspaceRestoreDirectory(settingsStore.savedDirectory || "") || "";

  setSettingsStore("workspaceTaskID", taskID);
  setSettingsStore("workspaceDirectory", taskID ? directory : "");
}

/**
 * Clear persisted workspace task/directory from the store.
 * Mirrors app.js clearWorkspaceMemory (line 1480).
 */
export function clearWorkspaceMemory(): void {
  setSettingsStore("workspaceTaskID", "");
  setSettingsStore("workspaceDirectory", "");
}

// ── Test / timing helpers ──
//
// These helpers read an optional `window.__overlayTest` config object injected
// by test runners to override timing constants.  Production code receives the
// production fallback value transparently.
//
// Mirrors app.js overlayTestConfig (line 1985) and overlayTiming (line 1990).

/**
 * Return the `window.__overlayTest` config object, or `null` when not set.
 *
 * Mirrors app.js overlayTestConfig (line 1985).
 */
export function overlayTestConfig(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const value = (window as any).__overlayTest;
  return value && typeof value === "object" ? value : null;
}

/**
 * Read a timing value from the test config by `name`.
 * When the config does not provide a finite number the `fallback` is returned.
 * The result is always at least `min` milliseconds (default 50 ms).
 *
 * Mirrors app.js overlayTiming (line 1990).
 */
export function overlayTiming(name: string, fallback: number, min = 50): number {
  const value = Number(overlayTestConfig()?.[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}
