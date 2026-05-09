import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

describe("card expand and collapse contract", () => {
  test("Card uses explicit expand/collapse writes instead of click toggle", () => {
    const src = read("src/components/Card.tsx")
    expect(src).toContain("import { cardExpanded, setCardExpanded }")
    expect(src).not.toContain("toggleCard")
    expect(src).toContain("const expand = () =>")
    expect(src).toContain("const collapse = () =>")
    expect(src).toContain("setCardExpanded(props.node.id, true, props.node.status)")
    expect(src).toContain("setCardExpanded(props.node.id, false, props.node.status)")
  })

  test("Card double-click collapse ignores controls and nested cards", () => {
    const src = read("src/components/Card.tsx")
    expect(src).toContain("onDblClick={(event) =>")
    expect(src).toContain('target.closest(".card") !== articleRef')
    for (const selector of [
      '"button"',
      '"a"',
      '"input"',
      '"textarea"',
      '"select"',
      '"summary"',
      '"[contenteditable=\'true\']"',
      '"[role=\'button\']"',
      '"[role=\'menuitem\']"',
      '"[role=\'textbox\']"',
      '"[data-card-dblclick-ignore=\'true\']"',
    ]) {
      expect(src).toContain(selector)
    }
  })

  test("CardHeader single click expands collapsed cards only", () => {
    const src = read("src/components/CardHeader.tsx")
    expect(src).toContain("onExpand: () => void")
    expect(src).toContain("if (!props.collapsible || props.expanded) return;")
    expect(src).toContain("props.onExpand();")
    expect(src).not.toContain("onToggle")
    expect(src).not.toContain("card__chevron")
  })

  test("GoalWorkflowGroup follows the same click-expand double-click-collapse contract", () => {
    const src = read("src/components/GoalWorkflowGroup.tsx")
    expect(src).toContain("import { cardExpanded, setCardExpanded }")
    expect(src).not.toContain("toggleCard")
    expect(src).toContain("const expand = () =>")
    expect(src).toContain("const collapse = () =>")
    expect(src).toContain("onDblClick={(event) =>")
    expect(src).toContain("onClick={expand}")
    expect(src).not.toContain("gwg-chevron")
  })

  test("explicit collapse controls are removed from source and styles", () => {
    const card = read("src/components/Card.tsx")
    const goal = read("src/components/GoalWorkflowGroup.tsx")
    const css = read("src/styles/surfaces/card.css")
    const inspector = read("src/styles/surfaces/inspector.css")
    const en = read("src/i18n/en-US.json")
    const zh = read("src/i18n/zh-CN.json")
    for (const source of [card, goal, css, inspector, en, zh]) {
      expect(source).not.toContain("card__collapse-toggle")
      expect(source).not.toContain("card.collapse")
      expect(source).not.toContain("card.collapse_title")
    }
    expect(css).not.toContain(".card__chevron")
    expect(goal).not.toContain("gwg-chevron")
    expect(inspector).not.toContain(".gwg-chevron")
  })
})
