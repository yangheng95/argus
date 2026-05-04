// ── Init Service ──
// Application startup sequence:
// - Load overlay settings from localStorage (+ Tauri native store)
// - Load i18n locale data
// - Configure the API client
// - Check server connection
// - Load initial board / tasks / meta / config / executors
// - Restore last workspace
// - Set up a periodic reconnect loop

import { configure as configureApi, apiJsonWithTimeout } from "./api";
import { getHostTransport } from "./host-transport";
import { installComposerAttachSubscription } from "./composer-attach";
import {
  checkConnection as checkServerConnection,
  startConnectionMonitor,
  stopConnectionMonitor,
} from "./connection";
import { startTaskListSSE, stopTaskListSSE } from "./sse";
import { loadAllLocales, setLocale } from "../utils/i18n";
import {
  loadSettings,
  settingsStore,
  setSettingsStore,
  saveSettings,
  bumpDirectoryEpoch,
  bumpWorkspaceEpoch,
  applySettings,
  setSavedDirectory,
  savedDirectoryValue,
  DEFAULT_SETTINGS,
  type ToolPermissions,
} from "../store/settings";
import { appStore, setAppStore } from "../store/app";
import { boardStore, setBoardStore, loadTasks, clearTasksForMissingDirectory } from "../store/board";
import { loadMeta } from "./meta";
import { loadExtensions } from "./extensions";
import { loadExecutors } from "./executor";
import { ensureWorkspaceDirectory } from "./workspace";
import { ensureDefaultDirectory } from "./workspace";
import { workspaceRestoreDirectory } from "../store/settings";
import { selectTask } from "./task";

// ── Types ──

export interface InitOptions {
  /**
 * Called once the initial connection check succeeds so the caller can
 * trigger any render-side updates that depend on live data.
 */
  onConnected?: () => void | Promise<void>;
  /**
 * Called on every successful reconnect (after an offline period).
 */
  onReconnect?: () => void | Promise<void>;
  /**
 * Reconnect poll interval in ms. Defaults to 10 000 (10 s).
 */
  reconnectInterval?: number;
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
  });
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
  await ensureDefaultDirectory();
  const directory = await ensureWorkspaceDirectory();
  syncApiConfig();
  if (!directory) {
    clearTasksForMissingDirectory();
    setBoardStore({
      board: null,
      path: null,
      vcs: null,
      changes: [],
    });
    return false;
  }
  await Promise.all([
    loadTasks(),
    loadMeta(),
    loadExtensions(),
    loadConfigInfo(),
    loadExecutors(),
  ]);
  return true;
}

// ── Public API ──

/**
 * Initialise the Solid overlay layer.
 * Call order:
 * 1. Load settings from localStorage
 * 2. Apply settings to API client
 * 3. Load i18n (all supported locales)
 * 4. Apply locale from settings
 * 5. Check server connection
 * 6. If connected: load board + tasks, call onConnected
 * 7. Start periodic reconnect loop
 */
