import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHAT_BUBBLE_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "ChatBubble.tsx"), "utf8")
const CARD_TODO_SUMMARY_TSX = readFileSync(
  join(import.meta.dir, "..", "src", "components", "CardTodoSummary.tsx"),
  "utf8",
)
const CARD_HEADER_CHROME_TSX = readFileSync(
  join(import.meta.dir, "..", "src", "components", "CardHeaderChrome.tsx"),
  "utf8",
)
const CHAT_BUBBLE_CSS = readFileSync(
  join(import.meta.dir, "..", "src", "styles", "surfaces", "chat-bubble.css"),
  "utf8",
)

test("ChatBubble uses one unified IM bubble for user and agent cards with restorable folding", () => {
  expect(CHAT_BUBBLE_TSX).toContain("data-align={align()}")
  expect(CHAT_BUBBLE_TSX).toContain('import { cardExpanded, setCardExpanded } from "../store/conversation-ui"')
  expect(CHAT_BUBBLE_TSX).toContain("const defaultExpanded = () => defaultExpandedForNode(props.node)")
  expect(CHAT_BUBBLE_TSX).toContain(
    "const expanded = () => cardExpanded(props.node.id, props.node.status, defaultExpanded())",
  )
  expect(CHAT_BUBBLE_TSX).toContain("const canBubbleSurfaceToggle = (event: MouseEvent) =>")
  expect(CHAT_BUBBLE_TSX).toContain("onDblClick={(event) => {")
  expect(CHAT_BUBBLE_TSX).toContain("toggleExpanded()")
  expect(CHAT_BUBBLE_TSX).not.toContain('role="button"')
  expect(CHAT_BUBBLE_TSX).not.toContain("tabindex={0}")
  expect(CHAT_BUBBLE_TSX).toContain('import { Button } from "./ui/Button"')
  expect(CHAT_BUBBLE_TSX).toContain("<Button")
  expect(CHAT_BUBBLE_TSX).toContain('class="chat-bubble__head-main"')
  expect(CHAT_BUBBLE_TSX).toContain('data-ui="chat-bubble-head-main"')
  expect(CHAT_BUBBLE_TSX).toContain('variant="ghost"')
  expect(CHAT_BUBBLE_TSX).toContain('size="mini"')
  expect(CHAT_BUBBLE_TSX).toContain('tone="neutral"')
  expect(CHAT_BUBBLE_TSX).toContain("aria-expanded={expanded()}")
  expect(CHAT_BUBBLE_TSX).toContain("onClick={toggleExpanded}")
  expect(CHAT_BUBBLE_TSX).toContain('<span class="chat-bubble__identity" data-align={align()}>')
  expect(CHAT_BUBBLE_TSX).toContain(
    '<Avatar role={normalizedRole()} status={props.node.status} class="chat-bubble__head-avatar" />',
  )
  expect(CHAT_BUBBLE_TSX).not.toContain('class="card__spinner"')
  expect(CHAT_BUBBLE_TSX).not.toContain("card__badge--running")
  expect(CHAT_BUBBLE_TSX).not.toContain("statusBadge")
  expect(CHAT_BUBBLE_TSX).not.toContain('class="card__copy"')
  expect(CHAT_BUBBLE_TSX).not.toContain("chat-bubble__avatar-slot")
  expect(CHAT_BUBBLE_TSX).toContain('import { currentTraceDirectory } from "../services/trace-directory"')
  expect(CHAT_BUBBLE_TSX).toContain("directory={currentTraceDirectory()}")
  expect(CHAT_BUBBLE_TSX).toContain('import { CardDurationChip, CardHeaderChrome } from "./CardHeaderChrome"')
  expect(CHAT_BUBBLE_TSX).toContain("<AgentSessionReplyBox")
  expect(CHAT_BUBBLE_TSX).toContain("collapsedActivityPreviewText")
  expect(CHAT_BUBBLE_TSX).toContain("collectLatestActivityText")
  expect(CHAT_BUBBLE_TSX).toContain('class="card__collapsed-preview"')
  expect(CHAT_BUBBLE_TSX).toContain("collectTodoSummary")
  expect(CHAT_BUBBLE_TSX).toContain('import { CardTodoSummary } from "./CardTodoSummary"')
  expect(CHAT_BUBBLE_TSX).toContain("<CardTodoSummary summary={summary()} />")
  expect(CARD_TODO_SUMMARY_TSX).toContain('class="card__todo-summary"')
  expect(CARD_TODO_SUMMARY_TSX).toContain('class="card__todo-progress"')
  expect(CHAT_BUBBLE_TSX).toContain("if (expanded()) return null")
  expect(CHAT_BUBBLE_TSX).toContain("collectTodoSummary(props.node)")
  expect(CHAT_BUBBLE_TSX).not.toContain("cardMessageSegments(props.node)")
  expect(CHAT_BUBBLE_TSX).not.toContain('class="chat-bubble__flow"')
  expect(CHAT_BUBBLE_TSX).not.toContain('class="chat-bubble__flow-avatar"')
  expect(CHAT_BUBBLE_TSX).toContain("function ChatBubbleChild")
  expect(CHAT_BUBBLE_TSX).toContain("storeCardNode(props.childID, props.parentID)")
  expect(CHAT_BUBBLE_TSX).not.toContain("const child = cardTreeStore.cards[childID]!")
  expect(CHAT_BUBBLE_CSS).not.toContain('.chat-bubble[data-align="right"] {\n  background')
  expect(CHAT_BUBBLE_CSS).not.toMatch(/\.chat-bubble\[data-align="right"\]\s*\{[^}]*color:/)
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-kind="agent"] .chat-bubble')
  expect(CHAT_BUBBLE_CSS).toContain("border-left: calc(3px * var(--ui-scale)) solid var(--card-stage);")
  expect(CHAT_BUBBLE_CSS).toMatch(
    /\.chat-bubble-row\[data-kind="agent"\] \.chat-bubble\s*\{[^}]*background: var\(--card-bg-0\);/,
  )
  expect(CHAT_BUBBLE_CSS).toMatch(
    /\.chat-bubble-row\[data-kind="agent"\] \.chat-bubble:hover\s*\{[^}]*background: var\(--card-bg-0\);/,
  )
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__identity")
  expect(CHAT_BUBBLE_CSS).toContain(
    ".chat-bubble__identity {\n  min-width: 0;\n  flex: 1 1 auto;\n  display: flex;\n  align-items: center;",
  )
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__identity-copy")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__title-line")
  expect(CHAT_BUBBLE_CSS).toContain("min-height: calc(36px * var(--ui-scale));")
  expect(CHAT_BUBBLE_CSS).toContain("font-size: calc(15px * var(--ui-scale));")
  expect(CHAT_BUBBLE_CSS).toContain("font-weight: var(--ui-font-weight-strong);")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble__head[data-align="right"] .chat-bubble__title-row')
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="user"] .chat-bubble__title-row')
  expect(CHAT_BUBBLE_CSS).toContain('.oc-button[data-ui="chat-bubble-head-main"].chat-bubble__head-main')
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__head-main:focus-visible")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="user"] .chat-bubble__identity {\n  display: flex;')
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="user"] .chat-bubble__actions')
  expect(CHAT_BUBBLE_TSX).toContain("<CardHeaderChrome")
  expect(CHAT_BUBBLE_TSX).toContain('actionsClass="chat-bubble__actions"')
  expect(CHAT_BUBBLE_TSX).not.toContain('class="card__meta-actions"')
  expect(CHAT_BUBBLE_TSX).not.toContain('class="card__control-actions"')
  expect(CARD_HEADER_CHROME_TSX.indexOf('class="card__meta-actions"')).toBeLessThan(
    CARD_HEADER_CHROME_TSX.indexOf('class="card__control-actions"'),
  )
  expect(CHAT_BUBBLE_CSS).toContain("max-width: min(70%, calc(520px * var(--ui-scale)));")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="user"] .chat-bubble__head-avatar')
  expect(CHAT_BUBBLE_CSS).not.toContain(".chat-bubble__flow")
  expect(CHAT_BUBBLE_CSS).not.toContain(".chat-bubble__flow-link")
  expect(CHAT_BUBBLE_CSS).not.toContain(".chat-bubble__flow-avatar")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble--collapsed")
  expect(CHAT_BUBBLE_CSS).toContain("cursor: pointer;")
  expect(CHAT_BUBBLE_CSS).toContain("user-select: none;")
  expect(CHAT_BUBBLE_CSS).not.toMatch(/border-inline-(?:start|end)/)
  expect(CHAT_BUBBLE_CSS).not.toContain("var(--card-system-rail)")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-avatar")
})

