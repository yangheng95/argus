// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// Self-sufficient — no external script dependencies.

import { render } from "solid-js/web"
import { createEffect, createRoot, createSignal, untrack } from "solid-js"
import { Conversation } from "./components/Conversation"
import { TaskList } from "./components/TaskList"
import { Board } from "./components/Board"
import { Mission } from "./components/Mission"
import { pageMode, setPageMode } from "./store/page-mode"
import { TaskStatusHeader } from "./components/TaskStatusHeader"
import { ProjectDirectoryBar } from "./components/TaskDirBar"
import { ChatComposer } from "./components/ChatComposer"
import { WindowControls } from "./components/WindowControls"
import {
  LeftPanelHeaderCollapseControl,
} from "./components/PanelHeaderCollapseControl"
import { TitlebarMenubar } from "./components/titlebar/TitlebarMenubar"
import { ConnectionBadge } from "./components/ConnectionBadge"
import { ConversationAgentRail } from "./components/ConversationAgentRail"
import { LogViewer } from "./components/LogViewer"
import { FileExplorerPanel } from "./components/FileExplorerPanel"
import { FileEditorPane } from "./components/FileEditorPane"
import { FileChangesPanel } from "./components/FileChangesPanel"
import { BrowserPreviewPanel } from "./components/BrowserPreviewPanel"
import { SideActivityToolbar, type SideActivity } from "./components/SideActivityToolbar"
import { closeFileEditor, fileWorkbenchOpen } from "./services/file-workbench"
import type { DiffTarget } from "./services/diff"
import { initApp } from "./services/init"
import { loadTasks, boardStore, loadBoard,
  activeTaskID,
  activeSessionID,
} from "./store/board"
import { messageStore } from "./store/messages"
import { appStore } from "./store/app"
import { selectTask, retryTask, replanTask, cancelTask, createTask, deleteTask, renameTask } from "./services/task"
import { canComposeChat, stopChatRequest } from "./services/chat"
import { isTaskInterruptable } from "./store/board"
import { setLocale } from "./utils/i18n"
import { apiJson, apiRequest, configure as configureApi, getServerUrl } from "./services/api"
import { t } from "./utils/i18n"
import { renderMarkdown } from "./utils/markdown"
import { aggregateUsageAcrossSessions, formatUsageStrip } from "./utils/format-usage"
import {
  applyTheme,
  applyZoom,
  applyOpacity,
  sanitizeZoom,
  handleZoomHotkey,
  installSystemThemeListener,
  toggleDevtools,
} from "./services/theme"
import { settingsStore, setSettingsStore, saveSettings } from "./store/settings"
import { initPaneResizers, cancelPaneResize, currentUIScale, renderPaneLayout, PANEL_PANE_CONFIG } from "./services/pane"
import { panelMessage } from "./services/chat"
import { ConnectionBanner } from "./components/ConnectionBanner"
import { CommandPalette } from "./components/CommandPalette"
import { NotificationCenter } from "./components/NotificationCenter"
import { AppDialogHost } from "./components/AppDialogHost"
import { InteractionDialogHost } from "./components/InteractionDialogHost"
import { SessionDialogHost } from "./components/SessionDialogHost"
import { GoalDialogHost } from "./components/GoalDialogHost"
import { ConfigDialogHost } from "./components/ConfigDialogHost"
import { WorkspaceOnboardingDialog } from "./components/WorkspaceOnboardingDialog"
import { waitForLogDrain, AppLog } from "./utils/log"
import { teardownApp } from "./services/init"
import { stopTimers } from "./services/sync"
import { nativeOpen } from "./utils/native"
import { hydrateIconPlaceholders } from "./utils/icon-html"
import { installNativeContextMenuSuppression } from "./utils/context-menu"
import { notifyError, notifyWarning, formatErrorDetails, recomputeBadgeFromTasks } from "./services/notify"
import {
  applyDirectory,
  activeDirectory,
  openPathInSelectedEditor,
} from "./services/workspace"
import { openConfigDialog, openGoalDialog, renderAboutVersion, setupDialogBackdropClose } from "./services/dialog"
import { cardTreeStore } from "./store/card-tree"
import { composerDraftKey } from "./services/composer-draft"
import { isCodingAssistantSource, selectCodingAssistantSession } from "./services/coding-assistant"
import { openImagePreview } from "./services/image-preview"
import { ImagePreviewHost } from "./components/ImagePreview"

// ── Module teardown ──
// Centralised cleanup for top-level document/window listeners and Solid roots.
// Triggered on beforeunload and on Vite HMR dispose so subsequent module
// re-executions don't stack duplicate handlers and effects.
const moduleTeardown = new AbortController()
const disposers: Array<() => void> = []
function runModuleTeardown() {
  if (!moduleTeardown.signal.aborted) moduleTeardown.abort()
  for (const d of disposers.splice(0)) {
    try {
      d()
    } catch {
      /* best-effort cleanup */
    }
  }
}
if ((import.meta as any).hot) {
  ;(import.meta as any).hot.dispose(runModuleTeardown)
}
const listenerOpts = { signal: moduleTeardown.signal } as const
installNativeContextMenuSuppression(document, moduleTeardown.signal)
hydrateIconPlaceholders(document)

const BROWSER_RESIZE_OBSERVER_DELIVERY_MESSAGES = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
])

function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isBrowserResizeObserverDeliveryError(error: unknown): boolean {
  return BROWSER_RESIZE_OBSERVER_DELIVERY_MESSAGES.has(runtimeErrorMessage(error))
}

function reportOverlayRuntimeError(scope: string, error: unknown): void {
  const details = formatErrorDetails(error)
  const message = runtimeErrorMessage(error)
  const diagnosticDetails = details ? `source: ${scope}\n\n${details}` : `source: ${scope}`
  if (isBrowserResizeObserverDeliveryError(error)) {
    AppLog.debug("runtime", scope, {
      message,
      details,
    })
    return
  }
  AppLog.error("runtime", scope, {
    message,
    details,
  })
  notifyError({
    id: `runtime:${scope}`,
    title: t("common.error"),
    message,
    details: diagnosticDetails,
  })
}

window.addEventListener(
  "error",
  (event) => {
    reportOverlayRuntimeError("window.error", event.error ?? event.message)
  },
  listenerOpts,
)

window.addEventListener(
  "unhandledrejection",
  (event) => {
    reportOverlayRuntimeError("window.unhandledrejection", event.reason)
  },
  listenerOpts,
)

// ── Application-level signals (shared across mount points) ──

const [logOpen, setLogOpen] = createSignal(false)

// ── Workspace (secondary panel, stacked above composer) state ──
// workspaceOpen drives layout visibility; workspaceTarget is remembered across
// open/close cycles so reopening restores the last active diff target.
const [workspaceOpen, setWorkspaceOpen] = createSignal(false)
const [workspaceTarget, setWorkspaceTarget] = createSignal<DiffTarget>({ filePath: "" })

type CenterWorkbenchPanel = "workflow" | "inspector" | "notifications" | "explorer" | "diff" | "browser" | "file"
type RightActivity = Exclude<CenterWorkbenchPanel, "file"> | "assistant"

const DEFAULT_CENTER_WORKBENCH_WIDTH = 420
const CENTER_WORKBENCH_MIN_PANEL_WIDTH = 128
const CENTER_WORKBENCH_PANEL_ORDER: readonly CenterWorkbenchPanel[] = [
  "workflow",
  "explorer",
  "diff",
  "browser",
  "inspector",
  "notifications",
  "file",
]

const RIGHT_ACTIVITIES: readonly SideActivity<RightActivity>[] = [
  { id: "workflow", icon: "workflow", labelKey: "chat.title" },
  { id: "inspector", icon: "inspect", labelKey: "sections.title" },
  { id: "notifications", icon: "notifications", labelKey: "notify.center_label" },
  { id: "explorer", icon: "folder", labelKey: "explorer.title" },
  { id: "diff", icon: "files", labelKey: "workspace.diff" },
  { id: "browser", icon: "web-search", labelKey: "browser_preview.title" },
  { id: "assistant", icon: "message", labelKey: "coding_assistant.title" },
]

