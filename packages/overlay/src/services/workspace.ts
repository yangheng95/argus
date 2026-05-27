// ── Workspace Service ──
// Responsibilities:
// - Manage the active workspace directory (custom vs. temp vs. task-scoped)
// - Compute the current workspace mode ("offline" | "task" | "empty")
// - Enter / clear workspace contexts (empty workspace, task workspace)
// - Clear board/executor runtime state when switching workspaces
// - Clear project-scope data (tasks, path, vcs, memory files)
// - Directory pick / browse / create (Tauri-backed)
// - Recent directories persistence (localStorage)
// This module operates on Solid stores (settingsStore, boardStore) and
// delegates timers / loading to callers via callbacks.

import { saveSettings, settingsStore, setSettingsStore } from "../store/settings";
import { applyTasks, boardStore, setBoardStore,
  activeTaskID,
} from "../store/board";
import { clearMessages } from "../store/messages";
import { setAppStore } from "../store/app";
import { AppLog } from "../utils/log";
import { t } from "../utils/i18n";
import { apiJson, configure as configureApi } from "./api";
import { getHostTransport } from "./host-transport";
import type { ProjectEditorID } from "./host-transport";
import { nativeMessage } from "./app-dialog";
import { nativeOpen, nativePrompt } from "../utils/native";
import { checkConnection } from "./connection";
import { reloadProjectScope } from "./config";
import { initGitCurrent } from "../utils/git";
import { startTaskListSSE, stopSSE, stopTaskListSSE } from "./sse";

// ── Types ──

export type WorkspaceMode = "offline" | "task" | "empty";

export interface ProjectEditor {
  id: ProjectEditorID;
  label: string;
}

// IDE means Integrated Development Environment; these IDs are the public
// choices surfaced by the workspace UI and handled by the native host.
export const PROJECT_EDITORS: ProjectEditor[] = [
  { id: "vscode", label: "VS Code" },
  { id: "pycharm", label: "PyCharm" },
  { id: "webstorm", label: "WebStorm" },
  { id: "intellij", label: "IntelliJ IDEA" },
  { id: "cursor", label: "Cursor" },
];

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

// ── Module-level counters (mirror state.workspaceEpoch / state.tasksSeq) ──

let workspaceEpoch = 0;
let tasksSeq = 0;

// ── Internal: schedule-board timer (
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
 * @param value The new directory path (trimmed).
 * @param source How the directory was set: "manual" (user-driven) or
 * "task" (task-scoped) or "auto" (restored). Defaults to
 * "manual".
 *
 * Source semantics:
 * - "manual": caller is `applyDirectory`, which owns the full switch
 *   lifecycle (epoch bump, persistence, clearProjectScopeData,
 *   reloadProjectScope). Do nothing extra here.
 * - "task": caller is `enterTaskWorkspace` — the user clicked a task in a
 *   different workspace. `settingsStore.directory` changes and
 *   `main.tsx`'s configureApi effect retargets the API client, but
 *   project-scope stores (appStore.config, boardStore.vcs, boardStore.path,
 *   appStore.providerCatalog / providerAuth / channels, tasks list) would
 *   otherwise keep serving the previous workspace's data until another
 *   full switch. Trigger a reload here so the config / git-status / task
 *   list align with the new workspace immediately.
 * - "auto": caller is `meta.ts` echoing the server's /path response; data
 *   is already fresh on that request — no reload needed.
 */
export function setWorkspaceDirectory(
  value: string,
  source: "manual" | "task" | "auto" = "manual",
): string {
  const next = typeof value === "string" ? value.trim() : "";
  const prev = settingsStore.directory;

  if (source === "manual") {
    setSettingsStore({
      directory: next,
      savedDirectory: next,
    });
  } else {
    setSettingsStore("directory", next);
  }

  if (source === "task" && next && next !== prev) {
    setSettingsStore("directoryEpoch", (n: number) => n + 1);
    stopTaskListSSE();
    clearProjectScopeData();
    const epoch = settingsStore.directoryEpoch;
    void reloadProjectScope({ restoreWorkspace: false })
      .then(() => {
        if (settingsStore.directoryEpoch === epoch && settingsStore.directory === next) {
          startTaskListSSE();
        }
      })
      .catch((e: unknown) =>
        console.error("[setWorkspaceDirectory/task] reload failed", e),
      );
  }

  return next;
}

// ── restoreWorkspaceDirectory ──

