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

test("ChatBubble keeps transcript messages visible inside one flat card surface", () => {
  expect(CHAT_BUBBLE_TSX).toContain('data-align={align()}')
  expect(CHAT_BUBBLE_TSX).toContain('<Avatar role={normalizedRole()} status={props.node.status} />')
  expect(CHAT_BUBBLE_TSX).toContain('<TracePanel sessionID={traceSessionID()!} onClose={() => setTraceOpen(false)} />')
  expect(CHAT_BUBBLE_TSX).toContain("<AgentSessionReplyBox")
  expect(CHAT_BUBBLE_TSX).toContain("const expanded = () => true")
  expect(CHAT_BUBBLE_TSX).not.toContain("cardExpanded")
  expect(CHAT_BUBBLE_TSX).not.toContain("setCardExpanded")
  expect(CHAT_BUBBLE_TSX).not.toContain("collapsible")
  expect(CHAT_BUBBLE_TSX).not.toContain("card__collapsed-preview")
  expect(CHAT_BUBBLE_TSX).not.toContain("card__todo-progress")
  expect(CHAT_BUBBLE_TSX).not.toContain("onDblClick")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble[data-align="right"]')
  expect(CHAT_BUBBLE_CSS).toContain("border-inline-start: calc(3px * var(--ui-scale)) solid var(--card-stage, var(--card-stage-info));")
  expect(CHAT_BUBBLE_CSS).toContain("border-inline-end: calc(3px * var(--ui-scale)) solid var(--card-stage-user);")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-avatar")
})
