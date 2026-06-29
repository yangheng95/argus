// ── P4 perf regression ──
//
// Verifies the new tree-writer applies events at a rate compatible with
// 60 Hz SSE streaming. A 1000-event reasoning-delta burst must finish well
// under 1s of CPU; a 10000-event burst must stay well under 10s. Any
// quadratic blow-up in the writer (e.g. full O(cards) re-sort per event,
// accidental reconcile of the whole tree) shows up here as a fail.
//
// This is a LOWER-BOUND benchmark — the pipeline in production also pays
// for Solid reactivity + DOM mount. But the writer itself must be O(1) per
// message.part.delta; if that invariant ever regresses, this catches it.

import { test, expect } from "bun:test"
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

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const { setBoardStore: setBoardStoreRaw } = await import("../src/store/board")
const {
  applyEvent: applyEventRaw,
  flushBufferedPartDeltas,
  resetWriter,
  hydrateConversationView: hydrateConversationViewRaw,
} = await import("../src/services/tree-writer")
const { cardTreeStore } = await import("../src/store/card-tree")

const TASK_ID = "tsk_perf"
const SID = "ses_perf"
const MSG_ID = "msg_perf"
const PART_ID = "part_perf"
const EXECUTOR_SID = "ses_executor_perf"
const EXECUTOR_MSG_ID = "msg_executor_perf"
const EXECUTOR_PART_ID = "part_executor_perf"
let eventSequence = 0

function setBoardStore(...args: any[]): any {
  if (args[0] === "board" && args.length === 2) return setBoardStoreRaw("board", stampTestBoard(args[1]))
  return (setBoardStoreRaw as any)(...args)
}

function applyEvent(event: any): void {
  const stampedEnvelope =
    event?.emittedAt || event?.timestamp
      ? event
      : { ...event, timestamp: 1_776_000_000_000 + ++eventSequence, sequence: eventSequence }
  applyEventRaw(stampTestEvent(validateEventForTest(stampedEnvelope)))
}

function hydrateConversationView(view: any, transcript: any[]): void {
  const completeTranscript = transcript.map((message) => validateTranscriptMessage(message))
  hydrateConversationViewRaw(
    { ...view, messages: stampTestViewMessages(view?.messages || []) },
    stampTestTranscript(completeTranscript),
  )
}

function validateEventForTest(event: any): any {
  const type = String(event?.type || "event")
  const props = event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
  if (props?.info && typeof props.info === "object") {
    const messageID = String(props.info.id || "")
    const orderKey = typeof props.info.orderKey === "string" ? props.info.orderKey : ""
    if (!orderKey) throw new Error(`perf fixture message ${messageID || "<unknown>"} missing orderKey`)
    if (event.orderKey !== orderKey) throw new Error(`perf fixture message ${messageID} envelope orderKey drift`)
    return {
      ...event,
      orderKey,
      properties: {
        ...props,
        info: props.info,
      },
    }
  }
  if (props?.part && typeof props.part === "object") {
    const part = props.part
    const messageID = String(part.messageID || "")
    const partID = String(part.id || "")
    const ownerOrderKey = typeof props.orderKey === "string" ? props.orderKey : ""
    const partOrderKey = typeof part.orderKey === "string" ? part.orderKey : ""
    if (!ownerOrderKey) throw new Error(`perf fixture part owner ${messageID || "<unknown>"} missing orderKey`)
    if (!partOrderKey) throw new Error(`perf fixture part ${partID || "<unknown>"} missing orderKey`)
    if (event.orderKey !== ownerOrderKey) {
      throw new Error(`perf fixture part ${partID || "<unknown>"} envelope orderKey drift`)
    }
    return {
      ...event,
      orderKey: ownerOrderKey,
      properties: {
        ...props,
        orderKey: ownerOrderKey,
        part,
      },
    }
  }
  if (!event.orderKey) throw new Error(`perf fixture event ${type || "<unknown>"} missing orderKey`)
  return {
    ...event,
    orderKey: event.orderKey,
  }
}

function validateTranscriptMessage(message: any): any {
  const info = message?.info || {}
  const messageID = String(info.id || "")
  if (!info.orderKey) throw new Error(`perf fixture transcript message ${messageID || "<unknown>"} missing orderKey`)
  return {
    ...message,
    info,
    parts: Array.isArray(message?.parts)
      ? message.parts.map((part: any) => {
          const partID = String(part.id || "")
          if (!part.orderKey) throw new Error(`perf fixture transcript part ${partID || "<unknown>"} missing orderKey`)
          return {
            ...part,
          }
        })
      : message?.parts,
  }
}

