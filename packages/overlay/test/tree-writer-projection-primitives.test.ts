import { test, expect } from "bun:test"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
import { installRealOverlayI18n } from "./fixtures/i18n"
import { stampTestEvent, testEventOrderKey, testMessageOrderKey, testPartOrderKey } from "./fixtures/timeline-order"

installRealOverlayI18n()
const {
  applyEvent: applyEventRaw,
  flushBufferedPartDeltas,
  resetWriter,
  hasProjectedPart,
} = await import("../src/services/tree-writer")
const { cardTreeStore } = await import("../src/store/card-tree")

function applyEvent(event: any): void {
  applyEventRaw(stampProjectionEventForTest(event))
}

function applyRawEvent(event: any): void {
  applyEventRaw(event)
}

function stampedInfo(channel: string, info: Record<string, any>) {
  return {
    ...info,
    resolvedRole: info.resolvedRole ?? channel,
    agent: info.agent ?? channel,
    channel,
  }
}

function stampedPart(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, ...cleanPart } = part
  return cleanPart
}

function stampedPartEvent(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, ...cleanPart } = part
  return {
    part: cleanPart,
    resolvedRole: resolvedRole ?? channel,
    channel,
    ...(parentSessionID ? { parentSessionID } : {}),
    ...(goalID ? { goalID } : {}),
  }
}

function stampProjectionEventForTest(event: any): any {
  const props = event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
  if (props?.info || props?.part) {
    return stampTestEvent(event)
  }
  return stampTestEvent(event)
}

test("part projection materializes the deterministic turn when the part arrives before message metadata", () => {
  resetWriter()

  applyEvent({
    type: "message.part.updated",
    emittedAt: 1_780_000_000_010,
    orderKey: testMessageOrderKey("msg_before_message", 1_780_000_000_000),
    properties: {
      taskID: "tsk_projection",
      orderKey: testMessageOrderKey("msg_before_message", 1_780_000_000_000),
      ...stampedPartEvent("build", {
        id: "prt_before_message",
        orderKey: testPartOrderKey("prt_before_message", 1_780_000_000_010),
        messageID: "msg_before_message",
        sessionID: "ses_before_message",
        time: { created: 1_780_000_000_010 },
        type: "text",
        text: "part first",
      }),
    },
  })

  const cardID = "build:session:ses_before_message:message:msg_before_message"
  expect(cardTreeStore.cards[cardID]).toBeDefined()
  expect(cardTreeStore.cards[cardID]?.parts).toEqual([
    expect.objectContaining({
      id: "prt_before_message",
      messageID: "msg_before_message",
      sessionID: "ses_before_message",
      text: "part first",
    }),
  ])
  expect(hasProjectedPart("ses_before_message", "prt_before_message")).toBe(true)

  applyEvent({
    type: "message.updated",
    emittedAt: 1_780_000_000_020,
    orderKey: testMessageOrderKey("msg_before_message", 1_780_000_000_000),
    properties: {
      taskID: "tsk_projection",
      info: stampedInfo("build", {
        id: "msg_before_message",
        orderKey: testMessageOrderKey("msg_before_message", 1_780_000_000_000),
        sessionID: "ses_before_message",
        role: "assistant",
        time: { created: 1_780_000_000_000 },
      }),
    },
  })

  expect(cardTreeStore.cards[cardID]).toBeDefined()
  expect(Object.keys(cardTreeStore.cards).filter((id) => id.includes("ses_before_message"))).toEqual([cardID])
  expect(cardTreeStore.cards[cardID]?.time).toBe(1_780_000_000_000)
})

