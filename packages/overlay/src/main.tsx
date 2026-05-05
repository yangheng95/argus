// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// Self-sufficient — no external script dependencies.

import { render } from "solid-js/web";
import { createEffect, createRoot, createSignal } from "solid-js";
import { Conversation } from "./components/Conversation";
import { TaskList } from "./components/TaskList";
import { Board } from "./components/Board";
import { TaskStatusHeader } from "./components/TaskStatusHeader";
import { TaskDirContent, TaskWorkspaceLine } from "./components/TaskDirBar";
import { ChatComposer } from "./components/ChatComposer";
import { WindowControls } from "./components/WindowControls";
import { TitlebarMenubar, TitlebarStatusCluster } from "./components/titlebar/TitlebarMenubar";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { FilesSection } from "./components/FilesSection";
import { FrontendPreviewPanel } from "./components/FrontendPreviewPanel";
import { AgentWorkflowPanel } from "./components/AgentWorkflowPanel";
import { DeliveryPanel, deliveryPanelDelivery } from "./components/Board";
import { LogViewer } from "./components/LogViewer";
import {
  WorkspacePanel,
  type WorkspaceView,
} from "./components/WorkspacePanel";
import type { DiffTarget } from "./services/diff";
import { initApp } from "./services/init";
import { applyTasks, loadTasks, boardStore, loadBoard, setBoardStore, setBoardData } from "./store/board";
import {
  messageStore,
  setMessages,
  setSelectedTaskID,
  setSseConnected,
} from "./store/messages";
import { appStore, setAppStore } from "./store/app";
import {
  selectTask,
  retryTask,
  replanTask,
  cancelTask,
  createTask,
  deleteTask,
} from "./services/task";
import { canComposeChat, stopChatRequest } from "./services/chat";
import { isTaskInterruptable } from "./store/board";
import { setLocale } from "./utils/i18n";
import { apiJson, apiRequest, configure as configureApi } from "./services/api";
import { t } from "./utils/i18n";
import { renderMarkdown, escapeHtml } from "./utils/markdown";
import { copyChatConversation } from "./utils/transcript";
import {
  applyTheme,
  applyZoom,
  applyOpacity,
  sanitizeZoom,
  handleZoomHotkey,
  installSystemThemeListener,
  toggleDevtools,
} from "./services/theme";
import { settingsStore, setSettingsStore, saveSettings } from "./store/settings";
import { initPaneResizers, cancelPaneResize, currentUIScale } from "./services/pane";
import { panelMessage } from "./services/chat";
import PromptCatalog from "./components/settings/PromptCatalog";
import ChannelsPanel from "./components/settings/ChannelsPanel";
import SkillMarketPanel from "./components/settings/SkillMarketPanel";
import ProvidersPanel from "./components/settings/ProvidersPanel";
import GeneralPanel from "./components/settings/GeneralPanel";
import AgentModelsPanel from "./components/settings/AgentModelsPanel";
import { PermissionsPanel } from "./components/settings/PermissionsPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { CommandPalette } from "./components/CommandPalette";
import { AppDialogHost } from "./components/AppDialogHost";
import { SessionDialogHost } from "./components/SessionDialogHost";
import { WorkspaceOnboardingDialog } from "./components/WorkspaceOnboardingDialog";
import { Tab, Tabs } from "./components/ui/Tabs";
import { waitForLogDrain, AppLog } from "./utils/log";
import { teardownApp } from "./services/init";
import { stopTimers } from "./services/sync";
import { nativeOpen, nativePrompt } from "./utils/native";
import { eventClosest } from "./utils/dom-utils";
import { shortPath } from "./utils/tool";
import {
  applyDirectory,
  browseDirectory,
  createDirectory,
  isProjectEditorID,
  openDirectory,
  openDirectoryInEditor,
  setDirectory,
  activeDirectory,
  loadRecentDirectories,
  removeRecentDirectory,
} from "./services/workspace";
import { openConfigDialog, switchConfigTab, setupDialogBackdropClose, renderAboutVersion } from "./services/dialog";
import { loadConversation } from "./store/messages";
import { cardTreeStore } from "./store/card-tree";
import {
  nextTabForPreviewResolution,
  previewRequestKey,
  resolveFrontendPreviewFromBoard,
  type FrontendPreviewResolution,
  type RightPanelTab,
} from "./services/frontend-preview";

// ── Module teardown ──
// Centralised cleanup for top-level document/window listeners and Solid roots.
// Triggered on beforeunload and on Vite HMR dispose so subsequent module
// re-executions don't stack duplicate handlers and effects.
const moduleTeardown = new AbortController();
const disposers: Array<() => void> = [];
function runModuleTeardown() {
  if (!moduleTeardown.signal.aborted) moduleTeardown.abort();
  for (const d of disposers.splice(0)) {
    try { d(); } catch { /* best-effort cleanup */ }
  }
}
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(runModuleTeardown);
}
const listenerOpts = { signal: moduleTeardown.signal } as const;

// ── Application-level signals (shared across mount points) ──

const [logOpen, setLogOpen] = createSignal(false);
const [rightPanelTab, setRightPanelTab] = createSignal<RightPanelTab>("inspector");
const [rightPanelManualKey, setRightPanelManualKey] = createSignal("");
const [frontendPreviewResolution, setFrontendPreviewResolution] =
  createSignal<FrontendPreviewResolution | null>(null);
const [frontendPreviewLoading, setFrontendPreviewLoading] = createSignal(false);
const [frontendPreviewError, setFrontendPreviewError] = createSignal("");
let frontendPreviewRequest = 0;

// ── Workspace (secondary panel, stacked above composer) state ──
// workspaceOpen drives layout visibility; workspaceView is remembered across
// open/close cycles so reopening restores the last active view.
const [workspaceOpen, setWorkspaceOpen] = createSignal(false);
const [workspaceView, setWorkspaceView] = createSignal<WorkspaceView>({
  kind: "diff",
  target: { filePath: "" },
});

function currentPreviewKey(): string {
  return previewRequestKey(boardStore.selectedTaskID || boardStore.board?.task?.id, boardStore.snapshotVersion);
}

function selectRightPanelTab(tab: RightPanelTab): void {
  setRightPanelManualKey(currentPreviewKey());
  setRightPanelTab(tab);
}