const [centerWorkbenchPanels, setCenterWorkbenchPanels] = createSignal<CenterWorkbenchPanel[]>(["workflow"])
const [selectedRightActivity, setSelectedRightActivity] = createSignal<RightActivity | null>("workflow")
const activeRightActivity = () => selectedRightActivity()

function activateCodingAssistantSession(): void {
  openCenterWorkbenchPanel("workflow")
  setSelectedRightActivity("assistant")
  void selectCodingAssistantSession().catch((error) => {
    reportOverlayRuntimeError("coding-assistant.select", error)
  })
}

function isCenterWorkbenchPanelOpen(panel: CenterWorkbenchPanel): boolean {
  return centerWorkbenchPanels().includes(panel)
}

function isRightActivityOpen(activity: RightActivity): boolean {
  if (activity === "assistant") return selectedRightActivity() === "assistant" && isCenterWorkbenchPanelOpen("workflow")
  return isCenterWorkbenchPanelOpen(activity)
}

function selectRightActivity(activity: RightActivity): void {
  if (activity === "assistant") {
    activateCodingAssistantSession()
    return
  }
  if (untrack(centerWorkbenchPanels).includes(activity)) {
    closeCenterWorkbenchPanel(activity)
  } else {
    openCenterWorkbenchPanel(activity)
  }
}

function openCenterWorkbenchPanel(panel: CenterWorkbenchPanel): void {
  setCenterWorkbenchPanels((current) => current.includes(panel) ? current : [...current, panel])
  if (panel !== "file") setSelectedRightActivity(panel)
}

function closeCenterWorkbenchPanel(panel: CenterWorkbenchPanel): void {
  if (panel === "diff") setWorkspaceOpen(false)
  if (panel === "file") closeFileEditor()
  setCenterWorkbenchPanels((current) => current.filter((item) => item !== panel))
  const selected = untrack(selectedRightActivity)
  if (selected === panel || (panel === "workflow" && selected === "assistant")) {
    setSelectedRightActivity(null)
  }
}

function clampCenterWorkbenchWidth(value: number): number {
  const scale = currentUIScale()
  const workspace = document.getElementById("conversationWorkspace")
  const total = workspace?.clientWidth || window.visualViewport?.width || window.innerWidth || 1000
  const min = 280 * scale
  const conversationMin = 360 * scale
  const max = Math.max(min, total - conversationMin)
  return Math.round(Math.min(Math.max(value, min), max))
}

function centerWorkbenchWidth(): number {
  return clampCenterWorkbenchWidth(settingsStore.centerWorkbenchWidth ?? DEFAULT_CENTER_WORKBENCH_WIDTH * currentUIScale())
}

function renderCenterWorkbenchWidth(width = centerWorkbenchWidth()): void {
  document.body.style.setProperty("--ui-center-workbench-width", `${clampCenterWorkbenchWidth(width)}px`)
}

function getCenterWorkbenchViews(): Record<CenterWorkbenchPanel, HTMLElement | null> {
  return {
    workflow: document.getElementById("centerWorkbenchWorkflow"),
    explorer: document.getElementById("centerWorkbenchExplorer"),
    diff: document.getElementById("centerWorkbenchDiff"),
    browser: document.getElementById("centerWorkbenchBrowser"),
    inspector: document.getElementById("centerWorkbenchInspector"),
    notifications: document.getElementById("centerWorkbenchNotifications"),
    file: document.getElementById("centerWorkbenchFile"),
  }
}

function orderedCenterWorkbenchPanels(panels = centerWorkbenchPanels()): CenterWorkbenchPanel[] {
  const open = new Set(panels)
  return CENTER_WORKBENCH_PANEL_ORDER.filter((panel) => open.has(panel))
}

function centerWorkbenchPanelWeight(panel: CenterWorkbenchPanel): number {
  const weight = Number(settingsStore.centerWorkbenchPanelWeights?.[panel])
  return Number.isFinite(weight) && weight > 0 ? weight : 1
}

