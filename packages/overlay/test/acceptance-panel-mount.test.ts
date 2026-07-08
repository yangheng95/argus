import { expect, test } from "bun:test"
import { readdirSync, statSync, readFileSync } from "node:fs"
import path from "node:path"

const overlayRoot = path.resolve(import.meta.dir, "..")

async function readSrc(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text()
}

async function readJson(rel: string): Promise<Record<string, unknown>> {
  const raw = await Bun.file(path.join(overlayRoot, rel)).text()
  return JSON.parse(raw) as Record<string, unknown>
}

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// Synchronous concatenation of all surface + cascade + primitive CSS.
// Tests that assert structural CSS properties use this instead of the
// deleted monolith src/styles.css.
function readAllSurfaceCss(): string {
  const root = path.join(overlayRoot, "src", "styles")
  return walkCss(root)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
}

// Regression for "no acceptance card visible during bench":
// commit beb81a2af (Scope acceptance rejections and evidence cards) defined and
// exported `AcceptancePanel` in components/Board.tsx, but the component was
// never imported or rendered anywhere — so even though the bench server kept
// emitting `acceptance.ready` / `acceptance.evidence.updated` and the board
// hydrated `candidateAcceptance.evidenceManifest`, the overlay UI rendered no
// acceptance card at all. This suite locks both the structural wiring and the
// redesigned panel's verdict-driven behavior in place.

