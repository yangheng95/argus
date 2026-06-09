// ── Connection Service ──
// Responsibilities:
// - Sync local server URL from Tauri native invoke
// - Restart local managed server via Tauri
// - Check server connection via global/health endpoint
// - Maintain a periodic connection monitor loop
// This module owns connection status and exposes typed helpers.
// Render-side effects (DOM badge updates) remain
// this module updates the Solid appStore.connectionStatus.

import { apiJson, configure as configureApi, DEFAULT_SERVER } from "./api"
import { appStore, setAppStore, setConnectionStatus } from "../store/app"
import { settingsStore, applySettings, saveSettings } from "../store/settings"
import { getHostTransport } from "./host-transport"
import { makeMonitorTick } from "./monitor-tick"
import { createVisibilityInterval, type VisibilityInterval } from "../utils/visibility-interval"
import { dismissNotification, formatErrorDetails, notifyError } from "./notify"
import { t } from "../utils/i18n"

// ── Helpers ──

const MANAGED_SERVER_NOTIFICATION_ID = "system:managed-server"

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Tauri host owns its sidecar; vscode host does not run a managed
 *  local server (the extension owns the sidecar there, not the
 *  webview). Use this whenever a code path is Tauri-specific. */
function hostOwnsLocalServer(): boolean {
  return getHostTransport().kind === "tauri"
}

function normalizeUrl(value: string | undefined, fallback: string): string {
  const input = typeof value === "string" && value.trim() ? value.trim() : fallback
  return input.replace(/\/+$/, "")
}

function isManagedLocalServerUrl(value: string): boolean {
  const input = typeof value === "string" && value.trim() ? value.trim() : settingsStore.serverUrl
  try {
    const url = new URL(input)
    return url.protocol.startsWith("http") && ["127.0.0.1", "localhost"].includes(url.hostname)
  } catch {
    return false
  }
}

function usesManagedLocalServer(): boolean {
  return settingsStore.autoServer && isManagedLocalServerUrl(settingsStore.serverUrl)
}

function errorSummary(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function sidecarLogPath(info: LocalServerInfo | null | undefined): string {
  const value = info?.sidecarLogPath
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function managedServerDetails(input: { error?: unknown; info?: LocalServerInfo | null; probeError?: unknown }): string {
  const parts: string[] = []
  if (input.info) {
    parts.push(`server url: ${input.info.url}`)
    if (typeof input.info.pid === "number") parts.push(`server pid: ${input.info.pid}`)
    const logPath = sidecarLogPath(input.info)
    if (logPath) parts.push(`sidecar log: ${logPath}`)
  }
  if (input.error !== undefined) {
    parts.push(`native error:\n${formatErrorDetails(input.error) || errorSummary(input.error)}`)
  }
  if (input.probeError !== undefined) {
    parts.push(`health probe error:\n${formatErrorDetails(input.probeError) || errorSummary(input.probeError)}`)
  }
  return parts.filter(Boolean).join("\n\n")
}

function notifyManagedServerFailure(input: {
  title?: string
  error?: unknown
  info?: LocalServerInfo | null
  probeError?: unknown
}): void {
  const summary = errorSummary(input.error ?? input.probeError ?? "unknown error")
  notifyError({
    id: MANAGED_SERVER_NOTIFICATION_ID,
    title: input.title ?? t("notify.managed_server_failed_title"),
    message: t("notify.managed_server_failed_body", { error: summary }),
    details: managedServerDetails(input),
  })
}

function clearManagedServerFailure(): void {
  dismissNotification(MANAGED_SERVER_NOTIFICATION_ID)
}

// ── Public: sync server URL from Tauri overlay_server_info ──

export interface LocalServerInfo {
  url: string
  /** PID of the spawned sidecar `bun` server process (Tauri-side child).
   *  Absent when the overlay is talking to an external server. */
  pid?: number
  [key: string]: unknown
}

/**
 * Queries Tauri for the current managed local server URL and, if it differs
 * from the stored value, persists the new URL.
 */
export async function localServerInfo(): Promise<LocalServerInfo | null> {
  if (!hostOwnsLocalServer()) return null
  try {
    const info = (await getHostTransport().native({ kind: "server.info" })) as LocalServerInfo | undefined
    if (info && typeof info.url === "string") return info
    notifyManagedServerFailure({ error: "server.info returned no managed server URL" })
    return null
  } catch (error) {
    notifyManagedServerFailure({ error })
    return null
  }
}

export interface SyncLocalServerUrlOptions {
  force?: boolean
}

/**
 * Sync the managed local server URL from Tauri.
 * Returns the server info on success, null if not applicable.
 */
export async function syncLocalServerUrl(options: SyncLocalServerUrlOptions = {}): Promise<LocalServerInfo | null> {
  if (!hostOwnsLocalServer()) return null
  if (!options.force && !usesManagedLocalServer()) return null
  const info = await localServerInfo()
  if (!info) return null
  clearManagedServerFailure()
  // Stash the sidecar PID even when the URL hasn't changed — overlay restart
  // / hot reload can land in a fresh process whose PID is the only thing
  // that's different from the in-memory app store.
  setAppStore("serverPid", typeof info.pid === "number" ? info.pid : undefined)
  const next = normalizeUrl(info.url, settingsStore.serverUrl)
  if (normalizeUrl(settingsStore.serverUrl, settingsStore.serverUrl) === next) {
    return info
  }
  // Update the settings store + persist + push to API client
  applySettings({ ...settingsStore, serverUrl: next })
  saveSettings()
  configureApi({ serverUrl: next })
  return info
}

/**
 * Restart the managed local server via Tauri.
 * Returns the new server info on success, null if not applicable.
 */
export async function restartLocalServer(): Promise<LocalServerInfo | null> {
  if (!hostOwnsLocalServer() || !usesManagedLocalServer()) return null
  let info: LocalServerInfo | undefined
  try {
    info = (await getHostTransport().native({ kind: "server.restart" })) as LocalServerInfo | undefined
  } catch (error) {
    notifyManagedServerFailure({ title: t("notify.managed_server_restart_failed_title"), error })
    return null
  }
  if (!info || typeof info.url !== "string") {
    notifyManagedServerFailure({
      title: t("notify.managed_server_restart_failed_title"),
      error: "server.restart returned no managed server URL",
    })
    return null
  }
  clearManagedServerFailure()
  setAppStore("serverPid", typeof info.pid === "number" ? info.pid : undefined)
  const next = normalizeUrl(info.url, settingsStore.serverUrl)
  applySettings({ ...settingsStore, serverUrl: next })
  saveSettings()
  configureApi({ serverUrl: next })
  return info
}

// ── Public: check connection ──

/**
 * Probe the server health endpoint.
 * server, 1 time otherwise. Updates appStore.connectionStatus.
 * Returns true when the server is reachable, false otherwise.
 */
export async function checkConnection(): Promise<boolean> {
  const managed = usesManagedLocalServer()
  let managedInfo: LocalServerInfo | null = null
  if (managed) {
    managedInfo = await syncLocalServerUrl()
  }
  setConnectionStatus("connecting")

  const attempts = managed ? 8 : 1
  let lastError: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      const health: any = await apiJson("global/health", { signal: AbortSignal.timeout(5000) })
      const paths = health?.paths
      if (
        paths &&
        typeof paths.database === "string" &&
        typeof paths.data === "string" &&
        typeof paths.home === "string"
      ) {
        setAppStore("enginePaths", { database: paths.database, data: paths.data, home: paths.home })
      }
      setConnectionStatus("online")
      clearManagedServerFailure()
      return true
    } catch (e) {
      lastError = e
      if (i >= attempts - 1) break
      await wait(350)
      managedInfo = await syncLocalServerUrl()
    }
  }

  setConnectionStatus("offline")
  console.warn("[connection] connection failed", String(lastError))
  if (managed) {
    notifyManagedServerFailure({ info: managedInfo, probeError: lastError })
  }
  return false
}

