import { test, expect } from "bun:test"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
import { installRealOverlayI18n } from "./fixtures/i18n"

installRealOverlayI18n()
const { applyEvent, flushBufferedPartDeltas, resetWriter, hasProjectedPart } = await import(
  "../src/services/tree-writer"
)
const { cardTreeStore } = await import("../src/store/card-tree")

function stampedInfo(channel: string, info: Record<string, any>) {
  return {
    ...info,
    resolvedRole: info.resolvedRole ?? channel,
    agent: info.agent ?? channel,
    channel,
  }
}

function stampedPart(channel: string, part: Record<string, any>) {
  return {
    ...part,
    resolvedRole: part.resolvedRole ?? channel,
    channel,
  }
}

test("part projection materializes the deterministic turn when the part arrives before message metadata", () => {
  resetWriter()

  applyEvent({
    type: "message.part.updated",
    emittedAt: 1_780_000_000_010,
    properties: {
      taskID: "tsk_projection",
      part: stampedPart("build", {
        id: "prt_before_message",
        messageID: "msg_before_message",
        sessionID: "ses_before_message",
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
    properties: {
      taskID: "tsk_projection",
      info: stampedInfo("build", {
        id: "msg_before_message",
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
    properties: {
      taskID: "tsk_projection",
      part: stampedPart("orchestrator", {
        id: "prt_part_first_text",
        messageID: "msg_part_first",
        sessionID: "ses_part_first_regroup",
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
      properties: {
        taskID: "tsk_projection",
        info: stampedInfo("orchestrator", {
          id,
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
      properties: {
        taskID: "tsk_projection",
        part: stampedPart("orchestrator", {
          id: "prt_part_first_finish",
          messageID: "msg_part_first",
          sessionID: "ses_part_first_regroup",
          type: "step-finish",
          reason: "tool-calls",
        }),
      },
    }),
  ).not.toThrow()

  applyEvent({
    type: "message.updated",
    emittedAt: 1_780_000_000_300,
    properties: {
      taskID: "tsk_projection",
      info: stampedInfo("orchestrator", {
        id: "msg_part_first",
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
      expect.objectContaining({
        id: "prt_part_first_finish",
        type: "step-finish",
        reason: "tool-calls",
      }),
    ]),
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
    properties: {
      taskID: "tsk_projection",
      info: stampedInfo("assistant", {
        id: "msg_known",
        sessionID: "ses_known",
        role: "assistant",
        time: { created: 1_780_000_000_100 },
      }),
    },
  })

  expect(() =>
    applyEvent({
      type: "message.part.removed",
      properties: {
        taskID: "tsk_projection",
        sessionID: "ses_known",
        partID: "prt_missing",
      },
    }),
  ).toThrow(/message\.part\.removed: unknown part prt_missing in session ses_known/)

  expect(() =>
    applyEvent({
      type: "message.removed",
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