test("part-first card survives regroup until its message metadata arrives", () => {
  resetWriter()

  applyEvent({
    type: "message.part.updated",
    emittedAt: 1_780_000_000_010,
    orderKey: testMessageOrderKey("msg_part_first", 1_780_000_000_050),
    properties: {
      taskID: "tsk_projection",
      orderKey: testMessageOrderKey("msg_part_first", 1_780_000_000_050),
      ...stampedPartEvent("orchestrator", {
        id: "prt_part_first_text",
        orderKey: testPartOrderKey("prt_part_first_text", 1_780_000_000_010),
        messageID: "msg_part_first",
        sessionID: "ses_part_first_regroup",
        time: { created: 1_780_000_000_010 },
        type: "text",
        text: "visible before metadata",
      }),
    },
  })

  const partFirstCardID = "orchestrator:session:ses_part_first_regroup:message:msg_part_first"
  expect(cardTreeStore.cards[partFirstCardID]?.parts).toEqual([
    expect.objectContaining({
      id: "prt_part_first_text",
      text: "visible before metadata",
    }),
  ])

  for (const [id, created] of [
    ["msg_later_a", 1_780_000_000_100],
    ["msg_later_b", 1_780_000_000_200],
  ] as const) {
    applyEvent({
      type: "message.updated",
      emittedAt: created,
      orderKey: testMessageOrderKey(id, created),
      properties: {
        taskID: "tsk_projection",
        info: stampedInfo("orchestrator", {
          id,
          orderKey: testMessageOrderKey(id, created),
          sessionID: "ses_part_first_regroup",
          role: "assistant",
          time: { created },
        }),
      },
    })
  }

  expect(cardTreeStore.cards[partFirstCardID]?.parts).toContainEqual(
    expect.objectContaining({
      id: "prt_part_first_text",
      text: "visible before metadata",
    }),
  )

  expect(() =>
    applyEvent({
      type: "message.part.updated",
      emittedAt: 1_780_000_000_250,
      orderKey: testMessageOrderKey("msg_part_first", 1_780_000_000_050),
      properties: {
        taskID: "tsk_projection",
        orderKey: testMessageOrderKey("msg_part_first", 1_780_000_000_050),
        ...stampedPartEvent("orchestrator", {
          id: "prt_part_first_finish",
          orderKey: testPartOrderKey("prt_part_first_finish", 1_780_000_000_250),
          messageID: "msg_part_first",
          sessionID: "ses_part_first_regroup",
          time: { created: 1_780_000_000_250 },
          type: "step-finish",
          reason: "tool-calls",
        }),
      },
    }),
  ).not.toThrow()

  applyEvent({
    type: "message.updated",
    emittedAt: 1_780_000_000_300,
    orderKey: testMessageOrderKey("msg_part_first", 1_780_000_000_050),
    properties: {
      taskID: "tsk_projection",
      info: stampedInfo("orchestrator", {
        id: "msg_part_first",
        orderKey: testMessageOrderKey("msg_part_first", 1_780_000_000_050),
        sessionID: "ses_part_first_regroup",
        role: "assistant",
        time: { created: 1_780_000_000_050 },
      }),
    },
  })

  expect(cardTreeStore.cards[partFirstCardID]?.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "prt_part_first_text",
        text: "visible before metadata",
      }),
    ]),
  )
  expect((cardTreeStore.cards[partFirstCardID]?.parts || []).map((part: any) => part.id)).not.toContain(
    "prt_part_first_finish",
  )
  expect(Object.keys(cardTreeStore.cards).filter((id) => id.includes("ses_part_first_regroup"))).toEqual([
    partFirstCardID,
  ])
})

