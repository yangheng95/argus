// ── Settings Store ──
// Solid reactive store for overlay settings.

import { createStore } from "solid-js/store";
import { DEFAULT_SERVER } from "../services/api";
import { getHostTransport } from "../services/host-transport";
import { sanitizeLocale } from "../utils/i18n";

// ── Types ──

export type ToolPermAction = "allow" | "ask" | "deny";

export interface ToolPermissions {
  websearch:          ToolPermAction;
  webfetch:           ToolPermAction;
  skill:              ToolPermAction;
  external_directory: ToolPermAction;
  task:               ToolPermAction;
  schedule:           ToolPermAction;
}

export interface OverlaySettings {
  serverUrl: string;
  autoServer: boolean;
  password: string;
  username: string;
  executor: string;
  initGit: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number | null;
  sectionsWidth: number | null;
  workspacePanelHeight: number | null;
  opacity: number;
  zoom: number;
  theme: string;
  locale: string;
  /** Active working directory. Empty string means the user has not yet
   *  selected one; the UI must surface an explicit "select directory" CTA. */
  directory: string;
  workspaceTaskID: string;
  workspaceDirectory: string;
  /** Last persisted directory value; used to detect uncommitted changes and
   *  restored on next cold start by loadSettings(). */
  savedDirectory: string;
  /** Incremented each time the workspace is invalidated/reset */
  workspaceEpoch: number;
  /** Incremented each time the working directory changes */
  directoryEpoch: number;
  /** Default tool permission actions; synced from server config */
  toolPermissions: ToolPermissions;
  /** Surface task lifecycle (success / failure / cancellation / pending
   *  interaction) as an OS-level desktop notification via the standard
   *  Web Notification API. The runtime requests permission once on the
   *  first event the user opts into, then degrades silently to in-app
   *  toasts if the operator denies. Default ON because the user explicitly
   *  asked for it; can be turned off in General settings. */
  desktopNotifications: boolean;
}

// ── Sanitisers ──

function sanitizeTheme(value: any): string {
  const text = String(value || "").trim();
  return text === "light" ||
    text === "dark" ||
    text === "vscode-dark" ||
    text === "system"
    ? text
    : "dark";
}

export const MIN_WINDOW_OPACITY = 0.5;

export function sanitizeOpacity(value: any): number {
  const n = parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return 0.99;
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

export const DEFAULT_THEME = "vscode-dark";

export const DEFAULT_SETTINGS: OverlaySettings = {
  serverUrl: DEFAULT_SERVER,
  autoServer: true,
  password: "",
  username: "opencorvus",
  executor: "opencode",
  initGit: true,
  sidebarCollapsed: false,
  sidebarWidth: null,
  sectionsWidth: null,
  workspacePanelHeight: null,
  opacity: 0.99,
  zoom: 1,
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  directory: "",
  workspaceTaskID: "",
  workspaceDirectory: "",
  savedDirectory: "",
  workspaceEpoch: 0,
  directoryEpoch: 0,
  toolPermissions: {
    websearch:          "allow",
    webfetch:           "allow",
    skill:              "allow",
    external_directory: "allow",
    task:               "allow",
    schedule:           "allow",
  },
  desktopNotifications: true,
};

// ── Store ──

export const [settingsStore, setSettingsStore] =
  createStore<OverlaySettings>({ ...DEFAULT_SETTINGS });

// ── applySettings ──

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
    sidebarCollapsed: input?.sidebarCollapsed === true,
    sidebarWidth: sanitizePaneWidth(input?.sidebarWidth),
    sectionsWidth: sanitizePaneWidth(input?.sectionsWidth),
    workspacePanelHeight: sanitizePaneWidth(input?.workspacePanelHeight),
    opacity: sanitizeOpacity(input?.opacity),
    zoom: sanitizeZoom(input?.zoom),
    theme: sanitizeTheme(input?.theme),
    locale: sanitizeLocale(
      (typeof input?.locale === "string" ? input.locale : "") ||
        DEFAULT_SETTINGS.locale,
    ),
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

export function saveSettings(): void {
  const s = settingsStore;
  localStorage.setItem("oc_server_url", s.serverUrl);
  localStorage.setItem("oc_auto_server", String(s.autoServer));
  localStorage.setItem("oc_password", s.password);
  localStorage.setItem("oc_username", s.username);
  localStorage.setItem("oc_executor", s.executor || DEFAULT_SETTINGS.executor);
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
  if (s.workspacePanelHeight != null) {
    localStorage.setItem("oc_workspace_height", String(s.workspacePanelHeight));
  } else {
    localStorage.removeItem("oc_workspace_height");
  }
  localStorage.setItem("oc_opacity", String(s.opacity));
  localStorage.setItem("oc_zoom", String(s.zoom));
  localStorage.setItem("oc_theme", s.theme || DEFAULT_SETTINGS.theme);
  localStorage.setItem("oc_locale", s.locale || DEFAULT_SETTINGS.locale);
  localStorage.setItem("oc_desktop_notifications", String(s.desktopNotifications));
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
  } else {
    localStorage.removeItem("oc_directory");
  }

  // Persist via the host (Tauri stores them on disk). VS Code transport
  // throws UnsupportedNativeCommandError; we ignore that — localStorage
  // above is the source of truth for settings.
  void getHostTransport()
    .native({ kind: "settings.save", payload: bootstrapOverlaySettings(s) })
    .catch(() => undefined);
}

