// ── Settings Store ──
// Solid reactive store for overlay settings.

import { createStore } from "solid-js/store"
import { DEFAULT_SERVER } from "../services/default-server"
import { PROJECT_EDITOR_IDS, getHostTransport, type ProjectEditorID } from "../services/host-transport"
import { requireInitialVsCodeHostTheme } from "../services/host-theme"
import { DEFAULT_THEME_ID, sanitizeThemeForHost } from "../services/theme-registry"
import { sanitizeLocale } from "../utils/i18n"

// ── Types ──

export type ToolPermAction = "allow" | "ask" | "deny"
export type ExecutorID = "opencorvus" | "codex" | "claude-code"

export interface ToolPermissions {
  websearch: ToolPermAction
  webfetch: ToolPermAction
  skill: ToolPermAction
  external_directory: ToolPermAction
  task: ToolPermAction
  schedule: ToolPermAction
}

export interface OverlaySettings {
  serverUrl: string
  autoServer: boolean
  password: string
  username: string
  executor: ExecutorID
  projectEditor: ProjectEditorID
  initGit: boolean
  sidebarCollapsed: boolean
  sidebarWidth: number | null
  centerWorkbenchPanelWeights: Record<string, number> | null
  zoom: number
  theme: string
  locale: string
  /** Active working directory. Empty string means the user has not yet
   *  selected one; the UI must surface an explicit "select directory" CTA. */
  directory: string
  workspaceTaskID: string
  workspaceDirectory: string
  /** Last persisted directory value; used to detect uncommitted changes and
   *  restored on next cold start by loadSettings(). */
  savedDirectory: string
  /** Preferred IDE used by the workspace launcher and file-link open actions. */
  preferredProjectEditor: ProjectEditorID
  /** Incremented each time the workspace is invalidated/reset */
  workspaceEpoch: number
  /** Incremented each time the working directory changes */
  directoryEpoch: number
  /** Default tool permission actions; synced from server config */
  toolPermissions: ToolPermissions
  /** Surface task lifecycle (success / failure / cancellation / pending
   *  interaction) as an OS-level desktop notification. Tauri acceptance uses
   *  the native notification plugin; browser dev mode uses the Web
   *  Notification API after the Settings gesture grants permission. Default
   *  ON because the user explicitly asked for it; can be turned off in
   *  General settings. */
  desktopNotifications: boolean
}

// ── Sanitisers ──

function sanitizeTheme(value: any): string {
  return sanitizeThemeForHost(value)
}

function settingsTheme(input: Partial<OverlaySettings>): string {
  if (typeof input?.theme === "string" && input.theme.trim()) {
    return sanitizeTheme(input.theme)
  }
  if (getHostTransport().kind === "vscode") {
    return requireInitialVsCodeHostTheme()
  }
  return DEFAULT_SETTINGS.theme
}

function sanitizeZoom(value: any): number {
  const n = parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return 1
  return Math.min(1.6, Math.max(0.8, n))
}

function sanitizePaneWidth(value: any): number | null {
  const n = parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function sanitizePanelWeights(value: any): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value)
    .map(([key, raw]) => {
      const weight = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""))
      return [key, weight] as const
    })
    .filter(([key, weight]) => key.length > 0 && Number.isFinite(weight) && weight > 0)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function defaultAutoServer(url: string): boolean {
  return !url || url === DEFAULT_SERVER
}

function sanitizeAutoServer(value: any, serverUrl: string): boolean {
  if (value === true || value === false) return value
  return defaultAutoServer(serverUrl)
}

export function sanitizeExecutor(value: any): ExecutorID {
  const text = String(value || "").trim()
  if (!text) return DEFAULT_SETTINGS.executor
  if (text === "opencorvus" || text === "codex" || text === "claude-code") return text
  throw new Error(`invalid executor id: ${text}`)
}