function refreshFrontendPreview(options: { manual?: boolean } = {}): void {
  const key = currentPreviewKey();
  const board = boardStore.board;
  const request = ++frontendPreviewRequest;
  if (options.manual) setRightPanelManualKey(key);
  setFrontendPreviewLoading(true);
  setFrontendPreviewError("");
  void resolveFrontendPreviewFromBoard(board)
    .then((resolution) => {
      if (request !== frontendPreviewRequest || key !== currentPreviewKey()) return;
      setFrontendPreviewResolution(resolution);
      setRightPanelTab((tab) =>
        nextTabForPreviewResolution({
          activeTab: tab,
          manualKey: rightPanelManualKey(),
          requestKey: key,
          resolution,
        }),
      );
    })
    .catch((err) => {
      if (request !== frontendPreviewRequest || key !== currentPreviewKey()) return;
      setFrontendPreviewError(err instanceof Error ? err.message : String(err));
      setFrontendPreviewResolution(null);
    })
    .finally(() => {
      if (request !== frontendPreviewRequest || key !== currentPreviewKey()) return;
      setFrontendPreviewLoading(false);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Format a millisecond timestamp for the debug blob. Returns "—" for
 *  missing / zero values so the blob stays aligned when fields are empty. */
function formatDebugTime(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build a plain-text debug blob for the currently selected task board.
 * Contains everything an operator needs to triage a stuck / mis-merged task
 * directly from the DB: identity + paths + per-goal worktree coords + ready
 * SQL. Returns `""` when no task is selected so the caller can show a hint.
 */
function buildTaskDebugBlob(board: any): string {
  const task = board?.task;
  const id = typeof task?.id === "string" ? task.id : "";
  if (!id) return "";
  const goalWorkflows: any[] = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : [];
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(
    `# Task Debug Info (double-click 任务 → clipboard)`,
    `# Generated: ${formatDebugTime(Date.now())}`,
    ``,
    `task.id:        ${id}`,
    `task.title:     ${String(task?.title ?? "—")}`,
    `task.status:    ${String(task?.status ?? "—")}`,
    `task.directory: ${String(task?.directory ?? "—")}`,
    `task.session:   ${String(task?.sessionID ?? "—")}`,
    `task.run.id:    ${String(task?.activeRunID ?? "—")}`,
    `task.time.created: ${formatDebugTime(task?.time?.created)}`,
    `task.time.updated: ${formatDebugTime(task?.time?.updated ?? task?.time?.created)}`,
    ``,
    `Goals (${goalWorkflows.length}):`,
  );
  if (goalWorkflows.length === 0) {
    push(`  (none — task has not produced goals yet)`);
  } else {
    for (const gw of goalWorkflows) {
      const gid = String(gw?.goalID ?? "?");
      const n = typeof gw?.orderIndex === "number" ? gw.orderIndex + 1 : "?";
      push(
        `  #${n}  ${gid}  ${String(gw?.goalStatus ?? "?")}  ${String(gw?.goalTitle ?? "").slice(0, 80)}`,
        `      retry:     ${gw?.retryCount ?? 0}`,
        `      workspace: ${String(gw?.workspaceDir ?? "—")}`,
        `      branch:    ${String(gw?.workspaceBranch ?? "—")}`,
      );
    }
  }
  push(
    ``,
    `Notes:`,
    `  - engine_goal stores contracts only; runtime status is derived in the board view from plan_version + iteration + protocol_event activity.`,
    `  - Phase-6-e removed the engine_run table. Runtime run snapshots now live in engine_artifact rows with kind='run'; goal attempts live in engine_artifact rows with kind='goal_run_attempt'.`,
    `  - When the workflow step list stops at 'architect.completed' with no later step row, the orchestrator has already promoted plan_version + goal_run; downstream progress lives in engine_artifact + message/part + protocol_event, not in workflow.step.updated.`,
    `  - Empty engine_milestone / engine_iteration / engine_executor_session does NOT mean nothing is running — executor_session is only persisted when the executor protocol formally registers a lease; in-process executors emit only via session.bridge.`,
    `  - LLM stream stalls bound through llm/activity.ts (withLLMActivity): every provider call has a first-byte gate, an idle gate (default 180s = session_llm_idle_ms), and a total deadline (default 30 min). Terminal events are guaranteed to fire within those bounds — done | failed | aborted, exactly one per call. If the board still appears "running" with no events past the total deadline, that's a bug at withLLMActivity (packages/opencorvus/src/llm/activity.ts) or its sink wiring, not a missing stalled-detection heuristic anywhere else.`,
    ``,
    `# SQL templates (read-only — open the DB with bun:sqlite readonly:true,`,
    `#  DB path (resolved by engine at runtime via /global/health): ${appStore.enginePaths?.database ?? "<not yet known — engine offline; reconnect and retry>"})`,
    ``,
    `-- Task snapshot (no status column — derive from time_completed / error / criteria_results)`,
    `SELECT * FROM engine_task WHERE id = '${id}';`,
    ``,
    `-- Goals & worktree coords (engine_goal has no status column — derived in the view)`,
    `SELECT id, title, kind, priority, plan_version_id, milestone_id, workspace_dir, workspace_branch, retry_count, order_index, time_updated`,
    `FROM engine_goal WHERE task_id = '${id}' ORDER BY order_index;`,
    ``,
    `-- Plan versions promoted by the planner (goals link via plan_version_id)`,
    `SELECT id, version, status, summary, time_created, time_updated`,
    `FROM engine_plan_version WHERE task_id = '${id}' ORDER BY version;`,
    ``,
    `-- Milestones in the active plan`,
    `SELECT id, plan_version_id, status, title, order_index, time_updated`,
    `FROM engine_milestone WHERE task_id = '${id}' ORDER BY order_index;`,
    ``,
    `-- Per-iteration aggregate scores (one row per planner iteration)`,
    `SELECT iteration, aggregate_score, global_score, delta_vs_prev, novelty_score,`,
    `       blocking_unmet_count, open_counterexamples, regressed_blocking, arbiter_verdict, time_updated`,
    `FROM engine_iteration WHERE task_id = '${id}' ORDER BY iteration;`,
    ``,
    `-- Run snapshots (engine_run table was removed; current state is latest payload per run_id)`,
    `SELECT run_id, label,`,
    `       json_extract(payload, '$.status') AS status,`,
    `       json_extract(payload, '$.phase') AS phase,`,
    `       json_extract(payload, '$.executor') AS executor,`,
    `       json_extract(payload, '$.session_id') AS session_id,`,
    `       json_extract(payload, '$.blocking_reason') AS blocking_reason,`,
    `       json_extract(payload, '$.error') AS error,`,
    `       time_created, time_updated`,
    `FROM engine_artifact`,
    `WHERE task_id = '${id}' AND kind='run'`,
    `ORDER BY time_created;`,
    ``,
    `-- Goal run attempts (one per begin-build-attempt; tells you which goal is currently executing)`,
    `SELECT goal_run_id, run_id, label,`,
    `       json_extract(payload, '$.goal_id') AS goal_id,`,
    `       json_extract(payload, '$.session_id') AS session_id,`,
    `       json_extract(payload, '$.status') AS status,`,
    `       json_extract(payload, '$.blocking_reason') AS blocking_reason,`,
    `       json_extract(payload, '$.error') AS error,`,
    `       json_extract(payload, '$.workspace_dir') AS workspace_dir,`,
    `       json_extract(payload, '$.merge_ref') AS merge_ref,`,
    `       time_created, time_updated`,
    `FROM engine_artifact`,
    `WHERE task_id = '${id}' AND kind='goal_run_attempt'`,
    `ORDER BY time_created;`,
    ``,
    `-- Executor sessions (only populated when executor protocol registers a lease;`,
    `--  empty rows do NOT prove no executor is running)`,
    `SELECT id, run_id, goal_run_id, provider, protocol, status, refs, lease_owner, lease_until, time_started, time_completed, time_created, time_updated`,
    `FROM engine_executor_session WHERE task_id = '${id}' ORDER BY time_created;`,
    ``,
    `-- Sessions belonging to this task (root/orchestrator/build children)`,
    `WITH RECURSIVE session_tree(id) AS (`,
    `  SELECT session_id FROM engine_task WHERE id = '${id}'`,
    `  UNION ALL`,
    `  SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id`,
    `)`,
    `SELECT s.id, s.parent_id, s.kind, s.goal_id, s.title, s.directory, s.time_created, s.time_updated`,
    `FROM session s JOIN session_tree st ON s.id = st.id`,
    `ORDER BY s.time_created;`,
    ``,
    `-- Recent messages in task sessions (unfinished assistant rows often reveal stream stalls)`,
    `WITH RECURSIVE session_tree(id) AS (`,
    `  SELECT session_id FROM engine_task WHERE id = '${id}'`,
    `  UNION ALL`,
    `  SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id`,
    `)`,
    `SELECT m.id, m.session_id, json_extract(m.data, '$.role') AS role,`,
    `       json_extract(m.data, '$.agent') AS agent,`,
    `       json_extract(m.data, '$.finish') AS finish,`,
    `       json_extract(m.data, '$.tokens.total') AS total_tokens,`,
    `       m.time_created, m.time_updated`,
    `FROM message m JOIN session_tree st ON m.session_id = st.id`,
    `ORDER BY m.time_created DESC LIMIT 80;`,
    ``,
    `-- Recent parts in task sessions (tool calls, pending tools, patches, and text deltas)`,
    `WITH RECURSIVE session_tree(id) AS (`,
    `  SELECT session_id FROM engine_task WHERE id = '${id}'`,
    `  UNION ALL`,
    `  SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id`,
    `)`,
    `SELECT p.id, p.message_id, p.session_id,`,
    `       json_extract(p.data, '$.type') AS part_type,`,
    `       json_extract(p.data, '$.tool') AS tool,`,
    `       json_extract(p.data, '$.state.status') AS tool_status,`,
    `       json_extract(p.data, '$.state.title') AS title,`,
    `       p.time_created, p.time_updated`,
    `FROM part p JOIN session_tree st ON p.session_id = st.id`,
    `ORDER BY p.time_created DESC LIMIT 120;`,
    ``,
    `-- Requirements parsed by the requirements stage`,
    `SELECT id, title, status, priority, order_index FROM engine_requirement`,
    `WHERE task_id = '${id}' ORDER BY order_index;`,
    ``,
    `-- Spec snapshots (architect / requirements input)`,
    `SELECT id, version, status, summary, time_created FROM engine_spec_snapshot`,
    `WHERE task_id = '${id}' ORDER BY version;`,
    ``,
    `-- Artifacts emitted by goal runs / deliveries (commit refs, reports, etc. land here)`,
    `SELECT id, run_id, goal_run_id, delivery_id, kind, label, payload, time_created, time_updated FROM engine_artifact`,
    `WHERE task_id = '${id}' ORDER BY time_created;`,
    ``,
    `-- Workflow step transitions (architect / requirements / design_analysis / planner)`,
    `SELECT type, source, emitted_at,`,
    `       json_extract(payload, '$.stepID') AS step_id,`,
    `       json_extract(payload, '$.status') AS step_status,`,
    `       json_extract(payload, '$.summary') AS summary`,
    `FROM protocol_event WHERE task_id = '${id}' AND type='workflow.step.updated'`,
    `ORDER BY emitted_at;`,
    ``,
    `-- Integrity-review lifecycle (started / progress / completed) — useful when stuck post-architect`,
    `SELECT type, source, emitted_at, payload FROM protocol_event`,
    `WHERE task_id = '${id}' AND (type LIKE 'integrity%' OR source LIKE 'architect.integrity%')`,
    `ORDER BY emitted_at;`,
    ``,
    `-- Recent non-stream events (skip session.bridge token noise to see real progress)`,
    `SELECT type, source, emitted_at FROM protocol_event`,
    `WHERE task_id = '${id}' AND source <> 'session.bridge'`,
    `ORDER BY emitted_at DESC LIMIT 60;`,
    ``,
    `-- Recent protocol events incl. token stream (last 2 min)`,
    `SELECT type, source, emitted_at FROM protocol_event`,
    `WHERE task_id = '${id}' AND emitted_at > strftime('%s','now','-2 minutes')*1000`,
    `ORDER BY emitted_at DESC LIMIT 60;`,
  );
  return lines.join("\n");
}

/**
 * Open the workspace panel, optionally with a specific view. If no view is
 * supplied, the last-used view is restored.
 */
function openWorkspace(view?: WorkspaceView): void {
  if (view) setWorkspaceView(view);
  setWorkspaceOpen(true);
}

/** Close the workspace panel. */
function closeWorkspace(): void {
  setWorkspaceOpen(false);
}

/** Toggle the workspace open/closed, restoring the remembered view. */
function toggleWorkspace(): void {
  if (workspaceOpen()) closeWorkspace();
  else openWorkspace();
}

/** Open (or switch to) a diff file in the workspace. */
function openWorkspaceDiff(target: DiffTarget): void {
  openWorkspace({ kind: "diff", target });
}

/** Open (or switch to) a file preview in the workspace. */
function openWorkspaceFile(filePath: string): void {
  openWorkspace({ kind: "file", filePath });
}

// Exposed for services and window-level bridges that need to trigger the
// workspace from outside this module (e.g. ChangesPanel clicks).
(window as any).openWorkspaceDiff = openWorkspaceDiff;
(window as any).openWorkspaceFile = openWorkspaceFile;

// Delegate clicks on rendered-markdown file links (see utils/markdown.ts —
// codespans that look like file paths are emitted with data-file-path).
// A single document-level listener keeps this decoupled from the message
// rendering path, which re-runs on every stream tick.
document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const link = target.closest<HTMLElement>("[data-file-path]");
  if (!link) return;
  const path = link.getAttribute("data-file-path");
  if (!path) return;
  ev.preventDefault();
  openWorkspaceFile(path);
}, listenerOpts);

document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("data-file-path")) return;
  const href = anchor.getAttribute("href") || "";
  if (!/^https?:\/\//i.test(href)) return;
  ev.preventDefault();
  void nativeOpen(href).catch((error) => {
    console.error("[ui] Failed to open external link", error);
  });
}, listenerOpts);

