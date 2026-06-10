import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const { setBoardStore } = await import("../src/store/board")
const { cardTreeStore } = await import("../src/store/card-tree")
const { applyEvent, flushBufferedPartDeltas, resetWriter } = await import("../src/services/tree-writer")

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const TASK_ID = "tsk_visible_version"
const SESSION_ID = "ses_visible_version"
const MESSAGE_ID = "msg_visible_version"
const PART_ID = "part_visible_version"

function seedPart(): void {
  setBoardStore("selectedTaskID", TASK_ID)
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "visible version",
      sessionID: SESSION_ID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  resetWriter()
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: MESSAGE_ID,
        sessionID: SESSION_ID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_776_000_000_010 },
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID,
        messageID: MESSAGE_ID,
        sessionID: SESSION_ID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "",
      },
    },
  })
}

test("streaming part deltas advance the card tree visible version", () => {
  try {
    seedPart()
    const before = cardTreeStore.visibleVersion

    applyEvent({
      type: "message.part.delta",
      properties: {
        taskID: TASK_ID,
        partID: PART_ID,
        messageID: MESSAGE_ID,
        sessionID: SESSION_ID,
        field: "text",
        delta: "hello",
      },
    })
    flushBufferedPartDeltas()

    expect(cardTreeStore.visibleVersion).toBeGreaterThan(before)
  } finally {
    resetWriter()
  }
})

test("resetWriter advances the card tree epoch for transcript replacement boundaries", () => {
  try {
    const before = cardTreeStore.treeEpoch
    resetWriter()
    expect(cardTreeStore.treeEpoch).toBe(before + 1)
  } finally {
    resetWriter()
  }
})

test("Conversation respects replacement scroll intent from the card tree epoch", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
  expect(source).toContain("() => cardTreeStore.treeEpoch")
  expect(source).toContain('cardTreeStore.treeReplacementScrollIntent === "preserve"')
  expect(source).toMatch(/scrollController\?\.contentChanged\(\);?/)
  expect(source).toMatch(/setTracking\(true\);?/)
  expect(source).toMatch(/scrollController\?\.scrollToBottom\(\);?/)
})
