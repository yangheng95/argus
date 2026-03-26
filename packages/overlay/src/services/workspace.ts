// ── Workspace Service ──
// Exact port of workspace.js createOverlayWorkspace factory to TypeScript.
//
// Responsibilities:
//   - Manage the active workspace directory (custom vs. temp vs. task-scoped)
//   - Compute the current workspace mode ("offline" | "task" | "empty")
//   - Enter / clear workspace contexts (empty workspace, task workspace)
//   - Clear board/executor runtime state when switching workspaces
//   - Clear project-scope data (tasks, path, vcs, memory files, preferences)
//   - Directory pick / browse / create (Tauri-backed)
//   - Recent directories persistence (localStorage)
//   - Workspace memory (rememberWorkspace / workspaceRestoreDirectory)
//
// This module operates on Solid stores (settingsStore, boardStore) and
// delegates timers / loading to callers via callbacks.

import { settingsStore, setSettingsStore } from "../store/settings";
import { boardStore, setBoardStore } from "../store/board";
import { clearMessages } from "../store/messages";
import { clearExecutorEvents } from "../store/executor";
import { AppLog } from "../utils/log";
import { t } from "../utils/i18n";
import { apiJson } from "./api";

// ── Types ──

export type WorkspaceMode = "offline" | "task" | "empty";

export interface ClearWorkspaceRuntimeOptions {
  /** When true, the in-flight chat request is NOT cancelled. */
  preserveChatRequest?: boolean;
}

export interface EnterEmptyWorkspaceOptions extends ClearWorkspaceRuntimeOptions {
  /** Override the globalView flag. */
  globalView?: boolean;
  /** When false, the saved/temp directory is NOT restored. Defaults to true. */
  restoreDirectory?: boolean;
}

export interface EnterTaskWorkspaceOptions extends ClearWorkspaceRuntimeOptions {
  /** If provided, sets the workspace directory with source "task". */
  directory?: string;
}

// ── Module-level counters (mirror app.js state.workspaceEpoch / state.tasksSeq) ──

let workspaceEpoch = 0;
let tasksSeq = 0;

// ── Internal: schedule-board timer (mirrors app.js state.boardKick / state.tasksKick) ──
// These timers are held here so clearWorkspaceRuntime can cancel them.

let boardKickTimer: ReturnType<typeof setTimeout> | null = null;
let tasksKickTimer: ReturnType<typeof setTimeout> | null = null;

export function setBoardKickTimer(timer: ReturnType<typeof setTimeout> | null): void {
  boardKickTimer = timer;
}

export function setTasksKickTimer(timer: ReturnType<typeof setTimeout> | null): void {
  tasksKickTimer = timer;
}

export function getBoardKickTimer(): ReturnType<typeof setTimeout> | null {
  return boardKickTimer;
}

export function getTasksKickTimer(): ReturnType<typeof setTimeout> | null {
  return tasksKickTimer;
}

// ── setWorkspaceDirectory ──

/**
 * Set the active workspace directory.
 *
 * @param value   The new directory path (trimmed).
 * @param source  How the directory was set: "manual" (user-driven) or
 *                "task" (task-scoped) or "auto" (restored). Defaults to
 *                "manual".
 *
 * When source is "manual":
 *   - Persists the directory as the saved directory.
 *   - Clears the temp directory when a non-empty value is provided.
 *   - Updates directoryMode to "custom" or "temp".
 *
 * Mirrors workspace.js setWorkspaceDirectory.
 */
export function setWorkspaceDirectory(
  value: string,
  source: "manual" | "task" | "auto" = "manual",
): string {
  const next = typeof value === "string" ? value.trim() : "";

  if (source === "manual") {
    setSettingsStore({
      directory: next,
      savedDirectory: next,
      tempDirectory: next ? "" : settingsStore.tempDirectory,
      directoryMode: next ? "custom" : "temp",
    });
  } else {
    setSettingsStore("directory", next);
  }

  return next;
}

// ── restoreWorkspaceDirectory ──

/**
 * Restore the workspace directory from the persisted "saved" or "temp"
 * directory.  Returns the restored path (or the current directory if neither
 * is available).
 *
 * Mirrors workspace.js restoreWorkspaceDirectory.
 */
