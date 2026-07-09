import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "bun:test"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

function cssRuleBody(css: string, selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of source.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

test("left activity shell does not reserve the retired toolbar width", () => {
  const activityCss = read("src/styles/surfaces/activity.css")
  const body = cssRuleBody(activityCss, ".left-activity-shell")

  expect(body).toContain("flex: 0 1 var(--ui-sidebar-width);")
  expect(body).toContain("width: var(--ui-sidebar-width);")
  expect(body).toContain("min-width: min(100%, var(--ui-rail-min-width));")
  expect(body).toContain("max-width: var(--ui-sidebar-width);")
  expect(body.match(/min-width\s*:/g) ?? []).toHaveLength(1)
  expect(body).not.toMatch(/min-width\s*:\s*0\b/)
  expect(body).not.toContain("var(--ui-collapsed-pane-width)")
})

test("left toolbar is retired and the left panel owns one Work Ledger mount", () => {
  const html = read("src/index.html")
  const main = read("src/main.tsx")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(html).toContain('id="leftActivityShell"')
  expect(html).toContain('id="leftPanelWork"')
  expect(html).toContain('id="workLedgerPanel"')
  expect(html).toContain('data-i18n="work_ledger.title"')
  expect(html).toContain('id="solidLeftPanelActions"')
  expect(html).not.toContain('id="solidLeftActivityToolbar"')
  expect(html).not.toContain('id="leftPanelTasks"')
  expect(html).not.toContain('id="leftPanelMissions"')
  expect(html).not.toContain('id="leftPanelAssistant"')
  expect(html).not.toContain('id="leftPanelExtensions"')
  expect(html).not.toContain('id="leftPanelMemory"')
  expect(html).not.toContain('id="btnCreateTask"')
  expect(html).not.toContain('id="btnCreateMission"')
  expect(html).not.toContain('id="btnCreateCodingAssistantSession"')

  expect(main).toContain('document.getElementById("workLedgerPanel")')
  expect(main).toContain("<WorkLedger")
  expect(main).toContain('document.getElementById("solidLeftPanelActions")')
  expect(main).toContain('data-ui="left-panel-open-project"')
  expect(main).toContain('Icon name="project-add"')
  expect(main).toContain('runMainAsync("projects.open-folder", () => browseDirectory())')
  expect(main).not.toContain("type LeftActivity")
  expect(main).not.toContain("LEFT_ACTIVITIES")
  expect(main).not.toContain("selectLeftActivity")
  expect(main).not.toContain("<ExtensionActivityPanel")
  expect(main).not.toContain("<TaskList")
  expect(main).not.toContain("<Mission")
  expect(main).not.toContain("<CodingAssistantSessionList")

  for (const key of [
    "work_ledger.title",
    "work_ledger.open_project",
    "work_ledger.kind.mission",
    "work_ledger.kind.task",
    "work_ledger.kind.chat",
    "work_ledger.kind_description.mission",
    "work_ledger.kind_description.task",
    "work_ledger.kind_description.chat",
    "work_ledger.search_placeholder",
  ]) {
    expect(en).toContain(`"${key}"`)
    expect(zh).toContain(`"${key}"`)
  }
  expect(en).toContain('"work_ledger.title": "Projects"')
  expect(zh).toContain('"work_ledger.title": "Projects"')
})

test("Memory, Skill, Tool, and MCP remain Settings-owned instead of left-toolbar owned", () => {
  const main = read("src/main.tsx")
  const configHost = read("src/components/ConfigDialogHost.tsx")
  const skillPanel = read("src/components/settings/SkillMarketPanel.tsx")
  const html = read("src/index.html")

  expect(html).not.toContain('id="leftPanelMemory"')
  expect(html).not.toContain('id="leftPanelExtensions"')
  expect(main).not.toContain("solidLeftMemoryPanel")
  expect(main).not.toContain("solidLeftExtensionsPanel")
  expect(main).not.toContain("<ExtensionActivityPanel")

  expect(configHost).toContain("return <SkillsPanel directory={activeProjectDirectory} />")
  expect(configHost).toContain("return <SkillMarketPanel active={true} directory={activeProjectDirectory} />")
  expect(configHost).toContain("return <McpPanel directory={activeProjectDirectory} />")
  expect(configHost).toContain("return <MemoryPanel taskID={() => activeTaskID() || undefined} />")
  expect(skillPanel).toContain("export function ToolsPanel")
  expect(skillPanel).toContain("export function SkillsPanel")
  expect(skillPanel).toContain("export function McpPanel")
})
