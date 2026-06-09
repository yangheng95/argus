import { expect, test } from "bun:test"
import { cardTreeStore } from "../src/store/card-tree"
import { resetWriter } from "../src/services/tree-writer"
import { ingestPersistedConversationMessage } from "../src/services/chat"

test("persisted task message is projected into the visible conversation tree", () => {
  resetWriter()

  ingestPersistedConversationMessage({
    info: {
      id: "msg_user_1",
      role: "user",
      sessionID: "ses_root",
      agent: "build",
      resolvedRole: "user",
      channel: "main",
      time: { created: 1_714_000_000_000 },
    },
    parts: [
      {
        id: "part_user_1",
        messageID: "msg_user_1",
        sessionID: "ses_root",
        type: "text",
        text: "visible user text",
        kind: "user_content",
        resolvedRole: "user",
        channel: "main",
      },
    ],
  })

  expect(cardTreeStore.order.length).toBeGreaterThan(0)
  expect(
    Object.values(cardTreeStore.cards).some((card) =>
      card.parts.some((part: any) => part.text === "visible user text"),
    ),
  ).toBe(true)
})