// Code-block copy buttons rendered by utils/markdown.ts wrapCodeBlock.
// markdown HTML lives inside innerHTML on streamed text — wiring per-button
// click handlers in Solid would require re-binding on every stream tick,
// so a single document-level listener keeps the renderer pure.
document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const btn = target.closest<HTMLButtonElement>("button[data-md-copy]");
  if (!btn) return;
  ev.preventDefault();
  ev.stopPropagation();
  const source = btn.getAttribute("data-md-copy") || "";
  if (!source) return;
  const flash = (text: string) => {
    btn.dataset.copied = "true";
    const prev = btn.getAttribute("aria-label") || "";
    btn.setAttribute("aria-label", text);
    btn.title = text;
    setTimeout(() => {
      delete btn.dataset.copied;
      btn.setAttribute("aria-label", prev || "Copy code");
      btn.title = prev || "Copy code";
    }, 1400);
  };
  const decoded = source
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  void (async () => {
    try {
      await navigator.clipboard.writeText(decoded);
      flash("Copied");
    } catch (err) {
      console.error("[md-copy] clipboard write failed", err);
      flash("Copy failed");
    }
  })();
}, listenerOpts);

function installGlobalBridges(): void {
  (window as any).renderMarkdown = renderMarkdown;
  (window as any).persistOverlaySettings = async () => {
    saveSettings();
  };
  (window as any).stepZoom = (delta: number) => {
    const next = sanitizeZoom((settingsStore.zoom || 1) + delta);
    setSettingsStore("zoom", next);
    applyZoom(next);
    saveSettings();
  };
  // Benchmark / test instrumentation: direct bridge into reactive stores.
  // Tests mutate this proxy and expect the real Solid UI to update immediately.
  const testStateTarget: Record<string, unknown> = {};
  const readState = (prop: PropertyKey): unknown => {
    if (typeof prop !== "string") return Reflect.get(testStateTarget, prop);
    if (prop === "directory") return activeDirectory();
    if (prop === "board") return boardStore.board;
    if (prop === "tasks") return boardStore.tasks;
    if (prop === "pendingTasks") return boardStore.pendingTasks;
    if (prop === "selectedTaskID") return boardStore.selectedTaskID;
    if (prop === "path") return boardStore.path;
    if (prop === "vcs") return boardStore.vcs;
    if (prop === "changes") return boardStore.changes;
    if (prop === "messages") return messageStore.messages;
    if (prop === "sseConnected") return messageStore.sseConnected;
    if (prop in appStore) return (appStore as unknown as Record<string, unknown>)[prop];
    if (prop === "settings") return settingsStore;
    if (prop in settingsStore) return (settingsStore as unknown as Record<string, unknown>)[prop];
    return Reflect.get(testStateTarget, prop);
  };
  const writeState = (prop: PropertyKey, value: unknown): boolean => {
    if (typeof prop !== "string") return Reflect.set(testStateTarget, prop, value);
    if (prop === "directory") {
      setSettingsStore("directory", typeof value === "string" ? value : "");
      return true;
    }
    if (prop === "board") {
      setBoardData(value as any);
      return true;
    }
    if (prop === "tasks") {
      applyTasks(Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "pendingTasks") {
      setBoardStore("pendingTasks", Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "selectedTaskID") {
      const next = typeof value === "string" ? value : "";
      setBoardStore("selectedTaskID", next);
      setSelectedTaskID(next);
      return true;
    }
    if (prop === "path") {
      setBoardStore("path", value as any);
      return true;
    }
    if (prop === "vcs") {
      setBoardStore("vcs", value as any);
      return true;
    }
    if (prop === "changes") {
      setBoardStore("changes", Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "messages") {
      setMessages(Array.isArray(value) ? (value as any[]) : []);
      return true;
    }
    if (prop === "sseConnected") {
      setSseConnected(value === true);
      return true;
    }
    if (prop in appStore) {
      setAppStore(prop as any, value as any);
      return true;
    }
    if (prop in settingsStore) {
      setSettingsStore(prop as any, value as any);
      return true;
    }
    return Reflect.set(testStateTarget, prop, value);
  };
  (window as any).state = new Proxy(testStateTarget, {
    get(_target, prop) {
      return readState(prop);
    },
    set(_target, prop, value) {
      return writeState(prop, value);
    },
    ownKeys() {
      return Array.from(
        new Set([
          ...Reflect.ownKeys(testStateTarget),
          ...Object.keys(boardStore),
          ...Object.keys(messageStore),
          ...Object.keys(appStore),
          ...Object.keys(settingsStore),
          "directory",
          "settings",
        ]),
      );
    },
    getOwnPropertyDescriptor(_target, prop) {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: readState(prop),
      };
    },
  });
  // Test hook: snapshot the current card tree as a flat JSON shape. Used by
  // Playwright / integration tests to read the live store-backed tree.
  (window as any).renderConversation = () =>
    cardTreeStore.order.map((id) => cardTreeStore.cards[id]).filter(Boolean);
  (window as any).cardTree = cardTreeStore;
  (window as any).applyDirectory = applyDirectory;
  (window as any).loadTasks = loadTasks;
  (window as any).selectTask = selectTask;
  (window as any).loadBoard = loadBoard;
  (window as any).loadConversation = loadConversation;
}

function installGoalFormHandlers(): void {
  const form = document.getElementById("goalForm") as HTMLFormElement | null;
  const dialog = document.getElementById("goalDialog") as HTMLDialogElement | null;
  const cancelBtn = document.getElementById("btnCancelGoal");
  if (!form || !dialog) return;
  if ((form as any).__goalBound) return;
  (form as any).__goalBound = true;

  cancelBtn?.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!boardStore.selectedTaskID) return;
    const goalID = (document.getElementById("goalId") as HTMLInputElement | null)?.value.trim() || "";
    const title = (document.getElementById("goalDescription") as HTMLTextAreaElement | null)?.value.trim() || "";
    const acceptanceText = (document.getElementById("goalCriteria") as HTMLTextAreaElement | null)?.value.trim() || "";
    if (!title) return;
    const taskID = boardStore.selectedTaskID || undefined;

    // Non-blocking save: close the dialog immediately and fire the update
    // asynchronously so the operator's UI is never frozen waiting for the
    // server. Errors surface via console + subsequent loadBoard diff.
    dialog.close();

    void (async () => {
      try {
        if (goalID) {
          // The backend's UpdateGoalInput requires acceptance_specs[].min(1).
          // Wrap the operator's free-text criterion into a single essential
          // llm_judge spec — same shape that addOperatorGoal synthesizes when
          // an operator-defined goal arrives without structured specs. We
          // intentionally keep the form simple (one textarea) rather than
          // expose the full spec editor; richer authoring belongs to the
          // requirements agent's structured tools.
          const fallbackCriterion = "The requested change is implemented and acceptance checks pass.";
          const criterion = acceptanceText || fallbackCriterion;
          const acceptanceSpec = {
            id: `acc-operator-${goalID}-${Date.now()}`,
            source_requirement_id: "operator",
            goal_id: goalID,
            title: title.slice(0, 80),
            severity: "essential",
            scorers: [
              {
                type: "llm_judge",
                name: "operator-acceptance",
                criteria: criterion,
                inputs: ["delivery_summary", "changed_files"],
              },
            ],
          };
          await panelMessage(`Update goal ${goalID}.`, {
            goalID,
            description: title,
            acceptance_specs: [acceptanceSpec],
            taskID,
          });
        } else {
          const payload = acceptanceText ? `/goal ${title}\nAcceptance: ${acceptanceText}` : `/goal ${title}`;
          await panelMessage(payload, { taskID });
        }
        await loadBoard({ sync: true });
      } catch (err) {
        console.error("Failed to save goal", err);
      }
    })();
  });
}

