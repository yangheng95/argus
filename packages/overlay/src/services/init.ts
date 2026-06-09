// ── Init Service ──
// Application startup sequence:
// - Load overlay settings from the active host persistence source
// - Load i18n locale data
// - Configure the API client
// - Check server connection
// - Load initial board / tasks / meta / config / executors
// - Restore last workspace
// - Set up a periodic reconnect loop

import { configure as configureApi, apiJsonWithTimeout } from "./api"
import { installComposerAttachSubscription } from "./composer-attach"
import { checkConnection as checkServerConnection, startConnectionMonitor, stopConnectionMonitor } from "./connection"
import { startTaskListSSE, stopTaskListSSE } from "./sse"
import { loadAllLocales, setLocale } from "../utils/i18n"
import {
  loadSettings,
  settingsStore,
  setSettingsStore,
  saveSettings,
  bumpDirectoryEpoch,
  bumpWorkspaceEpoch,
  DEFAULT_SETTINGS,
  type ToolPermissions,
} from "../store/settings"
import { appStore, setAppStore } from "../store/app"
import { boardStore, setBoardStore, loadTasks, clearTasksForMissingDirectory, activeTaskID } from "../store/board"
import { dialogStore } from "../store/dialog"
import { loadMeta } from "./meta"
import { loadExtensions } from "./extensions"
import { loadExecutors } from "./executor"
import { ensureWorkspaceDirectory } from "./workspace"
import { ensureDefaultDirectory } from "./workspace"
import { workspaceRestoreDirectory } from "../store/settings"
import { selectTask } from "./task"
import { installHostThemeHandshakeSubscription } from "./host-theme-handshake"

// ── Types ──

export interface InitOptions {
  /**
   * Called once the initial connection check succeeds so the caller can
   * trigger any render-side updates that depend on live data.
   */
  onConnected?: () => void | Promise<void>
  /**
   * Called after settings are loaded into settingsStore, before API, locale,
   * connection, and data initialization continue.
   */
  onSettingsLoaded?: () => void | Promise<void>
  /**
   * Called on every successful reconnect (after an offline period).
   */
  onReconnect?: () => void | Promise<void>
  /**
   * Reconnect poll interval in ms. Defaults to 10 000 (10 s).
   */
  reconnectInterval?: number
}

/**
 * Push current settings into the API client so subsequent fetch calls use
 * the correct server URL and credentials.
 * Push current settings into the API client.
 */
function syncApiConfig(): void {
  configureApi({
    serverUrl: settingsStore.serverUrl,
    username: settingsStore.username,
    password: settingsStore.password,
    directory: settingsStore.directory,
  })
}

/**
 * Load all initial data that requires a live server connection.
 * Load all initial data in parallel after connection is established.
 */
async function loadInitialData(): Promise<boolean> {
  // Let-it-crash: init-time failures must not be swallowed, otherwise the
  // UI boots into an inconsistent state (e.g. directory unset but tasks loaded
  // against a stale cwd). Errors propagate to initApp's caller which decides
  // how to surface them.
  await ensureDefaultDirectory()
  const directory = await ensureWorkspaceDirectory()
  syncApiConfig()
  if (!directory) {
    clearTasksForMissingDirectory()
    setBoardStore({
      board: null,
      path: null,
      vcs: null,
      changes: [],
    })
    return false
  }
  await apiJsonWithTimeout("config", CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: settingsStore.locale }),
  })
  await Promise.all([
    loadTasks(),
    loadMeta(),
    loadExtensions(),
    loadConfigInfo(CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS, {
      includeSettingsData: false,
    }),
    loadExecutors(),
  ])
  return true
}

// ── Public API ──

/**
 * Initialise the Solid overlay layer.
 * Call order:
 * 1. Load settings from the active host persistence source
 * 2. Apply settings to API client
 * 3. Load i18n (all supported locales)
 * 4. Apply locale from settings
 * 5. Check server connection
 * 6. If connected: load board + tasks, call onConnected
 * 7. Start periodic reconnect loop
 */