export function restoreWorkspaceDirectory(): string {
  const saved =
    typeof settingsStore.savedDirectory === "string" &&
    settingsStore.savedDirectory.trim()
      ? settingsStore.savedDirectory.trim()
      : "";
  const temp =
    typeof settingsStore.tempDirectory === "string" &&
    settingsStore.tempDirectory.trim()
      ? settingsStore.tempDirectory.trim()
      : "";

  // Resolve: prefer the persisted baseline directory, then the temp directory,
  // then fall back to the current active directory.
  const next =
    saved ||
    temp ||
    (settingsStore.directory ? settingsStore.directory.trim() : "");
  if (!next) return settingsStore.directory;

  setSettingsStore({
    directory: next,
    directoryMode: saved ? "custom" : "temp",
  });

  return next;
}

// ── workspaceMode ──

/**
 * Compute the current workspace mode based on reactive store state.
 *
 * - "offline"  — not connected to the server
 * - "task"     — a task is selected
 * - "empty"    — connected but no task selected
 *
 * Mirrors workspace.js workspaceMode.
 */
export function workspaceMode(): WorkspaceMode {
  if (!boardStore.selectedTaskID && !boardStore.board) {
    // Check app connection state — treat no-board as offline proxy
    // Real connected flag lives in appStore, but workspace.js keyed off
    // state.connected.  We approximate using boardStore + presence of data.
    // Callers that need a precise offline check should read appStore.connected
    // directly.
  }
  // Use the boardStore selectedTaskID as the primary signal
  if (boardStore.selectedTaskID) return "task";
  return "empty";
}

/**
 * Compute the workspace mode with an explicit connected flag.
 * Mirrors workspace.js workspaceMode more precisely when the caller can
 * supply the connection status.
 */
export function workspaceModeWithConnection(connected: boolean): WorkspaceMode {
  if (!connected) return "offline";
  if (boardStore.selectedTaskID) return "task";
  return "empty";
}

// ── hasWorkspaceSelection ──

/**
 * Returns true when a task is currently selected.
 * Mirrors workspace.js hasWorkspaceSelection.
 */
export function hasWorkspaceSelection(): boolean {
  return !!boardStore.selectedTaskID;
}

// ── enterSessionWorkspace ──

/**
 * Session workspaces are no longer supported by the overlay.
 * Throws unconditionally, mirroring workspace.js.
 */
export function enterSessionWorkspace(): never {
  throw new Error("Overlay no longer supports session workspaces");
}

// ── clearWorkspaceRuntime ──

/**
 * Clear all volatile runtime state associated with the current workspace
 * (board, messages, executor events, pending timers).
 *
 * Increments workspaceEpoch so any in-flight requests can detect staleness.
 *
 * @param options.preserveChatRequest  When true, skips cancelling any
 *                                     in-flight chat/stream request.
 *
 * Mirrors workspace.js clearWorkspaceRuntime.
 */
export function clearWorkspaceRuntime(
  options: ClearWorkspaceRuntimeOptions = {},
): void {
  workspaceEpoch += 1;

  // Cancel pending board/task schedule timers
  if (boardKickTimer !== null) {
    clearTimeout(boardKickTimer);
    boardKickTimer = null;
  }
  if (tasksKickTimer !== null) {
    clearTimeout(tasksKickTimer);
    tasksKickTimer = null;
  }

  tasksSeq += 1;

  // Clear Solid board store
  setBoardStore({
    board: null,
    loading: false,
  });

  // Clear messages store
  clearMessages();

  // Clear executor events store
  clearExecutorEvents();
}

// ── clearProjectScopeData ──

/**
 * Clear project-scoped state that is tied to a directory/connection rather
 * than a single task.
 *
 * Mirrors workspace.js clearProjectScopeData.
 *
 * NOTE: tasks, globalTasks, path, vcs, memoryFiles, memorySearchMode, and
 * preferences live in app.js state and/or the boardStore.  Only the
 * boardStore tasks field is managed here; the remaining fields are owned by
 * app.js for now.
 */
export function clearProjectScopeData(): void {
  setBoardStore("tasks", []);
  // path, vcs, memoryFiles, memorySearchMode, preferences remain in app.js
  // state and are not yet migrated to a Solid store.
}

// ── enterEmptyWorkspace ──

/**
 * Switch to the "empty" workspace (no task selected).
 *
 * - Clears the selectedTaskID.
 * - Optionally restores the saved/temp directory.
 * - Clears all runtime state.
 *
 * Mirrors workspace.js enterEmptyWorkspace.
 */