installGlobalBridges();
setupDialogBackdropClose();
installGoalFormHandlers();

// ── Mount: Conversation ──

const chatScroll = document.getElementById("chatScroll");
if (chatScroll) {
  chatScroll.innerHTML = "";
  render(() => <Conversation container={chatScroll} />, chatScroll);
}

// ── Mount: WorkspacePanel (Diff / File) ──

const workspaceMountEl = document.getElementById("solidWorkspaceMount");
if (workspaceMountEl) {
  workspaceMountEl.innerHTML = "";
  render(
    () => (
      <WorkspacePanel
        view={workspaceView()}
        onSelectView={setWorkspaceView}
        onClose={closeWorkspace}
      />
    ),
    workspaceMountEl,
  );
}

// ── Sidebar title backdoor: double-click resets DB ──
// Hidden operator escape hatch. Confirms before invoking POST /global/db/reset,
// then reloads to repopulate from a clean schema.
const sidebarTitleEl = document.querySelector<HTMLElement>(".sidebar-title");
if (sidebarTitleEl) {
  sidebarTitleEl.addEventListener("dblclick", async (ev) => {
    ev.preventDefault();
    if (!window.confirm(t("sidebar.reset_db_confirm"))) return;
    try {
      const res = await apiRequest<unknown>("global/db/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        responseKind: "text",
      });
      if (res.status === 409) {
        window.alert(t("sidebar.reset_db_blocked"));
        return;
      }
      if (!res.ok) {
        const text = typeof res.body === "string" && res.body ? res.body : `HTTP ${res.status}`;
        window.alert(t("sidebar.reset_db_failed", { error: text }));
        return;
      }
      window.location.reload();
    } catch (err) {
      window.alert(t("sidebar.reset_db_failed", { error: err instanceof Error ? err.message : String(err) }));
    }
  });
}

// ── Mount: TaskList ──

const taskListEl = document.getElementById("taskListPanel");
if (taskListEl) {
  taskListEl.innerHTML = "";
  render(
    () => (
      <TaskList
        onSelectTask={(taskID) => void selectTask(taskID)}
        onDeleteTask={(taskID) => void deleteTask(taskID)}
        onCancelTask={(taskID) => void cancelTask(taskID)}
      />
    ),
    taskListEl,
  );
}