function renderCenterWorkbenchPanelWeights(): void {
  const panels = orderedCenterWorkbenchPanels()
  const lastPanel = panels[panels.length - 1]
  const firstPanel = panels[0]
  const views = getCenterWorkbenchViews()
  for (const panel of CENTER_WORKBENCH_PANEL_ORDER) {
    const body = views[panel]
    if (!body) continue
    if (panels.includes(panel)) {
      body.style.setProperty("--center-workbench-panel-grow", String(centerWorkbenchPanelWeight(panel)))
      body.dataset.resizableNext = String(panel !== lastPanel && panels.length > 1)
      body.dataset.resizablePrev = String(panel !== firstPanel && panels.length > 1)
    } else {
      body.style.removeProperty("--center-workbench-panel-grow")
      delete body.dataset.resizableNext
      delete body.dataset.resizablePrev
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Format a millisecond timestamp for the debug blob. Returns "—" for
 *  missing / zero values so the blob stays aligned when fields are empty. */
function formatDebugTime(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms)
  if (!Number.isFinite(n) || n <= 0) return "—"
  return new Date(n)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "Z")
}

function debugGoalBoardFiles(gw: any): string {
  const steps = Array.isArray(gw?.steps) ? gw.steps : []
  let changedFiles = 0
  let changedFileDiffs = 0
  const commitRefs = new Set<string>()
  let statFiles: number | undefined
  let additions: number | undefined
  let deletions: number | undefined
  for (const step of steps) {
    const payload = step?.payload
    if (!payload || typeof payload !== "object") continue
    if (Array.isArray(payload.changedFiles)) changedFiles += payload.changedFiles.length
    if (Array.isArray(payload.changedFileDiffs)) changedFileDiffs += payload.changedFileDiffs.length
    if (typeof payload.commitRef === "string" && payload.commitRef.trim()) commitRefs.add(payload.commitRef.trim())
    const stats = payload.diffStats
    if (stats && typeof stats === "object") {
      if (typeof stats.files === "number") statFiles = (statFiles ?? 0) + stats.files
      if (typeof stats.additions === "number") additions = (additions ?? 0) + stats.additions
      if (typeof stats.deletions === "number") deletions = (deletions ?? 0) + stats.deletions
    }
  }
  const statText = statFiles === undefined
    ? "—"
    : `${statFiles} files, +${additions ?? 0}/-${deletions ?? 0}`
  return `changedFiles=${changedFiles}; changedFileDiffs=${changedFileDiffs}; commits=${commitRefs.size ? Array.from(commitRefs).join(",") : "none"}; diffStats=${statText}`
}

function psSingleQuote(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''")
}

/**
 * Build a plain-text debug blob for the currently selected task board.
 * Contains everything an operator needs to triage a stuck / mis-merged task
 * directly from the DB: identity + paths + per-goal worktree coords + ready
 * SQL. Returns `""` when no task is selected so the caller can show a hint.
 */
function buildTaskDebugBlob(board: any): string {
  const task = board?.task
  const id = typeof task?.id === "string" ? task.id : ""
  if (!id) return ""
  const taskDirectory = String(task?.directory ?? "—")
  const serverUrl = getServerUrl()
  const goalWorkflows: any[] = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : []
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)

  push(
    `# Task Debug Info (double-click 任务 → clipboard)`,
    `# Generated: ${formatDebugTime(Date.now())}`,
    ``,
    `task.id:        ${id}`,
    `task.title:     ${String(task?.title ?? "—")}`,
    `task.status:    ${String(task?.status ?? "—")}`,
    `task.directory: ${taskDirectory}`,
    `server.url:     ${serverUrl}`,
    `task.session:   ${String(task?.sessionID ?? "—")}`,
    `task.run.id:    ${String(task?.activeRunID ?? "—")}`,
    `task.time.created: ${formatDebugTime(task?.time?.created)}`,
    `task.time.updated: ${formatDebugTime(task?.time?.updated ?? task?.time?.created)}`,
    ``,
    `Goals (${goalWorkflows.length}):`,
  )
  if (goalWorkflows.length === 0) {
    push(`  (none — task has not produced goals yet)`)
  } else {
    for (const gw of goalWorkflows) {
      const gid = String(gw?.goalID ?? "?")
      const n = typeof gw?.orderIndex === "number" ? gw.orderIndex + 1 : "?"
      push(
        `  #${n}  ${gid}  ${String(gw?.goalStatus ?? "?")}  ${String(gw?.goalTitle ?? "").slice(0, 80)}`,
        `      retry:     ${gw?.retryCount ?? 0}`,
        `      workspace: ${String(gw?.workspaceDir ?? "—")}`,
        `      branch:    ${String(gw?.workspaceBranch ?? "—")}`,
        `      files:     ${debugGoalBoardFiles(gw)}`,
      )
    }
  }
  push(
    ``,
    `Notes:`,
    `  - engine_goal stores the goal contract only. workspace_dir / workspace_branch / workspace_base_ref / retry_count / status / cascade_state were retired (2026-05-05); workspace + retry live on the latest engine_artifact[kind='goal_run_attempt'].payload row, goal status is derived live via engine/describe.ts::goalStatusByID from the goal_run chain.`,
    `  - engine_artifact is the append-only single source: run / goal_run_attempt / acceptance / verification-evidence / architect_contract_graph / integrity_attempt / orchestrator-stream-error all live here. Latest-per-id wins by time_created desc.`,
    `  - Right-side Files panel reads board.goalWorkflows[].steps[].payload.changedFiles / changedFileDiffs / commitRef, which are projected from per-goal engine_artifact[kind='acceptance']. If SQL shows acceptance rows but the panel omits a goal, debug overlay refresh/resource keys before suspecting DB writes.`,
    `  - Project-scoped HTTP routes require task.directory as ?directory= or x-opencorvus-directory. /global/health is control-plane only; it confirms server health and global paths, not whether this task exists in the selected project instance.`,
    `  - goal_run liveness is owner-stamped: engine_artifact[kind='goal_run_attempt'].payload.owner = the process (pid:boot-ts:rand) that drove the attempt live. A live-status attempt whose owner ≠ the current server process is a restart orphan (engine/orphan.ts::isGoalRunOrphaned) — describe renders it not-running + ORPHANED and the orchestrator re-dispatches it; a half-streamed goal turn cannot resume.`,
    `  - LLM stream stalls bound through llm/activity.ts (withLLMActivity): first-byte gate, idle gate (default 180s = session_llm_idle_ms), total deadline (default 30 min). Exactly one terminal event per call — done | failed | aborted. Board "running" past the total deadline with no events ⇒ bug at withLLMActivity or its sink wiring, NOT a missing stalled-detection heuristic elsewhere.`,
    ``,
    `# Project-scoped HTTP probes (run these before direct SQLite; they use the same directory context as Overlay)`,
    `$server = '${psSingleQuote(serverUrl)}'`,
    `$dir = '${psSingleQuote(taskDirectory)}'`,
    `$task = '${psSingleQuote(id)}'`,
    `Invoke-RestMethod -Uri "$server/task/$task/board" -Headers @{ 'x-opencorvus-directory' = $dir } | ConvertTo-Json -Depth 40`,
    `Invoke-RestMethod -Uri "$server/task/$task/progress" -Headers @{ 'x-opencorvus-directory' = $dir } | ConvertTo-Json -Depth 30`,
    `Invoke-RestMethod -Uri "$server/task/$task/conversation" -Headers @{ 'x-opencorvus-directory' = $dir } | ConvertTo-Json -Depth 30`,
    `Invoke-RestMethod -Uri "$server/global/health" | ConvertTo-Json -Depth 10  # control-plane only; do not use this alone as task DB proof`,
    ``,
    `# SQL templates (read-only — open the verified DB with bun:sqlite readonly:true)`,
    `# Runtime DB path (single source):`,
    `#  - /global/health -> paths.database: ${appStore.enginePaths?.database ?? "<not yet known — engine offline; reconnect and retry>"}`,
    `# If SELECT * FROM engine_task returns 0 rows for this task, stop using that DB and use the project-scoped HTTP probes above; do not infer missing goals/contracts from an empty wrong DB.`,
    ``,
    `-- Task snapshot (no status column — derive via deriveTaskStatus from (time_started, time_completed, error, metadata.cancelled))`,
    `SELECT * FROM engine_task WHERE id = '${id}';`,
    ``,
    `-- Goal contracts (LLM-autonomous redesign: slug/objective/depends_on/owned_paths/requirement_ids are goal inputs; cross-goal handoffs live in architect_contract_graph)`,
    `SELECT id, slug, title, kind, source, priority, plan_version_id, milestone_id, order_index,`,
    `       objective, depends_on, owned_paths, requirement_ids, acceptance_specs,`,
    `       time_updated`,
    `FROM engine_goal WHERE task_id = '${id}' ORDER BY order_index;`,
    ``,
    `-- Active architect contract graph (task-scoped artifact; latest by time_created desc, id desc)`,
    `SELECT id, label, payload, time_created, time_updated`,
    `FROM engine_artifact`,
    `WHERE task_id = '${id}' AND kind='architect_contract_graph'`,
    `ORDER BY time_created DESC, id DESC LIMIT 1;`,
    ``,
    `-- Plan versions promoted by the planner (goals link via plan_version_id; status='active' is the live one)`,
    `SELECT id, version, status, summary, spec_snapshot_id, time_created, time_updated`,
    `FROM engine_plan_version WHERE task_id = '${id}' ORDER BY version;`,
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
    `-- Goal run attempts (one per begin-build-attempt; workspace + retry pointers live in payload here, not on engine_goal)`,
    `SELECT goal_run_id, run_id, label,`,
    `       json_extract(payload, '$.goal_id') AS goal_id,`,
    `       json_extract(payload, '$.session_id') AS session_id,`,
    `       json_extract(payload, '$.status') AS status,`,
    `       json_extract(payload, '$.retry_count') AS retry_count,`,
    `       json_extract(payload, '$.blocking_reason') AS blocking_reason,`,
    `       json_extract(payload, '$.superseded_reason') AS superseded_reason,`,
    `       json_extract(payload, '$.error') AS error,`,
    `       json_extract(payload, '$.workspace_dir') AS workspace_dir,`,
    `       json_extract(payload, '$.workspace_branch') AS workspace_branch,`,
    `       json_extract(payload, '$.workspace_base_ref') AS workspace_base_ref,`,
    `       json_extract(payload, '$.merge_ref') AS merge_ref,`,
    `       time_created, time_updated`,
    `FROM engine_artifact`,
    `WHERE task_id = '${id}' AND kind='goal_run_attempt'`,
    `ORDER BY time_created;`,
    ``,
    `-- Per-goal acceptance file projection (right-side Files panel backend source; latest delivered attempt per goal, not necessarily the live tip after retry/reset)`,
    `WITH latest_goal_run AS (`,
    `  SELECT goal_run_id, payload, time_created, id,`,
    `         row_number() OVER (PARTITION BY goal_run_id ORDER BY time_created DESC, id DESC) AS rn`,
    `  FROM engine_artifact`,
    `  WHERE task_id = '${id}' AND kind='goal_run_attempt'`,
    `), delivered AS (`,
    `  SELECT json_extract(gr.payload, '$.goal_id') AS goal_id,`,
    `         gr.goal_run_id,`,
    `         json_extract(gr.payload, '$.retry_count') AS retry_count,`,
    `         d.acceptance_id, d.time_created AS acceptance_time,`,
    `         json_extract(d.payload, '$.result.commit_ref') AS commit_ref,`,
    `         json_extract(d.payload, '$.result.changed_files') AS changed_files,`,
    `         json_array_length(json_extract(d.payload, '$.result.changed_files')) AS changed_file_count,`,
    `         json_array_length(json_extract(d.payload, '$.result.diffs')) AS diff_count,`,
    `         json_extract(d.payload, '$.result.stats.additions') AS additions,`,
    `         json_extract(d.payload, '$.result.stats.deletions') AS deletions,`,
    `         row_number() OVER (PARTITION BY json_extract(gr.payload, '$.goal_id') ORDER BY d.time_created DESC, d.id DESC) AS acceptance_rank`,
    `  FROM latest_goal_run gr`,
    `  JOIN engine_artifact d ON d.goal_run_id = gr.goal_run_id AND d.kind='acceptance'`,
    `  WHERE gr.rn = 1`,
    `)`,
    `SELECT g.order_index + 1 AS goal_number,`,
    `       'G' || (g.order_index + 1) || 'V' || (coalesce(delivered.retry_count, 0) + 1) AS delivered_label,`,
    `       g.id AS goal_id, g.title, delivered.goal_run_id, delivered.acceptance_id,`,
    `       delivered.commit_ref, delivered.changed_file_count, delivered.diff_count, delivered.additions, delivered.deletions,`,
    `       delivered.changed_files, delivered.acceptance_time`,
    `FROM engine_goal g`,
    `LEFT JOIN delivered ON delivered.goal_id = g.id AND delivered.acceptance_rank = 1`,
    `WHERE g.task_id = '${id}'`,
    `ORDER BY g.order_index;`,
    ``,
    `-- Raw per-goal acceptance artifacts (all delivered attempts, useful when a retry label differs from the delivered diff label)`,
    `WITH latest_goal_run AS (`,
    `  SELECT goal_run_id, payload, time_created, id,`,
    `         row_number() OVER (PARTITION BY goal_run_id ORDER BY time_created DESC, id DESC) AS rn`,
    `  FROM engine_artifact`,
    `  WHERE task_id = '${id}' AND kind='goal_run_attempt'`,
    `)`,
    `SELECT d.acceptance_id, d.goal_run_id,`,
    `       json_extract(gr.payload, '$.goal_id') AS goal_id,`,
    `       json_extract(gr.payload, '$.retry_count') AS retry_count,`,
    `       json_extract(d.payload, '$.status') AS status,`,
    `       json_extract(d.payload, '$.result.commit_ref') AS commit_ref,`,
    `       json_array_length(json_extract(d.payload, '$.result.changed_files')) AS changed_file_count,`,
    `       json_array_length(json_extract(d.payload, '$.result.diffs')) AS diff_count,`,
    `       json_extract(d.payload, '$.result.stats.additions') AS additions,`,
    `       json_extract(d.payload, '$.result.stats.deletions') AS deletions,`,
    `       json_extract(d.payload, '$.result.changed_files') AS changed_files,`,
    `       d.time_created, d.time_updated`,
    `FROM engine_artifact d`,
    `LEFT JOIN latest_goal_run gr ON gr.goal_run_id = d.goal_run_id AND gr.rn = 1`,
    `WHERE d.task_id = '${id}' AND d.kind='acceptance' AND d.goal_run_id IS NOT NULL`,
    `ORDER BY d.time_created;`,
    ``,
    `-- Orchestrator fatal stream errors (rule-23 single source — empty result = no fatal so far)`,
    `SELECT id, run_id, goal_run_id, label,`,
    `       json_extract(payload, '$.error') AS error,`,
    `       json_extract(payload, '$.phase') AS phase,`,
    `       time_created`,
    `FROM engine_artifact`,
    `WHERE task_id = '${id}' AND kind='orchestrator-stream-error'`,
    `ORDER BY time_created;`,
    ``,
    `-- Pending interactions (permission asks / clarifying questions — the most common "why is it stuck?" answer)`,
    `SELECT id, run_id, session_id, request_type, status, title, time_resolved, time_created`,
    `FROM engine_interaction_request`,
    `WHERE task_id = '${id}'`,
    `ORDER BY time_created;`,
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
    `-- Workflow step transitions (architect / requirements / frontend_design / planner)`,
    `SELECT type, source, emitted_at, run_id, goal_run_id,`,
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
    `SELECT type, source, emitted_at, run_id, goal_run_id FROM protocol_event`,
    `WHERE task_id = '${id}' AND source <> 'session.bridge'`,
    `ORDER BY emitted_at DESC LIMIT 60;`,
  )
  return lines.join("\n")
}

