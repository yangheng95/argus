// ── Entry Point ──
// Self-sufficient Solid.js entry point.
// Mounts all Solid components and initialises the application.
// Self-sufficient — no external script dependencies.

import { render } from "solid-js/web"
import { createEffect, createMemo, createRoot, createSignal, untrack } from "solid-js"
import { App } from "./components/App"
import { Icon, LUCIDE_ICON_NAMES, REGISTERED_ICONS, type IconName } from "./components/Icon"
import { Conversation } from "./components/Conversation"
import { TaskList } from "./components/TaskList"
import { CodingAssistantSessionList } from "./components/CodingAssistantSessionList"
import { Board } from "./components/Board"
import { Mission } from "./components/Mission"
import { ChatComposer } from "./components/ChatComposer"
import { LogViewer } from "./components/LogViewer"
import { FileExplorerPanel } from "./components/FileExplorerPanel"
import { FileChangesPanel, type FileChangesActiveView } from "./components/FileChangesPanel"
import { BrowserPreviewPanel } from "./components/BrowserPreviewPanel"
import { ScreenshotBrowserPanel } from "./components/ScreenshotBrowserPanel"
import { SideActivityToolbar, type SideActivity } from "./components/SideActivityToolbar"
import { McpPanel, SkillsPanel } from "./components/settings/SkillMarketPanel"
import { MemoryPanel } from "./components/MemoryPanel"
import { closeFileEditor, fileWorkbenchOpen } from "./services/file-workbench"
import type { DiffTarget } from "./services/diff"
import { initApp } from "./services/init"
import {
  loadTasks,
  boardStore,
  loadBoard,
  activeTaskID,
  activeSessionID,
  rootTaskSessionID,
  setBoardStore,
} from "./store/board"
import { clearMessages, messageStore, setChatAttachments } from "./store/messages"
import { appStore } from "./store/app"
import { selectTask, retryTask, replanTask, cancelTask, createTask, deleteTask, renameTask } from "./services/task"
import { canComposeChat, stopChatRequest } from "./services/chat"
import { isTaskInterruptable } from "./store/board"
import { loadAllLocales, localeTag, setLocale } from "./utils/i18n"
import { ApiError, apiJson, configure as configureApi } from "./services/api"
import { t } from "./utils/i18n"
import { renderMarkdown } from "./utils/markdown"
import { formatUsageStrip } from "./utils/format-usage"
import {
  applyTheme,
  applyZoom,
  applyOpacity,
  sanitizeZoom,
  handleZoomHotkey,
  installSystemThemeListener,
  toggleDevtools,
} from "./services/theme"
import { bumpWorkspaceEpoch, settingsStore, setSettingsStore, saveSettings } from "./store/settings"
import {
  initPaneResizers,
  cancelPaneResize,
  currentUIScale,
  renderPaneLayout,
  PANEL_PANE_CONFIG,
  type PaneState,
} from "./services/pane"
import { panelMessage } from "./services/chat"
import {
  loadPromptProfileCatalog,
  resetDatabase,
  type PromptProfileCatalogScope,
  type PromptProfileOption,
} from "./services/config"
import { NotificationCenter } from "./components/NotificationCenter"
import { waitForLogDrain, AppLog } from "./utils/log"
import { teardownApp } from "./services/init"
import { stopTimers } from "./services/sync"
import { nativeOpen } from "./utils/native"
import { getHostTransport } from "./services/host-transport"
import { hydrateIconPlaceholders, installIconHtmlRenderer } from "./utils/icon-html"
import { installNativeContextMenuSuppression } from "./utils/context-menu"
import { notifyError, notifyWarning, formatErrorDetails, recomputeBadgeFromTasks } from "./services/notify"
import { applyDirectory, activeDirectory, openPathInSelectedEditor } from "./services/workspace"
import { openConfigDialog, openGoalDialog, renderAboutVersion } from "./services/dialog"
import { cardTreeStore } from "./store/card-tree"
import { composerDraftKey } from "./services/composer-draft"
import { loadConversation } from "./services/conversation"
import { codingAssistantStore } from "./store/coding-assistant"
import {
  createCodingAssistantSession,
  deleteCodingAssistantSession,
  isCodingAssistantSource,
  loadCodingAssistantSessions,
  renameCodingAssistantSession,
  selectCodingAssistantSession,
  setCodingAssistantSearchQuery,
  stopCodingAssistantSession,
} from "./services/coding-assistant"
import { wakeMission, type MissionWakeResult } from "./services/mission"
import { startSSE, stopSSE } from "./services/sse"
import { resetWriter } from "./services/tree-writer"
import { openImagePreview } from "./services/image-preview"
import { buildChatDebugBlob, buildTaskDebugBlob, writeDebugClipboard } from "./utils/debug-info"
import { taskOwningDirectory } from "./services/task-directory"
import { taskScopedPath } from "./services/task-path"
import { createAnimationFrameScheduler } from "./utils/animation-frame"
import { promptProfileCatalogRequestKey, promptProfileCatalogScope } from "./services/prompt-profile-scope"
import { clampCenterWorkbenchResizeWidth, centerWorkbenchResizeRange } from "./utils/center-workbench-size"
import { layoutTokenPx } from "./utils/layout-tokens"

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
const REGISTERED_ICON_NAMES = new Set<string>(REGISTERED_ICONS)
const LUCIDE_ICON_NAME_SET = new Set<string>(LUCIDE_ICON_NAMES)

let pendingPaneLayoutState: PaneState | null = null

function flushPaneLayout(): void {
  const state = pendingPaneLayoutState
  pendingPaneLayoutState = null
  if (!state) return
  renderPaneLayout(state, PANEL_PANE_CONFIG)
}

const renderPaneLayoutOnFrame = createAnimationFrameScheduler(flushPaneLayout)
disposers.push(() => renderPaneLayoutOnFrame.cancel())

function schedulePaneLayout(state: PaneState): void {
  pendingPaneLayoutState = { ...state }
  renderPaneLayoutOnFrame.schedule()
}

function iconHtmlName(name: string): IconName {
  if (!REGISTERED_ICON_NAMES.has(name)) throw new Error(`Unknown icon "${name}"`)
  return name as IconName
}

function iconHtmlClassName(name: string, className?: string): string {
  if (LUCIDE_ICON_NAME_SET.has(name)) return className ?? ""
  return ["lucide", `lucide-${name}`, className].filter(Boolean).join(" ")
}

disposers.push(
  installIconHtmlRenderer(({ name, size, className }) => {
    const resolvedName = iconHtmlName(name)
    const root = document.createElement("span")
    const dispose = render(
      () => Icon({ name: resolvedName, size, class: iconHtmlClassName(resolvedName, className) }),
      root,
    )
    try {
      return root.innerHTML
    } finally {
      dispose()
    }
  }),
)
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
    notificationID: `runtime:${scope}`,
    notificationTitle: t("common.error"),
    notificationMessage: message,
    notificationDetails: diagnosticDetails,
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

window.addEventListener("oc:open-logs", () => setLogOpen(true), listenerOpts)

// ── Workspace (secondary panel, stacked above composer) state ──
// workspaceOpen drives layout visibility; workspaceTarget is remembered across
// open/close cycles so reopening restores the last active diff target.
const [workspaceOpen, setWorkspaceOpen] = createSignal(false)
const [workspaceTarget, setWorkspaceTarget] = createSignal<DiffTarget>({ filePath: "" })
const [fileChangesActiveView, setFileChangesActiveView] = createSignal<FileChangesActiveView>("changes")
const [browserPreviewLinkRefresh, setBrowserPreviewLinkRefresh] = createSignal(0)

