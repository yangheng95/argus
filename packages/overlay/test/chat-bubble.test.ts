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

test("ChatBubble keeps the surface contract for alignment, trace, reply, and collapse controls", () => {
  expect(CHAT_BUBBLE_TSX).toContain('data-align={align()}')
  expect(CHAT_BUBBLE_TSX).toContain('<Avatar role={normalizedRole()} status={props.node.status} />')
  expect(CHAT_BUBBLE_TSX).toContain('<TracePanel sessionID={traceSessionID()!} onClose={() => setTraceOpen(false)} />')
  expect(CHAT_BUBBLE_TSX).toContain("<AgentSessionReplyBox")
  expect(CHAT_BUBBLE_TSX).toContain('role={collapsible() ? "button" : undefined}')
  expect(CHAT_BUBBLE_TSX).toContain('if (event.key === "Enter" || event.key === " ")')
  expect(CHAT_BUBBLE_TSX).toContain("onDblClick={(event) => {")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble[data-align="right"]')
  expect(CHAT_BUBBLE_CSS).toContain(".chat-avatar")
})