// ── Mount: Board (Spec / Plan / Goals / Criteria / Delivery / Interactions) ──

const boardEl = document.getElementById("solidBoardMount");
if (boardEl) {
  boardEl.innerHTML = "";
  render(
    () => (
      <Board
        onRetry={async () => {
          const id = boardStore.selectedTaskID;
          if (!id) return;
          void retryTask(id);
        }}
        onReplan={() => {
          const id = boardStore.selectedTaskID;
          if (id) void replanTask(id);
        }}
        onCancel={() => {
          const id = boardStore.selectedTaskID;
          if (id) void cancelTask(id);
        }}
        onEditGoal={(goalId, title, detail) => {
          const goalDialog = document.getElementById("goalDialog") as HTMLDialogElement | null;
          const goalIdInput = document.getElementById("goalId") as HTMLInputElement | null;
          const goalDesc = document.getElementById("goalDescription") as HTMLTextAreaElement | null;
          const goalCrit = document.getElementById("goalCriteria") as HTMLTextAreaElement | null;
          if (!goalDialog || !goalIdInput || !goalDesc || !goalCrit) return;
          goalIdInput.value = goalId || "";
          goalDesc.value = title || "";
          goalCrit.value = detail || "";
          goalDialog.show();
        }}
        onDeleteGoal={async (goalId) => {
          if (!goalId || !boardStore.selectedTaskID) return;
          try {
            await panelMessage(`Delete goal ${goalId}.`, {
              goalID: goalId,
              taskID: boardStore.selectedTaskID || undefined,
            });
            await loadBoard({ sync: true });
          } catch (e) {
            console.error("Failed to delete goal", e);
          }
        }}
      />
    ),
    boardEl,
  );
}

// ── Mount: ChatComposer ──