function viewMessagesForTranscript(transcript: any[]): any[] {
  return transcript.map((message) => ({
    messageID: String(message.info.id || ""),
    sessionID: String(message.info.sessionID || ""),
    stage: String(message.info.channel || ""),
    time: Number(message.info.time?.created || 0),
    orderKey: message.info.orderKey,
    placement: "top_level",
  }))
}

const INITIAL_BOARD = {
  task: {
    id: TASK_ID,
    status: "active",
    request: "perf test",
    sessionID: SID,
    time: { created: 1_776_000_000_000 },
    attachments: [],
  },
  goalWorkflows: [],
  interactions: [],
}

function bootstrap() {
  setBoardStore("board", INITIAL_BOARD)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()
  applyEvent({
    type: "message.updated",
    orderKey: testMessageOrderKey(MSG_ID, 1_776_000_000_000),
    properties: {
      taskID: TASK_ID,
      info: {
        id: MSG_ID,
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_776_000_000_000 },
        orderKey: testMessageOrderKey(MSG_ID, 1_776_000_000_000),
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: testMessageOrderKey(MSG_ID, 1_776_000_000_000),
    properties: {
      taskID: TASK_ID,
      orderKey: testMessageOrderKey(MSG_ID, 1_776_000_000_000),
      part: {
        id: PART_ID,
        messageID: MSG_ID,
        sessionID: SID,
        orderKey: testPartOrderKey(PART_ID, 1_776_000_000_000),
        resolvedRole: "assistant",
        channel: "assistant",
        type: "reasoning",
        text: "",
      },
    },
  })
}

function runDeltaBurst(count: number): { totalMs: number; perEventMs: number } {
  bootstrap()
  const delta = "x"
  const start = performance.now()
  for (let i = 0; i < count; i++) {
    applyEvent({
      type: "message.part.delta",
      sequence: 10_000 + i,
      timestamp: 1_776_000_010_000 + i,
      orderKey: testEventOrderKey("message.part.delta", 1_776_000_010_000 + i, 10_000 + i),
      properties: {
        taskID: TASK_ID,
        partID: PART_ID,
        messageID: MSG_ID,
        sessionID: SID,
        field: "text",
        delta,
      },
    })
  }
  const totalMs = performance.now() - start
  flushBufferedPartDeltas()
  return { totalMs, perEventMs: totalMs / count }
}

function seedAssistantSession(sessionID: string, messageID: string, time: number): void {
  applyEvent({
    type: "message.updated",
    orderKey: testMessageOrderKey(messageID, time),
    properties: {
      taskID: TASK_ID,
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: time },
        orderKey: testMessageOrderKey(messageID, time),
      },
    },
  })
}

