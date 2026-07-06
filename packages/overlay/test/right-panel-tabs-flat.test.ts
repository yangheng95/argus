import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function ruleBody(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(styles)
  if (!head) throw new Error(`selector ${selector} not found`)
  const open = head.index + head[0].length - 1
  const close = styles.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return styles.slice(open + 1, close)
}

describe("right side activity toolbar replaces horizontal panel tabs", () => {
  test("old right tab mount and tab selectors are gone", () => {
    const html = readText("src/index.html")
    const main = readText("src/main.tsx")
    const inspectorCss = readText("src/styles/surfaces/inspector.css")

    expect(html).not.toContain('id="solidRightPanelTabs"')
    expect(html).not.toContain("data-panel-tab=")
    expect(main).not.toContain("RightPanelTabs")
    expect(main).not.toContain("rightPanelTab")
    expect(inspectorCss).not.toContain(".sections-tabs")
    expect(html).not.toContain("sections-tab-body")
    expect(inspectorCss).not.toContain("sections-tab-body")
    expect(inspectorCss).not.toContain('[data-ui="right-tab"]')
    expect(inspectorCss).not.toContain("[data-panel-tab")
  })

  test("activity buttons are square icon rail controls", () => {
    const css = readText("src/styles/surfaces/activity.css")
    const toolbar = readText("src/components/SideActivityToolbar.tsx")
    const buttonBody = ruleBody(css, '.side-activity-toolbar [data-ui="side-activity-button"]')
    const toolbarBody = ruleBody(css, ".side-activity-toolbar")
    const itemGroupBody = ruleBody(css, ".side-activity-toolbar__items,\n.side-activity-toolbar__trailing")

    expect(toolbar).toContain('data-ui="side-activity-button"')
    expect(toolbar).toContain("tooltipKey?: string")
    expect(toolbar).toContain("title={tooltip()}")
    expect(toolbar).toContain("aria-label={tooltip()}")
    expect(toolbar).toContain("<Icon name={activity.icon}")
    expect(buttonBody).toMatch(/border-radius:\s*0\b/)
    expect(buttonBody).toContain("width:")
    expect(buttonBody).toContain("height:")
    expect(toolbarBody).toMatch(/gap:\s*0\b/)
    expect(toolbarBody).toMatch(/padding:\s*0\b/)
    expect(itemGroupBody).toMatch(/gap:\s*0\b/)
  })

  test("right toolbar popup panels use responsive center-workbench sizing", () => {
    const tokens = readText("src/styles/tokens/design-language.css")
    const workspace = readText("src/styles/surfaces/workspace.css")
    const main = readText("src/main.tsx")
    const openBody = ruleBody(workspace, '.center-workbench-view[data-open="true"]')

    expect(tokens).not.toContain("--ui-right-toolbar-panel-initial-max-width")
    expect(openBody).toContain("min-width: 0;")
    expect(openBody).not.toContain("flex-shrink: 0;")
    expect(workspace).not.toContain('data-initial-width-capped="true"')
    expect(workspace).not.toContain("data-initial-width-capped")
    expect(workspace).not.toContain("max-width: calc(420px")
    expect(main).not.toContain("const RIGHT_TOOLBAR_INITIAL_WIDTH_PANELS")
    for (const panel of [
      '"requirements"',
      '"architect"',
      '"goals"',
      '"explorer"',
      '"diff"',
      '"browser"',
      '"screenshots"',
      '"notifications"',
    ]) {
      expect(main).toContain(panel)
    }
    expect(main).not.toContain('"inspector"')
    expect(main).not.toContain("dataset.initialWidthCapped")
    expect(main).not.toContain("clearCenterWorkbenchPanelInitialWidthCap")
    expect(main).not.toContain("--ui-sections-width")
    expect(main).not.toContain("rightPanelCollapsed")
    expect(main).not.toContain("sectionsWidth")
  })
})
