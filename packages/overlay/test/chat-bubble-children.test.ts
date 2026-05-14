import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHAT_BUBBLE_TSX = readFileSync(
  join(import.meta.dir, "..", "src", "components", "ChatBubble.tsx"),
  "utf8",
)

test("ChatBubble inlines child content instead of wrapping child cards in nested bubbles", () => {
  expect(CHAT_BUBBLE_TSX).toContain('const child = () => storeCardNode(props.childID, props.parentID)')
  expect(CHAT_BUBBLE_TSX).toContain('<Match when={child().kind === "message"}>')
  expect(CHAT_BUBBLE_TSX).toContain('<CardParts parts={child().parts} depth={props.depth + 1} />')
  expect(CHAT_BUBBLE_TSX).toContain('<Match when={child().kind === "agent" && child().integrity}>')
  expect(CHAT_BUBBLE_TSX).toContain('<Match when={child().kind === "integrity" && child().integrity}>')
  expect(CHAT_BUBBLE_TSX).toContain('throw new Error(`ChatBubble: unsupported child kind "${props.child.kind}" for ${props.parentID}`)')
  expect(CHAT_BUBBLE_TSX).not.toContain("<ChatBubble ")
})