/**
 * Restore the workspace directory from the persisted "saved" or "temp"
 * directory. Returns the restored path (or the current directory if neither
 * is available).
 * Mirrors workspace.js restoreWorkspaceDirectory.
 */
export function restoreWorkspaceDirectory(): string {
  const saved =
    typeof settingsStore.savedDirectory === "string" &&
    settingsStore.savedDirectory.trim()
      ? settingsStore.savedDirectory.trim()
      : "";
  const next =
    saved ||
    (settingsStore.directory ? settingsStore.directory.trim() : "");
  if (!next) return settingsStore.directory;
  setSettingsStore("directory", next);
  return next;
}

// ── workspaceMode ──

/**
 * Compute the current workspace mode based on reactive store state.
 * - "offline" — not connected to the server
 * - "task" — a task is selected
 * - "empty" — connected but no task selected
 * Mirrors workspace.js workspaceMode.
 */
export function workspaceMode(): WorkspaceMode {
  if (!activeTaskID() && !boardStore.board) {
 // Check app connection state — treat no-board as offline proxy
 // Real connected flag lives in appStore, but workspace.js keyed off
 // state.connected. We approximate using boardStore + presence of data.
 // Callers that need a precise offline check should read appStore.connected
 // directly.
  }
 // Use the selected task source as the primary signal
  if (activeTaskID()) return "task";
  return "empty";
}

/**
 * Compute the workspace mode with an explicit connected flag.
 * Mirrors workspace.js workspaceMode more precisely when the caller can
 * supply the connection status.
 */
export function workspaceModeWithConnection(connected: boolean): WorkspaceMode {
  if (!connected) return "offline";
  if (activeTaskID()) return "task";
  return "empty";
}

// ── hasWorkspaceSelection ──

/**
 * Returns true when a task is currently selected.
 * Mirrors workspace.js hasWorkspaceSelection.
 */
export function hasWorkspaceSelection(): boolean {
  return !!activeTaskID();
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
 * Increments workspaceEpoch so any in-flight requests can detect staleness.
 * @param options.preserveChatRequest When true, skips cancelling any
 * in-flight chat/stream request.
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

}

// ── clearProjectScopeData ──

/**
 * Clear project-scoped state that is tied to a directory/connection rather
 * than a single task.
 * Mirrors workspace.js clearProjectScopeData.
 * NOTE: tasks, globalTasks, path, vcs, memoryFiles, memorySearchMode
 * live. Only the boardStore tasks field is managed here; the remaining
 * fields are owned by for now.
 */
export function clearProjectScopeData(): void {
  applyTasks([], []);
  setBoardStore({
    path: null,
    vcs: null,
    changes: [],
    planPreview: "",
    specPreview: "",
    taskSequence: 0,
    boardEtag: "",
    boardSyncPending: false,
    boardQueued: false,
    boardUpdatedAt: 0,
    snapshotVersion: "",
    tasksError: "",
    tasksLoaded: true,
  });
  setAppStore({
    config: null,
    executors: [],
    providerCatalog: null,
    providerAuth: null,
    configLoadErrors: {},
    providerTest: null,
    channels: [],
    skills: [],
    skillMarket: [],
    mcp: {},
    memoryFiles: [],
    memorySearchMode: false,
    promptEntries: [],
    promptDrafts: {},
    criteriaSpecs: [],
  });
}

// ── closeProject ──

/**
 * Close the current project selection without deleting project data.
 * This is the single lifecycle path for Project -> Close Project.
 */
export function closeProject(): void {
  stopSSE();
  stopTaskListSSE();
  setSettingsStore("directoryEpoch", (n: number) => n + 1);
  setSettingsStore({
    directory: "",
    savedDirectory: "",
    workspaceTaskID: "",
    workspaceDirectory: "",
  });
  configureApi({ directory: "" });
  enterEmptyWorkspace({ restoreDirectory: false });
  clearProjectScopeData();
  saveSettings();
}

// ── enterEmptyWorkspace ──

/**
 * Switch to the "empty" workspace (no task selected).
 * - Clears the selected source.
 * - Optionally restores the saved/temp directory.
 * - Clears all runtime state.
 * Mirrors workspace.js enterEmptyWorkspace.
 */
export function enterEmptyWorkspace(
  options: EnterEmptyWorkspaceOptions = {},
): void {
  setBoardStore("selectedSource", null);

  if (options.restoreDirectory !== false) {
    restoreWorkspaceDirectory();
  }

  clearWorkspaceRuntime(options);
}