type CenterWorkbenchPanel =
  | "workflow"
  | "inspector"
  | "notifications"
  | "explorer"
  | "diff"
  | "browser"
  | "screenshots"
  | "file"
type RightActivity = Exclude<CenterWorkbenchPanel, "file">
type LeftActivity = "tasks" | "mission" | "assistant" | "memory" | "skill" | "mcp"
type PrimaryLeftActivity = "tasks" | "mission" | "assistant"
type PrimaryCenterPanel = "task" | "mission" | "chat"

const CENTER_WORKBENCH_PANEL_ORDER: readonly CenterWorkbenchPanel[] = [
  "workflow",
  "explorer",
  "diff",
  "browser",
  "screenshots",
  "inspector",
  "notifications",
  "file",
]

const RIGHT_ACTIVITIES: readonly SideActivity<RightActivity>[] = [
  { id: "workflow", icon: "workflow", labelKey: "chat.title", tooltipKey: "activity.tooltip.workflow" },
  { id: "inspector", icon: "inspect", labelKey: "sections.title", tooltipKey: "activity.tooltip.inspector" },
  { id: "explorer", icon: "folder", labelKey: "explorer.title", tooltipKey: "activity.tooltip.explorer" },
  { id: "diff", icon: "files", labelKey: "workspace.diff", tooltipKey: "activity.tooltip.diff" },
  { id: "browser", icon: "web-search", labelKey: "browser_preview.title", tooltipKey: "activity.tooltip.browser" },
  {
    id: "screenshots",
    icon: "screenshots",
    labelKey: "screenshots.title",
    tooltipKey: "activity.tooltip.screenshots",
  },
  {
    id: "notifications",
    icon: "notifications",
    labelKey: "notify.center_label",
    tooltipKey: "activity.tooltip.notifications",
  },
]

const LEFT_ACTIVITIES: readonly SideActivity<LeftActivity>[] = [
  { id: "mission", icon: "mission", labelKey: "mission.title", tooltipKey: "activity.tooltip.mission" },
  { id: "tasks", icon: "tasks", labelKey: "task.ledger.title", tooltipKey: "activity.tooltip.tasks" },
  { id: "assistant", icon: "message", labelKey: "coding_assistant.title", tooltipKey: "activity.tooltip.assistant" },
  { id: "memory", icon: "config-memory", labelKey: "memory.title", tooltipKey: "activity.tooltip.memory" },
  { id: "skill", icon: "config-skill", labelKey: "skill.title", tooltipKey: "activity.tooltip.skill" },
  { id: "mcp", icon: "config-mcp", labelKey: "mcp.title", tooltipKey: "activity.tooltip.mcp" },
]

const LEFT_ACTIVITY_BY_ID: ReadonlyMap<LeftActivity, SideActivity<LeftActivity>> = new Map(
  LEFT_ACTIVITIES.map((activity) => [activity.id, activity]),
)

function leftActivityDefinition(activity: LeftActivity): SideActivity<LeftActivity> {
  const definition = LEFT_ACTIVITY_BY_ID.get(activity)
  if (!definition) throw new Error(`Unknown left activity: ${activity}`)
  return definition
}

const [centerWorkbenchPanels, setCenterWorkbenchPanels] = createSignal<CenterWorkbenchPanel[]>(["workflow"])
const activeRightActivity = (): RightActivity | null => {
  const panel = selectedCenterWorkbenchPanel()
  return panel && panel !== "file" ? panel : null
}
const [selectedLeftActivity, setSelectedLeftActivity] = createSignal<LeftActivity>("mission")
const [selectedLeftPanelActivity, setSelectedLeftPanelActivity] = createSignal<LeftActivity>("mission")
const [primaryCenterPanel, setPrimaryCenterPanel] = createSignal<PrimaryCenterPanel>("mission")
const [missionActivityActivationToken, setMissionActivityActivationToken] = createSignal(0)
const [missionSharedRefreshToken, setMissionSharedRefreshToken] = createSignal(0)
const [missionLauncherActive, setMissionLauncherActive] = createSignal(false)
const [missionLauncherSubmitting, setMissionLauncherSubmitting] = createSignal(false)
const [assistantLauncherActive, setAssistantLauncherActive] = createSignal(false)
const [assistantLauncherSubmitting, setAssistantLauncherSubmitting] = createSignal(false)
const activeLeftActivity = () => selectedLeftActivity()
let codingAssistantActivationController: AbortController | null = null