export function sanitizeProjectEditor(value: any): ProjectEditorID {
  const text = String(value || "").trim()
  return PROJECT_EDITOR_IDS.includes(text as ProjectEditorID) ? (text as ProjectEditorID) : "vscode"
}

// ── Default locale ──

const DEFAULT_LOCALE = "en-US"

// ── Defaults ──

export const DEFAULT_THEME = DEFAULT_THEME_ID

export const DEFAULT_SETTINGS: OverlaySettings = {
  serverUrl: DEFAULT_SERVER,
  autoServer: true,
  password: "",
  username: "opencorvus",
  executor: "opencorvus",
  projectEditor: "vscode",
  initGit: true,
  sidebarCollapsed: false,
  sidebarWidth: null,
  centerWorkbenchPanelWeights: null,
  zoom: 1,
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  directory: "",
  workspaceTaskID: "",
  workspaceDirectory: "",
  savedDirectory: "",
  preferredProjectEditor: "vscode",
  workspaceEpoch: 0,
  directoryEpoch: 0,
  toolPermissions: {
    websearch: "allow",
    webfetch: "allow",
    skill: "allow",
    external_directory: "allow",
    task: "allow",
    schedule: "allow",
  },
  desktopNotifications: true,
}

// ── Store ──

export const [settingsStore, setSettingsStore] = createStore<OverlaySettings>({ ...DEFAULT_SETTINGS })

// ── applySettings ──

export function applySettings(input: Partial<OverlaySettings>): void {
  const nativeInput = input as Partial<OverlaySettings> & {
    workspaceTaskId?: unknown
  }
  const canonicalWorkspaceTaskID = typeof input?.workspaceTaskID === "string" ? input.workspaceTaskID.trim() : ""
  const workspaceTaskID = canonicalWorkspaceTaskID
    ? canonicalWorkspaceTaskID
    : typeof nativeInput?.workspaceTaskId === "string"
      ? nativeInput.workspaceTaskId.trim()
      : DEFAULT_SETTINGS.workspaceTaskID
  const serverUrl =
    typeof input?.serverUrl === "string" && input.serverUrl.trim() ? input.serverUrl.trim() : DEFAULT_SETTINGS.serverUrl

  setSettingsStore({
    serverUrl,
    autoServer: sanitizeAutoServer(input?.autoServer, serverUrl),
    password: typeof input?.password === "string" ? input.password : DEFAULT_SETTINGS.password,
    username:
      typeof input?.username === "string" && input.username.trim() ? input.username.trim() : DEFAULT_SETTINGS.username,
    executor: sanitizeExecutor(input?.executor),
    projectEditor: sanitizeProjectEditor(input?.projectEditor),
    initGit: true,
    sidebarCollapsed:
      typeof input?.sidebarCollapsed === "boolean" ? input.sidebarCollapsed : DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: sanitizePaneWidth(input?.sidebarWidth),
    centerWorkbenchPanelWeights: sanitizePanelWeights(input?.centerWorkbenchPanelWeights),
    zoom: sanitizeZoom(input?.zoom),
    theme: settingsTheme(input ?? {}),
    locale: sanitizeLocale((typeof input?.locale === "string" ? input.locale : "") || DEFAULT_SETTINGS.locale),
    directory: typeof input?.directory === "string" ? input.directory.trim() : "",
    workspaceTaskID,
    workspaceDirectory:
      typeof input?.workspaceDirectory === "string"
        ? input.workspaceDirectory.trim()
        : DEFAULT_SETTINGS.workspaceDirectory,
    preferredProjectEditor: sanitizeProjectEditor((input as any)?.preferredProjectEditor),
    desktopNotifications: input?.desktopNotifications !== false,
  })
}

// ── saveSettings ──

export async function saveSettings(): Promise<void> {
  const s = settingsStore
  const saved = await getHostTransport().native({ kind: "settings.save", payload: bootstrapOverlaySettings(s) })
  if (saved !== true) throw new Error("settings.save did not confirm persistence")
}

// ── loadSettings ──

