// ── Init Service ──
// Exact port of app.js init() and the surrounding startup sequence.
//
// Responsibilities:
//   - Load overlay settings from localStorage (+ Tauri native store)
//   - Load i18n locale data
//   - Configure the API client
//   - Check server connection
//   - Load initial board / tasks / meta / config / executors / preferences
//   - Restore last workspace
//   - Set up a periodic reconnect loop
//
// NOTE: Render-side side-effects (renderTheme, renderLocale, etc.) remain in
// app.js for now.  This module focuses on the data-loading contract so that
// the Solid layer can call initApp() and receive a fully-populated store.

import { configure as configureApi, apiJson } from "./api";
import { loadAllLocales, setLocale } from "../utils/i18n";
import {
  loadSettings,
  settingsStore,
  setSettingsStore,
  saveSettings,
  bumpDirectoryEpoch,
  bumpWorkspaceEpoch,
} from "../store/settings";
import { setAppStore } from "../store/app";
import { boardStore, setBoardStore, loadBoard, loadTasks } from "../store/board";

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
   * Reconnect poll interval in ms.  Defaults to 10 000 (10 s).
   */
  reconnectInterval?: number;
}

// ── Module-level state ──

let reconnectTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ──

/**
 * Probe the server with a lightweight HEAD request to /health (or fallback
 * GET /task).  Returns true when the server responds successfully.
 * Mirrors app.js checkConnection().
 */
async function checkConnection(serverUrl: string): Promise<boolean> {
  try {
    const base = serverUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/health`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    // Fallback: attempt a GET on the task list endpoint
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/task`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Push current settings into the API client so subsequent fetch calls use
 * the correct server URL and credentials.
 * Mirrors app.js applyOverlaySettings → window.__solidOverlay.configureApi.
 */
function syncApiConfig(): void {
  configureApi({
    serverUrl: settingsStore.serverUrl,
    username: settingsStore.username,
    password: settingsStore.password,
  });
}

/**
 * Load all initial data that requires a live server connection.
 * Mirrors the Promise.all block inside app.js init().
 */
async function loadInitialData(): Promise<void> {
  // Board and tasks are the core data dependencies for the Solid layer.
  // Additional loaders (meta, extensions, config, executors, preferences)
  // remain owned by app.js; only what the Solid store needs is loaded here.
  await Promise.all([loadBoard(), loadTasks()]);
}

// ── Public API ──

/**
 * Initialise the Solid overlay layer.
 *
 * Call order:
 *   1. Load settings from localStorage
 *   2. Apply settings to API client
 *   3. Load i18n (all supported locales)
 *   4. Apply locale from settings
 *   5. Check server connection
 *   6. If connected: load board + tasks, call onConnected
 *   7. Start periodic reconnect loop
 */
export async function initApp(options: InitOptions = {}): Promise<void> {
  const {
    onConnected,
    onReconnect,
    reconnectInterval = 10_000,
  } = options;

  // 1. Load settings from localStorage into the Solid store
  loadSettings();

  // 2. Push settings into the API client (server URL + auth)
  syncApiConfig();

  // 3. Load i18n locale bundles
  await loadAllLocales();

  // 4. Apply locale from settings
  await setLocale(settingsStore.locale);

  // 5. Check connection
  const connected = await checkConnection(settingsStore.serverUrl);

  if (connected) {
    // 6. Load initial data
    await loadInitialData();
    await onConnected?.();
  }

  // 7. Start reconnect loop (mirrors app.js state.reconnectTimer)
  if (reconnectTimer !== null) {
    clearInterval(reconnectTimer);
  }
  reconnectTimer = setInterval(async () => {
    if (connected) return; // already connected — nothing to do
    try {
      // Re-read settings in case they were updated while offline
      syncApiConfig();
      const ok = await checkConnection(settingsStore.serverUrl);
      if (ok) {
        await loadInitialData();
        await onReconnect?.();
      }
    } catch (err) {
      console.warn("[init] connection retry failed", err);
    }
  }, reconnectInterval);
}

/**
 * Tear down the reconnect loop.
 * Call on `beforeunload` or component cleanup.
 */
export function teardownApp(): void {
  if (reconnectTimer !== null) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
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
 *
 * Exact port of app.js loadConfigInfo() (lines 11163-11201).
 * DOM-side render calls (populateProviderSelect, renderChannels, etc.) remain
 * owned by app.js; this function only handles the data-layer work.
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

    // Unattended: if the server config carries a boolean value, honour it and
    // persist it to localStorage so it survives a page reload.
    // Mirrors app.js configUnattended() + syncUnattendedConfig() logic.
    const remoteUnattended = (config as any)?.unattended;
    if (typeof remoteUnattended === "boolean") {
      setSettingsStore("unattended", remoteUnattended);
      saveSettings();
    }
  } catch (e) {
    console.warn("[init] loadConfigInfo failed", e);
  }
}

// ── Workspace restoration ──

/**
 * Restore the last workspace state (task selection + directory) that was
 * persisted to settings before the overlay was last closed.
 *
 * Returns true when a task was successfully re-selected, false otherwise.
 * Mirrors app.js restoreInitialWorkspace() (lines 11203-11226).
 *
 * NOTE: The full restoration flow (setActiveDirectory, selectTask) still
 * dispatches through app.js.  This wrapper reads from Solid stores so that
 * the Solid layer can make the same decision without reading legacy `state`.
 */
export async function restoreInitialWorkspace(): Promise<boolean> {
  const { workspaceTaskID, workspaceDirectory, directory: activeDir } =
    settingsStore;
  const tasks = boardStore.tasks;

  // If a workspace selection is already in progress (epoch guard in app.js
  // hasWorkspaceSelection), skip restoration.  We surface that as a check on
  // workspaceEpoch > 0 — if the epoch was already bumped the caller is
  // mid-selection.
  if (settingsStore.workspaceEpoch > 0) return false;

  const base = activeDir || "";
  const taskID = workspaceTaskID || "";
  const directory = (workspaceDirectory || "").trim();
  const moved = !!directory && !!base && directory !== base;

  if (moved) {
    // Push directory change into settings store (persist: false equivalent).
    // The full setActiveDirectory side-effects remain in app.js; we only
    // reflect the intent here so reactive components see the updated value.
    setSettingsStore("directory", directory);
    bumpDirectoryEpoch();
  }

  if (taskID && tasks.some((item: any) => item?.task?.id === taskID)) {
    // Mark the task as selected in the board store.
    setBoardStore("selectedTaskID", taskID);
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