// ── loadSettings ──

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
    sidebarCollapsed:
      localStorage.getItem("oc_sidebar_collapsed") === "true",
    sidebarWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sidebar_width"),
    ),
    sectionsWidth: sanitizePaneWidth(
      localStorage.getItem("oc_sections_width"),
    ),
    workspacePanelHeight: sanitizePaneWidth(
      localStorage.getItem("oc_workspace_height"),
    ),
    opacity: sanitizeOpacity(localStorage.getItem("oc_opacity")),
    zoom: sanitizeZoom(localStorage.getItem("oc_zoom")),
    theme: sanitizeTheme(localStorage.getItem("oc_theme")),
    locale: sanitizeLocale(
      localStorage.getItem("oc_locale") || DEFAULT_SETTINGS.locale,
    ),
    directory,
    workspaceTaskID:
      localStorage.getItem("oc_workspace_task") ||
      DEFAULT_SETTINGS.workspaceTaskID,
    workspaceDirectory:
      localStorage.getItem("oc_workspace_directory") ||
      DEFAULT_SETTINGS.workspaceDirectory,
    savedDirectory: directory,
    workspaceEpoch: DEFAULT_SETTINGS.workspaceEpoch,
    directoryEpoch: DEFAULT_SETTINGS.directoryEpoch,
    desktopNotifications: localStorage.getItem("oc_desktop_notifications") !== "false",
  });
}

// ── Runtime setters ──

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

export function savedDirectoryValue(directory: any): string {
  const next = typeof directory === "string" ? directory.trim() : "";
  return next;
}

export function settingsDirectory(settings: Partial<OverlaySettings> | null | undefined): string {
  return typeof settings?.directory === "string" ? settings.directory.trim() : "";
}

// ── bootstrapOverlaySettings ──

export function bootstrapOverlaySettings(
  input: Partial<OverlaySettings> = settingsStore,
): Omit<OverlaySettings, "savedDirectory" | "workspaceEpoch" | "directoryEpoch" | "workspacePanelHeight"> & {
  directory?: string;
  sidebarWidth?: number;
  sectionsWidth?: number;
  workspacePanelHeight?: number;
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
    sidebarCollapsed: input.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth || undefined,
    sectionsWidth: input.sectionsWidth || undefined,
    workspacePanelHeight: input.workspacePanelHeight || undefined,
    opacity: input.opacity ?? DEFAULT_SETTINGS.opacity,
    zoom: input.zoom ?? DEFAULT_SETTINGS.zoom,
    theme: input.theme ?? DEFAULT_SETTINGS.theme,
    locale: input.locale ?? DEFAULT_SETTINGS.locale,
    directory: input.savedDirectory || undefined,
    workspaceTaskID: input.workspaceTaskID || undefined,
    workspaceDirectory: input.workspaceDirectory || undefined,
    toolPermissions: input.toolPermissions ?? DEFAULT_SETTINGS.toolPermissions,
  };
}

// ── Workspace memory helpers ──

export function looksLikeExecutionWorkspace(value: any): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(^|[\\/])goal-workspace([\\/]|$)/i.test(text);
}

export function workspaceRestoreDirectory(value: any): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (looksLikeExecutionWorkspace(text)) return "";
  return text;
}

// ── Test / timing helpers ──

export function overlayTestConfig(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const value = (window as any).__overlayTest;
  return value && typeof value === "object" ? value : null;
}

export function overlayTiming(name: string, fallback: number, min = 50): number {
  const value = Number(overlayTestConfig()?.[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}