function abortCodingAssistantActivation(): void {
  codingAssistantActivationController?.abort(
    new DOMException("Left activity switched away from Coding Assistant", "AbortError"),
  )
  codingAssistantActivationController = null
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function activateCodingAssistantSessionList(): void {
  abortCodingAssistantActivation()
  setMissionLauncherActive(false)
  setAssistantLauncherActive(false)
  if (isMissionSessionSource()) void selectTask("")
  const controller = new AbortController()
  codingAssistantActivationController = controller
  bumpWorkspaceEpoch()
  resetCenterWorkbenchToFocusedPanel("assistant")
  setSelectedLeftActivity("assistant")
  setSelectedLeftPanelActivity("assistant")
  void (async () => {
    await loadCodingAssistantSessions({ signal: controller.signal })
    if (controller.signal.aborted) throw controller.signal.reason
    const selectedID = codingAssistantStore.selectedSessionID
    const session =
      (selectedID ? codingAssistantStore.sessions.find((item) => item.id === selectedID) : undefined) ??
      codingAssistantStore.sessions[0]
    if (session?.id) {
      setAssistantLauncherActive(false)
      await selectCodingAssistantSession({
        sessionID: session.id,
        directory: String(session.directory || ""),
        signal: controller.signal,
      })
    } else {
      setAssistantLauncherActive(true)
    }
  })()
    .catch((error) => {
      if (isAbortError(error)) return
      reportOverlayRuntimeError("coding-assistant.sessions", error)
    })
    .finally(() => {
      if (codingAssistantActivationController === controller) codingAssistantActivationController = null
    })
}

function isCenterWorkbenchPanelOpen(panel: CenterWorkbenchPanel): boolean {
  return centerWorkbenchPanels().includes(panel)
}

function isRightActivityOpen(activity: RightActivity): boolean {
  if (activity === "workflow") return isCenterWorkbenchPanelOpen("workflow")
  return isCenterWorkbenchPanelOpen(activity)
}

function isLeftActivityOpen(activity: LeftActivity): boolean {
  if (activity === "assistant") {
    return (
      selectedLeftActivity() === "assistant" &&
      primaryCenterPanel() === "chat" &&
      isCenterWorkbenchPanelOpen("workflow")
    )
  }
  return selectedLeftActivity() === activity
}

const LEFT_PRIMARY_CENTER_PANEL: Record<PrimaryLeftActivity, PrimaryCenterPanel> = {
  tasks: "task",
  mission: "mission",
  assistant: "chat",
}

function isPrimaryLeftActivity(activity: LeftActivity): activity is PrimaryLeftActivity {
  return activity === "tasks" || activity === "mission" || activity === "assistant"
}

function leftActivityCenterPanel(activity: PrimaryLeftActivity): PrimaryCenterPanel {
  return LEFT_PRIMARY_CENTER_PANEL[activity]
}

function focusedLeftActivityOwnsPrimaryPanel(
  activity: LeftActivity = selectedLeftActivity(),
): activity is PrimaryLeftActivity {
  return isPrimaryLeftActivity(activity)
}

let pendingCenterWorkbenchRevealPanel: CenterWorkbenchPanel | null = null

function revealPendingCenterWorkbenchPanel(): void {
  const panel = pendingCenterWorkbenchRevealPanel
  pendingCenterWorkbenchRevealPanel = null
  if (!panel) return
  getCenterWorkbenchViews()[panel]?.scrollIntoView({ block: "nearest", inline: "nearest" })
}

function resetCenterWorkbenchToFocusedPanel(activity: PrimaryLeftActivity): void {
  const panel = leftActivityCenterPanel(activity)
  setWorkspaceOpen(false)
  closeFileEditor()
  setPrimaryCenterPanel(panel)
  setCenterWorkbenchPanels(["workflow"])
  scheduleCenterWorkbenchPanelReveal("workflow")
}

function hasWorkspaceDiffTarget(): boolean {
  return !!untrack(workspaceTarget).filePath
}

function openDiffActivity(): void {
  if (hasWorkspaceDiffTarget()) {
    setWorkspaceOpen(true)
    setFileChangesActiveView("diff")
  }
  openCenterWorkbenchPanel("diff")
}

function selectDiffActivity(): void {
  const diffOpen = isCenterWorkbenchPanelOpen("diff")
  const diffViewActive = untrack(fileChangesActiveView) === "diff"
  const hasTarget = hasWorkspaceDiffTarget()
  if (diffOpen && (!hasTarget || diffViewActive)) {
    closeCenterWorkbenchPanel("diff")
    return
  }
  openDiffActivity()
}

function selectRightActivity(activity: RightActivity): void {
  if (activity === "diff") {
    selectDiffActivity()
    return
  }
  const leftActivity = untrack(selectedLeftActivity)
  if (activity === "workflow" && focusedLeftActivityOwnsPrimaryPanel(leftActivity)) {
    resetCenterWorkbenchToFocusedPanel(leftActivity)
    return
  }
  if (untrack(centerWorkbenchPanels).includes(activity)) {
    closeCenterWorkbenchPanel(activity)
  } else {
    openCenterWorkbenchPanel(activity)
  }
}

function openRightActivity(activity: RightActivity): void {
  if (activity === "diff") {
    openDiffActivity()
    return
  }
  openCenterWorkbenchPanel(activity)
}

function openBrowserPreviewFromMessage(): boolean {
  const taskID = activeTaskID()
  if (!taskID) return false
  openRightActivity("browser")
  setBrowserPreviewLinkRefresh((value) => value + 1)
  return true
}

function selectLeftActivity(activity: LeftActivity): void {
  if (activity === "assistant") {
    activateCodingAssistantSessionList()
    return
  }
  abortCodingAssistantActivation()
  setAssistantLauncherActive(false)
  setMissionLauncherActive(false)
  if (boardStore.selectedSource?.kind === "session" && (activity !== "mission" || isCodingAssistantSource())) {
    void selectTask("")
  }
  if (focusedLeftActivityOwnsPrimaryPanel(activity)) {
    resetCenterWorkbenchToFocusedPanel(activity)
  } else {
    setPrimaryCenterPanel("task")
    openCenterWorkbenchPanel("workflow")
  }
  if (activity === "mission") setMissionActivityActivationToken((value) => value + 1)
  setSelectedLeftActivity(activity)
  setSelectedLeftPanelActivity(activity)
}

function isMissionSessionSource(): boolean {
  return boardStore.selectedSource?.kind === "session" && !isCodingAssistantSource()
}

function selectMissionTask(taskID: string, directory?: string): void {
  setMissionLauncherActive(false)
  setAssistantLauncherActive(false)
  resetCenterWorkbenchToFocusedPanel("tasks")
  setSelectedLeftActivity("tasks")
  setSelectedLeftPanelActivity("tasks")
  void selectTask(taskID, { directory })
}

function openTaskLauncher(): void {
  abortCodingAssistantActivation()
  setMissionLauncherActive(false)
  setAssistantLauncherActive(false)
  resetCenterWorkbenchToFocusedPanel("tasks")
  setSelectedLeftActivity("tasks")
  setSelectedLeftPanelActivity("tasks")
  void selectTask("")
  queueMicrotask(() => {
    document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")?.focus()
  })
}

function openMissionLauncher(): void {
  abortCodingAssistantActivation()
  setAssistantLauncherActive(false)
  resetCenterWorkbenchToFocusedPanel("mission")
  setSelectedLeftActivity("mission")
  setSelectedLeftPanelActivity("mission")
  setMissionLauncherActive(true)
  void selectTask("")
  queueMicrotask(() => {
    document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")?.focus()
  })
}

function openCodingAssistantLauncher(): void {
  abortCodingAssistantActivation()
  setMissionLauncherActive(false)
  setAssistantLauncherActive(true)
  bumpWorkspaceEpoch()
  resetCenterWorkbenchToFocusedPanel("assistant")
  setSelectedLeftActivity("assistant")
  setSelectedLeftPanelActivity("assistant")
  void selectTask("")
  queueMicrotask(() => {
    document.querySelector<HTMLTextAreaElement>("#solidChatComposer textarea")?.focus()
  })
}

async function openMissionSession(result: MissionWakeResult): Promise<void> {
  const source = { kind: "session" as const, id: result.sessionID }
  stopSSE()
  clearMessages()
  setChatAttachments([])
  resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })
  setBoardStore("selectedSource", source)
  setBoardStore("board", null)
  await loadConversation(source, {
    scrollIntent: "bottom",
    resetCause: "mission-session-hydrate",
    directory: activeDirectory(),
  })
  startSSE(source, 0, { directory: activeDirectory() })
  setMissionSharedRefreshToken((value) => value + 1)
}

function focusTaskPanel(): void {
  resetCenterWorkbenchToFocusedPanel("tasks")
}

function focusInitialRestoredTaskWorkspace(): void {
  if (!activeTaskID() || boardStore.selectedSource?.kind !== "task") return
  setMissionLauncherActive(false)
  setAssistantLauncherActive(false)
  resetCenterWorkbenchToFocusedPanel("tasks")
  setSelectedLeftActivity("tasks")
  setSelectedLeftPanelActivity("tasks")
}

function selectTaskFromTaskList(taskID: string): void {
  if (activeTaskID() !== taskID) focusTaskPanel()
  void selectTask(taskID)
}

function openCenterWorkbenchPanel(panel: CenterWorkbenchPanel): void {
  setCenterWorkbenchPanels((current) => (current.includes(panel) ? current : [...current, panel]))
  scheduleCenterWorkbenchPanelReveal(panel)
}

function closeCenterWorkbenchPanel(panel: CenterWorkbenchPanel): void {
  if (panel === "workflow" && focusedLeftActivityOwnsPrimaryPanel(untrack(selectedLeftActivity))) return
  if (panel === "diff") setWorkspaceOpen(false)
  if (panel === "file") closeFileEditor()
  setCenterWorkbenchPanels((current) => current.filter((item) => item !== panel))
}

function getCenterWorkbenchViews(): Record<CenterWorkbenchPanel, HTMLElement | null> {
  return {
    workflow: document.getElementById("centerWorkbenchWorkflow"),
    explorer: document.getElementById("centerWorkbenchExplorer"),
    diff: document.getElementById("centerWorkbenchDiff"),
    browser: document.getElementById("centerWorkbenchBrowser"),
    screenshots: document.getElementById("centerWorkbenchScreenshots"),
    inspector: document.getElementById("centerWorkbenchInspector"),
    notifications: document.getElementById("centerWorkbenchNotifications"),
    file: document.getElementById("centerWorkbenchFile"),
  }
}