export async function initApp(options: InitOptions = {}): Promise<void> {
  const {
    onConnected,
    onReconnect,
    reconnectInterval = 10_000,
  } = options;

 // 0. Install host → webview ui-command subscriptions (composer.attach
 //    from VS Code "Attach Current File"; no-op in Tauri). Done first so
 //    early host messages — e.g. an attach fired before the user even
 //    saw the panel — still land on the chat composer (plan §19.2.6).
  installComposerAttachSubscription();

 // 1. Load settings from localStorage into the Solid store
  loadSettings();

 // Note (W2-V34): a previous version called primeNotificationPermission()
 // at this point to "warm up" the desktop-notification permission. WebKit
 // (darwin / Tauri WKWebView) requires Notification.requestPermission() to
 // be called from inside a user gesture; calling it during init triggered
 // "Notification prompting can only be done from a user gesture" and
 // turned the permission state to "denied" with no prompt shown — which
 // could only be reverted by the user diving into System Settings.
 // Permission is now requested only on a real user gesture: the toggle
 // in components/settings/GeneralPanel.tsx invokes
 // requestNotificationPermission() inside the click handler. The lifecycle
 // event path in services/notify.ts no longer prompts; it reads the
 // current Notification.permission and degrades quietly if "default" or
 // "denied".

  // Try to load host-persisted settings (Tauri stores them on disk;
  // VS Code transport will throw UnsupportedNativeCommandError, in
  // which case we just keep the localStorage-loaded values from
  // step 1).
  try {
    const nativeSettings = await getHostTransport().native({ kind: "settings.load" });
    if (nativeSettings && typeof nativeSettings === "object" && !Array.isArray(nativeSettings)) {
      applySettings(nativeSettings as any);
      setSavedDirectory(savedDirectoryValue((nativeSettings as any).directory));
    }
  } catch {
    // Host doesn't support disk-backed settings — settings.load is a
    // best-effort enhancement. localStorage is the source of truth.
  }

 // 2. Push settings into the API client (server URL + auth)
  syncApiConfig();

 // 3. Load i18n locale bundles
  await loadAllLocales();

 // 4. Apply locale from settings
  await setLocale(settingsStore.locale);

 // 5. Check connection
  const connected = await checkServerConnection();

  if (connected) {
 // 6. Load initial data
    const loaded = await loadInitialData();
    if (loaded) await restoreInitialWorkspace();
    await onConnected?.();
    if (loaded) startTaskListSSE();
  }

 // 7. Start reconnect loop
  stopConnectionMonitor();
  startConnectionMonitor(async () => {
    syncApiConfig();
    const loaded = await loadInitialData();
    if (loaded) await restoreInitialWorkspace();
    await onReconnect?.();
    if (loaded) startTaskListSSE();
  }, reconnectInterval);
}

/**
 * Tear down the reconnect loop.
 * Call on `beforeunload` or component cleanup.
 */
export function teardownApp(): void {
  stopConnectionMonitor();
  stopTaskListSSE();
}

/**
 * Persist current settings to localStorage and re-apply to the API client.
 * Thin wrapper so callers don't need to import from multiple modules.
 */
export function persistAndSyncSettings(): void {
  saveSettings();
  syncApiConfig();
}

// ── Config loading ──

const CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS = 20_000;
let configInfoLoadSequence = 0;

function loadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function settledValue<T>(
  key: string,
  result: PromiseSettledResult<T>,
  fallback: T,
  errors: Record<string, string>,
): T {
  if (result.status === "fulfilled") return result.value;
  errors[key] = loadErrorMessage(result.reason);
  return fallback;
}

/**
 * Load server-side config, provider catalog, provider auth, channel list and
 * prompt entries from the API, then push everything into the Solid stores.
 * Pushes config, provider, channel, and prompt data into the Solid stores.
 */