/** Open the workspace panel. */
function openWorkspace(): void {
  setWorkspaceOpen(true)
  openCenterWorkbenchPanel("diff")
}

/** Close the workspace panel. */
function closeWorkspace(): void {
  setWorkspaceOpen(false)
  closeCenterWorkbenchPanel("diff")
}

/** Open (or switch to) a diff file in the workspace. */
function openWorkspaceDiff(target: DiffTarget): void {
  setWorkspaceTarget(target)
  closeFileEditor()
  openWorkspace()
}

// Exposed for services and window-level bridges that need to trigger the
// workspace from outside this module (e.g. ChangesPanel clicks).
;(window as any).openWorkspaceDiff = openWorkspaceDiff

// Delegate clicks on rendered-markdown file links (see utils/markdown.ts —
// codespans that look like file paths are emitted with data-file-path).
// A single document-level listener keeps this decoupled from the message
// rendering path, which re-runs on every stream tick.
document.addEventListener(
  "click",
  (ev) => {
    const target = ev.target as HTMLElement | null
    if (!target) return
    const imageTrigger = target.closest<HTMLElement>("[data-image-preview-trigger]")
    if (imageTrigger) {
      const src = imageTrigger.getAttribute("data-image-preview-src")
        || imageTrigger.querySelector("img")?.getAttribute("src")
        || ""
      const alt = imageTrigger.getAttribute("data-image-preview-alt")
        || imageTrigger.querySelector("img")?.getAttribute("alt")
        || ""
      ev.preventDefault()
      openImagePreview(src, alt)
      return
    }
    const link = target.closest<HTMLElement>("[data-file-path]")
    if (!link) return
    const path = link.getAttribute("data-file-path")
    if (!path) return
    ev.preventDefault()
    void openPathInSelectedEditor(path)
  },
  listenerOpts,
)

document.addEventListener(
  "click",
  (ev) => {
    const target = ev.target as HTMLElement | null
    if (!target) return
    const anchor = target.closest<HTMLAnchorElement>("a[href]")
    if (!anchor || anchor.hasAttribute("data-file-path")) return
    const href = anchor.getAttribute("href") || ""
    if (!/^https?:\/\//i.test(href)) return
    ev.preventDefault()
    void nativeOpen(href).catch((error) => {
      console.error("[ui] Failed to open external link", error)
    })
  },
  listenerOpts,
)

// Code-block copy buttons rendered by utils/markdown.ts wrapCodeBlock.
// markdown HTML lives inside innerHTML on streamed text — wiring per-button
// click handlers in Solid would require re-binding on every stream tick,
// so a single document-level listener keeps the renderer pure.
document.addEventListener(
  "click",
  (ev) => {
    const target = ev.target as HTMLElement | null
    if (!target) return
    const btn = target.closest<HTMLButtonElement>("button[data-md-copy]")
    if (!btn) return
    ev.preventDefault()
    ev.stopPropagation()
    const source = btn.getAttribute("data-md-copy") || ""
    if (!source) return
    const flash = (text: string) => {
      btn.dataset.copied = "true"
      const prev = btn.getAttribute("aria-label") || ""
      btn.setAttribute("aria-label", text)
      btn.title = text
      setTimeout(() => {
        delete btn.dataset.copied
        btn.setAttribute("aria-label", prev || "Copy code")
        btn.title = prev || "Copy code"
      }, 1400)
    }
    const decoded = source
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    void (async () => {
      try {
        await navigator.clipboard.writeText(decoded)
        flash("Copied")
      } catch (err) {
        console.error("[md-copy] clipboard write failed", err)
        flash("Copy failed")
      }
    })()
  },
  listenerOpts,
)

window.addEventListener(
  "acceptance:focus-changes",
  () => openCenterWorkbenchPanel("diff"),
  listenerOpts,
)

function installGlobalBridges(): void {
  ;(window as any).renderMarkdown = renderMarkdown
  ;(window as any).persistOverlaySettings = async () => {
    saveSettings()
  }
  ;(window as any).stepZoom = (delta: number) => {
    const next = sanitizeZoom((settingsStore.zoom || 1) + delta)
    setSettingsStore("zoom", next)
    applyZoom(next)
    saveSettings()
  }
  // Test hook: snapshot the current card tree as a flat JSON shape. Used by
  // Playwright / integration tests to read the live store-backed tree.
  ;(window as any).renderConversation = () => cardTreeStore.order.map((id) => cardTreeStore.cards[id]).filter(Boolean)
  ;(window as any).cardTree = cardTreeStore
  // Benchmark hook: expose named stores so external probes do not depend on
  // the legacy aggregate `state` bridge.
  ;(window as any).appStore = appStore
  ;(window as any).boardStore = boardStore
  ;(window as any).settingsStore = settingsStore
  ;(window as any).applyDirectory = applyDirectory
  ;(window as any).loadTasks = loadTasks
  ;(window as any).selectTask = selectTask
  ;(window as any).loadBoard = loadBoard
  ;(window as any).setPageMode = setPageMode
}

installGlobalBridges()
setupDialogBackdropClose()

// ── Mount: NotificationCenter ──
// Keep the in-app notification layer alive before any async boot work, so
// startup and operator-action failures can surface even when OS-level
// notifications are unavailable or permission has not been granted.
const notificationHost = document.createElement("div")
notificationHost.id = "notificationCenterHost"
document.body.appendChild(notificationHost)
render(() => <NotificationCenter surface="toast" />, notificationHost)

function recomputeNotificationsOnForeground() {
  recomputeBadgeFromTasks()
}

window.addEventListener("focus", recomputeNotificationsOnForeground, {
  signal: moduleTeardown.signal,
})
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.visibilityState !== "hidden") recomputeNotificationsOnForeground()
  },
  { signal: moduleTeardown.signal },
)

