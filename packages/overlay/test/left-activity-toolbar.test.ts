import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "bun:test"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

test("left activity toolbar owns task, mission, assistant, memory, skill, and MCP controls", () => {
  const html = read("src/index.html")
  const main = read("src/main.tsx")
  const toolbar = read("src/components/SideActivityToolbar.tsx")
  const icons = read("src/components/Icon.tsx")
  const activityCss = read("src/styles/surfaces/activity.css")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(html).toContain('id="solidLeftActivityToolbar"')
  expect(html).toContain('id="leftPanelTasks"')
  expect(html).toContain('id="leftPanelMissions"')
  expect(html).toContain('id="leftPanelSkills"')
  expect(html).toContain('id="leftPanelMcp"')
  expect(html).toContain('id="leftPanelMemory"')
  expect(main).toContain('type LeftActivity = "tasks" | "mission" | "assistant" | "memory" | "skill" | "mcp"')
  expect(main).toContain("const LEFT_ACTIVITIES")
  expect(main).toContain("selectLeftActivity")
  expect(main).toContain('setSelectedLeftActivity("assistant")')
  expect(main).toContain("isLeftActivityOpen")
  expect(main).toContain('id: "tasks", icon: "tasks", labelKey: "sidebar.title", tooltipKey: "activity.tooltip.tasks"')
  expect(main).toContain(
    'id: "assistant", icon: "message", labelKey: "coding_assistant.title", tooltipKey: "activity.tooltip.assistant"',
  )
  expect(main).toContain(
    'id: "mission", icon: "mission", labelKey: "mission.title", tooltipKey: "activity.tooltip.mission"',
  )
  expect(main).toContain(
    'id: "memory", icon: "config-memory", labelKey: "memory.title", tooltipKey: "activity.tooltip.memory"',
  )
  expect(main).toContain(
    'id: "skill", icon: "config-skill", labelKey: "skill.title", tooltipKey: "activity.tooltip.skill"',
  )
  expect(main).toContain('id: "mcp", icon: "config-mcp", labelKey: "mcp.title", tooltipKey: "activity.tooltip.mcp"')
  expect(main).toContain('<SkillsPanel active={selectedLeftPanelActivity() === "skill"} compact />')
  expect(main).toContain('<McpPanel active={selectedLeftPanelActivity() === "mcp"} compact />')
  expect(main).not.toContain('<SkillsPanel active={selectedLeftPanelActivity() === "skill"} directory={activeDirectory} compact />')
  expect(main).not.toContain('<McpPanel active={selectedLeftPanelActivity() === "mcp"} directory={activeDirectory} compact />')
  expect(main).toContain('active={selectedLeftPanelActivity() === "memory"}')
  expect(main).toContain("directory={activeDirectory}")
  expect(icons).toContain("ListTodo")
  expect(icons).toContain("tasks: { component: ListTodo }")
  expect(toolbar).toContain("tooltipKey?: string")
  expect(toolbar).toContain("title={tooltip()}")
  expect(toolbar).toContain("aria-label={tooltip()}")
  expect(activityCss).toContain(".sidebar-tool-panel .ext-group")
  expect(activityCss).toContain(".sidebar-tool-panel .tool-panel-toolbar")
  expect(activityCss).toContain('.sidebar-tool-panel .oc-button[data-ui="tool-panel-action"]')
  expect(activityCss).toContain('.sidebar-tool-panel .memory-panel[data-compact="true"] .knowledge-toolbar')
  expect(activityCss).toContain(".sidebar-tool-panel .extension-row")
  expect(activityCss).toContain(".sidebar-tool-panel .extension-row-main > span")
  expect(activityCss).toContain("-webkit-line-clamp: 3")
  expect(activityCss).toContain(".sidebar-tool-panel .skill-drop-zone__copy strong")
  for (const key of [
    "activity.tooltip.tasks",
    "activity.tooltip.mission",
    "activity.tooltip.assistant",
    "activity.tooltip.memory",
    "activity.tooltip.skill",
    "activity.tooltip.mcp",
    "activity.tooltip.workflow",
    "activity.tooltip.inspector",
    "activity.tooltip.explorer",
    "activity.tooltip.diff",
    "activity.tooltip.browser",
    "activity.tooltip.notifications",
  ]) {
    expect(en).toContain(`"${key}"`)
    expect(zh).toContain(`"${key}"`)
  }
})

test("skill panel imports dropped files, directories, and zip archives through the project import route", () => {
  const panel = read("src/components/settings/SkillMarketPanel.tsx")
  const service = read("src/services/extensions.ts")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(panel).toContain("handleDroppedSkillDrop")
  expect(panel).toContain("data-skill-drop-active")
  expect(panel).toContain("dataTransferEntries")
  expect(panel).toContain("webkitGetAsEntry")
  expect(panel).toContain("readEntryFiles")
  expect(panel).toContain("fileToBase64")
  expect(panel).toContain('confirm(t("skill.drop_confirm"')
  expect(panel).toContain("await importSkillArchive(payload.archive.name")
  expect(panel).toContain("await importSkillPackage(payload.sourceName, payload.files, skillForm.policy)")
  expect(panel).toContain("await importSkillFile(payload.file.name")
  expect(panel).toContain('class="tool-panel-toolbar"')
  expect(panel).toContain("<PanelActionButton compact")
  expect(panel).toContain('class="skill-drop-zone"')
  expect(service).toContain('apiJson("skill/import-file"')
  expect(service).toContain("importSkillPackage")
  expect(service).toContain("importSkillArchive")
  expect(en).toContain("SKILL.md file, skill folder, or .zip")
  expect(zh).toContain("SKILL.md、skill 文件夹或 .zip")
})

test("skill panel surfaces duplicate skill locations from installed skill metadata", () => {
  const panel = read("src/components/settings/SkillMarketPanel.tsx")
  const inlinePill = read("src/styles/surfaces/inline-pill.css")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(panel).toContain("duplicate_locations?: string[]")
  expect(panel).toContain("function skillDuplicateLocations")
  expect(panel).toContain('data-state="warn"')
  expect(panel).toContain('title={skillDuplicateTitle(item)}')
  expect(panel).toContain('t("skill.duplicate")')
  expect(panel).toContain('t("skill.duplicate_locations_title"')
  expect(inlinePill).toContain('.extension-status[data-state="warn"]')
  expect(en).toContain('"skill.duplicate"')
  expect(en).toContain('"skill.duplicate_locations_title"')
  expect(zh).toContain('"skill.duplicate"')
  expect(zh).toContain('"skill.duplicate_locations_title"')
})
