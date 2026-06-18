import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

describe("card expand and collapse contract", () => {
  test("Card uses one explicit toggle write from header and safe surface double-clicks", () => {
    const src = read("src/components/Card.tsx")
    expect(src).toContain("import { cardExpanded, setCardExpanded }")
    expect(src).not.toContain("toggleCard")
    expect(src).toContain("const setExpanded = (value: boolean) =>")
    expect(src).toContain("const toggleExpanded = () =>")
    expect(src).toContain("setCardExpanded(props.node.id, value, props.node.status)")
    expect(src).toContain("setExpanded(!expanded())")
    expect(src).toContain("const canCardSurfaceToggle = (event: MouseEvent) =>")
    expect(src).toContain('props.node.kind === "tool" && expanded()')
    expect(src).not.toContain("props.depth === 0 ||")
    expect(src).toContain('target.closest(".card") !== articleRef')
    expect(src).toContain('window.getSelection()?.type === "Range"')
    expect(src).toContain("onDblClick={(event) =>")
    expect(src).toContain("if (!canCardSurfaceToggle(event)) return")
    expect(src).toContain("toggleExpanded()")
  })

  test("Card surface toggle ignores controls and nested cards on the double-click path", () => {
    const src = read("src/components/Card.tsx")
    expect(src).not.toContain("canCardSurfaceCollapse")
    for (const selector of [
      '"button"',
      '"a"',
      '"input"',
      '"textarea"',
      '"select"',
      '"summary"',
      "\"[contenteditable='true']\"",
      "\"[role='button']\"",
      "\"[role='menuitem']\"",
      "\"[role='checkbox']\"",
      "\"[role='tab']\"",
      "\"[role='textbox']\"",
      "\"[data-card-click-ignore='true']\"",
      "\"[data-card-dblclick-ignore='true']\"",
    ]) {
      expect(src).toContain(selector)
    }
  })

  test("CardHeader single click and keyboard toggle both directions", () => {
    const src = read("src/components/CardHeader.tsx")
    expect(src).toContain("onToggle: () => void")
    expect(src).toContain('class="card__head-main"')
    expect(src).toContain("aria-expanded={props.collapsible ? props.expanded : undefined}")
    expect(src).toContain("if (!props.collapsible) return")
    expect(src).toContain("props.onToggle()")
    expect(src).not.toContain('role={props.collapsible ? "button" : undefined}')
    expect(src).not.toContain("tabindex={props.collapsible ? 0 : undefined}")
    expect(src).not.toContain("props.expanded) return")
    expect(src).not.toContain("card__chevron")
  })

  test("child execution cards do not expose per-session model settings", () => {
    const src = read("src/components/Card.tsx")
    expect(src).not.toContain("openSessionAgentModels")
    expect(src).toContain("onAgentModelSettings={undefined}")
  })

  test("GoalWorkflowGroup follows the same header toggle contract", () => {
    const src = read("src/components/GoalWorkflowGroup.tsx")
    expect(src).toContain("import { cardExpanded, setCardExpanded }")
    expect(src).not.toContain("toggleCard")
    expect(src).toContain("const toggleExpanded = () =>")
    expect(src).toContain("setCardExpanded(cardKey(), !expanded(), status())")
    expect(src).not.toContain("onDblClick")
    expect(src).toContain("<button")
    expect(src).toContain('type="button"')
    expect(src).toContain("onClick={toggleExpanded}")
    expect(src).toContain('class="gwg-header"')
    expect(src).toContain("aria-expanded={expanded()}")
    expect(src).not.toContain('role="button"')
    expect(src).not.toContain('tabindex="0"')
    expect(src).not.toContain("onKeyDown={(e) =>")
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

  test("agent bubbles and structured execution cards share one conversation width source", () => {
    const cardCss = read("src/styles/surfaces/card.css")
    const bubbleCss = read("src/styles/surfaces/chat-bubble.css")
    const conversationCss = read("src/styles/surfaces/conversation.css")

    expect(conversationCss).toContain("--conversation-card-inline-size: 100%;")
    expect(conversationCss).toContain("width: var(--conversation-card-inline-size);")
    expect(cardCss).toContain("width: var(--conversation-card-inline-size);")
    expect(bubbleCss).toContain("width: var(--conversation-card-inline-size);")
    expect(bubbleCss).toContain("width: 100%;")
    expect(bubbleCss).not.toContain("--card-sticky-inline-size")
    expect(cardCss).not.toContain("width: min(84%, calc(980px * var(--ui-scale)));")
    expect(bubbleCss).not.toContain("width: min(74%, calc(720px * var(--ui-scale)));")
    expect(conversationCss).not.toContain("max-width: min(100%, calc(1040px * var(--ui-scale)));")
  })
})