// ── Mount: Mission page ──
// The Mission page mode lives next to the default panel. The CSS
// (`body[data-page-mode="mission"]`) flips visibility between Panel
// and Mission without unmounting either side, so returning to Panel
// preserves selected task / conversation state (template §6.3).
const missionMountEl = document.getElementById("solidMissionMount")
if (missionMountEl) {
  missionMountEl.innerHTML = ""
  render(
    () => (
      <Mission
        workspaceTarget={workspaceTarget}
        workspaceOpen={workspaceOpen}
        closeWorkspace={closeWorkspace}
      />
    ),
    missionMountEl,
  )
}

// Reflect the active page mode onto <body> so the surface CSS in
// mission.css can hide the panel chrome when Mission is active.
disposers.push(
  createRoot((dispose) => {
    createEffect(() => {
      document.body.dataset.pageMode = pageMode()
    })
    return dispose
  }),
)

// ── Mount: Conversation ──

const chatScroll = document.getElementById("chatScroll")
if (chatScroll) {
  chatScroll.innerHTML = ""
  render(() => <Conversation container={chatScroll} />, chatScroll)
}
const conversationAgentRailMount = document.getElementById("solidConversationAgentRailMount")
if (conversationAgentRailMount) {
  conversationAgentRailMount.innerHTML = ""
  render(() => <ConversationAgentRail />, conversationAgentRailMount)
}

const fileEditorMountEl = document.getElementById("solidFileEditorMount")
if (fileEditorMountEl) {
  fileEditorMountEl.innerHTML = ""
  render(() => <FileEditorPane />, fileEditorMountEl)
}

const fileChangesMountEl = document.getElementById("solidFileChangesMount")
if (fileChangesMountEl) {
  fileChangesMountEl.innerHTML = ""
  render(
    () => <FileChangesPanel diffOpen={workspaceOpen()} diffTarget={workspaceTarget()} onCloseDiff={closeWorkspace} />,
    fileChangesMountEl,
  )
}

const fileExplorerMountEl = document.getElementById("solidFileExplorerMount")
if (fileExplorerMountEl) {
  fileExplorerMountEl.innerHTML = ""
  render(() => <FileExplorerPanel active={() => isCenterWorkbenchPanelOpen("explorer")} directory={activeDirectory} />, fileExplorerMountEl)
}

// ── Sidebar title backdoor: double-click resets DB ──
// Hidden operator escape hatch. Confirms before invoking POST /global/db/reset,
// then reloads to repopulate from a clean schema.
const sidebarTitleEl = document.querySelector<HTMLElement>(".sidebar-title")
if (sidebarTitleEl) {
  sidebarTitleEl.addEventListener("dblclick", async (ev) => {
    ev.preventDefault()
    if (!window.confirm(t("sidebar.reset_db_confirm"))) return
    try {
      const res = await apiRequest<unknown>("global/db/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        responseKind: "text",
      })
      if (res.status === 409) {
        notifyWarning({
          id: "system:reset-db",
          title: t("sidebar.reset_db_blocked_title"),
          message: t("sidebar.reset_db_blocked"),
        })
        return
      }
      if (!res.ok) {
        const text = typeof res.body === "string" && res.body ? res.body : `HTTP ${res.status}`
        notifyError({
          id: "system:reset-db",
          title: t("sidebar.reset_db_failed_title"),
          message: t("sidebar.reset_db_failed", { error: text }),
          details: `POST global/db/reset → HTTP ${res.status}\n\n${
            typeof res.body === "string"
              ? res.body
              : (() => {
                  try { return JSON.stringify(res.body, null, 2) } catch { return String(res.body) }
                })()
          }`,
        })
        return
      }
      window.location.reload()
    } catch (err) {
      notifyError({
        id: "system:reset-db",
        title: t("sidebar.reset_db_failed_title"),
        message: t("sidebar.reset_db_failed", { error: err instanceof Error ? err.message : String(err) }),
        details: formatErrorDetails(err),
      })
    }
  })
}

// ── Mount: TaskList ──

const taskListEl = document.getElementById("taskListPanel")
if (taskListEl) {
  taskListEl.innerHTML = ""
  render(
    () => (
      <TaskList
        onSelectTask={(taskID) => void selectTask(taskID)}
        onDeleteTask={(taskID) => void deleteTask(taskID)}
        onCancelTask={(taskID) => void cancelTask(taskID)}
        onRenameTask={(taskID, title) => void renameTask(taskID, title)}
      />
    ),
    taskListEl,
  )
}

function retrySelectedTask(): void {
  const id = activeTaskID()
  if (!id) return
  void retryTask(id)
}

function replanSelectedTask(): void {
  const id = activeTaskID()
  if (id) void replanTask(id)
}

function cancelSelectedTask(): void {
  const id = activeTaskID()
  if (id) void cancelTask(id)
}

function editGoal(goalId: string, title: string, detail: string): void {
  openGoalDialog(goalId || "", title || "", detail || "")
}

function deleteGoal(goalId: string): void {
  if (!goalId || !activeTaskID()) return
  void (async () => {
    try {
      await panelMessage(`Delete goal ${goalId}.`, {
        goalID: goalId,
        taskID: activeTaskID() || undefined,
      })
      await loadBoard({ sync: true })
    } catch (e) {
      console.error("Failed to delete goal", e)
    }
  })()
}

// ── Mount: ChatComposer ──

// One-shot follow-up suggestion the composer should pre-fill after a task
// finishes. Populated by a busy→idle effect below; cleared by the composer
// via onSuggestionConsumed after it either injects or drops the value.
const [pendingSuggestion, setPendingSuggestion] = createSignal("")
// Track the previous task-busy state so we only fire once per finish edge.
let lastTaskBusy = false
let lastSuggestionTaskID: string | null = null

const panelComposerDraftKey = () => {
  const taskID = activeTaskID()
  if (taskID) return composerDraftKey("task", taskID)
  const sessionID = activeSessionID()
  if (sessionID) return composerDraftKey("session", sessionID)
  const directory = activeDirectory()
  return directory ? composerDraftKey("task", "new", directory) : composerDraftKey("task", "new")
}

const composerEl = document.getElementById("solidChatComposer")
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
        draftKey={panelComposerDraftKey()}
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
            void stopChatRequest({ remote: false })
          }
        }}
      />
    ),
    composerEl,
  )
}

// ── Wire: Terminate button ──

const btnTerminateRun = document.getElementById("btnTerminateRun")
if (btnTerminateRun) {
  btnTerminateRun.addEventListener("click", () => {
    // If there's an active chat request (SSE stream), stop it first
    if (messageStore.chatRequest) {
      void stopChatRequest()
      return
    }
    // Otherwise cancel the active task
    const taskID = activeTaskID()
    if (taskID) void cancelTask(taskID)
  })
}

// ── Mount: WindowControls ──

const windowControlsEl = document.getElementById("solidWindowControls")
if (windowControlsEl) {
  render(() => <WindowControls />, windowControlsEl)
}

