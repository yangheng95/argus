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
      parts: [
        {
          id: "old-file",
          type: "file",
          messageID: "old-message",
          url: "/attachment/project/old.png",
          mime: "image/png",
        },
      ],
    })

    setCardTreeStore("order", [sessionID])
    setCardTreeStore("cards", {
      [sessionID]: {
        ...session,
        subtreeScreenshotItems: [
          {
            id: "file:old-message:old-file",
            role: "assistant",
            src: "/attachment/project/old.png",
            alt: "old.png",
            title: "old.png",
            detail: "image/png",
            time: 200,
            messageID: "old-message",
            partID: "old-file",
            source: "file",
          },
        ],
      },
      [interactionID]: interaction,
    })
    const before = cardTreeStore.visibleVersion

    pruneCardsAfterCursor(150)

    expect(cardTreeStore.order).toEqual([sessionID])
    expect(cardTreeStore.cards[interactionID]).toBeUndefined()
    expect(cardTreeStore.cards[sessionID]?.childIDs).toEqual([])
    expect(cardTreeStore.cards[sessionID]?.subtreeScreenshotItems).toEqual([])
    expect(cardTreeStore.screenshotItems).toEqual([])
    expect(cardTreeStore.visibleVersion).toBeGreaterThan(before)
  } finally {
    resetWriter()
  }
})

test("pruneCardsAfterCursor rejects cards without positive time", () => {
  resetWriter()
  try {
    const cardID = "requirements:session:ses_missing_time"
    setCardTreeStore("order", [cardID])
    setCardTreeStore("cards", {
      [cardID]: {
        id: cardID,
        kind: "agent",
        title: "Requirements",
        stage: "requirements",
        parts: [],
        childIDs: [],
      } as CardNode,
    })

    expect(() => pruneCardsAfterCursor(150)).toThrow(/missing positive time/)
  } finally {
    resetWriter()
  }
})