function orderedCenterWorkbenchPanels(panels = centerWorkbenchPanels()): CenterWorkbenchPanel[] {
  const open = new Set(panels)
  return CENTER_WORKBENCH_PANEL_ORDER.filter((panel) => open.has(panel))
}

function selectedCenterWorkbenchPanel(panels = centerWorkbenchPanels()): CenterWorkbenchPanel | null {
  return panels[panels.length - 1] ?? null
}

function centerWorkbenchPanelWeight(panel: CenterWorkbenchPanel): number {
  const weight = Number(settingsStore.centerWorkbenchPanelWeights?.[panel])
  return Number.isFinite(weight) && weight > 0 ? weight : 1
}

function centerWorkbenchPanelWeightsSignature(): string {
  const weights = settingsStore.centerWorkbenchPanelWeights
  if (!weights) return ""
  return CENTER_WORKBENCH_PANEL_ORDER.map((panel) => {
    const weight = Number(weights[panel])
    return Number.isFinite(weight) && weight > 0 ? `${panel}:${weight}` : `${panel}:`
  }).join("|")
}

function renderCenterWorkbenchPanelWeights(): void {
  const panels = orderedCenterWorkbenchPanels()
  const views = getCenterWorkbenchViews()
  for (const panel of CENTER_WORKBENCH_PANEL_ORDER) {
    const body = views[panel]
    if (!body) continue
    if (panels.includes(panel)) {
      body.style.setProperty("--center-workbench-panel-grow", String(centerWorkbenchPanelWeight(panel)))
    } else {
      body.style.removeProperty("--center-workbench-panel-grow")
    }
  }
}

function isCenterWorkbenchPanel(value: string | undefined): value is CenterWorkbenchPanel {
  return CENTER_WORKBENCH_PANEL_ORDER.includes(value as CenterWorkbenchPanel)
}

function getCenterWorkbenchSeparators(): Partial<Record<CenterWorkbenchPanel, HTMLElement>> {
  const separators: Partial<Record<CenterWorkbenchPanel, HTMLElement>> = {}
  for (const separator of document.querySelectorAll<HTMLElement>("[data-center-workbench-separator]")) {
    const panel = separator.dataset.centerWorkbenchSeparator
    if (isCenterWorkbenchPanel(panel)) separators[panel] = separator
  }
  return separators
}

function centerWorkbenchRightPanel(
  leftPanel: CenterWorkbenchPanel,
  panels = orderedCenterWorkbenchPanels(untrack(centerWorkbenchPanels)),
): CenterWorkbenchPanel | null {
  const index = panels.indexOf(leftPanel)
  return index >= 0 ? (panels[index + 1] ?? null) : null
}

function centerWorkbenchPanelMinWidth(totalWidth: number): number {
  void totalWidth
  return layoutTokenPx("--ui-workbench-panel-min-width")
}

function centerWorkbenchPanelResizeMetrics(
  leftPanel: CenterWorkbenchPanel,
  panels = orderedCenterWorkbenchPanels(untrack(centerWorkbenchPanels)),
): CenterWorkbenchPanelResizeMetrics | null {
  const rightPanel = centerWorkbenchRightPanel(leftPanel, panels)
  if (!rightPanel) return null
  const views = getCenterWorkbenchViews()
  const leftBody = views[leftPanel]
  const rightBody = views[rightPanel]
  if (!leftBody || !rightBody) return null
  const leftRect = leftBody.getBoundingClientRect()
  const rightRect = rightBody.getBoundingClientRect()
  const totalWidth = leftRect.width + rightRect.width
  if (totalWidth <= 0) return null
  const minWidth = centerWorkbenchPanelMinWidth(totalWidth)
  if (!centerWorkbenchResizeRange(totalWidth, minWidth)) return null
  return {
    leftPanel,
    rightPanel,
    leftBody,
    rightBody,
    leftRect,
    rightRect,
    totalWidth,
    totalWeight: centerWorkbenchPanelWeight(leftPanel) + centerWorkbenchPanelWeight(rightPanel),
    minWidth,
  }
}

function centerWorkbenchShowsAdjacentPanels(): boolean {
  return !window.matchMedia("(max-width: 520px)").matches
}

function renderCenterWorkbenchPanelSeparators(): void {
  const panels = orderedCenterWorkbenchPanels()
  const views = getCenterWorkbenchViews()
  const separators = getCenterWorkbenchSeparators()
  const showsAdjacentPanels = centerWorkbenchShowsAdjacentPanels()
  for (const panel of CENTER_WORKBENCH_PANEL_ORDER) {
    const separator = separators[panel]
    if (!separator) continue
    const rightPanel = centerWorkbenchRightPanel(panel, panels)
    const metrics = rightPanel ? centerWorkbenchPanelResizeMetrics(panel, panels) : null
    const enabled = !!rightPanel && !!metrics && showsAdjacentPanels
    separator.hidden = !enabled
    separator.dataset.disabled = String(!enabled)
    separator.tabIndex = enabled ? 0 : -1
    if (!rightPanel || !metrics) {
      separator.removeAttribute("aria-controls")
      separator.removeAttribute("aria-valuemin")
      separator.removeAttribute("aria-valuemax")
      separator.removeAttribute("aria-valuenow")
      continue
    }
    const leftControlID = views[panel]?.id
    const rightControlID = views[rightPanel]?.id
    if (leftControlID && rightControlID) separator.setAttribute("aria-controls", `${leftControlID} ${rightControlID}`)
    else separator.removeAttribute("aria-controls")
    const min = Math.round(metrics.minWidth)
    const max = Math.round(metrics.totalWidth - metrics.minWidth)
    const now = Math.round(metrics.leftRect.width)
    separator.setAttribute("aria-valuemin", String(min))
    separator.setAttribute("aria-valuemax", String(max))
    separator.setAttribute("aria-valuenow", String(Math.min(Math.max(now, min), max)))
  }
}

function renderCenterWorkbenchPanelLayout(): void {
  renderCenterWorkbenchPanelWeights()
  renderCenterWorkbenchPanelMeasurementsOnFrame.schedule()
}

function renderCenterWorkbenchPanelMeasurementsAndReveal(): void {
  renderCenterWorkbenchPanelSeparators()
  revealPendingCenterWorkbenchPanel()
}

const renderCenterWorkbenchPanelMeasurementsOnFrame = createAnimationFrameScheduler(
  renderCenterWorkbenchPanelMeasurementsAndReveal,
)
const renderCenterWorkbenchPanelLayoutOnFrame = createAnimationFrameScheduler(renderCenterWorkbenchPanelLayout)
disposers.push(() => {
  renderCenterWorkbenchPanelLayoutOnFrame.cancel()
  renderCenterWorkbenchPanelMeasurementsOnFrame.cancel()
  pendingCenterWorkbenchRevealPanel = null
})