// ── Connection monitor ──

let _monitorTimer: VisibilityInterval | null = null

/**
 * Start a periodic connection monitor that attempts reconnection every 10 s
 * when the overlay is offline. Safe to call multiple times — stops any
 * previously running monitor first.
 * On successful reconnect the caller is responsible for reloading data; this
 * function only updates the connection status store. In the current
 * migration phase the () owns the reconnect data-loading
 * side-effects; this function drives the Solid store status signal.
 */
export function startConnectionMonitor(onReconnect?: () => void | Promise<void>, intervalMs = 10_000): void {
  stopConnectionMonitor()
  // audit-2026-04-29 W2-V24 — re-entrance-guarded tick lives in
  // services/monitor-tick.ts so the no-overlap contract is
  // testable.
  const tick = makeMonitorTick({
    isHidden: () => typeof document !== "undefined" && document.hidden,
    isConnected: () => appStore.connected,
    check: () => checkConnection(),
    onReconnect,
  })
  _monitorTimer = createVisibilityInterval(tick, intervalMs)
  _monitorTimer.start()
}

/**
 * Stop the connection monitor loop.
 * Safe to call even when no monitor is running.
 */
export function stopConnectionMonitor(): void {
  if (_monitorTimer !== null) {
    _monitorTimer.dispose()
    _monitorTimer = null
  }
}

// ── resolveAutoServer ──

function defaultAutoServer(url: string): boolean {
  return !url || url === DEFAULT_SERVER
}

/**
 * Determine whether `autoServer` should be enabled for the given URL.
 * When `previous.autoServer` is true and `value` normalises to the same URL
 * that was previously saved, the previous preference is preserved. Otherwise
 * `autoServer` defaults to true only for the loopback / default server address.
 */
export function resolveAutoServer(value: string, previous: { autoServer?: boolean; serverUrl?: string } = {}): boolean {
  const next = normalizeUrl(value, DEFAULT_SERVER)
  if (previous.autoServer && next === normalizeUrl(previous.serverUrl ?? "", DEFAULT_SERVER)) {
    return true
  }
  return defaultAutoServer(next)
}
