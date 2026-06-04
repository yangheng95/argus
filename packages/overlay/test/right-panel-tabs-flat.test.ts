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
    expect(html).not.toContain('data-panel-tab=')
    expect(main).not.toContain("RightPanelTabs")
    expect(main).not.toContain("rightPanelTab")
    expect(inspectorCss).not.toContain(".sections-tabs")
    expect(inspectorCss).not.toContain('[data-ui="right-tab"]')
    expect(inspectorCss).not.toContain("[data-panel-tab")
  })

  test("activity buttons are square icon rail controls", () => {
    const css = readText("src/styles/surfaces/activity.css")
    const toolbar = readText("src/components/SideActivityToolbar.tsx")
    const buttonBody = ruleBody(css, '.side-activity-toolbar [data-ui="side-activity-button"]')

    expect(toolbar).toContain('data-ui="side-activity-button"')
    expect(toolbar).toContain("title={label()}")
    expect(toolbar).toContain("aria-label={label()}")
    expect(toolbar).toContain("<Icon name={activity.icon}")
    expect(buttonBody).toMatch(/border-radius:\s*0\b/)
    expect(buttonBody).toContain("width:")
    expect(buttonBody).toContain("height:")
  })
})
