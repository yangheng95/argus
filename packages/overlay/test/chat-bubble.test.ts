import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHAT_BUBBLE_TSX = readFileSync(
  join(import.meta.dir, "..", "src", "components", "ChatBubble.tsx"),
  "utf8",
)
const CHAT_BUBBLE_CSS = readFileSync(
  join(import.meta.dir, "..", "src", "styles", "surfaces", "chat-bubble.css"),
  "utf8",
)

test("ChatBubble uses one unified IM bubble for user and agent cards with restorable folding", () => {
  expect(CHAT_BUBBLE_TSX).toContain('data-align={align()}')
  expect(CHAT_BUBBLE_TSX).toContain('import { cardExpanded, setCardExpanded } from "../store/conversation-ui"')
  expect(CHAT_BUBBLE_TSX).toContain("const defaultExpanded = () => defaultExpandedForNode(props.node)")
  expect(CHAT_BUBBLE_TSX).toContain("const expanded = () => cardExpanded(props.node.id, props.node.status, defaultExpanded())")
  expect(CHAT_BUBBLE_TSX).toContain("const canBubbleSurfaceToggle = (event: MouseEvent) =>")
  expect(CHAT_BUBBLE_TSX).toContain("onDblClick={(event) => {")
  expect(CHAT_BUBBLE_TSX).toContain("toggleExpanded()")
  expect(CHAT_BUBBLE_TSX).toContain('<div class="chat-bubble__identity" data-align={align()}>')
  expect(CHAT_BUBBLE_TSX).toContain('<Avatar role={normalizedRole()} status={props.node.status} class="chat-bubble__head-avatar" />')
  expect(CHAT_BUBBLE_TSX).not.toContain("chat-bubble__avatar-slot")
  expect(CHAT_BUBBLE_TSX).toContain('<TracePanel sessionID={traceSessionID()!} onClose={() => setTraceOpen(false)} />')
  expect(CHAT_BUBBLE_TSX).toContain("<AgentSessionReplyBox")
  expect(CHAT_BUBBLE_TSX).not.toContain("card__collapsed-preview")
  expect(CHAT_BUBBLE_TSX).not.toContain("card__todo-progress")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble[data-align="right"]')
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__identity")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__title-line")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble__head[data-align=\"right\"] .chat-bubble__title-row")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble--collapsed")
  expect(CHAT_BUBBLE_CSS).toContain("border-inline-start: calc(3px * var(--ui-scale)) solid color-mix(in srgb, var(--card-stage, var(--card-stage-info)) 84%, transparent);")
  expect(CHAT_BUBBLE_CSS).toContain("border-inline-end: calc(3px * var(--ui-scale)) solid color-mix(in srgb, var(--card-stage-user) 84%, transparent);")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-avatar")
})
