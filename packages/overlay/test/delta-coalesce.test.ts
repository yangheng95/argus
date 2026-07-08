import { afterEach, beforeEach, expect, test } from "bun:test"

const { setBoardStore } = await import("../src/store/board")
const { cardTreeStore } = await import("../src/store/card-tree")
const { applyEvent, resetWriter } = await import("../src/services/tree-writer")
const { routeSSEEvent } = await import("../src/services/events")
const {
  testMessageOrderKey,
  testPartOrderKey,
  testSessionOrderKey,
  testTaskOrderKey,
} = await import("./fixtures/timeline-order")

const TASK_ID = "tsk_delta_coalesce"
const SESSION_ID = "ses_delta_coalesce"
const MESSAGE_ID = "msg_delta_coalesce"
const MESSAGE_TIME = 1_776_000_000_010

function seedBoard(): void {
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  setBoardStore("taskSequence", 0)
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: testTaskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "delta coalesce",
      sessionID: SESSION_ID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
}

function messageUpdated(messageID = MESSAGE_ID, sessionID = SESSION_ID): void {
  const orderKey = testMessageOrderKey(messageID, MESSAGE_TIME)
  applyEvent({
    type: "message.updated",
    orderKey,
    properties: {
      taskID: TASK_ID,
      info: {
        id: messageID,
        orderKey,
        sessionID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_776_000_000_010 },
      },
    },
  })
}

function partUpdated(part: any): void {
  const messageID = String(part.messageID ?? MESSAGE_ID)
  const partID = String(part.id ?? "part_delta")
  const messageOrderKey = testMessageOrderKey(messageID, MESSAGE_TIME)
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey,
    properties: {
      taskID: TASK_ID,
      orderKey: messageOrderKey,
      part: {
        messageID: MESSAGE_ID,
        sessionID: SESSION_ID,
        orderKey: testPartOrderKey(partID, MESSAGE_TIME + 1),
        resolvedRole: "assistant",
        channel: "assistant",
        ...part,
      },
    },
  })
}

function delta(partID: string, field: string, chunk: string, messageID = MESSAGE_ID, sessionID = SESSION_ID): void {
  applyEvent({
    type: "message.part.delta",
    properties: {
      taskID: TASK_ID,
      partID,
      messageID,
      sessionID,
      field,
      delta: chunk,
    },
  })
}

function sessionCard(sessionID = SESSION_ID, messageID = MESSAGE_ID) {
  return cardTreeStore.cards[`assistant:session:${sessionID}:message:${messageID}`]
}

function partText(partID: string): string {
  const part = (sessionCard()?.parts as any[]).find((entry) => entry.id === partID)
  return String(part?.text ?? "")
}

beforeEach(() => {
  seedBoard()
  resetWriter()
  messageUpdated()
})

afterEach(() => {
  resetWriter()
})

async function waitForDeltaFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 70))
}

test("same session part field deltas merge into one timed visible write", async () => {
  partUpdated({ id: "part_text", type: "text", text: "" })
  const beforeVersion = cardTreeStore.visibleVersion

  for (const chunk of ["Hel", "lo", " ", "world"]) delta("part_text", "text", chunk)

  expect(partText("part_text")).toBe("")
  expect(cardTreeStore.visibleVersion).toBe(beforeVersion)

  await waitForDeltaFlush()

  expect(partText("part_text")).toBe("Hello world")
  expect(cardTreeStore.visibleVersion).toBe(beforeVersion + 1)
})

test("message.part.updated synchronously flushes buffered deltas before replacing the part", () => {
  partUpdated({ id: "part_replace", type: "text", text: "" })
  delta("part_replace", "text", "old")

  partUpdated({ id: "part_replace", type: "text", text: "final" })

  expect(partText("part_replace")).toBe("final")
})

test("session.status terminal sees complete text before status mutation", () => {
  partUpdated({ id: "part_terminal", type: "text", text: "" })
  delta("part_terminal", "text", "complete")

  applyEvent({
    type: "session.status",
    orderKey: testSessionOrderKey(SESSION_ID, 1_776_000_000_500),
    emittedAt: 1_776_000_000_500,
    properties: {
      sessionID: SESSION_ID,
      status: { type: "terminal", reason: "completed" },
    },
  })

  expect(partText("part_terminal")).toBe("complete")
  expect(sessionCard()?.status).toBe("completed")
})