// One-shot follow-up suggestion the composer should pre-fill after a task
// finishes. Populated by a busy→idle effect below; cleared by the composer
// via onSuggestionConsumed after it either injects or drops the value.
const [pendingSuggestion, setPendingSuggestion] = createSignal("");
// Track the previous task-busy state so we only fire once per finish edge.
let lastTaskBusy = false;
let lastSuggestionTaskID: string | null = null;
createEffect(() => {
  const busyNow =
    !!messageStore.chatRequest || isTaskInterruptable();
  const wasBusy = lastTaskBusy;
  lastTaskBusy = busyNow;
  // Each busy→true edge resets the guard so the next finish is eligible for
  // a fresh suggestion even if it's the same task.
  if (busyNow && !wasBusy) {
    lastSuggestionTaskID = null;
    return;
  }
  if (!wasBusy || busyNow) return;
  const taskID = boardStore.selectedTaskID;
  if (!taskID) return;
  if (lastSuggestionTaskID === taskID) return;
  lastSuggestionTaskID = taskID;
  void apiJson(`task/${encodeURIComponent(taskID)}/followup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then((data: any) => {
      const text = typeof data?.suggestion === "string" ? data.suggestion.trim() : "";
      if (text) setPendingSuggestion(text);
    })
    .catch((err) => {
      AppLog.warn("main", "followup suggestion failed", err);
    });
});

const composerEl = document.getElementById("solidChatComposer");
if (composerEl) {
  render(
    () => (
      <ChatComposer
        enabled={canComposeChat()}
        // Composer busy ≡ a send request is in flight (SSE stream open).
        // A running task no longer disables the composer: the user can queue
        // additional messages; `panelMessage` routes them as operator notes /
        // inject via `task/:id/message`. Task cancellation lives on the task
        // row's CancelButton, not in the composer.
        busy={!!messageStore.chatRequest}
        stopping={!!(messageStore.chatRequest as any)?.stopping}
        pendingSuggestion={pendingSuggestion()}
        onSuggestionConsumed={() => setPendingSuggestion("")}
        onSubmit={(text, attachments, webSearch) =>
          panelMessage(text, attachments, webSearch ? { web_search: true } : {})
        }
        onStop={() => {
          // Abort the in-flight send request ONLY — no remote cancel. Task-level
          // interrupt is an explicit action on the task row's CancelButton so a
          // stray composer stop never tears down the underlying task.
          if (messageStore.chatRequest) {
            void stopChatRequest({ remote: false });
          }
        }}
      />
    ),
    composerEl,
  );
}

// ── Wire: Terminate button ──

const btnTerminateRun = document.getElementById("btnTerminateRun");
if (btnTerminateRun) {
  btnTerminateRun.addEventListener("click", () => {
    // If there's an active chat request (SSE stream), stop it first
    if (messageStore.chatRequest) {
      void stopChatRequest();
      return;
    }
    // Otherwise cancel the active task
    const taskID = boardStore.selectedTaskID;
    if (taskID) void cancelTask(taskID);
  });
}

// ── Mount: WindowControls ──

const windowControlsEl = document.getElementById("solidWindowControls");
if (windowControlsEl) {
  render(() => <WindowControls />, windowControlsEl);
}

// ── Mount: TitlebarMenubar ──

const titlebarMenuEl = document.getElementById("solidTitlebarMenu");
if (titlebarMenuEl) {
  render(
    () => (
      <TitlebarMenubar onOpenLog={() => setLogOpen(true)} />
    ),
    titlebarMenuEl,
  );
}

const titlebarStatusEl = document.getElementById("solidTitlebarStatus");
if (titlebarStatusEl) {
  render(() => <TitlebarStatusCluster onOpenLog={() => setLogOpen(true)} />, titlebarStatusEl);
}

// ── Mount: ConnectionBadge ──

const connBadgeEl = document.getElementById("solidConnBadge");
if (connBadgeEl) {
  render(() => <ConnectionBadge />, connBadgeEl);
}

// ── Mount: TaskDirContent + TaskWorkspaceLine ──
// Reactive replacement for services/meta.ts renderMeta() — both spans now
// derive from settingsStore.directory + boardStore.path through Solid memos.

const taskDirMountEl = document.getElementById("solidTaskDirMount");
if (taskDirMountEl) {
  render(() => <TaskDirContent />, taskDirMountEl);
}
const taskWorkspaceMountEl = document.getElementById("solidTaskWorkspaceLineMount");
if (taskWorkspaceMountEl) {
  render(() => <TaskWorkspaceLine />, taskWorkspaceMountEl);
}

// ── Mount: TaskStatusHeader ──
// Reactive replacement for the previous imperative createEffects in main.tsx
// that toggled #taskStatus[hidden], wrote #statusIcon.innerHTML, set
// #statusLabel textContent and ticked #taskElapsed via getElementById each
// frame. Owns its own visibility-gated 1Hz interval via Solid lifecycle.

const taskStatusMountEl = document.getElementById("solidTaskStatusMount");
if (taskStatusMountEl) {
  render(() => <TaskStatusHeader />, taskStatusMountEl);
}

// ── Mount: Right panel Inspector / Preview tabs ──

const rightPanelTabsEl = document.getElementById("solidRightPanelTabs");
if (rightPanelTabsEl) {
  render(
    () => (
      <Tabs
        size="sm"
        tone="neutral"
        aria-label={t("right_panel.tabs")}
        data-ui="right-tabs"
      >
        <Tab
          active={rightPanelTab() === "workflow"}
          size="sm"
          tone="neutral"
          onClick={() => selectRightPanelTab("workflow")}
          data-ui="right-tab"
        >
          {t("right_panel.workflow")}
        </Tab>
        <Tab
          active={rightPanelTab() === "inspector"}
          size="sm"
          tone="neutral"
          onClick={() => selectRightPanelTab("inspector")}
          data-ui="right-tab"
        >
          {t("right_panel.inspector")}
        </Tab>
        <Tab
          active={rightPanelTab() === "preview"}
          size="sm"
          tone="neutral"
          onClick={() => selectRightPanelTab("preview")}
          data-ui="right-tab"
        >
          {t("right_panel.preview")}
        </Tab>
      </Tabs>
    ),
    rightPanelTabsEl,
  );
}

const frontendPreviewMountEl = document.getElementById("solidFrontendPreviewMount");
if (frontendPreviewMountEl) {
  render(
    () => (
      <FrontendPreviewPanel
        resolution={frontendPreviewResolution()}
        loading={frontendPreviewLoading()}
        error={frontendPreviewError()}
        onRefresh={() => refreshFrontendPreview({ manual: true })}
      />
    ),
    frontendPreviewMountEl,
  );
}

createEffect(() => {
  const active = rightPanelTab();
  const workflow = document.getElementById("rightPanelWorkflow");
  const inspector = document.getElementById("rightPanelInspector");
  const preview = document.getElementById("rightPanelPreview");
  workflow?.setAttribute("data-active", active === "workflow" ? "true" : "false");
  inspector?.setAttribute("data-active", active === "inspector" ? "true" : "false");
  preview?.setAttribute("data-active", active === "preview" ? "true" : "false");
});

const agentWorkflowMountEl = document.getElementById("solidAgentWorkflowMount");
if (agentWorkflowMountEl) {
  render(() => <AgentWorkflowPanel />, agentWorkflowMountEl);
}

let lastFrontendPreviewKey = "";
createEffect(() => {
  const taskID = boardStore.selectedTaskID || boardStore.board?.task?.id || "";
  const snapshot = boardStore.snapshotVersion || "";
  const key = previewRequestKey(taskID, snapshot);
  if (!taskID) {
    lastFrontendPreviewKey = key;
    setFrontendPreviewResolution(null);
    setFrontendPreviewError("");
    setFrontendPreviewLoading(false);
    return;
  }
  if (key === lastFrontendPreviewKey) return;
  lastFrontendPreviewKey = key;
  refreshFrontendPreview();
});

// ── Mount: ChangesPanel ──

const filesSectionMountEl = document.getElementById("solidFilesSectionMount");
if (filesSectionMountEl) {
  render(() => <FilesSection />, filesSectionMountEl);
}

// ── Mount: DeliveryPanel ──
// Surfaces every delivery activity: deterministic gate checks, runtime flows,
// specialist reviews, agent verdict. Without this mount the DeliveryPanel
// component existed in components/Board.tsx but never reached the DOM, so the
// overlay rendered nothing for any delivery state — even though the bench
// emitted delivery.ready / delivery.evidence.updated and the board hydrated
// candidateDelivery.evidenceManifest. Reactive on boardStore.board so each
// snapshot refresh re-renders the rows.

const deliveryMountEl = document.getElementById("solidDeliveryMount");
if (deliveryMountEl) {
  render(
    () => (
      <DeliveryPanel
        delivery={deliveryPanelDelivery(boardStore.board as any)}
      />
    ),
    deliveryMountEl,
  );
}

// ── Mount: LogViewer (renders its own <dialog id="logDialog">) ──

const logViewerEl = document.getElementById("solidLogViewer");
if (logViewerEl) {
  render(
    () => (
      <LogViewer
        open={logOpen()}
        onClose={() => setLogOpen(false)}
      />
    ),
    logViewerEl,
  );
}

// ── Mount: Config Dialog Panels ──

const promptBody = document.getElementById("promptBody");
if (promptBody) {
  promptBody.innerHTML = "";
  render(() => <PromptCatalog />, promptBody);
}

const generalBody = document.getElementById("generalBody");
if (generalBody) {
  generalBody.innerHTML = "";
  render(() => <GeneralPanel />, generalBody);
}

const permissionsBody = document.getElementById("permissionsBody");
if (permissionsBody) {
  permissionsBody.innerHTML = "";
  render(() => <PermissionsPanel />, permissionsBody);
}

const channelConfigBody = document.getElementById("channelConfigBody");
if (channelConfigBody) {
  channelConfigBody.innerHTML = "";
  render(() => <ChannelsPanel />, channelConfigBody);
}

const toolsConfigBody = document.getElementById("toolsConfigBody");
if (toolsConfigBody) {
  toolsConfigBody.innerHTML = "";
  render(() => <SkillMarketPanel />, toolsConfigBody);
}

const memoryBody = document.getElementById("memoryBody");
if (memoryBody) {
  memoryBody.innerHTML = "";
  render(
    () => <MemoryPanel taskID={boardStore.selectedTaskID || undefined} />,
    memoryBody,
  );
}

const providersConfigBody = document.getElementById("providersConfigBody");
if (providersConfigBody) {
  providersConfigBody.innerHTML = "";
  render(() => <ProvidersPanel />, providersConfigBody);
}

// AgentModelsPanel auto-fetches at mount via createResource. Defer mount until
// initApp() has run syncApiConfig(), otherwise the initial /agent +
// /config/providers fetches go out before credentials/serverUrl are set —
// which hangs the WebView when Basic auth is configured.

// ── Native dialog close handlers ──
// Settings dialog (configDialog) close button — no longer handles it.

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("btnCloseConfigDialog")
    ?.addEventListener("click", () => {
      (
        document.getElementById("configDialog") as HTMLDialogElement | null
      )?.close();
    });
 // ── Config tab navigation ──
  document.getElementById("configSidebar")?.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>(".config-nav-item");
    const tab = btn?.dataset.configTab;
    if (tab) switchConfigTab(tab);
  });

 // ── Config sidebar resizer ──
  {
    const configResizer = document.getElementById("configResizer");
    const configSidebar = document.getElementById("configSidebar");
    configResizer?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !configSidebar) return;
      configResizer.dataset.active = "true";
      document.body.dataset.resizing = "true";
      e.preventDefault();
      const layout = configSidebar.parentElement;
      function onMove(ev: PointerEvent) {
        if (!layout) return;
        const rect = layout.getBoundingClientRect();
        const scale = currentUIScale();
        const min = 140 * scale;
        const max = 320 * scale;
        const next = Math.round(Math.min(max, Math.max(min, ev.clientX - rect.left)));
        configSidebar!.style.width = next + "px";
        configSidebar!.style.minWidth = next + "px";
      }
      function onUp() {
        delete configResizer!.dataset.active;
        delete document.body.dataset.resizing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

 // ── Workspace panel resizer ──
 // Drag the horizontal divider above the workspace to adjust its height.
 // Height is persisted to settings.workspacePanelHeight and applied as an
 // inline style on #solidWorkspaceMount. The workspace is stacked inside
 // #chatSection between #chatScroll and #solidChatComposer.
  {
    const resizer = document.getElementById("workspaceResizer");
    const mount = document.getElementById("solidWorkspaceMount");
    const applyHeight = (px: number) => {
      if (!mount) return;
      mount.style.height = px + "px";
      mount.style.minHeight = px + "px";
      mount.style.maxHeight = px + "px";
    };
    // Restore persisted height on startup.
    if (settingsStore.workspacePanelHeight != null) {
      applyHeight(settingsStore.workspacePanelHeight);
    }
    resizer?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !mount) return;
      resizer.dataset.active = "true";
      // "row" — use row-resize cursor globally during the drag, distinct
      // from column resizers which set data-resizing="true".
      document.body.dataset.resizing = "row";
      e.preventDefault();
      const chatSection = document.getElementById("chatSection");
      const composer = document.getElementById("solidChatComposer");
      function onMove(ev: PointerEvent) {
        if (!chatSection) return;
        const rect = chatSection.getBoundingClientRect();
        const scale = currentUIScale();
        // Leave room for chat-scroll (minimum) and the composer above/below.
        const composerH = composer?.getBoundingClientRect().height ?? 0;
        const chatScrollMin = 160 * scale;
        const min = 160 * scale;
        const max = Math.max(
          min + 40,
          rect.height - chatScrollMin - composerH,
        );
        // Workspace is directly above the composer — its height is measured
        // from the top edge of the composer upward to the pointer.
        const composerTop = composer
          ? composer.getBoundingClientRect().top
          : rect.bottom;
        const next = Math.round(
          Math.min(max, Math.max(min, composerTop - ev.clientY)),
        );
        applyHeight(next);
      }
      function onUp() {
        delete resizer!.dataset.active;
        delete document.body.dataset.resizing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        // Persist the final height.
        const height = mount && mount.style.height
          ? parseInt(mount.style.height, 10)
          : null;
        if (Number.isFinite(height) && height! > 0) {
          setSettingsStore("workspacePanelHeight", height);
          saveSettings();
        }
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

 // ── Sidebar buttons ──
  document.getElementById("btnRefreshTasks")?.addEventListener("click", () => {
    void loadTasks();
  });
  document.getElementById("btnSidebarToggle")?.addEventListener("click", () => {
    const next = !settingsStore.sidebarCollapsed;
    setSettingsStore("sidebarCollapsed", next);
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.dataset.collapsed = String(next);
    const toggleBtn = document.getElementById("btnSidebarToggle");
    if (toggleBtn) toggleBtn.title = next ? t("sidebar.open") : t("sidebar.close");
    saveSettings();
  });
  document.getElementById("btnCreateTask")?.addEventListener("click", () => {
    // Deselect current task and focus the composer — the user types their
    // request directly in the ChatComposer, no modal dialog needed.
    void selectTask("");
    const textarea = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea");
    textarea?.focus();
  });

  // Executor selection moved to <ExecutorSelector/> mounted inside ChatComposer
  // (chat-compose-meta-left). The component owns its own dropdown, click-out
  // dismissal and Escape handling — Solid lifecycle disposes both on unmount.
});

// ── Initialise application ──

document.getElementById("btnWorkspaceToggle")?.addEventListener("click", () => {
  toggleWorkspace();
});
document.getElementById("btnChatCopyAll")?.addEventListener("click", () => {
  void copyChatConversation();
});

disposers.push(createRoot((dispose) => {
  // body.dataset.workspace / .connection writes were dead — no CSS or JS in
  // the codebase reads either attribute. Removed (rule 10). The static
  // initial `data-workspace="offline"` in index.html is also stripped.

  createEffect(() => {
    applyTheme(settingsStore.theme);
    applyZoom(settingsStore.zoom);
    applyOpacity(settingsStore.opacity);
  });

  createEffect(() => {
    configureApi({
      serverUrl: settingsStore.serverUrl,
      username: settingsStore.username,
      password: settingsStore.password,
      directory: settingsStore.directory,
    });
  });

  createEffect(() => {
    void setLocale(settingsStore.locale);
  });

  createEffect(() => {
    const count = messageStore.messages.length;
    const chatCount = document.getElementById("chatCount");
    const copyBtn = document.getElementById("btnChatCopyAll") as HTMLButtonElement | null;
    if (chatCount) chatCount.textContent = count > 0 ? String(count) : "";
    if (copyBtn) copyBtn.disabled = count === 0;
  });

  // ── Debug-copy (double-click `任务` header) ──
  // Dumps a plain-text debug blob with everything a human needs to diagnose a
  // stuck / mis-merged task from the DB: task id, project dir, session, active
  // run, per-goal worktree path + branch + retry count, plus ready-to-paste
  // SQL queries keyed on the task id. Reads `boardStore.board` — the live
  // projection for the currently selected task — so no extra fetch.
  //
  // Triggered by a double-click on `.chat-title` (the "任务" label). Single
  // click remains free for future use. The same button flashes a "已复制"
  // hint via a transient `data-copied` attribute.
  {
    const title = document.querySelector(".chat-title") as HTMLElement | null;
    if (title) {
      title.style.cursor = "copy";
      title.title =
        "双击复制调试信息 (task id / directory / session / run / worktrees + SQL)";
      const flash = (text: string) => {
        title.dataset.copied = "true";
        const prev = title.textContent ?? "";
        title.textContent = text;
        setTimeout(() => {
          delete title.dataset.copied;
          title.textContent = prev;
        }, 1400);
      };
      title.addEventListener("dblclick", async (ev) => {
        ev.preventDefault();
        const blob = buildTaskDebugBlob(boardStore.board);
        if (!blob) {
          flash("无任务");
          return;
        }
        try {
          await navigator.clipboard.writeText(blob);
          flash("已复制");
        } catch (err) {
          console.error("[chat-title dblclick] clipboard write failed", err);
          flash("复制失败");
        }
      });
    }
  }

  // ── Task-switch progress bar (non-blocking) ──
  // Reflects boardStore.taskSwitching (set synchronously at selectTask entry,
  // cleared when the async load chain completes). The bar lives in a fixed
  // slot above the chat header so user input is never gated on load.
  createEffect(() => {
    const active = boardStore.taskSwitching;
    const bar = document.getElementById("taskSwitchProgress");
    if (!bar) return;
    bar.setAttribute("data-active", active ? "true" : "false");
    bar.setAttribute("aria-busy", active ? "true" : "false");
  });

  // ── Workspace visibility ──
  // Drives the show/hide of the workspace mount + resizer.
  createEffect(() => {
    const open = workspaceOpen();

    const mount = document.getElementById("solidWorkspaceMount");
    const resizer = document.getElementById("workspaceResizer");
    if (mount) (mount as HTMLElement).hidden = !open;
    if (resizer) (resizer as HTMLElement).hidden = !open;

    // Reflect open state on the toggle button for visual/a11y feedback.
    const toggleBtn = document.getElementById("btnWorkspaceToggle");
    if (toggleBtn) toggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
  });

  // Task status header + elapsed timer moved to <TaskStatusHeader/> component
  // (mounted into #solidTaskStatusMount above). The component owns its own
  // visibility-gated 1Hz interval and renders all four spans (status-icon,
  // status-label, elapsed) via Solid's reactive graph instead of four
  // getElementById writes per board update.

 // interactionBridge.renderInteractions removed — the unified InteractionCard
 // renders the UI in both inline conversation and sidebar surfaces, and

  return dispose;
}));

const paneCallbacks = {
  getState: () => ({
    sidebarCollapsed: settingsStore.sidebarCollapsed,
    sidebarWidth: settingsStore.sidebarWidth,
    sectionsWidth: settingsStore.sectionsWidth,
  }),
  onWidthsChanged: (sidebarWidth: number | null, sectionsWidth: number | null) => {
    setSettingsStore({
      ...(sidebarWidth != null ? { sidebarWidth } : {}),
      ...(sectionsWidth != null ? { sectionsWidth } : {}),
    });
    saveSettings();
  },
};
initPaneResizers(paneCallbacks);

// ── Global event listeners (

window.addEventListener("keydown", handleZoomHotkey, listenerOpts);
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "F12") { e.preventDefault(); void toggleDevtools(); }
}, listenerOpts);
const onResize = () => applyZoom(settingsStore.zoom);
window.addEventListener("resize", onResize, listenerOpts);
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize, listenerOpts);
window.addEventListener("blur", () => {
  void cancelPaneResize(paneCallbacks);
}, listenerOpts);
window.addEventListener("beforeunload", () => {
  runModuleTeardown();
  teardownApp();
  stopTimers();
});
installSystemThemeListener(() => applyTheme(settingsStore.theme));

// ── Directory action buttons (#taskDir, #recentDirPanel) ──

function renderRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  const dirs = loadRecentDirectories();
  const current = activeDirectory();
  const head = [
    `<div class="recent-dir-panel-head">`,
    `<div class="recent-dir-panel-title">${escapeHtml(t("cwd.recent"))}</div>`,
    current
      ? `<div class="recent-dir-panel-meta" title="${escapeHtml(current)}">${escapeHtml(shortPath(current))}</div>`
      : "",
    `</div>`,
  ].join("");
  if (!dirs.length) {
    panel.innerHTML = [
      `<div class="recent-dir-panel-shell">`,
      head,
      `<div class="recent-dir-empty">${escapeHtml(t("cwd.recent_empty"))}</div>`,
      `</div>`,
    ].join("");
    return;
  }
  panel.innerHTML = [
    `<div class="recent-dir-panel-shell">`,
    head,
    `<div class="recent-dir-list">`,
    dirs
      .map((dir) => {
        const isActive = !!current && dir.toLowerCase() === current.toLowerCase();
        return [
          `<div class="recent-dir-row" data-active="${isActive}">`,
          `<button type="button" class="recent-dir-item" data-recent-dir="${escapeHtml(dir)}" title="${escapeHtml(dir)}">`,
          `<span class="recent-dir-copy">`,
          `<span class="recent-dir-label">${escapeHtml(shortPath(dir))}</span>`,
          `<span class="recent-dir-path">${escapeHtml(dir)}</span>`,
          `</span>`,
          isActive ? `<span class="recent-dir-state" aria-hidden="true">•</span>` : "",
          `</button>`,
          // Inline SVG matches the Icon primitive contract (viewBox 16,
          // stroke=currentColor, stroke-width 1.4, line-cap/join round).
          // Inline string here because the surrounding markup builder is
          // an HTML-template-string flow; rewriting to JSX is bigger
          // scope than Step 7 covers. The string itself is the single
          // source — no `×` character anywhere in the codebase.
          `<button type="button" class="recent-dir-remove" data-recent-remove="${escapeHtml(dir)}" title="${escapeHtml(t("common.delete"))}" aria-label="${escapeHtml(t("common.delete"))}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg></button>`,
          `</div>`,
        ].join("");
      })
      .join(""),
    `</div>`,
    `</div>`,
  ].join("");
}

function openRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (!panel) return;
  if (!panel.hidden) { closeRecentDirPanel(); return; }
  renderRecentDirPanel();
  const wrap = document.getElementById("taskCwdDropdown");
  if (wrap) {
    const rect = wrap.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 6) + "px";
    panel.style.left = Math.round(Math.max(4, rect.left)) + "px";
    panel.style.width = Math.round(rect.width) + "px";
    wrap.dataset.open = "true";
    wrap.setAttribute("aria-expanded", "true");
  }
  panel.hidden = false;
}

function closeRecentDirPanel(): void {
  const panel = document.getElementById("recentDirPanel");
  if (panel) panel.hidden = true;
  const wrap = document.getElementById("taskCwdDropdown");
  if (wrap) {
    wrap.dataset.open = "false";
    wrap.setAttribute("aria-expanded", "false");
  }
}

document.getElementById("taskCwdDropdown")?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("[data-path-action],[data-path-open],[data-path-set],[data-path-editor]")) return;
  event.stopPropagation();
  openRecentDirPanel();
});
document.getElementById("taskCwdDropdown")?.addEventListener("keydown", (event) => {
  const e = event as KeyboardEvent;
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = event.target as HTMLElement | null;
  if (target && target.closest("[data-path-action],[data-path-open],[data-path-set],[data-path-editor]")) return;
  e.preventDefault();
  openRecentDirPanel();
});