// ── Mount: TitlebarMenubar ──

const titlebarMenuEl = document.getElementById("solidTitlebarMenu")
if (titlebarMenuEl) {
  render(() => <TitlebarMenubar onOpenLog={() => setLogOpen(true)} />, titlebarMenuEl)
}

const projectDirectoryBarEl = document.getElementById("solidProjectDirectoryBarMount")
if (projectDirectoryBarEl) {
  render(() => <ProjectDirectoryBar />, projectDirectoryBarEl)
}

const rightActivityToolbarEl = document.getElementById("solidRightActivityToolbar")
if (rightActivityToolbarEl) {
  render(
    () => (
      <SideActivityToolbar
        side="right"
        activities={RIGHT_ACTIVITIES}
        active={activeRightActivity}
        isActive={isRightActivityOpen}
        ariaLabelKey="activity.right"
        onSelect={selectRightActivity}
      />
    ),
    rightActivityToolbarEl,
  )
}

const leftPanelCollapseControlEl = document.getElementById("solidLeftPanelCollapseControl")
if (leftPanelCollapseControlEl) {
  render(() => <LeftPanelHeaderCollapseControl />, leftPanelCollapseControlEl)
}

const leftCollapsedRailControlEl = document.getElementById("solidLeftCollapsedRailControl")
if (leftCollapsedRailControlEl) {
  render(() => <LeftPanelHeaderCollapseControl />, leftCollapsedRailControlEl)
}

const browserPreviewEl = document.getElementById("solidBrowserPreviewMount")
if (browserPreviewEl) {
  render(
    () => (
      <BrowserPreviewPanel
        active={() => isCenterWorkbenchPanelOpen("browser")}
        directory={activeDirectory}
        refreshKey={() => boardStore.boardUpdatedAt}
        taskID={() => activeTaskID() || undefined}
        onReady={() => selectRightActivity("browser")}
      />
    ),
    browserPreviewEl,
  )
}

// ── Mount: ConnectionBadge ──

const connBadgeEl = document.getElementById("solidConnBadge")
if (connBadgeEl) {
  render(() => <ConnectionBadge />, connBadgeEl)
}

// ── Mount: TaskStatusHeader ──
// Reactive replacement for the previous imperative createEffects in main.tsx
// that toggled #taskStatus[hidden], wrote #statusIcon.innerHTML, set
// #statusLabel textContent and ticked #taskElapsed via getElementById each
// frame. Owns its own visibility-gated 1Hz interval via Solid lifecycle.

const taskStatusMountEl = document.getElementById("solidTaskStatusMount")
if (taskStatusMountEl) {
  render(() => <TaskStatusHeader />, taskStatusMountEl)
}

