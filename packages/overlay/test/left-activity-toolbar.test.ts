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

test("left activity shell keeps the token-owned minimum width", () => {
  const activityCss = read("src/styles/surfaces/activity.css")
  const body = cssRuleBody(activityCss, ".left-activity-shell")

  expect(body).toContain("min-width: min(100%, calc(var(--ui-collapsed-pane-width) + var(--ui-rail-min-width)));")
  expect(body.match(/min-width\s*:/g) ?? []).toHaveLength(1)
  expect(body).not.toMatch(/min-width\s*:\s*0\b/)
})

test("left activity toolbar owns task, mission, assistant, memory, tool, skill, and MCP controls", () => {
  const html = read("src/index.html")
  const main = read("src/main.tsx")
  const toolbar = read("src/components/SideActivityToolbar.tsx")
  const icons = read("src/components/Icon.tsx")
  const activityCss = read("src/styles/surfaces/activity.css")
  const settingsCss = read("src/styles/surfaces/settings.css")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(html).toContain('id="solidLeftActivityToolbar"')
  expect(html).toContain('id="leftActivityShell"')
  expect(html).toContain('id="leftPanelTasks"')
  expect(html).toContain('id="leftPanelMissions"')
  expect(html).toContain('id="leftPanelSkills"')
  expect(html).toContain('id="leftPanelTools"')
  expect(html).toContain('id="leftPanelMcp"')
  expect(html).toContain('id="leftPanelMemory"')
  expect(main).toContain('type LeftActivity = "tasks" | "mission" | "assistant" | "memory" | "tool" | "skill" | "mcp"')
  expect(main).toContain("const LEFT_ACTIVITIES")
  expect(main).toContain("const LEFT_ACTIVITY_BY_ID")
  expect(main).toContain("function leftActivityDefinition(activity: LeftActivity)")
  expect(main).not.toContain("LEFT_ACTIVITY_TITLE_KEYS")
  expect(main).toContain("const titleKey = activityDefinition.labelKey")
  expect(main).toContain("taskActions.dataset.i18nAriaLabel = titleKey")
  expect(main).toContain('taskActions.setAttribute("aria-label", titleText)')
  expect(main).toContain("selectLeftActivity")
  expect(main).toContain('setSelectedLeftActivity("assistant")')
  expect(main).toContain("isLeftActivityOpen")
  expect(main.indexOf('id: "mission", icon: "mission"')).toBeLessThan(main.indexOf('id: "tasks", icon: "tasks"'))
  expect(main).toContain(
    'const [selectedLeftActivity, setSelectedLeftActivity] = createSignal<LeftActivity>("mission")',
  )
  expect(main).toContain(
    'const [selectedLeftPanelActivity, setSelectedLeftPanelActivity] = createSignal<LeftActivity>("mission")',
  )
  expect(main).toContain(
    'const [primaryCenterPanel, setPrimaryCenterPanel] = createSignal<PrimaryCenterPanel>("mission")',
  )
  expect(html).toContain('id="leftPanelTasks" data-side-activity="tasks" data-active="false"')
  expect(html).toContain('id="leftPanelMissions" data-side-activity="mission" data-active="true"')
  expect(main).toContain(
    'id: "tasks", icon: "tasks", labelKey: "task.ledger.title", tooltipKey: "activity.tooltip.tasks"',
  )
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
    'id: "tool", icon: "config-tool", labelKey: "tool.title", tooltipKey: "activity.tooltip.tool"',
  )
  expect(main).toContain('id: "skill"')
  expect(main).toContain('icon: "config-skill"')
  expect(main).toContain('labelKey: "skill.title"')
  expect(main).toContain('tooltipKey: "activity.tooltip.skill"')
  expect(main).toContain("appStore.skillMounts?.unmounted_count > 0")
  expect(main).toContain("appStore.skillMounts.unmounted_count")
  expect(main).toContain('data-tone="warn"')
  expect(main).toContain('id: "mcp", icon: "config-mcp", labelKey: "mcp.title", tooltipKey: "activity.tooltip.mcp"')
  expect(main).toContain(
    '<ToolsPanel active={selectedLeftPanelActivity() === "tool"} directory={activeDirectory} compact />',
  )
  expect(main).toContain(
    '<SkillsPanel active={selectedLeftPanelActivity() === "skill"} directory={activeDirectory} compact />',
  )
  expect(main).toContain(
    '<McpPanel active={selectedLeftPanelActivity() === "mcp"} directory={activeDirectory} compact />',
  )
  expect(main).not.toContain('<SkillsPanel active={selectedLeftPanelActivity() === "skill"} compact />')
  expect(main).not.toContain('<McpPanel active={selectedLeftPanelActivity() === "mcp"} compact />')
  expect(icons).toContain("Wrench")
  expect(icons).toContain('"config-tool": { component: Wrench }')
  expect(main).toContain('active={selectedLeftPanelActivity() === "memory"}')
  expect(main).toContain("directory={activeDirectory}")
  expect(icons).toContain("ListTodo")
  expect(icons).toContain("tasks: { component: ListTodo }")
  expect(toolbar).toContain("tooltipKey?: string")
  expect(toolbar).toContain("badge?: () => JSX.Element")
  expect(toolbar).toContain("activeSemantics: SideActivityActiveSemantics")
  expect(toolbar).toContain('aria-current={props.activeSemantics === "current-page" && active() ? "page" : undefined}')
  expect(toolbar).toContain('aria-pressed={props.activeSemantics === "pressed-toggle" ? active() : undefined}')
  expect(toolbar).not.toContain("aria-pressed={active()}")
  expect(main).toContain('activeSemantics="current-page"')
  expect(main).toContain('activeSemantics="pressed-toggle"')
  expect(toolbar).toContain("title={tooltip()}")
  expect(toolbar).toContain("aria-label={tooltip()}")
  expect(toolbar).toContain("side-activity-badge")
  expect(activityCss).toContain(".sidebar-tool-panel .extension-settings-group")
  expect(activityCss).toContain(".left-activity-shell")
  expect(activityCss).toContain(".side-activity-badge")
  expect(activityCss).toContain("flex-direction: row")
  expect(activityCss).toMatch(
    /\.sidebar-tool-panel \.extension-settings-body\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;/s,
  )
  expect(activityCss).toContain(".sidebar-tool-panel .tool-panel-toolbar")
  expect(activityCss).toContain('.sidebar-tool-panel .oc-button[data-ui="tool-panel-action"]')
  expect(activityCss).toContain(".sidebar-tool-panel .config-status-box")
  expect(activityCss).not.toContain(".sidebar-tool-panel .memory-panel")
  expect(activityCss).not.toContain(".sidebar-tool-panel .knowledge-list")
  expect(settingsCss).toContain('.memory-panel[data-compact="true"] .knowledge-toolbar')
  expect(activityCss).toContain(".sidebar-tool-panel .extension-settings-row")
  expect(activityCss).toContain(".sidebar-tool-panel .extension-settings-row .s-row-desc")
  expect(activityCss).toContain("-webkit-line-clamp: 3")
  expect(activityCss).toContain(".sidebar-tool-panel .skill-drop-zone__copy strong")
  for (const key of [
    "activity.tooltip.tasks",
    "activity.tooltip.mission",
    "activity.tooltip.assistant",
    "activity.tooltip.memory",
    "activity.tooltip.tool",
    "activity.tooltip.skill",
    "activity.tooltip.mcp",
    "activity.tooltip.workflow",
    "activity.tooltip.requirements",
    "activity.tooltip.architect",
    "activity.tooltip.goals",
    "activity.tooltip.explorer",
    "activity.tooltip.diff",
    "activity.tooltip.browser",
    "activity.tooltip.screenshots",
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
  expect(panel).toContain('nativeConfirm(t("skill.drop_confirm"')
  expect(panel).toContain("await importSkillArchive(payload.archive.name, await fileToBase64(payload.archive), skillForm.policy, {")
  expect(panel).toContain("await importSkillPackage(payload.sourceName, payload.files, skillForm.policy, {")
  expect(panel).toContain("await importSkillFile(payload.file.name, await payload.file.text(), skillForm.policy, {")
  expect(panel).toContain("handleAgentDrop")
  expect(panel).toContain("droppedSkillImportPayload")
  expect(panel).toContain("await importAndMountSkill(agent")
  expect(panel).toContain('event.dataTransfer?.getData("application/x-opencorvus-skill")')
  expect(panel).toContain("agent-skill-matrix")
  expect(panel).toContain('data-view="agent-tabs"')
  expect(panel).toContain('data-ui="agent-skill-tabs"')
  expect(panel).toContain('data-ui="agent-skill-pool"')
  expect(panel).toContain("handleSkillPoolContextMenu")
  expect(panel).toContain("await handleMount(agent.name, skill.name)")
  expect(panel).toContain("mounted_agents?: string[]")
  expect(panel).toContain("unmounted?: boolean")
  expect(panel).toContain('class="tool-panel-toolbar"')
  expect(panel).toContain("<PanelActionButton compact")
  expect(panel).toContain('class="skill-drop-zone"')
  expect(service).toContain('apiJson(directoryOwnedPath("skill/import-file", options)')
  expect(service).toContain('apiJson(skillMountPath("skill/mount", options)')
  expect(service).toContain('apiJson(skillMountPath("skill/unmount", options)')
  expect(service).toContain('apiJson(skillMountPath("skill/import-and-mount", options)')
  expect(service).toContain("importSkillPackage")
  expect(service).toContain("importSkillArchive")
  expect(en).toContain('"skill.mount.matrix"')
  expect(en).toContain('"skill.mount.unmounted_count"')
  expect(zh).toContain('"skill.mount.matrix"')
  expect(zh).toContain('"skill.mount.unmounted_count"')
  expect(en).toContain("SKILL.md file, skill folder, or .zip")
  expect(zh).toContain("SKILL.md、skill 文件夹或 .zip")
})

test("skill panel surfaces duplicate skill locations from installed skill metadata", () => {
  const panel = read("src/components/settings/SkillMarketPanel.tsx")
  const settingsCss = read("src/styles/surfaces/settings.css")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(panel).toContain("duplicate_locations?: string[]")
  expect(panel).toContain("function skillDuplicateLocations")
  expect(panel).toContain('<SettingsPill tone="warn" title={skillDuplicateTitle(item)}>')
  expect(panel).toContain("title={skillDuplicateTitle(item)}")
  expect(panel).toContain('t("skill.duplicate")')
  expect(panel).toContain('t("skill.duplicate_locations_title"')
  expect(settingsCss).toContain('.s-pill[data-tone="warn"]')
  expect(en).toContain('"skill.duplicate"')
  expect(en).toContain('"skill.duplicate_locations_title"')
  expect(zh).toContain('"skill.duplicate"')
  expect(zh).toContain('"skill.duplicate_locations_title"')
})