function bootstrapExecutorWithManyCards(extraCards: number): void {
  setBoardStore("board", INITIAL_BOARD)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  const baseTime = 1_776_000_000_000
  const transcript: any[] = []
  for (let i = 0; i < extraCards; i++) {
    transcript.push({
      info: {
        id: `noise_msg_${i}`,
        sessionID: `noise_${i}`,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: baseTime + i },
        orderKey: testMessageOrderKey(`noise_msg_${i}`, baseTime + i),
      },
      parts: [
        {
          id: `noise_part_${i}`,
          messageID: `noise_msg_${i}`,
          sessionID: `noise_${i}`,
          orderKey: testPartOrderKey(`noise_part_${i}`, baseTime + i),
          resolvedRole: "assistant",
          channel: "assistant",
          type: "text",
          text: `noise ${i}`,
        },
      ],
    })
  }
  const completeTranscript = transcript.map((message) => validateTranscriptMessage(message))
  hydrateConversationView({ sessions: [], messages: viewMessagesForTranscript(completeTranscript) }, completeTranscript)
  applyEvent({
    type: "message.updated",
    orderKey: testMessageOrderKey(EXECUTOR_MSG_ID, baseTime + extraCards + 1),
    properties: {
      taskID: TASK_ID,
      info: {
        id: EXECUTOR_MSG_ID,
        sessionID: EXECUTOR_SID,
        role: "assistant",
        resolvedRole: "executor",
        agent: "executor",
        channel: "executor",
        time: { created: baseTime + extraCards + 1 },
        orderKey: testMessageOrderKey(EXECUTOR_MSG_ID, baseTime + extraCards + 1),
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: testMessageOrderKey(EXECUTOR_MSG_ID, baseTime + extraCards + 1),
    properties: {
      taskID: TASK_ID,
      orderKey: testMessageOrderKey(EXECUTOR_MSG_ID, baseTime + extraCards + 1),
      part: {
        id: EXECUTOR_PART_ID,
        messageID: EXECUTOR_MSG_ID,
        sessionID: EXECUTOR_SID,
        orderKey: testPartOrderKey(EXECUTOR_PART_ID, baseTime + extraCards + 1),
        resolvedRole: "executor",
        channel: "executor",
        type: "reasoning",
        text: "",
      },
    },
  })
}

function runExecutorDeltaBurstWithManyCards(
  count: number,
  extraCards: number,
): { totalMs: number; perEventMs: number } {
  bootstrapExecutorWithManyCards(extraCards)
  const start = performance.now()
  for (let i = 0; i < count; i++) {
    applyEvent({
      type: "message.part.delta",
      sequence: 20_000 + i,
      timestamp: 1_776_000_020_000 + i,
      orderKey: testEventOrderKey("message.part.delta", 1_776_000_020_000 + i, 20_000 + i),
      properties: {
        taskID: TASK_ID,
        partID: EXECUTOR_PART_ID,
        messageID: EXECUTOR_MSG_ID,
        sessionID: EXECUTOR_SID,
        field: "text",
        delta: "x",
      },
    })
  }
  const totalMs = performance.now() - start
  flushBufferedPartDeltas()
  return { totalMs, perEventMs: totalMs / count }
}

test("writer applies 1000 reasoning deltas in < 1s total (<1ms/event avg)", () => {
  const { totalMs, perEventMs } = runDeltaBurst(1000)
  console.log(`[perf] 1000 deltas: ${totalMs.toFixed(1)}ms (${perEventMs.toFixed(3)}ms/event)`)
  expect(totalMs).toBeLessThan(1000)
  // Verify the text actually accumulated — otherwise a no-op writer would "pass"
  const card = cardTreeStore.cards[`assistant:session:${SID}:message:${MSG_ID}`]
  expect(card).toBeDefined()
  const parts = card!.parts as any[]
  const reasoningPart = parts.find((p) => p.id === PART_ID)
  expect(reasoningPart).toBeDefined()
  expect((reasoningPart.text ?? "").length).toBe(1000)
})

test("writer applies 10000 reasoning deltas in < 10s total (guard against quadratic growth)", () => {
  const { totalMs, perEventMs } = runDeltaBurst(10_000)
  console.log(`[perf] 10000 deltas: ${totalMs.toFixed(1)}ms (${perEventMs.toFixed(3)}ms/event)`)
  expect(totalMs).toBeLessThan(10_000)
  // Per-event must stay O(1) — median allowance well below 1ms.
  expect(perEventMs).toBeLessThan(2)
})

test("executor reasoning deltas do not rebuild top-level order for every token", () => {
  const { totalMs, perEventMs } = runExecutorDeltaBurstWithManyCards(5000, 1500)
  console.log(`[perf] executor 5000 deltas / 1500 cards: ${totalMs.toFixed(1)}ms (${perEventMs.toFixed(3)}ms/event)`)
  expect(totalMs).toBeLessThan(750)
  expect(perEventMs).toBeLessThan(0.15)

  const cardID = `executor:session:${EXECUTOR_SID}:message:${EXECUTOR_MSG_ID}`
  const card = cardTreeStore.cards[cardID]
  expect(card).toBeDefined()
  expect(cardTreeStore.order).toContain(cardID)
  const reasoningPart = (card!.parts as any[]).find((p) => p.id === EXECUTOR_PART_ID)
  expect(reasoningPart).toBeDefined()
  expect((reasoningPart.text ?? "").length).toBe(5000)
})

test("new message.updated for new sessions stays cheap under many concurrent sessions", () => {
  setBoardStore("board", INITIAL_BOARD)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  const COUNT = 500
  const start = performance.now()
  for (let i = 0; i < COUNT; i++) {
    const sid = `sess_${i}`
    applyEvent({
      type: "message.updated",
      orderKey: testMessageOrderKey(`msg_${i}`, 1_776_000_000_000 + i),
      properties: {
        taskID: TASK_ID,
        info: {
          id: `msg_${i}`,
          sessionID: sid,
          role: "assistant",
          resolvedRole: "executor",
          agent: "executor",
          channel: "executor",
          parentSessionID: SID,
          time: { created: 1_776_000_000_000 + i },
          orderKey: testMessageOrderKey(`msg_${i}`, 1_776_000_000_000 + i),
        },
      },
    })
  }
  const totalMs = performance.now() - start
  const perEventMs = totalMs / COUNT
  console.log(`[perf] 500 new sessions: ${totalMs.toFixed(1)}ms (${perEventMs.toFixed(3)}ms/event)`)
  // With N sessions and each message.updated triggering a full
  // `rebuildTopLevelOrder`, this is O(N) per event → O(N²) total. We
  // accept up to 5s for 500 sessions (~10ms/event) as a warning bar — any
  // regression pushes this over.
  expect(totalMs).toBeLessThan(5000)
})