export async function loadSettings(): Promise<void> {
  const persisted = await getHostTransport().native({ kind: "settings.load" })
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    applySettings(persisted as Partial<OverlaySettings>)
    setSavedDirectory(savedDirectoryValue((persisted as Partial<OverlaySettings>).directory))
    return
  }
  if (persisted !== null && persisted !== undefined) {
    throw new Error("settings.load returned a non-object payload")
  }
  applySettings({ ...DEFAULT_SETTINGS })
  setSavedDirectory(DEFAULT_SETTINGS.savedDirectory)
}

// ── Runtime setters ──

export function setSavedDirectory(path: string): void {
  setSettingsStore("savedDirectory", typeof path === "string" ? path : "")
}

export function bumpWorkspaceEpoch(): void {
  setSettingsStore("workspaceEpoch", (n) => n + 1)
}

export function bumpDirectoryEpoch(): void {
  setSettingsStore("directoryEpoch", (n) => n + 1)
}

// ── Directory helpers ──

export function savedDirectoryValue(directory: any): string {
  const next = typeof directory === "string" ? directory.trim() : ""
  return next
}

export function settingsDirectory(settings: Partial<OverlaySettings> | null | undefined): string {
  return typeof settings?.directory === "string" ? settings.directory.trim() : ""
}

// ── bootstrapOverlaySettings ──

export function bootstrapOverlaySettings(input: Partial<OverlaySettings> = settingsStore): Omit<
  OverlaySettings,
  "savedDirectory" | "workspaceEpoch" | "directoryEpoch" | "toolPermissions"
> & {
  directory?: string
  sidebarWidth?: number
  centerWorkbenchPanelWeights?: Record<string, number>
  preferredProjectEditor?: ProjectEditorID
  workspaceTaskID?: string
  workspaceTaskId?: string
  workspaceDirectory?: string
} {
  const workspaceTaskID = input.workspaceTaskID || undefined
  return {
    serverUrl: input.serverUrl ?? DEFAULT_SETTINGS.serverUrl,
    autoServer: input.autoServer ?? DEFAULT_SETTINGS.autoServer,
    password: input.password ?? DEFAULT_SETTINGS.password,
    username: input.username ?? DEFAULT_SETTINGS.username,
    executor: sanitizeExecutor(input.executor),
    projectEditor: sanitizeProjectEditor(input.projectEditor),
    initGit: true,
    sidebarCollapsed: input.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: input.sidebarWidth || undefined,
    centerWorkbenchPanelWeights: input.centerWorkbenchPanelWeights || undefined,
    zoom: input.zoom ?? DEFAULT_SETTINGS.zoom,
    theme: input.theme ?? DEFAULT_SETTINGS.theme,
    locale: input.locale ?? DEFAULT_SETTINGS.locale,
    desktopNotifications: input.desktopNotifications ?? DEFAULT_SETTINGS.desktopNotifications,
    directory: input.savedDirectory || undefined,
    preferredProjectEditor: sanitizeProjectEditor(input.preferredProjectEditor),
    workspaceTaskID,
    workspaceTaskId: workspaceTaskID,
    workspaceDirectory: input.workspaceDirectory || undefined,
  }
}

// ── Workspace memory helpers ──

export function looksLikeExecutionWorkspace(value: any): boolean {
  const text = String(value || "").trim()
  if (!text) return false
  return /(^|[\\/])goal-workspace([\\/]|$)/i.test(text)
}

export function workspaceRestoreDirectory(value: any): string {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) return ""
  if (looksLikeExecutionWorkspace(text)) return ""
  return text
}

// ── Test / timing helpers ──

export function overlayTestConfig(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null
  const value = (window as any).__overlayTest
  return value && typeof value === "object" ? value : null
}

export function overlayTiming(name: string, defaultValue: number, min = 50): number {
  const value = Number(overlayTestConfig()?.[name])
  if (!Number.isFinite(value)) return defaultValue
  return Math.max(min, Math.floor(value))
}
