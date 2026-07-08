import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readSource(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

test("left sidebar exposes one unified Work Ledger mount", () => {
  const html = readSource("src/index.html")
  const main = readSource("src/main.tsx")

  expect(html).toContain('id="workLedgerPanel"')
  expect(html).toContain('id="leftPanelWork"')
  expect(html).toContain('data-i18n="work_ledger.title"')
  expect(html).not.toContain('id="solidLeftActivityToolbar"')
  expect(html).not.toContain('id="leftPanelTasks"')
  expect(html).not.toContain('id="leftPanelMissions"')
  expect(html).not.toContain('id="leftPanelAssistant"')
  expect(html).not.toContain('id="leftPanelMemory"')
  expect(html).not.toContain('id="leftPanelExtensions"')
  expect(html).not.toContain('id="btnCreateTask"')
  expect(html).not.toContain('id="btnCreateMission"')
  expect(html).not.toContain('id="btnCreateCodingAssistantSession"')

  expect(main).toContain('document.getElementById("workLedgerPanel")')
  expect(main).toContain("<WorkLedger")
  expect(main).toContain("onSelectMission={(row)")
  expect(main).toContain("onSelectTask={(row)")
  expect(main).toContain("onSelectChat={(row)")
  expect(main).toContain("async function createWorkLedgerProjectChat(directory: string)")
  expect(main).toContain("await createCodingAssistantSession({ directory: projectDirectory })")
  expect(main).toContain('runMainAsync("work-ledger.project-new-chat", () => createWorkLedgerProjectChat(directory))')
  expect(main).not.toContain("<TaskList")
  expect(main).not.toContain("<CodingAssistantSessionList")
  expect(main).not.toContain("<Mission")
  expect(main).not.toContain("type LeftActivity")
  expect(main).not.toContain("LEFT_ACTIVITIES")
})

test("composer mode selector replaces the external executor slot", () => {
  const main = readSource("src/main.tsx")
  const composer = readSource("src/components/ChatComposer.tsx")
  const css = readSource("src/styles/surfaces/composer.css")

  expect(main).toContain('const [primaryCenterPanel, setPrimaryCenterPanel] = createSignal<PrimaryCenterPanel>("chat")')
  expect(main).toContain('const [composerMode, setComposerMode] = createSignal<ComposerMode>("chat")')
  expect(composer).toContain('triggerDataUI="composer-mode-selector"')
  expect(composer).toContain("<SelectControl<ComposerModeOption>")
  expect(composer).toContain('onComposerModeChange: (mode: ComposerMode) => void')
  expect(composer.indexOf('id: "chat"')).toBeLessThan(composer.indexOf('id: "mission"'))
  expect(composer).not.toContain('import { ExecutorSelector }')
  expect(composer).not.toContain("<ExecutorSelector")
  expect(composer).not.toContain('import * as Select from "@kobalte/core/select"')
  expect(css).toContain(".composer-mode-select-trigger.oc-select-trigger")
})

test("Mission and Task detailed status surfaces keep task-level DAG detail", () => {
  const service = readSource("src/services/mission.ts")

  expect(service).toContain("export async function loadMissionStatus")
  expect(service).toContain("export async function loadTaskStatus")
  expect(service).toContain("agentInvocationDAG: unknown")
})

test("Work Ledger owns row-kind rendering, child task mounting, and row actions", () => {
  const component = readSource("src/components/WorkLedger.tsx")
  const css = readSource("src/styles/surfaces/work-ledger.css")

  expect(component).toContain('data-ui="work-ledger-child-task"')
  expect(component).toContain('data-kind="task"')
  expect(component).toContain("useTaskRowActionsKeyboard")
  expect(component).toContain("data-actions-keyboard-open={rowActions.actionsKeyboardOpenData()}")
  expect(component).toContain('onCreateChat: (directory: string) => void | Promise<void>')
  expect(component).toContain("onCreateChat={props.onCreateChat}")
  expect(component).toContain('data-ui="work-row-stop"')
  expect(component).toContain('data-ui="work-row-delete"')
  expect(component).toContain("function inlineMeta")
  expect(component).toContain('class="work-row-inline-meta"')
  expect(component).not.toContain('class="work-row-meta"')
  expect(component).not.toContain('kindLabel("chat")')

  expect(css).toContain(".work-row-kind-mark")
  expect(css).toContain(".work-row-status-mark")
  expect(css).toContain(".work-row-inline-meta")
  expect(css).toMatch(/\.work-row-main\s*\{[^}]*flex-direction:\s*row;/)
  expect(css).not.toContain(".work-row-meta")
  expect(css).not.toMatch(/\.work-row-main\s*\{[^}]*flex-direction:\s*column;/)
  expect(css).toContain('.work-row-actions .oc-button[data-chrome="icon-action"][data-ui="work-row-stop"]')
  expect(css).toContain('.work-row-actions .oc-button[data-chrome="icon-action"][data-ui="work-row-delete"]')
})