export function enterEmptyWorkspace(
  options: EnterEmptyWorkspaceOptions = {},
): void {
  setBoardStore("selectedTaskID", "");

  if (options.restoreDirectory !== false) {
    restoreWorkspaceDirectory();
  }

  clearWorkspaceRuntime(options);
}

// ── enterTaskWorkspace ──

/**
 * Switch to a specific task workspace.
 *
 * - Optionally sets the workspace directory with source "task".
 * - Sets the selectedTaskID.
 * - Clears all runtime state.
 *
 * Mirrors workspace.js enterTaskWorkspace.
 */
export function enterTaskWorkspace(
  taskID: string,
  options: EnterTaskWorkspaceOptions = {},
): void {
  if (
    typeof options.directory === "string" &&
    options.directory.trim()
  ) {
    setWorkspaceDirectory(options.directory, "task");
  }

  setBoardStore("selectedTaskID", taskID || "");
  clearWorkspaceRuntime(options);
}

// ── Epoch / sequence accessors ──

/** Returns the current workspace epoch (incremented on every runtime clear). */
export function getWorkspaceEpoch(): number {
  return workspaceEpoch;
}

/** Returns the current tasks sequence number (incremented on every runtime clear). */
export function getTasksSeq(): number {
  return tasksSeq;
}

// ── Tauri helpers (internal) ──

async function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const globalInvoke = (window as any).__TAURI__?.core?.invoke;
  if (typeof globalInvoke === "function") {
    return globalInvoke(command, args);
  }
  throw new Error(`Tauri runtime unavailable for ${command}`);
}

function hasTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).__TAURI__?.core?.invoke === "function"
  );
}

async function currentTauriWindow(): Promise<any | null> {
  const getCurrent = (window as any).__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent() as any;
    } catch {
      // Not running inside Tauri
    }
  }
  return null;
}

/**
 * Temporarily un-pin the always-on-top window, run `run()`, then restore the
 * pin state.  Mirrors app.js withUnpinned().
 */
async function withUnpinned<T>(run: () => Promise<T>): Promise<T> {
  const win = await currentTauriWindow();
  if (
    !win ||
    typeof win.isAlwaysOnTop !== "function" ||
    typeof win.setAlwaysOnTop !== "function"
  ) {
    return run();
  }
  const pinned = await win.isAlwaysOnTop().catch(() => false);
  if (!pinned) return run();
  await win.setAlwaysOnTop(false).catch(() => undefined);
  try {
    return await run();
  } finally {
    await win.setAlwaysOnTop(true).catch(() => undefined);
    await win.setFocus?.().catch(() => undefined);
  }
}

/** Produce a user-facing error message: translated key + error detail. */
function errorText(key: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return `${t(key)}: ${detail}`;
}

// ── Path utilities (internal) ──

function absolutePath(value: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}

