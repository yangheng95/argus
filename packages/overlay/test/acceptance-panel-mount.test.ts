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

test("index.html declares toolbar workbench activities without a separate Inspector column", async () => {
  const html = await readSrc("src/index.html")
  expect(html).toContain('id="solidConversationAgentRailMount"')
  expect(html).toContain('id="chatContentFrame"')
  expect(html).toContain('id="chatMessagePane"')
  expect(html).toContain('id="centerWorkbench"')
  expect(html).toContain('id="solidCenterWorkbenchTabs"')
  expect(html).toContain('id="centerWorkbenchResizer"')
  expect(html).toContain('id="centerWorkbenchWorkflow"')
  expect(html).toContain('id="centerWorkbenchInspector"')
  expect(html).toContain('id="centerWorkbenchNotifications"')
  expect(html).toContain('id="centerWorkbenchExplorer"')
  expect(html).toContain('id="centerWorkbenchDiff"')
  expect(html).toContain('id="centerWorkbenchBrowser"')
  expect(html).not.toContain('id="centerWorkbenchAssistant"')
  expect(html).not.toContain('id="solidCodingAssistantMount"')
  expect(html).toContain('id="centerWorkbenchFile"')
  expect(html).toContain('id="solidFileEditorMount"')
  expect(html).not.toContain('id="solidFileEditorToggleMount"')
  expect(html).not.toContain('id="rightPanelWorkflow"')
  expect(html).not.toContain('id="solidAgentWorkflowMount"')
  expect(html).not.toContain('id="solidLeftActivityToolbar"')
  expect(html).toContain('id="solidLeftPanelCollapseControl"')
  expect(html).toContain('id="solidLeftCollapsedRailControl"')
  expect(html).toContain('id="solidRightActivityToolbar"')
  expect(html).toContain('id="chatViewTitle"')
  expect(html).toContain('id="leftPanelTasks"')
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
  expect(html).not.toContain('id="rightPanelTui"')
  expect(html).not.toContain('id="rightPanelBrowser"')
  expect(html).not.toContain('id="rightPaneResizer"')
  expect(html).toContain('id="rightPanelInspector"')
  expect(html).toContain('id="rightPanelNotifications"')
  expect(html).toContain('id="solidNotificationCenterMount"')
  expect(html).toContain('data-side-activity="inspector" data-active="false"')
  expect(html).toContain('data-side-activity="notifications" data-active="false"')
  expect(html).toContain('id="solidBoardMount"')
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

test("Board keeps acceptance inside the unified Inspector stack and file changes outside it", async () => {
  const board = await readSrc("src/components/Board.tsx")
  expect(board).toContain('class="workflow-section-stack"')
  const acceptanceAt = board.indexOf("<AcceptancePanel")
  expect(acceptanceAt).toBeGreaterThan(-1)
  expect(board).not.toContain("<FilesSection")
})

test("Inspector workflow sections render as one contiguous stack", async () => {
  const css = await readSrc("src/styles/surfaces/inspector.css")
  expect(css).toMatch(/\.workflow-section-stack\s*\{/)
  expect(css).toMatch(/\.workflow-section-stack \.oc-section \+ \.oc-section\s*\{/)
  expect(css).toContain('.workflow-section-stack .oc-section[data-phase-state="active"]')
})

test("main.tsx mounts the top-level side activity toolbars and bodies", async () => {
  const main = await readSrc("src/main.tsx")
  expect(main).toContain('document.getElementById("solidConversationAgentRailMount")')
  expect(main).toContain('document.querySelector("#chatViewTitle")')
  expect(main).toContain('document.getElementById("solidFileExplorerMount")')
  expect(main).toContain('document.getElementById("solidFileEditorMount")')
  expect(main).toContain('document.getElementById("centerWorkbenchFile")')
  expect(main).toContain('document.getElementById("centerWorkbenchDiff")')
  expect(main).toContain('document.getElementById("solidFileChangesMount")')
  expect(main).not.toContain('document.getElementById("chatPluginOutlet")')
  expect(main).not.toContain('document.getElementById("solidLeftActivityToolbar")')
  expect(main).toContain('document.getElementById("solidRightActivityToolbar")')
  expect(main).toContain('document.getElementById("solidBrowserPreviewMount")')
  expect(main).not.toContain('document.getElementById("solidFileEditorToggleMount")')
  expect(main).not.toContain('document.getElementById("solidAgentWorkflowMount")')
  expect(main).not.toContain('document.getElementById("solidRightPanelTabs")')
  expect(main).not.toContain('document.getElementById("solidFilesSectionMount")')
  expect(main).toContain('document.getElementById("solidBoardMount")')
  expect(main).not.toContain('document.getElementById("solidAcceptanceMount")')
  expect(main).not.toContain('document.getElementById("solidFrontendPreviewMount")')
  expect(main).not.toContain("<FrontendPreviewPanel")
  expect(main).toContain("<SideActivityToolbar")
  expect(main).toContain("selectRightActivity")
  expect(main).toContain('type CenterWorkbenchTab = "workflow" | "inspector" | "notifications" | "explorer" | "diff" | "browser" | "file"')
  expect(main).toContain('type RightActivity = Exclude<CenterWorkbenchTab, "file"> | "assistant"')
  expect(main).toContain('id: "workflow", icon: "goals", labelKey: "chat.title"')
  expect(main).toContain('id: "inspector", icon: "panel-right", labelKey: "sections.title"')
  expect(main).toContain('id: "notifications", icon: "log-lines", labelKey: "notify.center_label"')
  expect(main).toContain('id: "explorer", icon: "folder", labelKey: "explorer.title"')
  expect(main).toContain('id: "diff", icon: "file-document", labelKey: "workspace.diff"')
  expect(main).toContain('{ id: "assistant", icon: "message", labelKey: "coding_assistant.title" }')
  expect(main).toContain('const [centerWorkbenchTabs, setCenterWorkbenchTabs] = createSignal<CenterWorkbenchTab[]>(["workflow"])')
  expect(main).toContain('const [activeCenterWorkbenchTab, setActiveCenterWorkbenchTab] = createSignal<CenterWorkbenchTab | null>("workflow")')
  expect(main).toContain('workflow: document.getElementById("centerWorkbenchWorkflow")')
  expect(main).toContain('inspector: document.getElementById("centerWorkbenchInspector")')
  expect(main).toContain('notifications: document.getElementById("centerWorkbenchNotifications")')
  expect(main).toContain('isCodingAssistantSource() ? t("chat.assistant_title") : t("chat.title")')
  expect(main).toContain('render(() => <NotificationCenter surface="panel" />, notificationPanelEl)')
  expect(main).toContain('render(() => <NotificationCenter surface="toast" />, notificationHost)')
  expect(main).toContain("selectCodingAssistantSession()")
  expect(main).not.toContain("overlayRightActivityPlugins")
  expect(main).not.toContain("const PluginPanel = plugin.Panel")
  expect(main).not.toContain("<TuiHostPanel")
  expect(main).not.toContain("<TuiRuntimePanel")
  expect(main).toContain("<BrowserPreviewPanel")
  expect(main).toContain("<FileExplorerPanel")
  expect(main).toContain("<FileChangesPanel")
  expect(main).toContain("<FileEditorPane")
  expect(main).not.toContain("<RightPanelTabs")
  expect(main).not.toContain("<RightFilesPanel")
  expect(main).not.toContain("<FileEditorToggle")
  expect(main).not.toContain("<FilesSection")
  expect(main).toContain("<ConversationAgentRail")
  expect(main).not.toContain("nextTabForPreviewResolution")
  expect(main).not.toContain("AgentWorkflowPanel")
  expect(main).not.toContain('import { InspectorPanel } from "./components/InspectorPanel"')
  expect(main).not.toContain("<InspectorPanel")
})

test("ConversationAgentRail owns workflow navigation without high-energy effects", async () => {
  const component = await readSrc("src/components/ConversationAgentRail.tsx")
  const css = await readSrc("src/styles/surfaces/conversation.css")
  expect(component).toContain("buildAgentWorkflow(")
  expect(component).toContain("mergeAgentRecords")
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
  expect(board).toContain("<AcceptancePanel acceptance={acceptance()}")
})

test("AcceptancePanel is not mounted for tasks without acceptance content", async () => {
  const board = await readSrc("src/components/Board.tsx")
  const acceptanceAt = board.indexOf("<AcceptancePanel")
  const beforeAcceptance = board.slice(Math.max(0, acceptanceAt - 220), acceptanceAt)
  expect(beforeAcceptance).toContain("<Show when={acceptance()}>")
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
  expect(css).toMatch(/\.acceptance-panel\[data-verdict="accepted"\]\s*\{[^}]*--acceptance-panel-accent:\s*var\(--good\)/)
  expect(css).toMatch(/\.acceptance-panel\[data-verdict="rejected"\]\s*\{[^}]*--acceptance-panel-accent:\s*var\(--bad\)/)
  expect(css).not.toMatch(/\.acceptance-panel\s*\{[^}]*border-left\s*:/)
  // The deleted `.acceptance-card` family must not survive — every theme
  // override at lines 9822 / 11890 / 12628 was migrated to `.acceptance-panel`.
  expect(css).not.toMatch(/\.acceptance-card\b/)
  expect(css).not.toMatch(/\.acceptance-title\b/)
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

test("`acceptance:focus-changes` event contract — AcceptancePanel dispatches, ChangesPanel listens", async () => {
  const board = await readSrc("src/components/Board.tsx")
  const changes = await readSrc("src/components/ChangesPanel.tsx")
  const fileChangesView = await readSrc("src/components/FileChangesView.tsx")
  const filesPanel = await readSrc("src/components/FileChangesPanel.tsx")
  const main = await readSrc("src/main.tsx")
  // Dispatch site (AcceptancePanel goal-pill / files-changed footer).
  expect(board).toContain('"acceptance:focus-changes"')
  expect(board).toMatch(/window\.dispatchEvent\(\s*new CustomEvent\("acceptance:focus-changes"/)
  // Listener side: the side activity file-changes workbench switches to changed files; FileChangesView owns row selection state.
  expect(filesPanel).toContain('"acceptance:focus-changes"')
  expect(filesPanel).toContain('setActiveView("changes")')
  expect(filesPanel).not.toContain("showWorkbenchPane")
  expect(main).toContain('"acceptance:focus-changes"')
  expect(main).toContain('openCenterWorkbenchTab("diff")')
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
    "browser_preview.capture",
    "browser_preview.capture_loading",
    "browser_preview.viewport.desktop",
    "coding_assistant.title",
    "chat.assistant_title",
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
    "right_panel.tabs",
    "right_panel.inspector",
    "right_panel.preview",
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