export async function initApp(options: InitOptions = {}): Promise<void> {
  const { onConnected, onSettingsLoaded, onReconnect, reconnectInterval = 10_000 } = options

  // 0. Install host → webview ui-command subscriptions (composer.attach
  //    from VS Code "Attach Current File"; no-op in Tauri). Done first so
  //    early host messages — e.g. an attach fired before the user even
  //    saw the panel — still land on the chat composer (plan §19.2.6).
  installComposerAttachSubscription()
  installHostThemeHandshakeSubscription()

  // 1. Load settings into the Solid store
  await loadSettings()
  await onSettingsLoaded?.()

  // 2. Push settings into the API client (server URL + auth)
  syncApiConfig()

  // 3. Load i18n locale bundles
  await loadAllLocales()

  // 4. Apply locale from settings
  await setLocale(settingsStore.locale)

  // 5. Check connection
  const connected = await checkServerConnection()

  if (connected) {
    // 6. Load initial data
    const loaded = await loadInitialData()
    if (loaded) await restoreInitialWorkspace()
    await onConnected?.()
    if (loaded) startTaskListSSE()
  }

  // 7. Start reconnect loop
  stopConnectionMonitor()
  startConnectionMonitor(async () => {
    syncApiConfig()
    const loaded = await loadInitialData()
    if (loaded) await restoreInitialWorkspace()
    await onReconnect?.()
    if (loaded) startTaskListSSE()
  }, reconnectInterval)
}

/**
 * Tear down the reconnect loop.
 * Call on `beforeunload` or component cleanup.
 */
export function teardownApp(): void {
  stopConnectionMonitor()
  stopTaskListSSE()
}

/**
 * Persist current settings through the active host and re-apply the API client.
 * Thin wrapper so callers don't need to import from multiple modules.
 */
export function persistAndSyncSettings(): void {
  saveSettings()
  syncApiConfig()
}

// ── Config loading ──

const CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS = 20_000
let configInfoLoadSequence = 0