disposers.push(
  createRoot((dispose) => {
    createEffect(() => {
      const busyNow = !!messageStore.chatRequest || isTaskInterruptable()
      const wasBusy = lastTaskBusy
      lastTaskBusy = busyNow
      // Each busy→true edge resets the guard so the next finish is eligible for
      // a fresh suggestion even if it's the same task.
      if (busyNow && !wasBusy) {
        lastSuggestionTaskID = null
        return
      }
      if (!wasBusy || busyNow) return
      const taskID = activeTaskID()
      if (!taskID) return
      if (lastSuggestionTaskID === taskID) return
      lastSuggestionTaskID = taskID
      void apiJson(`task/${encodeURIComponent(taskID)}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then((data: any) => {
          const text = typeof data?.suggestion === "string" ? data.suggestion.trim() : ""
          if (text) setPendingSuggestion(text)
        })
        .catch((err) => {
          AppLog.warn("main", "followup suggestion failed", err)
        })
    })

    return dispose
  }),
)

// ── Mount: Board (right-panel task workflow sections) ──

const boardMountEl = document.getElementById("solidBoardMount")
if (boardMountEl) {
  render(
    () => (
      <Board
        onRetry={retrySelectedTask}
        onReplan={replanSelectedTask}
        onCancel={cancelSelectedTask}
        onEditGoal={editGoal}
        onDeleteGoal={deleteGoal}
      />
    ),
    boardMountEl,
  )
}

const notificationPanelEl = document.getElementById("solidNotificationCenterMount")
if (notificationPanelEl) {
  render(() => <NotificationCenter surface="panel" />, notificationPanelEl)
}

// ── Mount: LogViewer (renders its own <dialog id="logDialog">) ──

const logViewerEl = document.getElementById("solidLogViewer")
if (logViewerEl) {
  render(() => <LogViewer open={logOpen()} onClose={() => setLogOpen(false)} />, logViewerEl)
}

document.addEventListener("DOMContentLoaded", () => {
  // ── Sidebar buttons ──
  document.getElementById("btnCreateTask")?.addEventListener("click", () => {
    // Deselect current task and focus the composer — the user types their
    // request directly in the ChatComposer, no modal dialog needed.
    setPageMode("panel")
    void selectTask("")
    const textarea = document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")
    textarea?.focus()
  })

  // Mission entry: switch to the Mission page mode. The mount itself
  // lives in the static layout (#solidMissionMount); show/hide is
  // governed by body[data-page-mode] (see styles/surfaces/mission.css).
  document.getElementById("btnMission")?.addEventListener("click", () => {
    setPageMode(pageMode() === "mission" ? "panel" : "mission")
  })

  // Executor selection moved to <ExecutorSelector/> mounted inside ChatComposer
  // (chat-compose-meta-left). The component owns its own dropdown, click-out
  // dismissal and Escape handling — Solid lifecycle disposes both on unmount.
})

// ── Initialise application ──

const [settingsHydrated, setSettingsHydrated] = createSignal(false)

disposers.push(
  createRoot((dispose) => {
    // body.dataset.workspace / .connection writes were dead — no CSS or JS in
    // the codebase reads either attribute. Removed (rule 10). The static
    // initial `data-workspace="offline"` in index.html is also stripped.

    createEffect(() => {
      if (!settingsHydrated()) return
      applyTheme(settingsStore.theme)
      applyZoom(settingsStore.zoom)
      applyOpacity(settingsStore.opacity)
    })

    createEffect(() => {
      if (!settingsHydrated()) return
      configureApi({
        serverUrl: settingsStore.serverUrl,
        username: settingsStore.username,
        password: settingsStore.password,
        directory: activeDirectory(),
      })
    })

    createEffect(() => {
      void setLocale(settingsStore.locale)
    })

    // Chat header usage strip — whole-conversation token + USD-cost
    // estimate aggregated across every runtime session in the selected
    // task's card tree. The aggregation kernel lives in
    // `utils/format-usage.ts` (`aggregateUsageAcrossSessions` +
    // `formatUsageStrip`) so it can be unit-tested without DOM or Solid.
    // This effect is the reactive glue: it reads the cards proxy so
    // Solid re-runs the effect whenever a card is added, removed, or
    // its `usage` field changes, and writes the formatted string into
    // `#chatUsage`. An empty string hides the chip via the
    // `.chat-usage:empty { display: none }` rule.
    createEffect(() => {
      const target = document.getElementById("chatUsage")
      if (!target) return
      const aggregate = aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))
      target.textContent = formatUsageStrip(aggregate)
    })

    // ── Debug-copy (double-click `任务` header) ──
    // Dumps a plain-text debug blob with everything a human needs to diagnose a
    // stuck / mis-merged task from the DB: task id, project dir, session, active
    // run, per-goal worktree path + branch + retry count, plus ready-to-paste
    // SQL queries keyed on the task id. Reads `boardStore.board` — the live
    // projection for the currently selected task — so no extra fetch.
    //
    // Triggered by a double-click on the Conversation tab. Single
    // click remains free for future use. The same button flashes a "已复制"
    // hint via a transient `data-copied` attribute.
    {
      const title = document.querySelector("#chatViewTitle") as HTMLElement | null
      if (title) {
        title.style.cursor = "copy"
        title.title = "双击复制调试信息 (task id / directory / session / run / worktrees + SQL)"
        const flash = (text: string) => {
          title.dataset.copied = "true"
          const prev = title.textContent ?? ""
          title.textContent = text
          setTimeout(() => {
            delete title.dataset.copied
            title.textContent = prev
          }, 1400)
        }
        title.addEventListener("dblclick", async (ev) => {
          ev.preventDefault()
          const blob = buildTaskDebugBlob(boardStore.board)
          if (!blob) {
            flash("无任务")
            return
          }
          try {
            await navigator.clipboard.writeText(blob)
            flash("已复制")
          } catch (err) {
            console.error("[chat-view-title dblclick] clipboard write failed", err)
            flash("复制失败")
          }
        })
      }
    }

    // ── Task-switch progress bar (non-blocking) ──
    // Reflects boardStore.taskSwitching (set synchronously at selectTask entry,
    // cleared when the async load chain completes). The bar lives in a fixed
    // slot above the chat header so user input is never gated on load.
    createEffect(() => {
      settingsStore.locale
      boardStore.selectedSource
      const title = document.querySelector("#chatViewTitle") as HTMLElement | null
      if (title) title.textContent = isCodingAssistantSource() ? t("chat.assistant_title") : t("chat.title")
    })

    createEffect(() => {
      const active = boardStore.taskSwitching
      const bar = document.getElementById("taskSwitchProgress")
      if (!bar) return
      bar.setAttribute("data-active", active ? "true" : "false")
      bar.setAttribute("aria-busy", active ? "true" : "false")
    })

    createEffect(() => {
      const panels = centerWorkbenchPanels()
      const workbench = document.getElementById("centerWorkbench")
      const resizer = document.getElementById("centerWorkbenchResizer")
      const views = getCenterWorkbenchViews()
      if (workbench) {
        workbench.dataset.open = String(panels.length > 0)
        workbench.hidden = panels.length === 0
      }
      if (resizer) {
        resizer.hidden = true
        resizer.dataset.disabled = "true"
      }
      for (const [panel, body] of Object.entries(views)) {
        const open = panels.includes(panel as CenterWorkbenchPanel)
        if (body) {
          body.dataset.open = String(open)
          body.dataset.active = String(open)
        }
      }
      renderCenterWorkbenchPanelWeights()
    })

    createEffect(() => {
      settingsStore.centerWorkbenchWidth
      settingsStore.centerWorkbenchPanelWeights
      centerWorkbenchPanels().length
      renderCenterWorkbenchWidth()
      renderCenterWorkbenchPanelWeights()
    })

    createEffect(() => {
      const panels = centerWorkbenchPanels()
      const sections = document.getElementById("sections")
      const inspectorBody = document.getElementById("rightPanelInspector")
      const notificationsBody = document.getElementById("rightPanelNotifications")
      const inspectorTitle = document.getElementById("rightPanelTitle")
      const notificationsTitle = document.getElementById("notificationPanelTitle")
      if (sections) sections.dataset.rightActivity = "inspector"
      if (inspectorTitle) inspectorTitle.textContent = t("sections.title")
      if (notificationsTitle) notificationsTitle.textContent = t("notify.center_label")
      if (inspectorBody) inspectorBody.dataset.active = String(panels.includes("inspector"))
      if (notificationsBody) notificationsBody.dataset.active = String(panels.includes("notifications"))
    })

    createEffect(() => {
      const open = fileWorkbenchOpen()
      if (open) {
        setWorkspaceOpen(false)
        openCenterWorkbenchPanel("file")
      } else {
        closeCenterWorkbenchPanel("file")
      }
    })

    createEffect(() => {
      const open = workspaceOpen()
      if (open) {
        openCenterWorkbenchPanel("diff")
      } else {
        closeCenterWorkbenchPanel("diff")
      }
    })

    createEffect(() => {
      const sidebarCollapsed = settingsStore.sidebarCollapsed
      const rightPanelCollapsed = settingsStore.rightPanelCollapsed

      const sidebar = document.getElementById("sidebar")
      const sections = document.getElementById("sections")
      const leftResizer = document.getElementById("leftPaneResizer") as HTMLElement | null

      if (sidebar) {
        sidebar.dataset.collapsed = String(sidebarCollapsed)
        sidebar.hidden = false
      }
      if (sections) {
        sections.dataset.collapsed = "false"
        sections.hidden = false
      }
      if (leftResizer) {
        leftResizer.hidden = sidebarCollapsed
        leftResizer.dataset.disabled = String(sidebarCollapsed)
      }

      renderPaneLayout({
        sidebarCollapsed,
        rightPanelCollapsed,
        sidebarWidth: settingsStore.sidebarWidth,
        sectionsWidth: settingsStore.sectionsWidth,
      }, PANEL_PANE_CONFIG)
    })

    // Task status header + elapsed timer moved to <TaskStatusHeader/> component
    // (mounted into #solidTaskStatusMount above). The component owns its own
    // visibility-gated 1Hz interval and renders all four spans (status-icon,
    // status-label, elapsed) via Solid's reactive graph instead of four
    // getElementById writes per board update.

    // interactionBridge.renderInteractions removed — the unified InteractionCard
    // renders the UI in both inline conversation and sidebar surfaces, and

    return dispose
  }),
)

const paneCallbacks = {
  getState: () => ({
    sidebarCollapsed: settingsStore.sidebarCollapsed,
    rightPanelCollapsed: settingsStore.rightPanelCollapsed,
    sidebarWidth: settingsStore.sidebarWidth,
    sectionsWidth: settingsStore.sectionsWidth,
  }),
  onWidthsChanged: (sidebarWidth: number | null, sectionsWidth: number | null) => {
    setSettingsStore({
      ...(sidebarWidth != null ? { sidebarWidth } : {}),
      ...(sectionsWidth != null ? { sectionsWidth } : {}),
    })
    saveSettings()
  },
}
initPaneResizers(paneCallbacks, PANEL_PANE_CONFIG)

interface CenterWorkbenchPanelResize {
  leftPanel: CenterWorkbenchPanel
  rightPanel: CenterWorkbenchPanel
  leftRect: DOMRect
  totalWidth: number
  totalWeight: number
  minWidth: number
}

let centerWorkbenchPanelResize: CenterWorkbenchPanelResize | null = null

function startCenterWorkbenchPanelResize(event: PointerEvent, leftPanel: CenterWorkbenchPanel): void {
  const panels = orderedCenterWorkbenchPanels(untrack(centerWorkbenchPanels))
  const index = panels.indexOf(leftPanel)
  const rightPanel = panels[index + 1]
  if (!rightPanel) return
  const views = getCenterWorkbenchViews()
  const leftBody = views[leftPanel]
  const rightBody = views[rightPanel]
  if (!leftBody || !rightBody) return
  const leftRect = leftBody.getBoundingClientRect()
  const rightRect = rightBody.getBoundingClientRect()
  const totalWidth = leftRect.width + rightRect.width
  if (totalWidth <= 0) return
  const scale = currentUIScale()
  const desiredMin = CENTER_WORKBENCH_MIN_PANEL_WIDTH * scale
  const minWidth = Math.min(desiredMin, Math.max(80 * scale, (totalWidth - 2) / 2))
  centerWorkbenchPanelResize = {
    leftPanel,
    rightPanel,
    leftRect,
    totalWidth,
    totalWeight: centerWorkbenchPanelWeight(leftPanel) + centerWorkbenchPanelWeight(rightPanel),
    minWidth,
  }
  document.body.dataset.centerWorkbenchPanelResizing = "true"
  event.preventDefault()
}

function findCenterWorkbenchResizePanel(event: PointerEvent): CenterWorkbenchPanel | null {
  const panels = orderedCenterWorkbenchPanels(untrack(centerWorkbenchPanels))
  if (panels.length < 2) return null
  const views = getCenterWorkbenchViews()
  const handleWidth = 10 * currentUIScale()
  for (let index = 0; index < panels.length - 1; index += 1) {
    const leftPanel = panels[index]
    if (!leftPanel) continue
    const leftBody = views[leftPanel]
    const rightBody = views[panels[index + 1]!]
    if (!leftBody || !rightBody) continue
    const leftRect = leftBody.getBoundingClientRect()
    const rightRect = rightBody.getBoundingClientRect()
    const boundaryX = Math.round((leftRect.right + rightRect.left) / 2)
    if (Math.abs(event.clientX - boundaryX) <= handleWidth) return leftPanel
  }
  return null
}

function updateCenterWorkbenchPanelResize(event: PointerEvent): void {
  const drag = centerWorkbenchPanelResize
  if (!drag) return
  const leftWidth = Math.min(
    Math.max(event.clientX - drag.leftRect.left, drag.minWidth),
    drag.totalWidth - drag.minWidth,
  )
  const leftWeight = drag.totalWeight * (leftWidth / drag.totalWidth)
  const rightWeight = drag.totalWeight - leftWeight
  setSettingsStore("centerWorkbenchPanelWeights", {
    ...(settingsStore.centerWorkbenchPanelWeights ?? {}),
    [drag.leftPanel]: leftWeight,
    [drag.rightPanel]: rightWeight,
  })
}

function stopCenterWorkbenchPanelResize(): void {
  if (!centerWorkbenchPanelResize) return
  centerWorkbenchPanelResize = null
  delete document.body.dataset.centerWorkbenchPanelResizing
  saveSettings()
}

let centerWorkbenchDrag = false
function stopCenterWorkbenchResize() {
  if (!centerWorkbenchDrag) return
  centerWorkbenchDrag = false
  delete document.body.dataset.centerWorkbenchResizing
  const cssWidth = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--ui-center-workbench-width"))
  const width = clampCenterWorkbenchWidth(Number.isFinite(cssWidth) ? cssWidth : centerWorkbenchWidth())
  setSettingsStore("centerWorkbenchWidth", width)
  saveSettings()
}

const centerWorkbenchResizer = document.getElementById("centerWorkbenchResizer")
centerWorkbenchResizer?.addEventListener(
  "pointerdown",
  (event) => {
    if ((event as PointerEvent).button != null && (event as PointerEvent).button !== 0) return
    centerWorkbenchDrag = true
    document.body.dataset.centerWorkbenchResizing = "true"
    event.preventDefault()
  },
  listenerOpts,
)
const centerWorkbench = document.getElementById("centerWorkbench")
centerWorkbench?.addEventListener(
  "pointerdown",
  (event) => {
    const pointer = event as PointerEvent
    if (pointer.button != null && pointer.button !== 0) return
    const panel = findCenterWorkbenchResizePanel(pointer)
    if (!panel) return
    startCenterWorkbenchPanelResize(pointer, panel)
  },
  listenerOpts,
)
window.addEventListener(
  "pointermove",
  (event) => {
    updateCenterWorkbenchPanelResize(event)
    if (!centerWorkbenchDrag) return
    const workspace = document.getElementById("conversationWorkspace")
    const rect = workspace?.getBoundingClientRect()
    if (!rect) return
    renderCenterWorkbenchWidth(rect.right - event.clientX)
  },
  listenerOpts,
)
window.addEventListener("pointerup", stopCenterWorkbenchResize, listenerOpts)
window.addEventListener("pointerup", stopCenterWorkbenchPanelResize, listenerOpts)
window.addEventListener("pointercancel", stopCenterWorkbenchResize, listenerOpts)
window.addEventListener("pointercancel", stopCenterWorkbenchPanelResize, listenerOpts)

// ── Global event listeners (

window.addEventListener("keydown", handleZoomHotkey, listenerOpts)
window.addEventListener(
  "keydown",
  (e: KeyboardEvent) => {
    if (e.key === "F12") {
      e.preventDefault()
      void toggleDevtools()
    }
  },
  listenerOpts,
)
const onResize = () => {
  applyZoom(settingsStore.zoom)
  renderCenterWorkbenchWidth()
}
window.addEventListener("resize", onResize, listenerOpts)
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize, listenerOpts)
window.addEventListener(
  "blur",
  () => {
    void cancelPaneResize(paneCallbacks)
    stopCenterWorkbenchResize()
    stopCenterWorkbenchPanelResize()
  },
  listenerOpts,
)
window.addEventListener("beforeunload", () => {
  runModuleTeardown()
  teardownApp()
  stopTimers()
})
installSystemThemeListener(() => applyTheme(settingsStore.theme))

