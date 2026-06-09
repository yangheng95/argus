import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHAT_BUBBLE_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "ChatBubble.tsx"), "utf8")

test("ChatBubble inlines child content instead of wrapping child cards in nested bubbles", () => {
  expect(CHAT_BUBBLE_TSX).toContain("const child = () => storeCardNode(props.childID, props.parentID)")
  expect(CHAT_BUBBLE_TSX).toContain('<Match when={child().kind === "message"}>')
  expect(CHAT_BUBBLE_TSX).toContain(
    '<CardParts parts={child().parts} depth={props.depth + 1} streaming={child().status === "running"} />',
  )
  expect(CHAT_BUBBLE_TSX).toContain('<Match when={child().kind === "agent"}>')
  expect(CHAT_BUBBLE_TSX).toContain("<ChatBubbleAgentChildBody child={child()} depth={props.depth} />")
  expect(CHAT_BUBBLE_TSX).toContain('<Match when={child().kind === "integrity" && child().integrity}>')
  expect(CHAT_BUBBLE_TSX).toContain(
    'throw new Error(`ChatBubble: unsupported child kind "${props.child.kind}" for ${props.parentID}`)',
  )
  expect(CHAT_BUBBLE_TSX).not.toContain("<ChatBubble ")
})

test("ChatBubble renders integrity reviewer agent children without requiring a consensus payload", () => {
  expect(CHAT_BUBBLE_TSX).toContain("function ChatBubbleAgentChildBody")
  expect(CHAT_BUBBLE_TSX).toContain('class="chat-bubble__child"')
  expect(CHAT_BUBBLE_TSX).toContain("data-card-id={child().id}")
  expect(CHAT_BUBBLE_TSX).toContain("<ReviewStreamSection reviewStream={props.child.reviewStream!} />")
  expect(CHAT_BUBBLE_TSX).toContain(
    '<CardParts parts={props.child.parts} depth={props.depth + 1} streaming={props.child.status === "running"} />',
  )
  expect(CHAT_BUBBLE_TSX).not.toContain('child().kind === "agent" && child().integrity')
})