test("ChatBubble keeps collapsed preview and TODO summary inside its disclosure button", () => {
  const disclosureOpen = CHAT_BUBBLE_TSX.indexOf('data-ui="chat-bubble-head-main"')
  const collapsedPreview = CHAT_BUBBLE_TSX.indexOf('class="card__collapsed-preview"', disclosureOpen)
  const todoSummary = CHAT_BUBBLE_TSX.indexOf("<CardTodoSummary summary={summary()} />", disclosureOpen)
  const disclosureClose = CHAT_BUBBLE_TSX.indexOf("</Button>", disclosureOpen)
  const actionRail = CHAT_BUBBLE_TSX.indexOf("<CardHeaderChrome", disclosureOpen)

  expect(disclosureOpen).toBeGreaterThan(0)
  expect(collapsedPreview).toBeGreaterThan(disclosureOpen)
  expect(todoSummary).toBeGreaterThan(collapsedPreview)
  expect(disclosureClose).toBeGreaterThan(todoSummary)
  expect(actionRail).toBeGreaterThan(disclosureClose)
  expect(CHAT_BUBBLE_TSX).not.toContain('<div class="card__preview-row">')
})

test("ChatBubble action controls use Button primitives", () => {
  for (const dataUi of ["card-error-reason", "card-trace", "card-agent-cancel", "card-rewind"]) {
    expect(CARD_HEADER_CHROME_TSX).toContain(`data-ui="${dataUi}"`)
    expect(CHAT_BUBBLE_TSX).not.toContain(`data-ui="${dataUi}"`)
  }
  expect(CARD_HEADER_CHROME_TSX).toContain('import { Button } from "./ui/Button"')

  for (const retired of [
    'class="card__error-reason"',
    'class="card__trace"',
    'class="card__agent-cancel"',
    'class="card__rewind"',
  ]) {
    expect(CHAT_BUBBLE_TSX).not.toContain(retired)
  }
})