// Dev-only hook used by `script/snap-settings.ts` to drive the config
// dialog open from Playwright. Vite dev does not happily serve the
// `.ts` modules to a dynamic-import call from a foreign origin, so the
// snap script cannot reach `openConfigDialog` through the module graph
// — it reaches in via `window.__OC_DEV__` instead. Gated on
// `import.meta.env.DEV` so the production bundle does not carry it.
//
// `ensureConfigHost` is here because the production init IIFE only
// mounts <ConfigDialogHost /> *after* `initApp()` resolves — and
// without a running daemon `initApp()` blocks indefinitely. The snap
// script calls `ensureConfigHost()` first so it can open the dialog
// even when the rest of the app is offline.
if (import.meta.env.DEV) {
  let configHostMounted = false
  function ensureConfigHost(): void {
    if (configHostMounted) return
    if (document.getElementById("configDialogHost")) {
      configHostMounted = true
      return
    }
    const host = document.createElement("div")
    host.id = "configDialogHost"
    document.body.appendChild(host)
    render(() => <ConfigDialogHost />, host)
    configHostMounted = true
  }
  let goalHostMounted = false
  function ensureGoalHost(): void {
    if (goalHostMounted) return
    if (document.getElementById("goalDialogHost")) {
      goalHostMounted = true
      return
    }
    const host = document.createElement("div")
    host.id = "goalDialogHost"
    document.body.appendChild(host)
    render(() => <GoalDialogHost />, host)
    goalHostMounted = true
  }
  ;(window as any).__OC_DEV__ = { openConfigDialog, ensureConfigHost, openGoalDialog, ensureGoalHost }
}

// ── Init ──

function ensureAppDialogHost(): void {
  if (document.getElementById("appDialogHost")) return
  const appDialogHost = document.createElement("div")
  appDialogHost.id = "appDialogHost"
  document.body.appendChild(appDialogHost)
  render(() => <AppDialogHost />, appDialogHost)
}

function ensureConfigDialogHost(): void {
  if (document.getElementById("configDialogHost")) return
  const configDialogHost = document.createElement("div")
  configDialogHost.id = "configDialogHost"
  document.body.appendChild(configDialogHost)
  render(() => <ConfigDialogHost />, configDialogHost)
}

;(window as any).__overlayInitSettled = false
void (async () => {
  try {
    ensureAppDialogHost()
    ensureConfigDialogHost()
    await initApp({
      onSettingsLoaded: () => {
        setSettingsHydrated(true)
      },
    })
    renderAboutVersion()
    const connBannerHost = document.createElement("div")
    connBannerHost.id = "connectionBannerHost"
    document.body.appendChild(connBannerHost)
    render(() => <ConnectionBanner />, connBannerHost)
    const cmdkHost = document.createElement("div")
    cmdkHost.id = "commandPaletteHost"
    document.body.appendChild(cmdkHost)
    render(() => <CommandPalette />, cmdkHost)
    const sessionDialogHost = document.createElement("div")
    sessionDialogHost.id = "sessionDialogHost"
    document.body.appendChild(sessionDialogHost)
    render(() => <SessionDialogHost />, sessionDialogHost)
    ensureAppDialogHost()
    const interactionDialogHost = document.createElement("div")
    interactionDialogHost.id = "interactionDialogHost"
    document.body.appendChild(interactionDialogHost)
    render(() => <InteractionDialogHost />, interactionDialogHost)
    const goalDialogHost = document.createElement("div")
    goalDialogHost.id = "goalDialogHost"
    document.body.appendChild(goalDialogHost)
    render(() => <GoalDialogHost />, goalDialogHost)
    ensureConfigDialogHost()
    const imagePreviewHost = document.createElement("div")
    imagePreviewHost.id = "imagePreviewHost"
    document.body.appendChild(imagePreviewHost)
    render(() => <ImagePreviewHost />, imagePreviewHost)
    const onboardingHost = document.createElement("div")
    onboardingHost.id = "workspaceOnboardingHost"
    document.body.appendChild(onboardingHost)
    render(() => <WorkspaceOnboardingDialog />, onboardingHost)
  } catch (error) {
    reportOverlayRuntimeError("initApp", error)
  } finally {
    await waitForLogDrain()
    ;(window as any).__overlayInitSettled = true
  }
})()