function scheduleCenterWorkbenchPanelReveal(panel: CenterWorkbenchPanel): void {
  pendingCenterWorkbenchRevealPanel = panel
  renderCenterWorkbenchPanelLayoutOnFrame.schedule()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Open the workspace panel. */
function openWorkspace(): void {
  setWorkspaceOpen(true)
  setFileChangesActiveView("diff")
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
      const src =
        imageTrigger.getAttribute("data-image-preview-src") ||
        imageTrigger.querySelector("img")?.getAttribute("src") ||
        ""
      const alt =
        imageTrigger.getAttribute("data-image-preview-alt") ||
        imageTrigger.querySelector("img")?.getAttribute("alt") ||
        ""
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
    const previewUrl = anchor.getAttribute("data-browser-preview-url") || ""
    const href = previewUrl || anchor.getAttribute("href") || ""
    if (!/^https?:\/\//i.test(href)) return
    const canOpenExternalUrl = getHostTransport().capabilities.nativeCommands["open-url"]
    if (!previewUrl && !canOpenExternalUrl) return
    ev.preventDefault()
    void (async () => {
      try {
        if (previewUrl && openBrowserPreviewFromMessage()) return
        if (!canOpenExternalUrl) return
        await nativeOpen(href)
      } catch (error) {
        console.error("[ui] Failed to open external link", error)
        notifyError({
          id: "browser-preview:open-url",
          title: t("browser_preview.title"),
          message: error instanceof Error ? error.message : String(error),
          details: formatErrorDetails(error),
        })
      }
    })()
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
        btn.setAttribute("aria-label", prev || t("markdown.copy_code"))
        btn.title = prev || t("markdown.copy_code")
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
        flash(t("markdown.copied"))
      } catch (err) {
        console.error("[md-copy] clipboard write failed", err)
        flash(t("markdown.copy_failed"))
      }
    })()
  },
  listenerOpts,
)

window.addEventListener(
  "acceptance:focus-changes",
  () => {
    setFileChangesActiveView("changes")
    openCenterWorkbenchPanel("diff")
  },
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
}

installGlobalBridges()

// Components call strict `t()` at render time. Load the locale bundles before
// mounting any Solid surface so early hosts do not render against an empty
// translation dictionary.
await loadAllLocales()
await setLocale(localeTag())

function ensureOverlayAppHost(): void {
  if (document.getElementById("overlayAppHost")) return
  const host = document.createElement("div")
  host.id = "overlayAppHost"
  document.body.appendChild(host)
  const dispose = render(() => <App />, host)
  disposers.push(() => {
    dispose()
    host.remove()
  })
}

ensureOverlayAppHost()

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

// ── Mount: Conversation ──

const chatScroll = document.getElementById("chatScroll")
if (chatScroll) {
  chatScroll.innerHTML = ""
  render(() => <Conversation container={chatScroll} />, chatScroll)
}

const fileChangesMountEl = document.getElementById("solidFileChangesMount")
if (fileChangesMountEl) {
  fileChangesMountEl.innerHTML = ""
  render(
    () => (
      <FileChangesPanel
        diffOpen={workspaceOpen()}
        diffTarget={workspaceTarget()}
        active={() => isCenterWorkbenchPanelOpen("file") || isCenterWorkbenchPanelOpen("diff")}
        activeView={fileChangesActiveView()}
        onActiveViewChange={setFileChangesActiveView}
        onCloseDiff={closeWorkspace}
      />
    ),
    fileChangesMountEl,
  )
}

const fileExplorerMountEl = document.getElementById("solidFileExplorerMount")
if (fileExplorerMountEl) {
  fileExplorerMountEl.innerHTML = ""
  render(
    () => <FileExplorerPanel active={() => isCenterWorkbenchPanelOpen("explorer")} directory={activeDirectory} />,
    fileExplorerMountEl,
  )
}

const screenshotBrowserMountEl = document.getElementById("solidScreenshotBrowserMount")
if (screenshotBrowserMountEl) {
  screenshotBrowserMountEl.innerHTML = ""
  render(
    () => <ScreenshotBrowserPanel active={() => isCenterWorkbenchPanelOpen("screenshots")} />,
    screenshotBrowserMountEl,
  )
}