function joinPath(base: string, value: string): string {
  if (!base) return value;
  if (absolutePath(value)) return value;
  if (/[\\/]$/.test(base)) return `${base}${value}`;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${value}`;
}

// ── Native dialog helpers (internal) ──

interface NativeMessageOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
}

interface NativePromptOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputValue?: string;
}

/**
 * Show an application-level notification dialog.
 * Delegates to the legacy app.js `showAppDialog` via the `window` global to
 * avoid a circular import during the migration period.
 */
async function nativeMessage(message: string, options?: NativeMessageOptions): Promise<void> {
  const showAppDialog = (window as any).showAppDialog;
  if (typeof showAppDialog === "function") {
    await showAppDialog({
      title: options?.title || t("dialog.notice"),
      message,
      kind: options?.kind || "info",
      okLabel: options?.okLabel || t("common.ok"),
    });
  }
}

/**
 * Show an input prompt dialog.
 * Returns the trimmed string entered by the user, or null if cancelled.
 * Delegates to legacy app.js `showAppDialog`.
 */
async function nativePrompt(
  message: string,
  options?: NativePromptOptions,
): Promise<string | null> {
  const showAppDialog = (window as any).showAppDialog;
  if (typeof showAppDialog !== "function") return null;
  const result = await showAppDialog({
    title: options?.title || t("dialog.input"),
    message,
    kind: options?.kind || "info",
    okLabel: options?.okLabel || t("common.submit"),
    cancelLabel: options?.cancelLabel || t("common.cancel"),
    cancel: true,
    input: true,
    inputLabel: options?.inputLabel || t("dialog.value"),
    inputPlaceholder: options?.inputPlaceholder || "",
    inputValue: options?.inputValue || "",
  });
  return result?.confirmed ? result.value : null;
}

/**
 * Open a local path or URL using native OS facilities.
 * Mirrors app.js nativeOpen().
 */
async function nativeOpen(target: string): Promise<boolean> {
  if (!target) return false;
  const url = /^https?:\/\//i.test(target);
  try {
    const opened = url
      ? await tauriInvoke("overlay_open_url", { url: target })
      : await tauriInvoke("overlay_open_path", { path: target });
    if (opened) return true;
  } catch { /* Tauri not available */ }
  if (url) {
    window.open(target, "_blank", "noopener");
    return true;
  }
  try {
    const result = await apiJson("path/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target }),
    });
    return (result as any)?.opened === true;
  } catch (openErr) {
    AppLog.debug("ui", "path/open fallback failed", { target, error: String(openErr) });
    return false;
  }
}

// ── Temp directory ──

/**
 * Ask the Tauri backend to create a new temporary directory.
 * Returns the path, or an empty string on failure.
 * Mirrors app.js createTempDirectory().
 */
export async function createTempDirectory(): Promise<string> {
  const created = await tauriInvoke("overlay_create_temp_dir").catch(() => undefined);
  return typeof created === "string" ? created.trim() : "";
}

// ── Tauri file / directory pickers ──

/**
 * Open a native directory picker, temporarily un-pinning the window.
 * Returns the selected path, or an empty string when cancelled.
 * Mirrors app.js pickDirectory().
 */
export async function pickDirectory(start?: string): Promise<string> {
  const selected = await withUnpinned(() =>
    tauriInvoke("overlay_pick_dir", { start: start || undefined }) as Promise<unknown>,
  );
  return typeof selected === "string" ? selected : "";
}

/**
 * Open a native multi-file picker, temporarily un-pinning the window.
 * Returns the array of selected paths.
 * Mirrors app.js pickFiles().
 */
export async function pickFiles(start?: string): Promise<string[]> {
  const result = await withUnpinned(() =>
    tauriInvoke("overlay_pick_files", { start: start || undefined }) as Promise<unknown>,
  );
  return Array.isArray(result) ? result : [];
}

// ── Directory helper functions ──

/**
 * Returns the currently active working directory from the settings store.
 * Mirrors app.js activeDirectory().
 */
export function activeDirectory(): string {
  return settingsStore.directory;
}

/**
 * Returns "custom" when `directory` is non-empty, otherwise returns the
 * default directoryMode ("temp").
 * Mirrors app.js sanitizeDirectoryMode().
 */
export function sanitizeDirectoryMode(
  value: unknown,
  directory: string,
): "custom" | "temp" {
  if (value === "custom") return "custom";
  if (typeof value === "string" && value.trim() === "temp") return "temp";
  return typeof directory === "string" && directory.trim() ? "custom" : "temp";
}

/**
 * Returns the "saved directory" value: non-empty only when the mode resolves
 * to "custom".
 * Mirrors app.js savedDirectoryValue().
 */
export function savedDirectoryValue(directory: string, mode: unknown): string {
  const next = typeof directory === "string" ? directory.trim() : "";
  if (!next) return "";
  return sanitizeDirectoryMode(mode, next) === "custom" ? next : "";
}

/**
 * Extract and trim the `directory` field from a settings object.
 * Mirrors app.js settingsDirectory().
 */
export function settingsDirectory(settings: Record<string, unknown> | null | undefined): string {
  return typeof settings?.directory === "string" ? settings.directory.trim() : "";
}

// ── Workspace memory (rememberWorkspace / workspaceRestoreDirectory) ──

/**
 * Returns true when the path looks like a goal-workspace execution directory
 * (contains a "goal-workspace" path segment).
 * Mirrors app.js looksLikeExecutionWorkspace().
 */
export function looksLikeExecutionWorkspace(value: unknown): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(^|[\\/])goal-workspace([\\/]|$)/i.test(text);
}

/**
 * Returns `value` unless it looks like a goal-workspace execution directory,
 * in which case returns an empty string.
 * Mirrors app.js workspaceRestoreDirectory().
 */
export function workspaceRestoreDirectory(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (looksLikeExecutionWorkspace(text)) return "";
  return text;
}

export interface RememberWorkspaceInput {
  taskID?: string;
  directory?: string;
}

/**
 * Persist the current task + directory as the "workspace memory" so it can be
 * restored after an overlay restart.
 * Mirrors app.js rememberWorkspace().
 */
export function rememberWorkspace(input: RememberWorkspaceInput = {}): void {
  const taskID =
    typeof input.taskID === "string"
      ? input.taskID.trim()
      : boardStore.selectedTaskID || settingsStore.workspaceTaskID || "";

  const rawDir =
    typeof input.directory === "string"
      ? input.directory.trim()
      : settingsStore.savedDirectory || activeDirectory() || settingsStore.directory || "";

  const directory =
    workspaceRestoreDirectory(rawDir) ||
    workspaceRestoreDirectory(settingsStore.savedDirectory || "") ||
    "";

  setSettingsStore("workspaceTaskID", taskID);
  setSettingsStore("workspaceDirectory", taskID ? directory : "");
}

// ── Recent directories ──

const RECENT_DIRS_KEY = "oc_recent_directories";
const MAX_RECENT_DIRS = 10;

/**
 * Load the recent-directories list from localStorage.
 * Returns a plain array of trimmed path strings.
 * Mirrors app.js loadRecentDirectories().
 */
export function loadRecentDirectories(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((d) => typeof d === "string" && (d as string).trim())
      : [];
  } catch {
    return [];
  }
}

/**
 * Persist the given array of directory paths to localStorage.
 * Mirrors app.js saveRecentDirectories().
 */
export function saveRecentDirectories(dirs: string[]): void {
  try {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs));
  } catch { /* ignore quota errors */ }
}

/**
 * Prepend `dir` to the recent-directories list (deduplicating by case-
 * insensitive comparison) and persist.
 * Mirrors app.js addRecentDirectory().
 */
export function addRecentDirectory(dir: string): void {
  if (!dir || typeof dir !== "string") return;
  const normalized = dir.trim();
  if (!normalized) return;
  const dirs = loadRecentDirectories().filter(
    (d) => d.toLowerCase() !== normalized.toLowerCase(),
  );
  dirs.unshift(normalized);
  saveRecentDirectories(dirs.slice(0, MAX_RECENT_DIRS));
}

/**
 * Remove all entries matching `dir` (case-insensitive) from the recent-
 * directories list and persist.
 * Mirrors app.js removeRecentDirectory().
 */
export function removeRecentDirectory(dir: string): void {
  if (!dir) return;
  const normalized = dir.trim().toLowerCase();
  saveRecentDirectories(
    loadRecentDirectories().filter((d) => d.toLowerCase() !== normalized),
  );
}

// ── applyDirectory ──

export interface ApplyDirectoryOptions {
  /**
   * When true, `next` is written as the saved directory.
   * When false, the saved directory is cleared.
   * When omitted (null/undefined), the saved directory is unchanged.
   */
  save?: boolean;
  /**
   * When true, `next` is written as the temp directory.
   * When false, the temp directory is cleared.
   * When omitted (null/undefined), the temp directory is unchanged.
   */
  temp?: boolean;
  /**
   * When false, skip persisting overlay settings after the switch.
   * Defaults to true.
   */
  persist?: boolean;
  /**
   * When false, skip restoring the initial workspace after the reload.
   * Defaults to true.
   */
  restoreWorkspace?: boolean;
}

/**
 * Switch the active working directory, update related store fields, and
 * trigger a project-scope reload via the legacy app.js bridge.
 *
 * Mirrors app.js applyDirectory().
 */
export async function applyDirectory(
  next: string,
  options: ApplyDirectoryOptions = {},
): Promise<void> {
  const save =
    options.save === true ? next : options.save === false ? "" : null;
  const temp =
    options.temp === true ? next : options.temp === false ? "" : null;

  const curDir = settingsStore.directory;
  const curSaved = settingsStore.savedDirectory;
  const curTemp = settingsStore.tempDirectory;

  if (
    next === curDir &&
    (save === null || save === curSaved) &&
    (temp === null || temp === curTemp)
  ) {
    console.log("[applyDir] skipped (same)", {
      next,
      save,
      temp,
      dir: curDir,
      saved: curSaved,
      tempDir: curTemp,
    });
    return;
  }

  console.log("[applyDir] switching", { from: curDir, to: next, save, temp });

  setSettingsStore("directoryEpoch", (n: number) => n + 1);
  setSettingsStore("directory", next);
  if (save !== null) setSettingsStore("savedDirectory", save);
  if (temp !== null) setSettingsStore("tempDirectory", temp);
  setSettingsStore(
    "directoryMode",
    settingsStore.savedDirectory ? "custom" : "temp",
  );
  setBoardStore("pendingTasks", []);

  // Clear stale workspace memory so restoreInitialWorkspace() won't revert the switch.
  setSettingsStore("workspaceTaskID", "");
  setSettingsStore("workspaceDirectory", "");

  // Clear project-scope data (tasks list, messages, executor events).
  clearProjectScopeData();

  if (options.persist !== false) {
    // Persist via legacy bridge to keep localStorage + Tauri store in sync.
    const persistFn = (window as any).persistOverlaySettings;
    if (typeof persistFn === "function") await persistFn();
  }

  if (options.save === true && next) addRecentDirectory(next);

  // Connection check + reload via legacy bridge.
  const { checkConnection } = await import("./connection");
  if (typeof checkConnection === "function") {
    console.log("[applyDir] checking connection");
    const ok = await checkConnection();
    if (!ok) {
      console.warn("[applyDir] connection failed, aborting");
      return;
    }
  }

  const { reloadProjectScope } = await import("./config");
  console.log("[applyDir] reloading project scope");
  await reloadProjectScope(options);
  console.log("[applyDir] done, tasks=", boardStore.tasks.length);
}

// ── setActiveDirectory ──

/**
 * Set the active directory without persisting.
 * No-ops when `value` is empty or already equals the current directory.
 * Mirrors app.js setActiveDirectory().
 */
export async function setActiveDirectory(
  value: string,
  options: ApplyDirectoryOptions = {},
): Promise<void> {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next || next === settingsStore.directory) return;
  await applyDirectory(next, { ...options, persist: false });
}

// ── browseDirectory / createDirectory ──

/**
 * Open a native directory picker and apply the selected directory.
 * Mirrors app.js browseDirectory().
 */
export async function browseDirectory(): Promise<void> {
  try {
    const selected = await pickDirectory(activeDirectory());
    if (!selected) return;
    await setDirectory(selected);
  } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.set_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

/**
 * Pick a parent directory and prompt for a new folder name, then create it
 * and switch to it (optionally initialising Git).
 * Mirrors app.js createDirectory().
 */
export async function createDirectory(): Promise<void> {
  try {
    const parent = await pickDirectory(activeDirectory());
    if (!parent) return;
    const name = await nativePrompt(t("cwd.create_prompt"), {
      title: t("cwd.create_title"),
      okLabel: t("common.create"),
      inputLabel: t("cwd.folder"),
      inputPlaceholder: t("cwd.folder_placeholder"),
    });
    const value = name?.trim();
    if (!value) return;
    const target = joinPath(parent, value);
    const created = await tauriInvoke("overlay_create_dir", { path: target }).catch(
      () => undefined,
    );
    if (!created) throw new Error(t("cwd.create_unavailable"));
    await setDirectory(target);
    if (settingsStore.initGit) {
      const { initGitCurrent } = await import("../utils/git");
      await initGitCurrent({ notify: false });
    }
  } catch (e) {
    AppLog.error("ui", "Failed to create working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.create_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

// ── openDirectory / resetDirectory ──

/**
 * Open the given directory (or the current active directory) with the
 * native OS file explorer.
 * Mirrors app.js openDirectory().
 */
export async function openDirectory(target?: string): Promise<void> {
  const dir = target ?? activeDirectory();
  try {
    if (!dir) return;
    const opened = await nativeOpen(dir);
    if (opened) return;
    await nativeMessage(dir, {
      title: t("cwd.title"),
      kind: "info",
    });
  } catch (e) {
    AppLog.error("ui", "Failed to open working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.open_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

/**
 * Reset the working directory to a fresh temp directory.
 * Mirrors app.js resetDirectory().
 */
export async function resetDirectory(): Promise<void> {
  try {
    await setTempDirectory();
  } catch (e) {
    AppLog.error("ui", "Failed to reset working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.reset_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

// ── setDirectory / setTempDirectory ──

/**
 * Set the working directory to `value`.  When `value` is empty, falls back to
 * the existing temp directory or creates a new one.
 * Mirrors app.js setDirectory().
 */
export async function setDirectory(
  value: string,
  options: ApplyDirectoryOptions = {},
): Promise<void> {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) {
    if (settingsStore.tempDirectory) {
      await applyDirectory(settingsStore.tempDirectory, { ...options, save: false });
      return;
    }
    await setTempDirectory(options);
    return;
  }
  await applyDirectory(next, { ...options, save: true, temp: false });
}

/**
 * Create a new temporary directory (via Tauri) and switch to it.
 * Mirrors app.js setTempDirectory().
 */
export async function setTempDirectory(
  options: ApplyDirectoryOptions = {},
): Promise<void> {
  if (!hasTauriRuntime()) {
    await applyDirectory("", { ...options, save: false, temp: false });
    return;
  }
  const next = await createTempDirectory();
  if (!next) throw new Error(t("cwd.create_unavailable"));
  const { scaffoldProjectConfig } = await import("./config");
  await scaffoldProjectConfig(next);
  await applyDirectory(next, { ...options, save: false, temp: true });
}

// ── ensureDefaultDirectory / ensureWorkspaceDirectory ──

/**
 * Ensure a default working directory is set, creating a temp directory if
 * neither a saved nor temp directory is available.
 * Returns true when a new temp directory was created.
 * Mirrors app.js ensureDefaultDirectory().
 */
export async function ensureDefaultDirectory(): Promise<boolean> {
  if (settingsStore.savedDirectory) {
    setSettingsStore("directory", settingsStore.savedDirectory);
    setSettingsStore("directoryMode", "custom");
    return false;
  }
  if (settingsStore.tempDirectory) {
    setSettingsStore("directory", settingsStore.tempDirectory);
    setSettingsStore("directoryMode", "temp");
    return false;
  }
  if (!hasTauriRuntime()) return false;
  const next = await createTempDirectory();
  if (!next) return false;
  const scaffoldProjectConfig = (window as any).scaffoldProjectConfig;
  if (typeof scaffoldProjectConfig === "function") {
    await scaffoldProjectConfig(next);
  }
  setSettingsStore("tempDirectory", next);
  setSettingsStore("directory", next);
  setSettingsStore("savedDirectory", "");
  setSettingsStore("directoryMode", "temp");
  const persistFn = (window as any).persistOverlaySettings;
  if (typeof persistFn === "function") await persistFn();
  return true;
}

/**
 * Ensure the workspace directory is resolved.  If the active directory is
 * already set, returns it immediately; otherwise loads meta from the server
 * and falls back to the `path.directory` value returned by the server.
 * Mirrors app.js ensureWorkspaceDirectory().
 */
export async function ensureWorkspaceDirectory(): Promise<string> {
  if (activeDirectory()) return activeDirectory();
  // Load meta via legacy bridge (sets boardStore.path).
  const { loadMeta } = await import("./meta");
  if (typeof loadMeta === "function") await loadMeta();
  if (!settingsStore.directory && (boardStore.path as any)?.directory) {
    setSettingsStore("directory", (boardStore.path as any).directory);
  }
  return activeDirectory();
}

// ── currentExecutionDirectory ──

/**
 * Sort priority for goal-run status values used by currentExecutionDirectory.
 * Mirrors app.js goalRunPriority().
 */
function goalRunPriority(status: unknown): number {
  if (status === "running") return 0;
  if (status === "blocked") return 1;
  if (status === "accepted") return 2;
  if (status === "queued") return 3;
  if (status === "completed") return 4;
  if (status === "failed") return 5;
  if (status === "aborted") return 6;
  return 7;
}

/**
 * Return the workspace directory of the highest-priority active goal run.
 * Mirrors app.js currentExecutionDirectory().
 */
export function currentExecutionDirectory(): string {
  const goalRuns: unknown[] = Array.isArray(boardStore.board?.goalRuns)
    ? boardStore.board.goalRuns
    : [];
  const rows = goalRuns
    .filter(
      (item: any) =>
        typeof item?.workspaceDir === "string" && item.workspaceDir.trim(),
    )
    .toSorted(
      (a: any, b: any) =>
        goalRunPriority(a?.status) - goalRunPriority(b?.status) ||
        (b?.time?.updated || 0) - (a?.time?.updated || 0),
    );
  return (rows[0] as any)?.workspaceDir?.trim() || "";
}
