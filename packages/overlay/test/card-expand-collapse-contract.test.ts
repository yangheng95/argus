import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

describe("card expand and collapse contract", () => {
  test("Card uses a single explicit header toggle write", () => {
    const src = read("src/components/Card.tsx")
    expect(src).toContain("import { cardExpanded, setCardExpanded }")
    expect(src).not.toContain("toggleCard")
    expect(src).toContain("const setExpanded = (value: boolean) =>")
    expect(src).toContain("const toggleExpanded = () =>")
    expect(src).toContain("setCardExpanded(props.node.id, value, props.node.status)")
    expect(src).toContain("setExpanded(!expanded())")
  })

  test("Card has no double-click collapse path competing with header toggle", () => {
    const src = read("src/components/Card.tsx")
    expect(src).not.toContain("onDblClick")
    expect(src).not.toContain("canCardSurfaceCollapse")
  })

  test("CardHeader single click and keyboard toggle both directions", () => {
    const src = read("src/components/CardHeader.tsx")
    expect(src).toContain("onToggle: () => void")
    expect(src).toContain("if (!props.collapsible) return;")
    expect(src).toContain("props.onToggle();")
    expect(src).not.toContain("props.expanded) return")
    expect(src).not.toContain("card__chevron")
  })

  test("GoalWorkflowGroup follows the same header toggle contract", () => {
    const src = read("src/components/GoalWorkflowGroup.tsx")
    expect(src).toContain("import { cardExpanded, setCardExpanded }")
    expect(src).not.toContain("toggleCard")
    expect(src).toContain("const toggleExpanded = () =>")
    expect(src).toContain("setCardExpanded(cardKey(), !expanded(), status())")
    expect(src).not.toContain("onDblClick")
    expect(src).toContain("onClick={toggleExpanded}")
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