test("index.html declares the unified Work Ledger left panel and task-scope workbench activities", async () => {
  const html = await readSrc("src/index.html")
  expect(html).toContain('id="solidConversationAgentRailMount"')
  expect(html).toContain('id="chatContentFrame"')
  expect(html).toContain('id="chatMessagePane"')
  expect(html).toContain('id="centerWorkbench"')
  expect(html).not.toContain('id="solidCenterWorkbenchTabs"')
  expect(html).not.toContain('id="centerWorkbenchResizer"')
  expect(html).toContain('id="leftPaneResizer"')
  expect(html).toContain('aria-label="Resize left panel"')
  expect(html).toContain('aria-controls="sidebar workspaceMain"')
  expect(html).toContain('tabindex="0"')
  expect(html).toContain('id="centerWorkbenchWorkflow"')
  expect(html).toContain('id="centerWorkbenchSeparatorWorkflow"')
  expect(html).toContain('data-center-workbench-separator="workflow"')
  expect(html).toContain('role="separator" aria-orientation="vertical"')
  expect(html).not.toContain('id="centerWorkbenchInspector"')
  expect(html).not.toContain('id="centerWorkbenchSeparatorInspector"')
  expect(html).toContain('id="centerWorkbenchRequirements"')
  expect(html).toContain('id="centerWorkbenchSeparatorRequirements"')
  expect(html).toContain('id="solidRequirementsPanelMount"')
  expect(html).toContain('id="centerWorkbenchArchitect"')
  expect(html).toContain('id="centerWorkbenchSeparatorArchitect"')
  expect(html).toContain('id="solidArchitectPanelMount"')
  expect(html).toContain('id="centerWorkbenchGoals"')
  expect(html).toContain('id="centerWorkbenchSeparatorGoals"')
  expect(html).toContain('id="solidGoalsPanelMount"')
  expect(html).toContain('id="centerWorkbenchNotifications"')
  expect(html).toContain('id="centerWorkbenchSeparatorNotifications"')
  expect(html).toContain('id="centerWorkbenchExplorer"')
  expect(html).toContain('id="centerWorkbenchSeparatorExplorer"')
  expect(html).toContain('id="centerWorkbenchDiff"')
  expect(html).toContain('id="centerWorkbenchSeparatorDiff"')
  expect(html).toContain('id="centerWorkbenchBrowser"')
  expect(html).toContain('id="centerWorkbenchSeparatorBrowser"')
  expect(html).toContain('id="centerWorkbenchScreenshots"')
  expect(html).toContain('id="centerWorkbenchSeparatorScreenshots"')
  expect(html).not.toContain('id="centerWorkbenchAssistant"')
  expect(html).not.toContain('id="solidCodingAssistantMount"')
  expect(html).toContain('id="centerWorkbenchFile"')
  expect(html).toContain('id="solidFileEditorMount"')
  expect(html).not.toContain('id="solidFileEditorToggleMount"')
  expect(html).not.toContain('id="rightPanelWorkflow"')
  expect(html).not.toContain('id="solidAgentWorkflowMount"')
  expect(html).not.toContain('id="solidLeftActivityToolbar"')
  expect(html).not.toContain('id="solidLeftPanelCollapseControl"')
  expect(html).not.toContain('id="solidLeftCollapsedRailControl"')
  expect(html).not.toContain('class="sidebar-collapsed-rail"')
  expect(html).toContain('id="solidRightActivityToolbar"')
  expect(html).toContain('id="chatViewTitle"')
  expect(html).toContain('id="leftPanelWork"')
  expect(html).toContain('id="workLedgerPanel"')
  expect(html).toContain('data-i18n="work_ledger.title"')
  expect(html).toContain('id="solidLeftPanelActions"')
  expect(html).not.toContain('id="leftPanelTasks"')
  expect(html).not.toContain('id="leftPanelMissions"')
  expect(html).not.toContain('id="leftPanelAssistant"')
  expect(html).not.toContain('id="codingAssistantSessionListPanel"')
  expect(html).not.toContain('id="leftPanelExtensions"')
  expect(html).not.toContain('id="leftPanelSkills"')
  expect(html).not.toContain('id="leftPanelMcp"')
  expect(html).not.toContain('id="leftPanelTools"')
  expect(html).not.toContain('id="leftPanelMemory"')
  expect(html).not.toContain('id="solidLeftExtensionsPanel"')
  expect(html).not.toContain('id="solidLeftSkillsPanel"')
  expect(html).not.toContain('id="solidLeftMcpPanel"')
  expect(html).not.toContain('id="solidLeftToolsPanel"')
  expect(html).not.toContain('id="solidLeftMemoryPanel"')
  expect(html).not.toContain('id="leftPanelExplorer"')
  expect(html).not.toContain('id="leftPanelChanges"')
  expect(html).toContain('id="solidFileExplorerMount"')
  expect(html).toContain('id="solidFileChangesMount"')
  expect(html).not.toContain('id="chatPluginPane"')
  expect(html).not.toContain('data-chat-view="plugin"')
  expect(html).not.toContain('id="chatPluginOutlet"')
  expect(html).not.toContain('id="chatTuiPane"')
  expect(html).not.toContain('id="solidTuiHostMount"')
  expect(html).not.toContain('id="chatBrowserPreviewPane"')
  expect(html).toContain('id="solidBrowserPreviewMount"')
  expect(html).toContain('id="solidScreenshotBrowserMount"')
  expect(html).not.toContain('id="rightPanelTui"')
  expect(html).not.toContain('id="rightPanelBrowser"')
  expect(html).not.toContain('id="rightPaneResizer"')
  expect(html).not.toContain('id="rightPanelInspector"')
  expect(html).toContain('id="rightPanelNotifications"')
  expect(html).toContain('id="solidNotificationCenterMount"')
  expect(html).not.toContain('data-side-activity="inspector"')
  expect(html).toContain('data-side-activity="notifications" data-active="false"')
  expect(html).not.toContain('id="solidBoardMount"')
  expect(html).not.toContain('id="solidRightPanelTabs"')
  expect(html).not.toContain('id="solidRightFilesMount"')
  expect(html).not.toContain('id="solidInteractionMount"')
  expect(html).not.toContain('id="solidAcceptanceMount"')
  expect(html).not.toContain('id="rightPanelPreview"')
  expect(html).not.toContain('id="solidFrontendPreviewMount"')
})

test("index.html does not declare the rejected single InspectorPanel root", async () => {
  const html = await readSrc("src/index.html")
  expect(html).not.toContain('id="solidInspectorPanelMount"')
})

