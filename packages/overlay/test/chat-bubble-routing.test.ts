import { expect, test } from "bun:test"

import type { CardNode } from "../src/store/card-tree"
import { bubbleAlign, renderAsBubble } from "../src/utils/chat-bubble"

function card(partial: Partial<CardNode> & Pick<CardNode, "id" | "kind" | "title">): CardNode {
  return {
    parts: [],
    childIDs: [],
    time: 1,
    ...partial,
  } as CardNode
}

test("renderAsBubble only routes message and agent cards into ChatBubble", () => {
  expect(renderAsBubble(card({ id: "m", kind: "message", title: "Message" }))).toBe(true)
  expect(renderAsBubble(card({ id: "a", kind: "agent", title: "Agent" }))).toBe(true)
  expect(renderAsBubble(card({ id: "s", kind: "step", title: "Step" }))).toBe(false)
  expect(renderAsBubble(card({ id: "p", kind: "phase", title: "Phase" }))).toBe(false)
  expect(renderAsBubble(card({ id: "t", kind: "tool", title: "Tool" }))).toBe(false)
  expect(renderAsBubble(card({ id: "i", kind: "integrity", title: "Integrity" }))).toBe(false)
})

test("bubbleAlign uses the normalized effective role instead of kind or stage heuristics", () => {
  expect(
    bubbleAlign(
      card({
        id: "user-message",
        kind: "message",
        title: "User",
        role: "user",
      }),
    ),
  ).toBe("right")
  expect(
    bubbleAlign(
      card({
        id: "system-message",
        kind: "message",
        title: "System",
        role: "system",
      }),
    ),
  ).toBe("left")
  expect(
    bubbleAlign(
      card({
        id: "executor-session",
        kind: "agent",
        title: "Executor",
        stage: "executor",
      }),
    ),
  ).toBe("left")
  expect(
    bubbleAlign(
      card({
        id: "normalized-stage",
        kind: "agent",
        title: "Design",
        stage: "frontend_design",
      }),
    ),
  ).toBe("left")
})