// ── Sidebar title backdoor: double-click resets DB ──
// Hidden operator escape hatch. Confirms before invoking POST /global/db/reset,
// then reloads to repopulate from a clean schema.
const sidebarTitleEl = document.querySelector<HTMLElement>(".sidebar-title")
if (sidebarTitleEl) {
  sidebarTitleEl.addEventListener("dblclick", async (ev) => {
    ev.preventDefault()
    const databasePath = appStore.enginePaths?.database?.trim()
    const projectDir = activeDirectory().trim()
    if (!databasePath || !projectDir) {
      notifyError({
        id: "system:reset-db",
        title: t("sidebar.reset_db_failed_title"),
        message: t("sidebar.reset_db_missing_context"),
      })
      return
    }
    if (!window.confirm(t("sidebar.reset_db_confirm", { database: databasePath, projectDir }))) return
    try {
      await resetDatabase(projectDir)
      window.location.reload()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        notifyWarning({
          id: "system:reset-db",
          title: t("sidebar.reset_db_blocked_title"),
          message: t("sidebar.reset_db_blocked"),
        })
        return
      }
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

const LEFT_ACTIVITY_BODY_IDS: Record<LeftActivity, string> = {
  tasks: "leftPanelTasks",
  mission: "leftPanelMissions",
  assistant: "leftPanelAssistant",
  memory: "leftPanelMemory",
  skill: "leftPanelSkills",
  mcp: "leftPanelMcp",
}

disposers.push(
  createRoot((dispose) => {
    createEffect(() => {
      const activity = selectedLeftPanelActivity()
      const activityDefinition = leftActivityDefinition(activity)
      const titleKey = activityDefinition.labelKey
      const titleText = t(titleKey)
      for (const [id, elementID] of Object.entries(LEFT_ACTIVITY_BODY_IDS) as Array<[LeftActivity, string]>) {
        const element = document.getElementById(elementID)
        if (element) element.dataset.active = id === activity ? "true" : "false"
      }
      const title = document.getElementById("leftPanelTitle")
      if (title) title.textContent = titleText
      const taskActions = document.getElementById("leftPanelTaskActions")
      if (taskActions) {
        const hasCreateAction = activity === "tasks" || activity === "mission" || activity === "assistant"
        taskActions.dataset.active = hasCreateAction ? "true" : "false"
        taskActions.dataset.activityActions = activity
        taskActions.dataset.i18nAriaLabel = titleKey
        taskActions.setAttribute("aria-label", titleText)
        for (const button of taskActions.querySelectorAll<HTMLElement>("[data-left-action]")) {
          button.hidden = button.dataset.leftAction !== activity
        }
      }
    })
    return dispose
  }),
)

const taskListEl = document.getElementById("taskListPanel")
if (taskListEl) {
  taskListEl.innerHTML = ""
  render(
    () => (
      <TaskList
        onSelectTask={selectTaskFromTaskList}
        onDeleteTask={(taskID) => void deleteTask(taskID)}
        onCancelTask={(taskID) => void cancelTask(taskID)}
        onRenameTask={(taskID, title) => void renameTask(taskID, title)}
      />
    ),
    taskListEl,
  )
}

const codingAssistantListEl = document.getElementById("codingAssistantSessionListPanel")
if (codingAssistantListEl) {
  codingAssistantListEl.innerHTML = ""
  render(
    () => (
      <CodingAssistantSessionList
        sessions={codingAssistantStore.sessions}
        selectedSessionID={codingAssistantStore.selectedSessionID}
        loading={codingAssistantStore.loading}
        loadingMore={codingAssistantStore.loadingMore}
        error={codingAssistantStore.error}
        searchQuery={codingAssistantStore.searchQuery}
        hasMore={!!codingAssistantStore.nextCursor}
        actionBusyID={codingAssistantStore.actionBusyID}
        onSearchChange={(query) => {
          setCodingAssistantSearchQuery(query)
          void loadCodingAssistantSessions().catch((error) => {
            reportOverlayRuntimeError("coding-assistant.search", error)
          })
        }}
        onSelectSession={(session) => {
          setAssistantLauncherActive(false)
          resetCenterWorkbenchToFocusedPanel("assistant")
          void selectCodingAssistantSession({ sessionID: session.id, directory: String(session.directory || "") }).catch((error) => {
            reportOverlayRuntimeError("coding-assistant.select", error)
          })
        }}
        onRenameSession={(session, title) =>
          void renameCodingAssistantSession({ sessionID: session.id, directory: String(session.directory || "") }, title)
            .then((ok) => {
              if (!ok) throw new Error("Coding assistant rename failed")
            })
            .catch((error) => {
              reportOverlayRuntimeError("coding-assistant.rename", error)
            })
        }
        onDeleteSession={(session) =>
          void deleteCodingAssistantSession({ sessionID: session.id, directory: String(session.directory || "") })
            .then((ok) => {
              if (!ok) throw new Error("Coding assistant delete failed")
            })
            .catch((error) => {
              reportOverlayRuntimeError("coding-assistant.delete", error)
            })
        }
        onStopSession={(session) =>
          void stopCodingAssistantSession({ sessionID: session.id, directory: String(session.directory || "") })
            .then((ok) => {
              if (!ok) throw new Error("Coding assistant stop failed")
            })
            .catch((error) => {
              reportOverlayRuntimeError("coding-assistant.stop", error)
            })
        }
        onRetry={() =>
          void loadCodingAssistantSessions().catch((error) => {
            reportOverlayRuntimeError("coding-assistant.retry", error)
          })
        }
        onLoadMore={() =>
          void loadCodingAssistantSessions({ append: true }).catch((error) => {
            reportOverlayRuntimeError("coding-assistant.more", error)
          })
        }
      />
    ),
    codingAssistantListEl,
  )
}

const missionListEl = document.getElementById("missionListPanel")
if (missionListEl) {
  missionListEl.innerHTML = ""
  render(
    () => (
      <Mission
        active={selectedLeftPanelActivity() === "mission"}
        activationToken={missionActivityActivationToken()}
        refreshToken={missionSharedRefreshToken()}
        onSelectTask={selectMissionTask}
      />
    ),
    missionListEl,
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
const [promptProfiles, setPromptProfiles] = createSignal<PromptProfileOption[]>([])
const [activePromptProfile, setActivePromptProfile] = createSignal("frontend")
// Track the previous task-busy state so we only fire once per finish edge.
let lastTaskBusy = false
let lastSuggestionTaskID: string | null = null
let promptProfileLoadSequence = 0
let promptProfileInFlightRequestKey = ""
let promptProfileLoadedRequestKey = ""
const promptProfileRequestKey = createMemo(() => promptProfileCatalogRequestKey())

async function refreshPromptProfiles(scope: PromptProfileCatalogScope, requestKey: string): Promise<void> {
  if (requestKey === promptProfileInFlightRequestKey || requestKey === promptProfileLoadedRequestKey) return
  const sequence = ++promptProfileLoadSequence
  promptProfileInFlightRequestKey = requestKey
  try {
    const catalog = await loadPromptProfileCatalog(scope)
    if (sequence !== promptProfileLoadSequence) return
    setPromptProfiles(catalog.profiles)
    setActivePromptProfile((current) =>
      catalog.profiles.some((profile) => profile.id === current) ? current : catalog.active,
    )
    promptProfileLoadedRequestKey = requestKey
  } finally {
    if (promptProfileInFlightRequestKey === requestKey) promptProfileInFlightRequestKey = ""
  }
}

createEffect(() => {
  const selectedTaskSessionID = rootTaskSessionID()
  const selectedSessionID = activeSessionID()
  const configuredActive = appStore.config?.prompt_profile?.active
  if (!selectedTaskSessionID && !selectedSessionID && typeof configuredActive === "string" && configuredActive.trim()) {
    setActivePromptProfile(configuredActive)
  }
})

createEffect<string>((previousKey) => {
  const requestKey = promptProfileRequestKey()
  if (requestKey === previousKey) return previousKey
  const scope = promptProfileCatalogScope()
  if (scope.kind === "pending") {
    promptProfileLoadSequence++
    promptProfileInFlightRequestKey = ""
    promptProfileLoadedRequestKey = ""
    setPromptProfiles([])
    return requestKey
  }
  if (scope.kind === "unavailable") return requestKey
  void refreshPromptProfiles(scope, requestKey).catch((error) => reportOverlayRuntimeError("prompt-profile", error))
  return requestKey
}, "")

const panelComposerDraftKey = () => {
  if (missionSubmitActive()) {
    const directory = activeDirectory()
    return directory ? composerDraftKey("mission", "new", directory) : composerDraftKey("mission", "new")
  }
  if (missionLedgerActive()) {
    const directory = activeDirectory()
    return directory ? composerDraftKey("mission", "ledger", directory) : composerDraftKey("mission", "ledger")
  }
  if (assistantSubmitActive()) {
    const directory = activeDirectory()
    return directory ? composerDraftKey("assistant", "new", directory) : composerDraftKey("assistant", "new")
  }
  const taskID = activeTaskID()
  if (taskID) return composerDraftKey("task", taskID)
  const sessionID = activeSessionID()
  if (sessionID) return composerDraftKey("session", sessionID)
  const directory = activeDirectory()
  return directory ? composerDraftKey("task", "new", directory) : composerDraftKey("task", "new")
}

function missionSubmitActive(): boolean {
  return missionLauncherActive()
}

function missionLedgerActive(): boolean {
  return primaryCenterPanel() === "mission" && !missionSubmitActive() && !isMissionSessionSource()
}

function assistantSubmitActive(): boolean {
  return assistantLauncherActive() || (primaryCenterPanel() === "chat" && !activeSessionID())
}

const composerEl = document.getElementById("solidChatComposer")
if (composerEl) {
  render(
    () => (
      <ChatComposer
        enabled={
          canComposeChat() && !missionLedgerActive() && !missionLauncherSubmitting() && !assistantLauncherSubmitting()
        }
        // Composer busy ≡ a send request is in flight (SSE stream open).
        // A running task no longer disables the composer: the user can queue
        // additional messages; `panelMessage` routes them as operator notes /
        // inject via `task/:id/message`. Task cancellation lives on the task
        // row's CancelButton, not in the composer.
        busy={!!messageStore.chatRequest}
        stopping={!!(messageStore.chatRequest as any)?.stopping}
        draftKey={panelComposerDraftKey()}
        placeholder={
          missionSubmitActive()
            ? t("mission.launcher.placeholder")
            : assistantSubmitActive()
              ? t("coding_assistant.launcher.placeholder")
              : undefined
        }
        textareaDataUI={
          missionSubmitActive()
            ? "mission-composer-input"
            : assistantSubmitActive()
              ? "coding-assistant-composer-input"
              : undefined
        }
        sendDataUI={
          missionSubmitActive()
            ? "mission-composer-submit"
            : assistantSubmitActive()
              ? "coding-assistant-composer-submit"
              : undefined
        }
        pendingSuggestion={pendingSuggestion()}
        onSuggestionConsumed={() => setPendingSuggestion("")}
        promptProfiles={promptProfiles()}
        promptProfileID={activePromptProfile()}
        onPromptProfileChange={setActivePromptProfile}
        onSubmit={async (text, attachments, webSearch, promptProfile) => {
          const metadata = {
            ...(webSearch ? { web_search: true } : {}),
            promptProfile,
          }
          if (missionSubmitActive()) {
            if (attachments.length > 0) {
              throw new Error(t("mission.launcher.attachments_unsupported"))
            }
            setMissionLauncherSubmitting(true)
            try {
              const model = typeof appStore.config?.model === "string" ? appStore.config.model : undefined
              const result = await wakeMission({ text, model, promptProfile })
              await openMissionSession(result)
              setMissionLauncherActive(false)
              return result
            } finally {
              setMissionLauncherSubmitting(false)
            }
          }
          if (assistantSubmitActive()) {
            setAssistantLauncherSubmitting(true)
            try {
              await createCodingAssistantSession({ directory: activeDirectory() })
              setAssistantLauncherActive(false)
              return await panelMessage(text, attachments, metadata)
            } finally {
              setAssistantLauncherSubmitting(false)
            }
          }
          const refreshMissionLedger = isMissionSessionSource()
          const result = await panelMessage(text, attachments, metadata)
          if (refreshMissionLedger) setMissionSharedRefreshToken((value) => value + 1)
          return result
        }}
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

const rightActivityToolbarEl = document.getElementById("solidRightActivityToolbar")
if (rightActivityToolbarEl) {
  render(
    () => (
      <SideActivityToolbar
        side="right"
        activities={RIGHT_ACTIVITIES}
        active={activeRightActivity}
        isActive={isRightActivityOpen}
        activeSemantics="pressed-toggle"
        ariaLabelKey="activity.right"
        onSelect={selectRightActivity}
      />
    ),
    rightActivityToolbarEl,
  )
}

const leftActivityToolbarEl = document.getElementById("solidLeftActivityToolbar")
if (leftActivityToolbarEl) {
  render(
    () => (
      <SideActivityToolbar
        side="left"
        activities={LEFT_ACTIVITIES}
        active={activeLeftActivity}
        isActive={isLeftActivityOpen}
        activeSemantics="current-page"
        ariaLabelKey="activity.left"
        onSelect={selectLeftActivity}
      />
    ),
    leftActivityToolbarEl,
  )
}

const leftSkillsPanelEl = document.getElementById("solidLeftSkillsPanel")
if (leftSkillsPanelEl) {
  render(() => <SkillsPanel active={selectedLeftPanelActivity() === "skill"} compact />, leftSkillsPanelEl)
}

const leftMcpPanelEl = document.getElementById("solidLeftMcpPanel")
if (leftMcpPanelEl) {
  render(() => <McpPanel active={selectedLeftPanelActivity() === "mcp"} compact />, leftMcpPanelEl)
}

const leftMemoryPanelEl = document.getElementById("solidLeftMemoryPanel")
if (leftMemoryPanelEl) {
  render(
    () => (
      <MemoryPanel
        active={selectedLeftPanelActivity() === "memory"}
        taskID={() => activeTaskID() || undefined}
        directory={activeDirectory}
        compact
      />
    ),
    leftMemoryPanelEl,
  )
}

const browserPreviewEl = document.getElementById("solidBrowserPreviewMount")
if (browserPreviewEl) {
  render(
    () => (
      <BrowserPreviewPanel
        active={() => isCenterWorkbenchPanelOpen("browser")}
        directory={activeDirectory}
        refreshKey={() => `${boardStore.boardUpdatedAt}:${browserPreviewLinkRefresh()}`}
        taskID={() => activeTaskID() || undefined}
        onReady={() => openRightActivity("browser")}
      />
    ),
    browserPreviewEl,
  )
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
      void apiJson(taskScopedPath(taskID, taskOwningDirectory(taskID), "/followup"), {
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

// ── Mount: LogViewer dialog host ──

const logViewerEl = document.getElementById("solidLogViewer")
if (logViewerEl) {
  render(() => <LogViewer open={logOpen()} onClose={() => setLogOpen(false)} />, logViewerEl)
}

function onDocumentReady(callback: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true })
    return
  }
  callback()
}

function bindSidebarStaticControls(): void {
  // ── Sidebar buttons ──
  document.getElementById("btnCreateTask")?.addEventListener("click", () => {
    openTaskLauncher()
  })
  document.getElementById("btnCreateMission")?.addEventListener("click", () => {
    openMissionLauncher()
  })
  document.getElementById("btnCreateCodingAssistantSession")?.addEventListener("click", () => {
    openCodingAssistantLauncher()
  })

  // Executor selection moved to <ExecutorSelector/> mounted inside ChatComposer
  // (chat-compose-meta-left). The component owns its own dropdown, click-out
  // dismissal and Escape handling — Solid lifecycle disposes both on unmount.
}

onDocumentReady(bindSidebarStaticControls)

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

    // Chat header usage strip — card-tree-stats maintains the aggregate so
    // this always-mounted UI glue does not scan the full card dictionary on
    // every SSE update. An empty string hides the chip via the
    // `.chat-usage:empty { display: none }` rule.
    createEffect(() => {
      const target = document.getElementById("chatUsage")
      if (!target) return
      target.textContent = formatUsageStrip(cardTreeStore.usageAggregate)
    })

    // ── Debug-copy (double-click `任务` header) ──
    // Dumps a concise plain-text debug blob for the selected workflow task or
    // standalone chat session. Reads the live board/card projections, so the
    // copy action does not issue a second fetch.
    //
    // Triggered by a double-click on the Conversation tab. Single
    // click remains free for future use. The same button flashes a "已复制"
    // hint via a transient `data-copied` attribute.
    {
      const title = document.querySelector("#chatViewTitle") as HTMLElement | null
      if (title) {
        title.style.cursor = "copy"
        title.title = "双击复制调试信息 (task/chat id / directory / session / run)"
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
          const selectedSource = boardStore.selectedSource
          const blob =
            selectedSource?.kind === "session"
              ? buildChatDebugBlob(boardStore.board, selectedSource, cardTreeStore)
              : buildTaskDebugBlob(boardStore.board)
          if (!blob) {
            flash(selectedSource?.kind === "session" ? "无会话" : "无任务")
            return
          }
          try {
            await writeDebugClipboard(blob)
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
      missionLauncherActive()
      assistantLauncherActive()
      primaryCenterPanel()
      const title = document.querySelector("#chatViewTitle") as HTMLElement | null
      if (title) {
        title.textContent = missionSubmitActive()
          ? t("mission.launcher.title")
          : assistantSubmitActive()
            ? t("coding_assistant.launcher.title")
            : primaryCenterPanel() === "mission"
              ? t("mission.title")
              : primaryCenterPanel() === "chat" || isCodingAssistantSource()
                ? t("chat.panel_title")
                : t("task.panel_title")
      }
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
      const selectedPanel = selectedCenterWorkbenchPanel(panels)
      const workbench = document.getElementById("centerWorkbench")
      const views = getCenterWorkbenchViews()
      if (views.workflow) views.workflow.dataset.workbenchView = primaryCenterPanel()
      if (workbench) {
        workbench.dataset.open = String(panels.length > 0)
        workbench.hidden = panels.length === 0
      }
      for (const [panel, body] of Object.entries(views)) {
        const open = panels.includes(panel as CenterWorkbenchPanel)
        if (body) {
          body.dataset.open = String(open)
          body.dataset.active = String(open)
          body.dataset.selected = String(open && panel === selectedPanel)
        }
      }
      renderCenterWorkbenchPanelLayoutOnFrame.schedule()
    })

    createEffect(() => {
      centerWorkbenchPanelWeightsSignature()
      renderCenterWorkbenchPanelLayoutOnFrame.schedule()
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
      document.body.dataset.notificationsPanelOpen = String(panels.includes("notifications"))
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
      const sidebarCollapsed = false

      const sidebar = document.getElementById("sidebar")
      const sections = document.getElementById("sections")

      if (sidebar) {
        sidebar.dataset.collapsed = String(sidebarCollapsed)
        sidebar.hidden = false
      }
      if (sections) {
        sections.dataset.collapsed = "false"
        sections.hidden = false
      }

      schedulePaneLayout(
        {
          sidebarCollapsed,
          sidebarWidth: settingsStore.sidebarWidth,
        }
      )
    })

    // Task status header + elapsed timer moved to <TaskStatusHeader/> component
    // (owned by <App/> and portaled into #solidTaskStatusMount). The component owns its own
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
    sidebarCollapsed: false,
    sidebarWidth: settingsStore.sidebarWidth,
  }),
  onWidthsChanged: (sidebarWidth: number | null) => {
    setSettingsStore({
      ...(sidebarWidth != null ? { sidebarWidth } : {}),
    })
    saveSettings()
  },
}
initPaneResizers(paneCallbacks, PANEL_PANE_CONFIG)

interface CenterWorkbenchPanelResizeMetrics {
  leftPanel: CenterWorkbenchPanel
  rightPanel: CenterWorkbenchPanel
  leftBody: HTMLElement
  rightBody: HTMLElement
  leftRect: DOMRect
  rightRect: DOMRect
  totalWidth: number
  totalWeight: number
  minWidth: number
}

interface CenterWorkbenchPanelResize {
  leftPanel: CenterWorkbenchPanel
  rightPanel: CenterWorkbenchPanel
  leftRect: DOMRect
  totalWidth: number
  totalWeight: number
  minWidth: number
}

let centerWorkbenchPanelResize: CenterWorkbenchPanelResize | null = null
let pendingCenterWorkbenchPanelResizeClientX: number | null = null

function startCenterWorkbenchPanelResize(event: PointerEvent, leftPanel: CenterWorkbenchPanel): void {
  const metrics = centerWorkbenchPanelResizeMetrics(leftPanel)
  if (!metrics) return
  centerWorkbenchPanelResize = {
    leftPanel: metrics.leftPanel,
    rightPanel: metrics.rightPanel,
    leftRect: metrics.leftRect,
    totalWidth: metrics.totalWidth,
    totalWeight: metrics.totalWeight,
    minWidth: metrics.minWidth,
  }
  document.body.dataset.centerWorkbenchPanelResizing = "true"
  event.preventDefault()
}

function applyPendingCenterWorkbenchPanelResize(): void {
  const drag = centerWorkbenchPanelResize
  const clientX = pendingCenterWorkbenchPanelResizeClientX
  pendingCenterWorkbenchPanelResizeClientX = null
  if (!drag || clientX == null) return
  updateCenterWorkbenchPanelWeights(drag, clientX - drag.leftRect.left)
}

const applyCenterWorkbenchPanelResizeOnFrame = createAnimationFrameScheduler(applyPendingCenterWorkbenchPanelResize)
disposers.push(() => {
  applyCenterWorkbenchPanelResizeOnFrame.cancel()
  pendingCenterWorkbenchPanelResizeClientX = null
})

function updateCenterWorkbenchPanelWeights(
  metrics: Pick<CenterWorkbenchPanelResize, "leftPanel" | "rightPanel" | "totalWidth" | "totalWeight" | "minWidth">,
  rawLeftWidth: number,
): void {
  const leftWidth = clampCenterWorkbenchResizeWidth(metrics.totalWidth, metrics.minWidth, rawLeftWidth)
  if (leftWidth === null) return
  const leftWeight = metrics.totalWeight * (leftWidth / metrics.totalWidth)
  const rightWeight = metrics.totalWeight - leftWeight
  setSettingsStore("centerWorkbenchPanelWeights", {
    ...(settingsStore.centerWorkbenchPanelWeights ?? {}),
    [metrics.leftPanel]: leftWeight,
    [metrics.rightPanel]: rightWeight,
  })
}

function updateCenterWorkbenchPanelResize(event: PointerEvent): void {
  if (!centerWorkbenchPanelResize) return
  pendingCenterWorkbenchPanelResizeClientX = event.clientX
  applyCenterWorkbenchPanelResizeOnFrame.schedule()
}

function resizeCenterWorkbenchPanelByKeyboard(event: KeyboardEvent, leftPanel: CenterWorkbenchPanel): void {
  const metrics = centerWorkbenchPanelResizeMetrics(leftPanel)
  if (!metrics) return
  const step = 24 * currentUIScale()
  let leftWidth = metrics.leftRect.width
  if (event.key === "ArrowLeft") {
    leftWidth -= step
  } else if (event.key === "ArrowRight") {
    leftWidth += step
  } else if (event.key === "Home") {
    leftWidth = metrics.minWidth
  } else if (event.key === "End") {
    leftWidth = metrics.totalWidth - metrics.minWidth
  } else {
    return
  }
  event.preventDefault()
  updateCenterWorkbenchPanelWeights(metrics, leftWidth)
  saveSettings()
}

function stopCenterWorkbenchPanelResize(): void {
  if (!centerWorkbenchPanelResize) return
  applyCenterWorkbenchPanelResizeOnFrame.cancel()
  applyPendingCenterWorkbenchPanelResize()
  centerWorkbenchPanelResize = null
  delete document.body.dataset.centerWorkbenchPanelResizing
  saveSettings()
}

for (const separator of document.querySelectorAll<HTMLElement>("[data-center-workbench-separator]")) {
  separator.addEventListener(
    "pointerdown",
    (event) => {
      const panel = separator.dataset.centerWorkbenchSeparator
      if (!isCenterWorkbenchPanel(panel) || separator.dataset.disabled === "true") return
      if (event.button != null && event.button !== 0) return
      startCenterWorkbenchPanelResize(event, panel)
    },
    listenerOpts,
  )
  separator.addEventListener(
    "keydown",
    (event) => {
      const panel = separator.dataset.centerWorkbenchSeparator
      if (!isCenterWorkbenchPanel(panel) || separator.dataset.disabled === "true") return
      resizeCenterWorkbenchPanelByKeyboard(event, panel)
    },
    listenerOpts,
  )
}
window.addEventListener(
  "pointermove",
  (event) => {
    updateCenterWorkbenchPanelResize(event)
  },
  listenerOpts,
)
window.addEventListener("pointerup", stopCenterWorkbenchPanelResize, listenerOpts)
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
function applyWindowResize(): void {
  applyZoom(settingsStore.zoom)
  schedulePaneLayout(paneCallbacks.getState())
  renderCenterWorkbenchPanelLayoutOnFrame.schedule()
}

const applyWindowResizeOnFrame = createAnimationFrameScheduler(applyWindowResize)
disposers.push(() => applyWindowResizeOnFrame.cancel())
window.addEventListener("resize", applyWindowResizeOnFrame.schedule, listenerOpts)
if (window.visualViewport) window.visualViewport.addEventListener("resize", applyWindowResizeOnFrame.schedule, listenerOpts)
window.addEventListener(
  "blur",
  () => {
    void cancelPaneResize(paneCallbacks)
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
  function ensureConfigHost(): void {
    ensureOverlayAppHost()
  }
  function ensureGoalHost(): void {
    ensureOverlayAppHost()
  }
  ;(window as any).__OC_DEV__ = { openConfigDialog, ensureConfigHost, openGoalDialog, ensureGoalHost }
}

// ── Init ──

;(window as any).__overlayInitSettled = false
void (async () => {
  try {
    ensureOverlayAppHost()
    await initApp({
      onSettingsLoaded: () => {
        setSettingsHydrated(true)
      },
      onConnected: focusInitialRestoredTaskWorkspace,
    })
    renderAboutVersion()
  } catch (error) {
    reportOverlayRuntimeError("initApp", error)
  } finally {
    await waitForLogDrain()
    ;(window as any).__overlayInitSettled = true
  }
})()