test("Goals panel keeps acceptance adjacent to goals and file changes outside it", async () => {
  const board = await readSrc("src/components/Board.tsx")
  expect(board).toContain("export function GoalsBoardPanel")
  expect(board).toContain('class="sections-stack workflow-section-stack task-scope-panel__stack"')
  expect(board).toContain('id="goalWorkflowsSection"')
  expect(board).toContain('data-task-scope-content="goals"')
  expect(board).not.toContain("<SectionFrame")
  const acceptanceAt = board.indexOf("<AcceptancePanel")
  const goalsPanelAt = board.indexOf("export function GoalsBoardPanel")
  const goalsContentAt = board.indexOf('id="goalWorkflowsSection"')
  expect(acceptanceAt).toBeGreaterThan(-1)
  expect(acceptanceAt).toBeGreaterThan(goalsPanelAt)
  expect(acceptanceAt).toBeGreaterThan(goalsContentAt)
  expect(board).not.toContain("<FilesSection")
})

test("task-scope panels render direct content through the shared scroll stack", async () => {
  const css = await readSrc("src/styles/surfaces/inspector.css")
  expect(css).toMatch(/\.task-scope-panel\s*\{/)
  expect(css).toMatch(/\.task-scope-panel__stack\.workflow-section-stack\s*\{/)
  expect(css).toMatch(/\.task-scope-panel__content\s*\{/)
  expect(css).toContain('.task-scope-panel__content[data-phase-state="active"]')
  expect(css).toMatch(/\.workflow-section-stack\s*\{/)
  expect(css).toContain('.workflow-section-stack .oc-section[data-phase-state="active"]')
})

test("main.tsx mounts Work Ledger on the left and keeps the right activity toolbar", async () => {
  const main = await readSrc("src/main.tsx")
  const app = await readSrc("src/components/App.tsx")
  expect(app).toContain('id="solidConversationAgentRailMount"')
  expect(app).toContain("<ConversationAgentRail />")
  expect(app).toContain('id="solidFileEditorMount"')
  expect(app).toContain("<FileEditorPane />")
  expect(app).toContain('id="solidNotificationCenterMount"')
  expect(app).toContain('<NotificationCenter surface="panel" />')
  expect(main).not.toContain('document.getElementById("solidConversationAgentRailMount")')
  expect(main).not.toContain('document.getElementById("solidFileEditorMount")')
  expect(main).not.toContain('document.getElementById("solidNotificationCenterMount")')
  expect(main).toContain('document.querySelector("#chatViewTitle")')
  expect(main).toContain('document.getElementById("solidFileExplorerMount")')
  expect(main).toContain('document.getElementById("centerWorkbenchFile")')
  expect(main).toContain('document.getElementById("centerWorkbenchDiff")')
  expect(main).toContain('document.getElementById("solidFileChangesMount")')
  expect(main).not.toContain('document.getElementById("chatPluginOutlet")')
  expect(main).toContain('document.getElementById("workLedgerPanel")')
  expect(main).not.toContain('document.getElementById("solidLeftActivityToolbar")')
  expect(main).toContain('document.getElementById("solidRightActivityToolbar")')
  expect(main).not.toContain('document.getElementById("solidLeftPanelCollapseControl")')
  expect(main).not.toContain('document.getElementById("solidLeftCollapsedRailControl")')
  expect(main).not.toContain("LeftPanelHeaderCollapseControl")
  expect(main).toContain('document.getElementById("solidBrowserPreviewMount")')
  expect(main).toContain('document.getElementById("solidScreenshotBrowserMount")')
  expect(main).not.toContain('document.getElementById("solidFileEditorToggleMount")')
  expect(main).not.toContain('document.getElementById("solidAgentWorkflowMount")')
  expect(main).not.toContain('document.getElementById("solidRightPanelTabs")')
  expect(main).not.toContain('document.getElementById("solidFilesSectionMount")')
  expect(main).not.toContain('document.getElementById("solidBoardMount")')
  expect(main).toContain('document.getElementById("solidRequirementsPanelMount")')
  expect(main).toContain('document.getElementById("solidArchitectPanelMount")')
  expect(main).toContain('document.getElementById("solidGoalsPanelMount")')
  expect(main).not.toContain('document.getElementById("solidAcceptanceMount")')
  expect(main).not.toContain('document.getElementById("solidFrontendPreviewMount")')
  expect(main).not.toContain("<FrontendPreviewPanel")
  expect(main).toContain("<WorkLedger")
  expect(main).toContain("<SideActivityToolbar")
  expect(main).not.toContain("selectLeftActivity")
  expect(main).toContain("selectRightActivity")
  expect(main).not.toContain("type LeftActivity")
  expect(main).toContain("type CenterWorkbenchPanel =")
  expect(main).toContain('| "screenshots"')
  expect(main).toContain('type RightActivity = Exclude<CenterWorkbenchPanel, "file">')
  expect(main).toContain(
    'id: "workflow", icon: "workflow", labelKey: "chat.title", tooltipKey: "activity.tooltip.workflow"',
  )
  expect(main).not.toContain('id: "inspector"')
  expect(main).toContain(
    'id: "requirements",\n    icon: "spec",\n    labelKey: "workflow.requirements",\n    tooltipKey: "activity.tooltip.requirements"',
  )
  expect(main).toContain(
    'id: "architect",\n    icon: "plan",\n    labelKey: "workflow.architect",\n    tooltipKey: "activity.tooltip.architect"',
  )
  expect(main).toContain('id: "goals", icon: "goals", labelKey: "workflow.goals", tooltipKey: "activity.tooltip.goals"')
  expect(main).toContain(
    'id: "explorer", icon: "folder", labelKey: "explorer.title", tooltipKey: "activity.tooltip.explorer"',
  )
  expect(main).toContain('id: "diff", icon: "files", labelKey: "workspace.diff", tooltipKey: "activity.tooltip.diff"')
  expect(main).toContain(
    'id: "browser", icon: "web-search", labelKey: "browser_preview.title", tooltipKey: "activity.tooltip.browser"',
  )
  expect(main).toContain('id: "screenshots"')
  expect(main).toContain('icon: "screenshots"')
  expect(main).toContain('labelKey: "screenshots.title"')
  expect(main).toContain('tooltipKey: "activity.tooltip.screenshots"')
  expect(main).toContain('id: "notifications"')
  expect(main).toContain('icon: "notifications"')
  expect(main).toContain('labelKey: "notify.center_label"')
  expect(main).toContain('tooltipKey: "activity.tooltip.notifications"')
  expect(main).not.toContain('id: "assistant", icon: "message"')
  expect(main).not.toContain('id: "mission", icon: "mission"')
  expect(main).not.toContain('id: "tasks", icon: "tasks"')
  expect(main).not.toContain('id: "memory", icon: "config-memory"')
  expect(main).not.toMatch(/id:\s*"extensions"[\s\S]*?icon:\s*"config-skill"/)
  expect(main).not.toContain('id: "tool"')
  expect(main).not.toContain('id: "skill"')
  expect(main).not.toContain('id: "mcp"')
  expect(main).toContain(
    'const [centerWorkbenchPanels, setCenterWorkbenchPanels] = createSignal<CenterWorkbenchPanel[]>(["workflow"])',
  )
  expect(main).not.toContain("selectedRightActivity")
  expect(main).not.toContain("setSelectedRightActivity")
  expect(main).toContain("const activeRightActivity = (): RightActivity | null =>")
  expect(main).toContain("const panel = selectedCenterWorkbenchPanel()")
  expect(main).toContain('return panel && panel !== "file" ? panel : null')
  expect(main).not.toContain('primaryCenterPanel() === "task" && isCenterWorkbenchPanelOpen("workflow")')
  expect(main).toContain(
    "function selectedCenterWorkbenchPanel(panels = centerWorkbenchPanels()): CenterWorkbenchPanel | null",
  )
  expect(main).toContain("const selectedPanel = selectedCenterWorkbenchPanel(panels)")
  expect(main).toContain("body.dataset.selected = String(open && panel === selectedPanel)")
  expect(main).toContain("active={activeRightActivity}")
  expect(main).not.toContain("centerWorkbenchTabs")
  expect(main).not.toContain("activeCenterWorkbenchTab")
  expect(main).toContain('workflow: document.getElementById("centerWorkbenchWorkflow")')
  expect(main).not.toContain('inspector: document.getElementById("centerWorkbenchInspector")')
  expect(main).toContain('requirements: document.getElementById("centerWorkbenchRequirements")')
  expect(main).toContain('architect: document.getElementById("centerWorkbenchArchitect")')
  expect(main).toContain('goals: document.getElementById("centerWorkbenchGoals")')
  expect(main).toContain('notifications: document.getElementById("centerWorkbenchNotifications")')
  expect(main).toContain('screenshots: document.getElementById("centerWorkbenchScreenshots")')
  expect(main).toContain("primaryCenterPanel")
  expect(main).toContain('t("chat.panel_title")')
  expect(main).toContain('t("task.panel_title")')
  expect(main).toContain('t("mission.title")')
  expect(main).not.toContain('render(() => <NotificationCenter surface="panel" />, notificationPanelEl)')
  expect(main).toContain('render(() => <NotificationCenter surface="toast" />, notificationHost)')
  expect(main).not.toContain("<CodingAssistantSessionList")
  expect(main).not.toContain("loadCodingAssistantSessions({ directory: activeDirectory(), signal: controller.signal })")
  expect(main).toMatch(
    /selectCodingAssistantSession\(\{[\s\S]*?sessionID:\s*row\.sessionID[\s\S]*?directory:\s*row\.directory/,
  )
  expect(main).toContain('type PrimaryCenterPanel = "task" | "mission" | "chat"')
  expect(main).not.toContain("leftActivityCenterPanel")
  expect(main).not.toContain("focusedLeftActivityOwnsPrimaryPanel")
  expect(main).not.toContain("resetCenterWorkbenchToFocusedPanel")
  expect(main).toContain("resetCenterWorkbenchToPrimaryPanel")
  expect(main).toContain('setCenterWorkbenchPanels(["workflow"])')
  expect(main).toContain("function isMissionSessionSource(): boolean")
  expect(main).toContain("return boardStore.selectedSource?.kind === \"session\" && !isCodingAssistantSource()")
  expect(main).toContain("CENTER_WORKBENCH_PANEL_ORDER")
  expect(main).toContain("getCenterWorkbenchSeparators")
  expect(main).toContain("renderCenterWorkbenchPanelSeparators")
  expect(main).toContain("resizeCenterWorkbenchPanelByKeyboard")
  expect(main).toContain("aria-valuenow")
  expect(main).toContain("startCenterWorkbenchPanelResize")
  expect(main).toContain("centerWorkbenchPanelWeights")
  expect(main).toContain("scheduleCenterWorkbenchPanelReveal")
  expect(main).toContain("renderCenterWorkbenchPanelMeasurementsAndReveal")
  expect(main).not.toContain("overlayRightActivityPlugins")
  expect(main).not.toContain("const PluginPanel = plugin.Panel")
  expect(main).not.toContain("<TuiHostPanel")
  expect(main).not.toContain("<TuiRuntimePanel")
  expect(main).toContain("<BrowserPreviewPanel")
  expect(main).toContain("<ScreenshotBrowserPanel")
  expect(main).toContain("<FileExplorerPanel")
  expect(main).toContain("<FileChangesPanel")
  expect(main).toContain('active={() => isCenterWorkbenchPanelOpen("file") || isCenterWorkbenchPanelOpen("diff")}')
  expect(main).not.toContain("<FileEditorPane")
  expect(main).not.toContain("<RightPanelTabs")
  expect(main).not.toContain("<RightFilesPanel")
  expect(main).not.toContain("<FileEditorToggle")
  expect(main).not.toContain("<FilesSection")
  expect(main).not.toContain("<ConversationAgentRail")
  expect(main).not.toContain("nextTabForPreviewResolution")
  expect(main).not.toContain("AgentWorkflowPanel")
  expect(main).not.toContain('import { InspectorPanel } from "./components/InspectorPanel"')
  expect(main).not.toContain("<InspectorPanel")
})

test("chat usage strip reads the stats-kernel aggregate instead of scanning every card", async () => {
  const main = await readSrc("src/main.tsx")
  expect(main).toContain("formatUsageStrip(cardTreeStore.usageAggregate)")
  expect(main).not.toContain("aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))")
  expect(main).not.toContain("import { aggregateUsageAcrossSessions")
})

test("ConversationAgentRail owns workflow navigation without high-energy effects", async () => {
  const component = await readSrc("src/components/ConversationAgentRail.tsx")
  const css = await readSrc("src/styles/surfaces/conversation.css")
  expect(component).toContain("conversationAgentRecordsForSource(boardStore.selectedSource)")
  expect(component).toContain("parentIDChainForCard")
  expect(component).not.toContain("buildAgentWorkflow(")
  expect(component).not.toContain("mergeAgentRecords")
  expect(component).not.toContain("orderedReachableCardIDs()")
  expect(component).not.toContain("Object.values(cardTreeStore.cards).find")
  expect(component).not.toContain("AgentReportDialog")
  expect(component).not.toContain("conversation-agent-rail__resize")
  expect(css).toContain(".conversation-agent-rail")
  expect(css).not.toContain("agent-report-dialog")
  expect(css).not.toContain("agent-workflow-card-aura")
  expect(css).not.toContain("@keyframes workflow-")
})

test("AcceptancePanel and AcceptanceEvidenceGroup are exported from components/Board.tsx", async () => {
  const board = await readSrc("src/components/Board.tsx")
  expect(board).toMatch(/export\s+function\s+AcceptancePanel/)
  expect(board).toMatch(/export\s+function\s+AcceptanceEvidenceGroup/)
  expect(board).toMatch(/export\s+function\s+acceptancePanelAcceptance/)
})

test("AcceptancePanel has an in-flight projection while the run is in deliver before a acceptance row exists", async () => {
  const board = await readSrc("src/components/Board.tsx")
  expect(board).toContain('const ACCEPTANCE_PHASES = new Set(["deliver", "refine"])')
  expect(board).toContain('const LIVE_RUN_STATUSES = new Set(["queued", "accepted", "running", "blocked"])')
  expect(board).toContain("pending: true")
  expect(board).toContain('t("acceptance.inflight.hint")')
  expect(board).toMatch(/if \(hasActiveAcceptanceRun\(board\(\)\)\) return "acceptance"/)
  expect(board).toContain("<AcceptancePanel acceptance={scope.acceptance()}")
})

test("AcceptancePanel is not mounted for tasks without acceptance content", async () => {
  const board = await readSrc("src/components/Board.tsx")
  const acceptanceAt = board.indexOf("<AcceptancePanel")
  const beforeAcceptance = board.slice(Math.max(0, acceptanceAt - 220), acceptanceAt)
  expect(beforeAcceptance).toContain("<Show when={scope.acceptance()}>")
  expect(board).not.toContain("acceptance.empty.hint")
  expect(board).not.toContain('data-verdict="empty"')
})

test("AcceptancePanel drives chrome via [data-verdict] (not the lifecycle status mapping)", async () => {
  const board = await readSrc("src/components/Board.tsx")
  // Single attribute hook for acceptance body chrome. Verdict text belongs to
  // the Section badge owner, not a second verdict pill inside the body.
  expect(board).toContain("data-verdict={tone()}")
  expect(board).not.toContain('class="acceptance-panel-header"')
  expect(board).not.toContain('<span class="verdict-pill" data-verdict={tone()}>')
  expect(board).not.toContain('<span class="verdict-pill" data-verdict="empty">')
  expect(board).toContain('class="acceptance-panel-meta"')
  // The buggy lifecycle-as-verdict mapping must be gone — `acceptance.status.*`
  // i18n keys belonged to the deleted `acceptanceStatusLabel` helper.
  expect(board).not.toContain("acceptance.status.candidate")
  expect(board).not.toContain("acceptance.status.delivered")
  expect(board).not.toContain("acceptance.status.failed")
  expect(board).not.toContain("acceptance.status.publishing")
  expect(board).not.toContain("acceptanceStatusLabel")
  expect(board).not.toContain("empty.acceptance")
})

test("surface CSS maps verdict tone to the panel's pseudo-element left-edge accent", async () => {
  // acceptance-panel chrome moved from styles.css to surfaces/inspector.css
  // (styles.css was dissolved 2026-05-04).
  const css = readAllSurfaceCss()
  // Per-tone left-edge colors — rejected MUST be red, accepted MUST be green.
  // The accent is a pseudo-element rail, not a decorative border, so the
  // right-panel no-border chrome contract and verdict semantics can coexist.
  expect(css).toMatch(/\.acceptance-panel::before\s*\{[^}]*background:\s*var\(--acceptance-panel-accent\)/)
  expect(css).toMatch(
    /\.acceptance-panel\[data-verdict="accepted"\]\s*\{[^}]*--acceptance-panel-accent:\s*var\(--good\)/,
  )
  expect(css).toMatch(
    /\.acceptance-panel\[data-verdict="rejected"\]\s*\{[^}]*--acceptance-panel-accent:\s*var\(--bad\)/,
  )
  expect(css).not.toMatch(/\.acceptance-panel\s*\{[^}]*border-left\s*:/)
  // The deleted `.acceptance-card` family must not survive — every theme
  // override at lines 9822 / 11890 / 12628 was migrated to `.acceptance-panel`.
  expect(css).not.toMatch(/\.acceptance-card\b/)
  expect(css).not.toMatch(/\.acceptance-title\b/)
})

test("acceptance evidence names wrap instead of forcing narrow panel overflow", async () => {
  const css = readAllSurfaceCss()
  const nameRule = css.match(/\.acceptance-evidence-name\s*\{[\s\S]*?\n\}/)?.[0] ?? ""
  expect(nameRule).toContain("min-width: 0;")
  expect(nameRule).toContain("overflow-wrap: anywhere;")
  expect(nameRule).not.toContain("white-space: nowrap;")
  expect(nameRule).not.toContain("text-overflow: ellipsis;")
})

test("evidence rows reuse the shared .verdict-pill primitive — no per-row color rules", async () => {
  // verdict-pill primitive moved from styles.css to surfaces/inspector.css
  // (styles.css was dissolved 2026-05-04).
  const css = readAllSurfaceCss()
  const board = await readSrc("src/components/Board.tsx")
  // The shared primitive exists, with at least the four acceptance tones.
  expect(css).toMatch(/\.verdict-pill\s*\{/)
  expect(css).toMatch(/\.verdict-pill\[data-verdict="accepted"\]/)
  expect(css).toMatch(/\.verdict-pill\[data-verdict="rejected"\]/)
  expect(css).toMatch(/\.verdict-pill\[data-verdict="inflight"\]/)
  expect(css).toMatch(/\.verdict-pill\[data-verdict="empty"\]/)
  // The legacy `.integrity__verdict` must be gone — IntegrityCard now
  // uses the same `.verdict-pill` primitive.
  expect(css).not.toMatch(/\.integrity__verdict\s*\{/)
  // AcceptancePanel renders its pills via the shared class, not a bespoke one.
  expect(board).toContain('class="verdict-pill"')
})

test("AcceptancePanel action controls use the shared Button primitive", async () => {
  const board = await readSrc("src/components/Board.tsx")
  const evidenceStart = board.indexOf("export function AcceptanceEvidenceGroup")
  const panelStart = board.indexOf("export function AcceptancePanel")
  const taskActionsStart = board.indexOf("// ── TaskActionsPanel ──")
  const evidenceSlice = board.slice(evidenceStart, panelStart)
  const panelSlice = board.slice(panelStart, taskActionsStart)

  expect(evidenceSlice).not.toContain("<button")
  expect(panelSlice).not.toContain("<button")
  expect(evidenceSlice).toContain("<Button")
  expect(panelSlice).toContain("<Button")
  expect(evidenceSlice).toContain('data-ui="acceptance-evidence-goal-pill"')
  expect(panelSlice).toContain('data-ui="acceptance-summary-toggle"')
  expect(panelSlice).toContain('data-ui="acceptance-files-link"')
  expect(evidenceSlice).toContain('attr:data-has-pill={row.goalRunID ? "true" : undefined}')
})

test("`acceptance:focus-changes` event contract — AcceptancePanel dispatches, ChangesPanel listens", async () => {
  const board = await readSrc("src/components/Board.tsx")
  const changes = await readSrc("src/components/ChangesPanel.tsx")
  const fileChangesView = await readSrc("src/components/FileChangesView.tsx")
  const filesPanel = await readSrc("src/components/FileChangesPanel.tsx")
  const main = await readSrc("src/main.tsx")
  // Dispatch site (AcceptancePanel goal-pill / files-changed footer).
  expect(board).toContain('"acceptance:focus-changes"')
  expect(board).toMatch(/window\.dispatchEvent\(\s*new CustomEvent\("acceptance:focus-changes"/)
  // Listener side: the lifted center-workbench state switches to changed files; FileChangesView owns row selection state.
  expect(main).toContain('setFileChangesActiveView("changes")')
  expect(filesPanel).not.toContain("showWorkbenchPane")
  expect(main).toContain('"acceptance:focus-changes"')
  expect(main).toContain('openCenterWorkbenchPanel("diff")')
  expect(changes).toContain('"acceptance:focus-changes"')
  expect(changes).toContain('focusEvent="acceptance:focus-changes"')
  expect(fileChangesView).toContain("addEventListener")
  expect(fileChangesView).toContain("setSelectedRowKey")
})

test("redesign-required i18n keys exist in both locales; the legacy lifecycle keys are gone", async () => {
  const en = await readJson("src/i18n/en-US.json")
  const zh = await readJson("src/i18n/zh-CN.json")
  const required = [
    "acceptance.verdict.accepted",
    "acceptance.verdict.rejected",
    "acceptance.verdict.inflight",
    "acceptance.verdict.empty",
    "acceptance.iteration",
    "acceptance.checks",
    "acceptance.reviews",
    "acceptance.show_more",
    "acceptance.show_less",
    "acceptance.inflight.hint",
    "browser_preview.title",
    "browser_preview.url_label",
    "browser_preview.capture_title",
    "browser_preview.capture_loading",
    "browser_preview.viewport.desktop",
    "coding_assistant.title",
    "work_ledger.title",
    "work_ledger.open_project",
    "work_ledger.kind.mission",
    "work_ledger.kind.task",
    "work_ledger.kind.chat",
    "activity.tooltip.requirements",
    "activity.tooltip.architect",
    "activity.tooltip.goals",
    "skill.title",
    "skill.market.title",
    "mcp.title",
    "memory.title",
    "workflow.goals_pending",
  ]
  // i18n keys are flat strings with literal dots, not nested paths — use
  // `key in obj` instead of toHaveProperty (which would mis-traverse).
  for (const key of required) {
    expect(key in en).toBe(true)
    expect(key in zh).toBe(true)
  }
  // Legacy lifecycle-as-verdict keys + old empty hint must be deleted (rule 17).
  for (const key of [
    "acceptance.empty.hint",
    "acceptance.runtime",
    "acceptance.status.candidate",
    "acceptance.status.delivered",
    "acceptance.status.failed",
    "acceptance.status.publishing",
    "empty.acceptance",
    "activity.tooltip.inspector",
    "right_panel.tabs",
    "right_panel.inspector",
    "right_panel.preview",
    "sections.title",
    "frontend_preview.title",
    "coding_assistant.input_placeholder",
    "coding_assistant.send",
    "coding_assistant.loading",
  ]) {
    expect(key in en).toBe(false)
    expect(key in zh).toBe(false)
  }
})

test("evidence helpers do NOT silently truncate the row list (the old `.slice(0, 12)` is gone)", async () => {
  const board = await readSrc("src/components/Board.tsx")
  // The pre-redesign helper sliced the merged list to 12 rows. The new
  // per-group helpers must show every failed row — no integer-bounded
  // `.slice(0, N)` truncation in the acceptance evidence helpers. (We pin
  // the literal `.slice(0, 12)` because that's the regression we just
  // killed; pinning it tighter than "any slice" avoids tripping on
  // unrelated `.slice(0, 6)` style truncations that can legitimately
  // appear in other helpers in this file.)
  expect(board).not.toContain(".slice(0, 12)")
})