// ── enterTaskWorkspace ──

/**
 * Switch to a specific task workspace.
 * - Optionally sets the workspace directory with source "task".
 * - Sets the selected task source.
 * - Clears all runtime state.
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

  setBoardStore("selectedSource", taskID ? { kind: "task", id: taskID } : null);
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

// ── Tauri file / directory pickers ──

/** Open a native directory picker. Returns the selected path, or an empty string when cancelled. */
export async function pickDirectory(start?: string): Promise<string> {
  const selected = await getHostTransport().native({ kind: "workspace.pickDir", start });
  return typeof selected === "string" ? selected : "";
}

/** Open a native multi-file picker. Returns the array of selected paths. */
export async function pickFiles(start?: string): Promise<string[]> {
  const result = await getHostTransport().native({
    kind: "workspace.pickFiles",
    start,
    multiple: true,
  });
  return Array.isArray(result) ? result : [];
}

// ── Directory helper functions ──

/**
 * Returns the currently active working directory for project-scoped UI.
 */
export function activeDirectory(): string {
  return boardStore.board?.task?.directory || settingsStore.directory || "";
}

// ── Recent directories ──

const RECENT_DIRS_KEY = "oc_recent_directories";
const MAX_RECENT_DIRS = 10;

/**
 * Load the recent-directories list from localStorage.
 * Returns a plain array of trimmed path strings.
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
 */
export function saveRecentDirectories(dirs: string[]): void {
  try {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs));
  } catch { /* ignore quota errors */ }
}

/**
 * Prepend `dir` to the recent-directories list (deduplicating by case-
 * insensitive comparison) and persist.
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
 * trigger a project-scope reload via the .
 */
export async function applyDirectory(
  next: string,
  options: ApplyDirectoryOptions = {},
): Promise<void> {
  const save =
    options.save === true ? next : options.save === false ? "" : null;

  const curDir = settingsStore.directory;
  const curSaved = settingsStore.savedDirectory;

  if (next === curDir && (save === null || save === curSaved)) {
    console.log("[applyDir] skipped (same)", { next, save, dir: curDir, saved: curSaved });
    return;
  }

  console.log("[applyDir] switching", { from: curDir, to: next, save });

  stopSSE();
  stopTaskListSSE();
  setSettingsStore("directoryEpoch", (n: number) => n + 1);
  setSettingsStore("directory", next);
  if (save !== null) setSettingsStore("savedDirectory", save);

 // Sync the API client's directory context immediately so all subsequent
 // API calls (checkConnection, reloadProjectScope, etc.) target the new
 // directory on the backend.
  configureApi({ directory: next });
  setBoardStore("pendingTasks", []);

 // Clear transient provider-test state so a result from the previous project
 // does not linger in the Settings › Providers panel after the switch. The
 // providerCatalog / providerAuth fields are reloaded by reloadProjectScope
 // below; providerTest is user-triggered-only and otherwise never refreshed.
  setAppStore("providerTest", null);

 // Clear stale workspace memory so restoreInitialWorkspace() won't revert the switch.
  setSettingsStore("workspaceTaskID", "");
  setSettingsStore("workspaceDirectory", "");

 // Clear project-scope data (tasks list, messages, executor events).
  clearProjectScopeData();

  if (options.persist !== false) {
 // Persist through the active host settings source.
    const persistFn = (window as any).persistOverlaySettings;
    if (typeof persistFn === "function") await persistFn();
  }

  if (options.save === true && next) addRecentDirectory(next);

 // Capture epoch before entering async phase — if another applyDirectory
 // call supersedes us while we await, our epoch will be stale.
  const epoch = settingsStore.directoryEpoch;

 // Connection check + reload via .
  console.log("[applyDir] checking connection");
  const ok = await checkConnection();
  if (!ok) {
    console.warn("[applyDir] connection failed, aborting");
    return;
  }

  if (epoch !== settingsStore.directoryEpoch) {
    console.log("[applyDir] superseded after connection check, aborting");
    return;
  }

  console.log("[applyDir] reloading project scope");
  await reloadProjectScope(options);

  if (epoch !== settingsStore.directoryEpoch) {
    console.log("[applyDir] superseded after reload, discarding");
    return;
  }
  startTaskListSSE();
  console.log("[applyDir] done, tasks=", boardStore.tasks.length);
}

// ── setActiveDirectory ──