export interface LoadConfigInfoOptions {
  includeSettingsData?: boolean
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function settledValue<T>(key: string, result: PromiseSettledResult<T>, fallback: T, errors: Record<string, string>): T {
  if (result.status === "fulfilled") return result.value
  errors[key] = loadErrorMessage(result.reason)
  return fallback
}

function providerInfoRequests(timeoutMilliseconds: number) {
  return [
    apiJsonWithTimeout("provider", timeoutMilliseconds),
    apiJsonWithTimeout("provider/auth", timeoutMilliseconds),
  ] as const
}

function settledProviderInfo(
  catalogResult: PromiseSettledResult<unknown>,
  authResult: PromiseSettledResult<unknown>,
  errors: Record<string, string>,
): { catalog: unknown; auth: unknown } {
  return {
    catalog: settledValue("provider", catalogResult, appStore.providerCatalog ?? null, errors),
    auth: settledValue("provider/auth", authResult, appStore.providerAuth ?? null, errors),
  }
}

/**
 * Load server-side config and channel data into the Solid stores.
 * Settings-only data is opt-in so cold start does not parse provider catalogs
 * or prompt definitions before the corresponding UI is visible.
 */
export async function loadConfigInfo(
  timeoutMilliseconds = CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS,
  options: LoadConfigInfoOptions = {},
): Promise<void> {
  const loadSequence = ++configInfoLoadSequence
  const includeSettingsData = options.includeSettingsData === true
  try {
    const configRequest = apiJsonWithTimeout("config", timeoutMilliseconds)
    const channelsRequest = apiJsonWithTimeout("channel", timeoutMilliseconds)
    const settingsRequests = includeSettingsData
      ? ([
          ...providerInfoRequests(timeoutMilliseconds),
          apiJsonWithTimeout("config/prompt", timeoutMilliseconds),
        ] as const)
      : ([] as const)
    const [configResult, channelsResult, ...settingsResults] = await Promise.allSettled([
      configRequest,
      channelsRequest,
      ...settingsRequests,
    ])
    const errors: Record<string, string> = {}
    const config = settledValue("config", configResult, appStore.config ?? null, errors)
    const channels = settledValue(
      "channel",
      channelsResult,
      Array.isArray(appStore.channels) ? appStore.channels : [],
      errors,
    )
    const providerInfo = includeSettingsData
      ? settledProviderInfo(settingsResults[0], settingsResults[1], errors)
      : { catalog: appStore.providerCatalog, auth: appStore.providerAuth }
    const prompts = includeSettingsData
      ? settledValue(
          "config/prompt",
          settingsResults[2],
          Array.isArray(appStore.promptEntries) ? appStore.promptEntries : [],
          errors,
        )
      : appStore.promptEntries
    if (Object.keys(errors).length > 0) {
      console.warn("[init] loadConfigInfo partial failure", errors)
    }

    if (loadSequence !== configInfoLoadSequence) return

    // Push into appStore
    setAppStore({
      config: config ?? null,
      providerCatalog: providerInfo.catalog ?? null,
      providerAuth: providerInfo.auth ?? null,
      configLoadErrors: errors,
      channels: Array.isArray(channels) ? channels : [],
      promptEntries: Array.isArray(prompts) ? prompts : [],
    })

    // Sync tool_permissions from server config into settingsStore.
    const remoteTP = (config as any)?.tool_permissions
    if (remoteTP && typeof remoteTP === "object") {
      const def = DEFAULT_SETTINGS.toolPermissions
      const merged: ToolPermissions = {
        websearch: remoteTP.websearch ?? def.websearch,
        webfetch: remoteTP.webfetch ?? def.webfetch,
        skill: remoteTP.skill ?? def.skill,
        external_directory: remoteTP.external_directory ?? def.external_directory,
        task: remoteTP.task ?? def.task,
        schedule: remoteTP.schedule ?? def.schedule,
      }
      setSettingsStore("toolPermissions", merged)
    }
  } catch (e) {
    if (loadSequence !== configInfoLoadSequence) return
    console.warn("[init] loadConfigInfo failed", e)
    setAppStore("configLoadErrors", { loadConfigInfo: loadErrorMessage(e) })
  }
}

export async function loadProviderInfo(timeoutMilliseconds = CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS): Promise<void> {
  const [catalogResult, authResult] = await Promise.allSettled(providerInfoRequests(timeoutMilliseconds))
  const errors: Record<string, string> = {}
  const providerInfo = settledProviderInfo(catalogResult, authResult, errors)
  if (Object.keys(errors).length > 0) {
    console.warn("[init] loadProviderInfo partial failure", errors)
  }
  setAppStore({
    providerCatalog: providerInfo.catalog ?? null,
    providerAuth: providerInfo.auth ?? null,
    configLoadErrors: errors,
  })
}

export async function loadSettingsInfo(timeoutMilliseconds = CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS): Promise<void> {
  await loadConfigInfo(timeoutMilliseconds, { includeSettingsData: true })
}

export function configRefreshIncludesSettingsData(): boolean {
  return dialogStore.config.open
}

// ── Workspace restoration ──

const RESTORABLE_RUNNING_TASK_STATUSES = new Set(["active", "queued"])

function taskIDFromItem(item: any): string {
  const id = item?.task?.id ?? item?.id
  return typeof id === "string" ? id.trim() : ""
}

function taskStatusFromItem(item: any): string {
  const status = item?.task?.status ?? item?.status
  return typeof status === "string" ? status.trim() : ""
}

export function initialRestoreTaskID(
  tasks: any[],
  savedTaskID: string,
  options: { selectRunningWhenUnmatched?: boolean } = {},
): string {
  const list = Array.isArray(tasks) ? tasks : []
  const saved = typeof savedTaskID === "string" ? savedTaskID.trim() : ""
  if (saved && list.some((item: any) => taskIDFromItem(item) === saved)) {
    return saved
  }
  if (options.selectRunningWhenUnmatched === false) return ""
  const running = list.find((item: any) => RESTORABLE_RUNNING_TASK_STATUSES.has(taskStatusFromItem(item)))
  return taskIDFromItem(running)
}

/**
 * Restore the last workspace state (task selection + directory) that was
 * persisted to settings before the overlay was last closed.
 * Returns true when a task was successfully re-selected, false otherwise.
 */
export async function restoreInitialWorkspace(): Promise<boolean> {
  const { workspaceTaskID, workspaceDirectory, directory: activeDir } = settingsStore
  const tasks = boardStore.tasks

  // Skip if a workspace selection is already in progress (epoch > 0).
  if (settingsStore.workspaceEpoch > 0) return false

  const base = activeDir || ""
  const directory = workspaceRestoreDirectory(workspaceDirectory || "")
  const moved = !!directory && !!base && directory !== base

  if (moved) {
    // Reflect directory change so reactive components see the updated value.
    setSettingsStore("directory", directory)
    syncApiConfig()
    bumpDirectoryEpoch()
  }

  const taskID = initialRestoreTaskID(tasks, workspaceTaskID || "", { selectRunningWhenUnmatched: !moved })

  if (taskID) {
    if (activeTaskID() !== taskID || !boardStore.board) {
      await selectTask(taskID)
    }
    // body.dataset.workspace/connection is updated reactively by main.tsx createEffect.
    bumpWorkspaceEpoch()
    return true
  }

  if (moved) {
    // Could not find the task — roll back the directory change.
    setSettingsStore("directory", base)
    syncApiConfig()
    bumpDirectoryEpoch()
  }

  if ((workspaceTaskID || "").trim() || boardStore.selectedSource?.kind === "task" || boardStore.board?.task) {
    await selectTask("")
  }
  return false
}