document.getElementById("taskDir")?.addEventListener("click", async (event) => {
  const button = eventClosest(event, "[data-path-action],[data-path-open],[data-path-set],[data-path-editor]");
  if (!button || (button as HTMLButtonElement).disabled) return;
  const el = button as HTMLElement;
  const action = el.dataset.pathAction || "";
  if (action === "browse") { await browseDirectory(); return; }
  if (action === "create") { await createDirectory(); return; }
  if (el.dataset.pathOpen) { await openDirectory(el.dataset.pathOpen); return; }
  if (el.dataset.pathEditor && isProjectEditorID(el.dataset.pathEditor)) {
    await openDirectoryInEditor(el.dataset.pathEditor);
    return;
  }
  const target = el.dataset.pathSet || "";
  if (!target) return;
  try { await setDirectory(target); } catch (e) {
    AppLog.error("ui", "Failed to set working directory", { error: String(e) });
  }
});

document.getElementById("recentDirPanel")?.addEventListener("click", async (event) => {
  const removeBtn = eventClosest(event, "[data-recent-remove]");
  if (removeBtn) {
    const dir = (removeBtn as HTMLElement).dataset.recentRemove;
    if (dir) {
      removeRecentDirectory(dir);
      renderRecentDirPanel();
      // Close panel when list becomes empty
      if (!loadRecentDirectories().length) closeRecentDirPanel();
    }
    return;
  }
  const item = eventClosest(event, "[data-recent-dir]");
  if (!item) return;
  const dir = (item as HTMLElement).dataset.recentDir;
  if (!dir) return;
  closeRecentDirPanel();
  try { await setDirectory(dir); } catch (e) {
    AppLog.error("ui", "Failed to switch to recent directory", { dir, error: String(e) });
  }
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("#taskCwdDropdown") || target?.closest?.(".recent-dir-panel")) return;
  closeRecentDirPanel();
}, listenerOpts);

// Global Esc: close any non-HTML5-dialog popovers the operator might
// have opened. HTML5 <dialog>.showModal() already handles Esc natively
// via the platform's `cancel` event; we only patch the in-DOM
// custom popovers (recent-directory dropdown today; future panels can
// hook the same channel by listening for the bubbling key event and
// preventDefault'ing if they handle it).
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const dirPanel = document.getElementById("recentDirPanel");
  if (dirPanel && !dirPanel.hidden) {
    ev.preventDefault();
    closeRecentDirPanel();
  }
}, listenerOpts);

// ── Init ──

(window as any).__overlayInitSettled = false;
void (async () => {
  try {
    await initApp();
    const agentModelsBody = document.getElementById("agentModelsBody");
    if (agentModelsBody) {
      agentModelsBody.innerHTML = "";
      render(() => <AgentModelsPanel />, agentModelsBody);
    }
    renderAboutVersion();
    const connBannerHost = document.createElement("div");
    connBannerHost.id = "connectionBannerHost";
    document.body.appendChild(connBannerHost);
    render(() => <ConnectionBanner />, connBannerHost);
    const cmdkHost = document.createElement("div");
    cmdkHost.id = "commandPaletteHost";
    document.body.appendChild(cmdkHost);
    render(() => <CommandPalette />, cmdkHost);
    const sessionDialogHost = document.createElement("div");
    sessionDialogHost.id = "sessionDialogHost";
    document.body.appendChild(sessionDialogHost);
    render(() => <SessionDialogHost />, sessionDialogHost);
    const appDialogHost = document.createElement("div");
    appDialogHost.id = "appDialogHost";
    document.body.appendChild(appDialogHost);
    render(() => <AppDialogHost />, appDialogHost);
    const onboardingHost = document.createElement("div");
    onboardingHost.id = "workspaceOnboardingHost";
    document.body.appendChild(onboardingHost);
    render(() => <WorkspaceOnboardingDialog />, onboardingHost);
  } catch (error) {
    console.error(error);
  } finally {
    await waitForLogDrain();
    (window as any).__overlayInitSettled = true;
  }
})();
