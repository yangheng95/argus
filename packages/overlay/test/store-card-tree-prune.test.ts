import { expect, test } from "bun:test"

import { cardTreeStore, pruneCardsAfterCursor, setCardTreeStore, type CardNode } from "../src/store/card-tree"
import { resetWriter } from "../src/services/tree-writer"

function card(partial: Partial<CardNode> & Pick<CardNode, "id" | "kind" | "title" | "time">): CardNode {
  return {
    parts: [],
    childIDs: [],
    ...partial,
  } as CardNode
}

test("pruneCardsAfterCursor drops dangling childIDs from surviving parent cards", () => {
  resetWriter()
  try {
    const sessionID = "requirements:session:ses_parent"
    const interactionID = "interaction:question-1"
    const session = card({
      id: sessionID,
      kind: "agent",
      title: "Requirements",
      stage: "requirements",
      time: 100,
      childIDs: [interactionID],
    })
    const interaction = card({
      id: interactionID,
      kind: "message",
      title: "Question",
      role: "assistant",
      time: 200,
      parts: [{ type: "interaction-question", prompt: "Need input" }],
    })

    setCardTreeStore("order", [sessionID])
    setCardTreeStore("cards", {
      [sessionID]: session,
      [interactionID]: interaction,
    })
    const before = cardTreeStore.visibleVersion

    pruneCardsAfterCursor(150)

    expect(cardTreeStore.order).toEqual([sessionID])
    expect(cardTreeStore.cards[interactionID]).toBeUndefined()
    expect(cardTreeStore.cards[sessionID]?.childIDs).toEqual([])
    expect(cardTreeStore.visibleVersion).toBeGreaterThan(before)
  } finally {
    resetWriter()
  }
})