test("non-reconstructable message stream events stay loud for selected-task recovery", () => {
  resetWriter()

  expect(() =>
    applyEvent({
      type: "message.part.delta",
      orderKey: testEventOrderKey("message.part.delta", 1_780_000_000_000),
      properties: {
        taskID: "tsk_projection",
        partID: "prt_missing",
        sessionID: "ses_missing",
        field: "text",
        delta: "x",
      },
    }),
  ).toThrow(/message\.part\.delta: unknown session ses_missing/)

  applyEvent({
    type: "message.updated",
    orderKey: testMessageOrderKey("msg_known", 1_780_000_000_100),
    properties: {
      taskID: "tsk_projection",
      info: stampedInfo("assistant", {
        id: "msg_known",
        orderKey: testMessageOrderKey("msg_known", 1_780_000_000_100),
        sessionID: "ses_known",
        role: "assistant",
        time: { created: 1_780_000_000_100 },
      }),
    },
  })

  expect(() =>
    applyEvent({
      type: "message.part.removed",
      orderKey: testEventOrderKey("message.part.removed", 1_780_000_000_000),
      properties: {
        taskID: "tsk_projection",
        sessionID: "ses_known",
        partID: "prt_missing",
      },
    }),
  ).toThrow(/message\.part\.removed: unknown part prt_missing in session ses_known/)

  expect(() =>
    applyRawEvent({
      type: "message.part.updated",
      emittedAt: 1_780_000_000_200,
      properties: {
        taskID: "tsk_projection",
        ...stampedPartEvent("assistant", {
          id: "prt_missing_order_key",
          messageID: "msg_known",
          sessionID: "ses_known",
          type: "text",
          text: "part event must carry its own orderKey",
        }),
      },
    }),
  ).toThrow(/message\.part\.updated msg_known envelope missing orderKey/)

  expect(() =>
    applyRawEvent({
      type: "message.part.updated",
      emittedAt: 1_780_000_000_210,
      orderKey: "v1:0001780000000210:0000000000000030:0000000000000000:message:msg_known",
      properties: {
        taskID: "tsk_projection",
        orderKey: "v1:0001780000000210:0000000000000030:0000000000000000:message:msg_known",
        ...stampedPartEvent("assistant", {
          id: "prt_route_only",
          messageID: "msg_known",
          sessionID: "ses_known",
          type: "text",
          text: "part event must stamp orderKey on the part DTO",
        }),
      },
    }),
  ).toThrow(/message\.part\.updated part prt_route_only missing orderKey/)

  expect(() =>
    applyRawEvent({
      type: "message.part.updated",
      emittedAt: 1_780_000_000_215,
      orderKey: "v1:0001780000000100:0000000000000030:0000000000000000:message:msg_known",
      properties: {
        taskID: "tsk_projection",
        orderKey: "v1:0001780000000100:0000000000000030:0000000000000000:message:msg_known",
        ...stampedPartEvent("assistant", {
          id: "prt_distinct_part_key",
          orderKey: "v1:0001780000000215:0000000000000031:0000000000000000:part:prt_distinct_part_key",
          messageID: "msg_known",
          sessionID: "ses_known",
          type: "text",
          text: "message route key and part key are distinct domains",
        }),
      },
    }),
  ).not.toThrow()
  expect(hasProjectedPart("ses_known", "prt_distinct_part_key")).toBe(true)

  expect(() =>
    applyRawEvent({
      type: "message.part.updated",
      emittedAt: 1_780_000_000_220,
      orderKey: "v1:0001780000000220:0000000000000031:0000000000000000:part:prt_mismatch_route",
      properties: {
        taskID: "tsk_projection",
        orderKey: "v1:0001780000000220:0000000000000031:0000000000000000:part:prt_mismatch_route",
        ...stampedPartEvent("assistant", {
          id: "prt_mismatch",
          orderKey: "v1:0001780000000220:0000000000000031:0000000000000000:part:prt_mismatch_part",
          messageID: "msg_known",
          sessionID: "ses_known",
          type: "text",
          text: "route orderKey must be a message-domain key",
        }),
      },
    }),
  ).toThrow(/message\.part\.updated msg_known envelope expected message orderKey/)

  expect(() =>
    applyEvent({
      type: "message.removed",
      orderKey: testEventOrderKey("message.removed", 1_780_000_000_000),
      properties: {
        taskID: "tsk_projection",
        sessionID: "ses_known",
        messageID: "msg_missing",
      },
    }),
  ).toThrow(/message\.removed: unknown message msg_missing in session ses_known/)
})

test("completed integrity verdict is not downgraded by late running review events", () => {
  resetWriter()

  applyEvent({
    type: "integrity.review.completed",
    emittedAt: 1_780_000_000_000,
    orderKey: testEventOrderKey("integrity.review.completed", 1_780_000_000_000),
    properties: {
      taskID: "tsk_projection",
      sessionID: "ses_integrity_done",
      verdict: "pass",
      summary: "accepted",
      teamReportMarkdown: "accepted",
      reviewers: [],
      findings: [],
      requiredRepairs: [],
      unresolvedDisagreements: [],
      attempts: 1,
      acceptance: {
        verdict: "accepted",
        summary: "accepted",
      },
    },
  })

  const cardID = "integrity:session:ses_integrity_done"
  expect(cardTreeStore.cards[cardID]?.status).toBe("completed")
  expect(cardTreeStore.cards[cardID]?.integrity?.verdict).toBe("pass")

  applyEvent({
    type: "review.stream.progress",
    emittedAt: 1_780_000_000_500,
    orderKey: testEventOrderKey("review.stream.progress", 1_780_000_000_500),
    properties: {
      taskID: "tsk_projection",
      reviewID: "integrity:ses_integrity_done",
      phase: "integrity",
      currentStep: "agent",
      attempt: 2,
      elapsedMs: 500,
      summary: "late progress",
    },
  })
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1_780_000_000_600,
    orderKey: testEventOrderKey("review.stream.chunk", 1_780_000_000_600),
    properties: {
      taskID: "tsk_projection",
      reviewID: "integrity:ses_integrity_done",
      phase: "integrity",
      kind: "reasoning",
      attempt: 2,
      delta: "late chunk",
    },
  })
  flushBufferedPartDeltas()

  expect(cardTreeStore.cards[cardID]?.status).toBe("completed")
  expect(cardTreeStore.cards[cardID]?.integrity?.verdict).toBe("pass")
  expect(cardTreeStore.cards[cardID]?.parts.some((part: any) => String(part?.text || "").includes("late chunk"))).toBe(
    false,
  )
})