/**
 * Set the active directory without persisting.
 * No-ops when `value` is empty or already equals the current directory.
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
    const created = await getHostTransport()
      .native({ kind: "workspace.createDir", path: target })
      .catch(() => undefined);
    if (!created) throw new Error(t("cwd.create_unavailable"));
    await setDirectory(target);
    if (settingsStore.initGit) {
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

// ── openDirectory ──

/**
 * Open the given directory (or the current active directory) with the
 * native OS file explorer.
 */
export async function openDirectory(target?: string): Promise<void> {
  const dir = target ?? activeDirectory();
  if (!dir) return;
  try {
    await nativeOpen(dir);
  } catch (e) {
    AppLog.error("ui", "Failed to open working directory", { error: String(e) });
    await nativeMessage(errorText("cwd.open_failed", e), {
      title: t("cwd.title"),
      kind: "error",
    });
  }
}

// ── openDirectoryInEditor ──

/**
 * Open the given directory or file path (or the current active directory) with
 * the requested project editor.
 */
export async function openDirectoryInEditor(
  editor: ProjectEditorID,
  target?: string,
): Promise<void> {
  await openProjectPathInEditor(editor, target ?? activeDirectory());
}

/**
 * Open a project path (directory or file) in the selected IDE.
 * Relative paths are resolved against the active project directory.
 */
export async function openProjectPathInEditor(
  editor: ProjectEditorID,
  target?: string,
): Promise<void> {
  const rawTarget = typeof target === "string" ? target.trim() : "";
  if (!rawTarget) return;
  const baseDirectory = activeDirectory();
  const resolvedTarget = absolutePath(rawTarget)
    ? rawTarget
    : baseDirectory
      ? joinPath(baseDirectory, rawTarget)
      : "";
  if (!resolvedTarget) return;
  try {
    await getHostTransport().native({
      kind: "workspace.openProjectEditor",
      editor,
      path: resolvedTarget,
    });
  } catch (e) {
    const label = PROJECT_EDITORS.find((item) => item.id === editor)?.label ?? editor;
    AppLog.error("ui", "Failed to open workspace path in editor", {
      editor,
      path: resolvedTarget,
      error: String(e),
    });
    await nativeMessage(errorText("cwd.open_editor_failed", e), {
      title: t("cwd.open_in_editor", { name: label }),
      kind: "error",
    });
  }
}

export async function openPathInSelectedEditor(target: string): Promise<void> {
  const path = editorTargetPath(target);
  if (!path) {
    if (typeof target === "string" && target.trim()) {
      await nativeMessage(t("cwd.path_required"), {
        title: t("cwd.title"),
        kind: "error",
      });
    }
    return;
  }
  await openDirectoryInEditor(settingsStore.projectEditor, path);
}

function isAbsoluteEditorPath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(path);
}

export function editorTargetPath(target: string): string {
  const path = typeof target === "string" ? target.trim() : "";
  if (!path || isAbsoluteEditorPath(path)) return path;
  const base = activeDirectory().trim();
  if (!base) return "";
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${path.replace(/^[\\/]+/, "")}`;
}

// ── setDirectory ──

/**
 * Set the working directory to `value`. `value` must be a non-empty path the
 * user explicitly chose; passing an empty string throws rather than silently
 * creating a temp workspace (that fallback was removed — see CHANGELOG for
 * the temp-workspace deletion rationale).
 */
export async function setDirectory(
  value: string,
  options: ApplyDirectoryOptions = {},
): Promise<void> {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) throw new Error(t("cwd.path_required"));
  await applyDirectory(next, { ...options, save: true });
}

// ── ensureDefaultDirectory ──

/**
 * Restore the user's last saved working directory. Returns false when none is
 * available — in which case `settingsStore.directory` stays empty and the UI
 * must surface a "select directory" CTA.
 */
export async function ensureDefaultDirectory(): Promise<boolean> {
  if (settingsStore.savedDirectory) {
    setSettingsStore("directory", settingsStore.savedDirectory);
    return true;
  }
  return false;
}

/**
 * Ensure the workspace directory is resolved. Returns the active directory
 * restored by `ensureDefaultDirectory()` (the user's last saved choice).
 * When no saved directory exists, returns an empty string so the UI can
 * surface a "select directory" CTA — we do NOT fall back to the server's
 * cwd, because a sidecar-launched server inherits the overlay binary's
 * launch directory (e.g. `target/release`), which is never a valid project
 * root and silently cancels any task that is started against it.
 */
export async function ensureWorkspaceDirectory(): Promise<string> {
  return activeDirectory();
}
