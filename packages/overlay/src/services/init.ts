// ── Init Service ──
// Application startup sequence:
// - Load overlay settings from localStorage (+ Tauri native store)
// - Load i18n locale data
// - Configure the API client
// - Check server connection
// - Load initial board / tasks / meta / config / executors
// - Restore last workspace
// - Set up a periodic reconnect loop

import { configure as configureApi, apiJson } from "./api";
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
import { setAppStore } from "../store/app";
import { boardStore, setBoardStore, loadTasks } from "../store/board";
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
async function loadInitialData(): Promise<void> {
  // Let-it-crash: init-time failures must not be swallowed, otherwise the
  // UI boots into an inconsistent state (e.g. directory unset but tasks loaded
  // against a stale cwd). Errors propagate to initApp's caller which decides
  // how to surface them.
  await ensureDefaultDirectory();
  await ensureWorkspaceDirectory();
  syncApiConfig();
  await Promise.all([
    loadTasks(),
    loadMeta(),
    loadExtensions(),
    loadConfigInfo(),
    loadExecutors(),
  ]);
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

 // 1. Load settings from localStorage into the Solid store
  loadSettings();

  const invoke = (window as any).__TAURI__?.core?.invoke as
    | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  if (typeof invoke === "function") {
    const nativeSettings = await invoke("overlay_settings_load").catch(() => null);
    if (nativeSettings && typeof nativeSettings === "object" && !Array.isArray(nativeSettings)) {
      applySettings(nativeSettings as any);
      setSavedDirectory(savedDirectoryValue((nativeSettings as any).directory));
    }
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
    await loadInitialData();
    await restoreInitialWorkspace();
    await onConnected?.();
    startTaskListSSE();
  }

 // 7. Start reconnect loop
  stopConnectionMonitor();
  startConnectionMonitor(async () => {
    syncApiConfig();
    await loadInitialData();
    await restoreInitialWorkspace();
    await onReconnect?.();
    startTaskListSSE();
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

/**
 * Load server-side config, provider catalog, provider auth, channel list and
 * prompt entries from the API, then push everything into the Solid stores.
 * Pushes config, provider, channel, and prompt data into the Solid stores.
 */
export async function loadConfigInfo(): Promise<void> {
  try {
    const [config, catalog, auth, channels, prompts] = await Promise.all([
      apiJson("config"),
      apiJson("provider"),
      apiJson("provider/auth"),
      apiJson("channel"),
      apiJson("config/prompt").catch(() => []),
    ]);

 // Push into appStore
    setAppStore({
      config: config ?? null,
      providerCatalog: catalog ?? null,
      providerAuth: auth ?? null,
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
    console.warn("[init] loadConfigInfo failed", e);
  }
}

// ── Workspace restoration ──

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
  const taskID = workspaceTaskID || "";
  const directory = workspaceRestoreDirectory(workspaceDirectory || "");
  const moved = !!directory && !!base && directory !== base;

  if (moved) {
 // Reflect directory change so reactive components see the updated value.
    setSettingsStore("directory", directory);
    bumpDirectoryEpoch();
  }

  if (taskID && tasks.some((item: any) => item?.task?.id === taskID)) {
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
