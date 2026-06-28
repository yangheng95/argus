import { expect, test } from "bun:test"
import { installRealOverlayI18n } from "./fixtures/i18n"
import {
  stampTestBoard,
  stampTestEvent,
  stampTestTranscript,
  stampTestViewMessages,
  testEventOrderKey,
  testMessageOrderKey,
  testPartOrderKey,
} from "./fixtures/timeline-order"

;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
installRealOverlayI18n()

const { setBoardStore } = await import("../src/store/board")
const { applyEvent, flushBufferedPartDeltas, hydrateConversationView, resetWriter } = await import(
  "../src/services/tree-writer"
)
const { cardTreeStore } = await import("../src/store/card-tree")

const TASK_ID = "tsk_delta_order_stability"
const SESSION_ID = "ses_delta_order_stability"
const MESSAGE_ID = "msg_delta_order_stability"
const PART_ID = "part_delta_order_stability"
const BASE_TIME = 1_776_000_000_000

function seedVisibleMessage(): void {
  setBoardStore(
    "board",
    stampTestBoard({
      task: {
        id: TASK_ID,
        status: "active",
        request: "delta order stability",
        sessionID: SESSION_ID,
        time: { created: BASE_TIME },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    }),
  )
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()
  const transcript = stampTestTranscript([
    {
      info: {
        id: MESSAGE_ID,
        sessionID: SESSION_ID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: BASE_TIME },
        orderKey: testMessageOrderKey(MESSAGE_ID, BASE_TIME),
      },
      parts: [
        {
          id: PART_ID,
          messageID: MESSAGE_ID,
          sessionID: SESSION_ID,
          orderKey: testPartOrderKey(PART_ID, BASE_TIME + 1),
          resolvedRole: "assistant",
          channel: "assistant",
          type: "text",
          text: "seed",
        },
      ],
    },
  ])
  hydrateConversationView(
    {
      sessions: [],
      messages: stampTestViewMessages([
        {
          messageID: MESSAGE_ID,
          sessionID: SESSION_ID,
          stage: "assistant",
          time: BASE_TIME,
          orderKey: testMessageOrderKey(MESSAGE_ID, BASE_TIME),
          placement: "top_level",
        },
      ]),
    },
    transcript,
  )
}

test("visible text deltas preserve the top-level order reference", () => {
  try {
    seedVisibleMessage()
    const cardID = `assistant:session:${SESSION_ID}:message:${MESSAGE_ID}`
    expect(cardTreeStore.order).toContain(cardID)
    const stableOrder = cardTreeStore.order

    applyEvent(
      stampTestEvent({
        type: "message.part.delta",
        sequence: 30_001,
        timestamp: BASE_TIME + 30_001,
        orderKey: testEventOrderKey("message.part.delta", BASE_TIME + 30_001, 30_001),
        properties: {
          taskID: TASK_ID,
          partID: PART_ID,
          messageID: MESSAGE_ID,
          sessionID: SESSION_ID,
          field: "text",
          delta: " tail",
        },
      }),
    )
    flushBufferedPartDeltas()

    expect(cardTreeStore.order).toBe(stableOrder)
    const textPart = cardTreeStore.cards[cardID]?.parts.find((part: any) => part.id === PART_ID)
    expect(textPart?.text).toBe("seed tail")
  } finally {
    resetWriter()
  }
})