test("session.status terminal summary projects onto the active card and clears on streaming", () => {
  applyEvent({
    type: "session.status",
    orderKey: testSessionOrderKey(SESSION_ID, 1_776_000_000_500),
    emittedAt: 1_776_000_000_500,
    properties: {
      sessionID: SESSION_ID,
      status: {
        type: "terminal",
        reason: "completed",
        summary: "I checked the implementation and recorded the passing result.",
      },
    },
  })

  expect(sessionCard()?.status).toBe("completed")
  expect(sessionCard()?.agentSummary).toEqual({
    text: "I checked the implementation and recorded the passing result.",
    source: "session_status",
  })

  applyEvent({
    type: "session.status",
    orderKey: testSessionOrderKey(SESSION_ID, 1_776_000_000_600),
    emittedAt: 1_776_000_000_600,
    properties: {
      sessionID: SESSION_ID,
      status: { type: "streaming" },
    },
  })

  expect(sessionCard()?.status).toBe("running")
  expect(sessionCard()?.agentSummary).toBeUndefined()
})

test("pending session.status terminal summary drains when the message card materializes", () => {
  resetWriter()
  seedBoard()

  applyEvent({
    type: "session.status",
    orderKey: testSessionOrderKey(SESSION_ID, 1_776_000_000_500),
    emittedAt: 1_776_000_000_500,
    properties: {
      sessionID: SESSION_ID,
      status: {
        type: "terminal",
        reason: "completed",
        summary: "I finished the delegated check before the message replay arrived.",
      },
    },
  })
  messageUpdated()

  expect(sessionCard()?.status).toBe("completed")
  expect(sessionCard()?.agentSummary).toEqual({
    text: "I finished the delegated check before the message replay arrived.",
    source: "session_status",
  })
})

test("resetWriter flushes and cancels buffered delta frames before clearing state", () => {
  partUpdated({ id: "part_reset", type: "text", text: "" })
  delta("part_reset", "text", "stale")

  resetWriter()

  expect(cardTreeStore.order).toEqual([])
  expect(Object.keys(cardTreeStore.cards)).toEqual([])
})

test("interleaved parts keep independent buffers and insertion order", async () => {
  partUpdated({ id: "part_a", type: "text", text: "" })
  partUpdated({ id: "part_b", type: "text", text: "" })

  delta("part_a", "text", "A")
  delta("part_b", "text", "B")
  delta("part_a", "text", "C")
  await waitForDeltaFlush()

  expect(partText("part_a")).toBe("AC")
  expect(partText("part_b")).toBe("B")
  const ids = (sessionCard()?.parts as any[]).map((part) => part.id)
  expect(ids.slice(-2)).toEqual(["part_a", "part_b"])
})

test("tool raw field deltas merge through the existing state.raw branch", async () => {
  partUpdated({
    id: "part_tool",
    type: "tool",
    tool: "bash",
    state: { status: "running", raw: "" },
  })

  delta("part_tool", "raw", "line1\n")
  delta("part_tool", "raw", "line2\n")
  await waitForDeltaFlush()

  const part = (sessionCard()?.parts as any[]).find((entry) => entry.id === "part_tool")
  expect(part?.state?.raw).toBe("line1\nline2\n")
})

test("executor run.output is consumed without creating visible conversation cards", () => {
  resetWriter()
  seedBoard()
  const beforeVersion = cardTreeStore.visibleVersion

  const base = {
    type: "run.output",
    task_id: TASK_ID,
    properties: {
      type: "text_delta",
      text: "",
      runID: "run_delta",
      sessionID: SESSION_ID,
    },
  }

  expect(routeSSEEvent({ ...base, sequence: 1, properties: { ...base.properties, text: "A" } })).toBe(true)
  expect(routeSSEEvent({ ...base, sequence: 2, properties: { ...base.properties, text: "B" } })).toBe(true)
  expect(routeSSEEvent({ ...base, sequence: 3, properties: { ...base.properties, text: "C" } })).toBe(true)

  expect(cardTreeStore.visibleVersion).toBe(beforeVersion)
  expect(cardTreeStore.cards[`executor:session:${SESSION_ID}:message:executor:msg:run_delta`]).toBeUndefined()
})