export async function loadConfigInfo(
  timeoutMilliseconds = CONFIG_INFO_LOAD_TIMEOUT_MILLISECONDS,
): Promise<void> {
  const loadSequence = ++configInfoLoadSequence;
  try {
    const [configResult, catalogResult, authResult, channelsResult, promptsResult] = await Promise.allSettled([
      apiJsonWithTimeout("config", timeoutMilliseconds),
      apiJsonWithTimeout("provider", timeoutMilliseconds),
      apiJsonWithTimeout("provider/auth", timeoutMilliseconds),
      apiJsonWithTimeout("channel", timeoutMilliseconds),
      apiJsonWithTimeout("config/prompt", timeoutMilliseconds),
    ]);
    const errors: Record<string, string> = {};
    const config = settledValue("config", configResult, appStore.config ?? null, errors);
    const catalog = settledValue("provider", catalogResult, appStore.providerCatalog ?? null, errors);
    const auth = settledValue("provider/auth", authResult, appStore.providerAuth ?? null, errors);
    const channels = settledValue(
      "channel",
      channelsResult,
      Array.isArray(appStore.channels) ? appStore.channels : [],
      errors,
    );
    const prompts = settledValue(
      "config/prompt",
      promptsResult,
      Array.isArray(appStore.promptEntries) ? appStore.promptEntries : [],
      errors,
    );
    if (Object.keys(errors).length > 0) {
      console.warn("[init] loadConfigInfo partial failure", errors);
    }

    if (loadSequence !== configInfoLoadSequence) return;

    // Push into appStore
    setAppStore({
      config: config ?? null,
      providerCatalog: catalog ?? null,
      providerAuth: auth ?? null,
      configLoadErrors: errors,
      channels: Array.isArray(channels) ? channels : [],
      promptEntries: Array.isArray(prompts) ? prompts : [],
    });

 // Sync tool_permissions from server config into settingsStore.
    const remoteTP = (config as any)?.tool_permissions;
    if (remoteTP && typeof remoteTP === "object") {
      const def = DEFAULT_SETTINGS.toolPermissions;
      const merged: ToolPermissions = {
        websearch:          remoteTP.websearch          ?? def.websearch,
        webfetch:           remoteTP.webfetch           ?? def.webfetch,
        skill:              remoteTP.skill              ?? def.skill,
        external_directory: remoteTP.external_directory ?? def.external_directory,
        task:               remoteTP.task               ?? def.task,
        schedule:           remoteTP.schedule           ?? def.schedule,
      };
      setSettingsStore("toolPermissions", merged);
    }
  } catch (e) {
    if (loadSequence !== configInfoLoadSequence) return;
    console.warn("[init] loadConfigInfo failed", e);
    setAppStore("configLoadErrors", { loadConfigInfo: loadErrorMessage(e) });
  }
}

// ── Workspace restoration ──

const RESTORABLE_RUNNING_TASK_STATUSES = new Set(["active", "queued"]);

function taskIDFromItem(item: any): string {
  const id = item?.task?.id ?? item?.id;
  return typeof id === "string" ? id.trim() : "";
}

function taskStatusFromItem(item: any): string {
  const status = item?.task?.status ?? item?.status;
  return typeof status === "string" ? status.trim() : "";
}

export function initialRestoreTaskID(
  tasks: any[],
  savedTaskID: string,
  options: { selectRunningWhenUnmatched?: boolean } = {},
): string {
  const list = Array.isArray(tasks) ? tasks : [];
  const saved = typeof savedTaskID === "string" ? savedTaskID.trim() : "";
  if (saved && list.some((item: any) => taskIDFromItem(item) === saved)) {
    return saved;
  }
  if (options.selectRunningWhenUnmatched === false) return "";
  const running = list.find((item: any) =>
    RESTORABLE_RUNNING_TASK_STATUSES.has(taskStatusFromItem(item)),
  );
  return taskIDFromItem(running);
}

/**
 * Restore the last workspace state (task selection + directory) that was
 * persisted to settings before the overlay was last closed.
 * Returns true when a task was successfully re-selected, false otherwise.
 */
export async function restoreInitialWorkspace(): Promise<boolean> {
  const { workspaceTaskID, workspaceDirectory, directory: activeDir } =
    settingsStore;
  const tasks = boardStore.tasks;

 // Skip if a workspace selection is already in progress (epoch > 0).
  if (settingsStore.workspaceEpoch > 0) return false;

  const base = activeDir || "";
  const directory = workspaceRestoreDirectory(workspaceDirectory || "");
  const moved = !!directory && !!base && directory !== base;

  if (moved) {
 // Reflect directory change so reactive components see the updated value.
    setSettingsStore("directory", directory);
    bumpDirectoryEpoch();
  }

  const taskID = initialRestoreTaskID(
    tasks,
    workspaceTaskID || "",
    { selectRunningWhenUnmatched: !moved },
  );

  if (taskID) {
    if (boardStore.selectedTaskID !== taskID || !boardStore.board) {
      await selectTask(taskID);
    }
 // body.dataset.workspace/connection is updated reactively by main.tsx createEffect.
    bumpWorkspaceEpoch();
    return true;
  }

  if (moved) {
 // Could not find the task — roll back the directory change.
    setSettingsStore("directory", base);
    bumpDirectoryEpoch();
  }

  return false;
}
