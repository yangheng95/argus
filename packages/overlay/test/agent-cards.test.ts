import { beforeEach, expect, test } from "bun:test"
import { createRoot, createEffect } from "solid-js"
import { conversationMessages } from "../src/utils/conversation"
import { appendAgentEvent, clearAgentEvents, messageStore, setMessages, setAgentEvents, setSelectedTaskID } from "../src/store/messages"
import {
  agentCardExpanded,
  clearConversationUiState,
  toggleAgentCardExpanded,
  toggleToolOutputExpanded,
  toolOutputExpanded,
} from "../src/store/conversation-ui"
import { setBoardStore } from "../src/store/board"

// Polyfill requestAnimationFrame for Bun test environment —
// scheduleRebuildAgentCards uses it for debouncing.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0 }
}

function resetStores() {
  setMessages([])
  clearAgentEvents()
  clearConversationUiState()
  setSelectedTaskID("")
  setBoardStore("board", null)
  setBoardStore("selectedTaskID", "")
  setBoardStore("taskSequence", 0)
}

beforeEach(() => {
  resetStores()
})

test("builds a live agent card when only agent events exist", () => {
  setBoardStore("board", {
    task: {
      status: "evaluating",
    },
  })
  setAgentEvents([
    {
      id: "judge:start",
      stage: "judge",
      kind: "status",
      summary: "Evaluator agent started",
      time: { created: 1000 },
      _targetText: "Evaluator agent started",
      _liveText: "Evaluator agent started",
    },
  ])

  const items = conversationMessages()
  const card = items.find((item: any) => item?._agentCard)

  expect(card?._agentStage).toBe("evaluator")
  expect(card?._agentStatus).toBe("running")
  expect(card?._agentMessages).toHaveLength(1)
  expect(card?._agentMessages?.[0]?.parts?.[0]?.text).toBe("Evaluator agent started")
})

test("keeps transcript-backed cards canonical for the same stage", () => {
  setBoardStore("board", {
    task: {
      status: "planning",
    },
  })
  setMessages([
    {
      info: {
        id: "planner-msg-1",
        role: "assistant",
        agent: "planner",
        sessionID: "planner-session-1",
        time: { created: 2000 },
      },
      parts: [{ id: "planner-part-1", type: "text", text: "First planning note" }],
    },
  ])
  setAgentEvents([
    {
      id: "planner-status-1",
      stage: "planner",
      kind: "status",
      summary: "Planner agent started",
      time: { created: 1500 },
      _targetText: "Planner agent started",
      _liveText: "Planner agent started",
    },
  ])

  const cards = conversationMessages().filter((item: any) => item?._agentCard)

  expect(cards).toHaveLength(1)
  expect(cards[0]?._agentStage).toBe("planner")
  expect(cards[0]?._agentMessages).toHaveLength(1)
  expect(cards[0]?._agentMessages?.[0]?.parts?.[0]?.text).toBe("First planning note")
})

test("prunes live agent events per stage to 12", () => {
  setSelectedTaskID("task-live")
  setBoardStore("selectedTaskID", "task-live")
  setBoardStore("board", {
    task: {
      status: "planning",
    },
  })

  // Use setAgentEvents directly (appendAgentEvent uses setTimeout batching
  // which doesn't fire in synchronous test context).
  const events: any[] = []
  for (let i = 0; i < 20; i += 1) {
    events.push({
      id: `goal-${i}`,
      eventID: `evt-${i}`,
      taskID: "task-live",
      stage: "goal",
      kind: "status",
      toolName: "",
      text: "",
      summary: `Goal event ${i}`,
      payload: {},
      time: { created: 1000 + i },
    })
  }
  setAgentEvents(events)

  // pruneAgentEvents keeps last 12 per stage
  expect(messageStore.agentEvents).toHaveLength(12)
  expect(messageStore.agentEvents[0]?.summary).toBe("Goal event 8")
  expect(messageStore.agentEvents.at(-1)?.summary).toBe("Goal event 19")

  const cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards).toHaveLength(1)
  expect(cards[0]?._agentMessages).toHaveLength(12)
  expect(cards[0]?._agentMessages?.[0]?.parts?.[0]?.text).toBe("Goal event 8")
})

test("live agent cards keep a stable identity and explicit collapse across pruning", () => {
  setSelectedTaskID("task-stable")
  setBoardStore("selectedTaskID", "task-stable")
  setBoardStore("board", {
    task: {
      status: "planning",
    },
  })

  const mkEvent = (i: number) => ({
    id: `planner-${i}`,
    eventID: `evt-${i}`,
    taskID: "task-stable",
    stage: "planner",
    kind: "status",
    toolName: "",
    text: "",
    summary: `Planner event ${i}`,
    payload: {},
    time: { created: 1_000 + i },
  })

  // First batch: 12 events
  setAgentEvents(Array.from({ length: 12 }, (_, i) => mkEvent(i)))

  const firstCard = conversationMessages().find((item: any) => item?._agentCard)
  expect(firstCard?._agentCardKey).toBe("planner:live")
  expect(agentCardExpanded(firstCard?._agentCardKey, true)).toBe(true)

  toggleAgentCardExpanded(firstCard?._agentCardKey, true)
  expect(agentCardExpanded(firstCard?._agentCardKey, true)).toBe(false)

  // Second batch: 20 events (pruned to last 12)
  setAgentEvents(Array.from({ length: 20 }, (_, i) => mkEvent(i)))

  const secondCard = conversationMessages().find((item: any) => item?._agentCard)
  expect(secondCard?._agentCardKey).toBe("planner:live")
  expect(secondCard?._agentMessages).toHaveLength(12)
  expect(secondCard?._agentMessages?.[0]?.parts?.[0]?.text).toBe("Planner event 8")
  expect(agentCardExpanded(secondCard?._agentCardKey, true)).toBe(false)
})

test("each message becomes a separate timeline card", () => {
  setBoardStore("board", {
    task: {
      status: "planning",
      sessionID: "root-session",
    },
  })

  // First message arrives — one card
  setMessages([
    {
      info: {
        id: "spec-msg-1",
        role: "assistant",
        agent: "spec",
        sessionID: "spec-session-1",
        time: { created: 1000 },
      },
      parts: [{ id: "p1", type: "text", text: "Analysing requirements" }],
    },
  ])

  let cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards).toHaveLength(1)
  expect(cards[0]?._agentMessages).toHaveLength(1)
  expect(cards[0]?._agentCardKey).toBe("spec:message:spec-msg-1")

  // Second message arrives — two separate cards (one per message)
  setMessages([
    {
      info: {
        id: "spec-msg-1",
        role: "assistant",
        agent: "spec",
        sessionID: "spec-session-1",
        time: { created: 1000 },
      },
      parts: [{ id: "p1", type: "text", text: "Analysing requirements" }],
    },
    {
      info: {
        id: "spec-msg-2",
        role: "assistant",
        agent: "spec",
        sessionID: "spec-session-1",
        time: { created: 2000 },
      },
      parts: [{ id: "p2", type: "text", text: "Generated spec" }],
    },
  ])

  cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards).toHaveLength(2)
  expect(cards[0]?._agentCardKey).toBe("spec:message:spec-msg-1")
  expect(cards[1]?._agentCardKey).toBe("spec:message:spec-msg-2")
  // Each card has exactly one message
  expect(cards[0]?._agentMessages).toHaveLength(1)
  expect(cards[1]?._agentMessages).toHaveLength(1)

  // Third message arrives — three cards
  setMessages([
    {
      info: {
        id: "spec-msg-1",
        role: "assistant",
        agent: "spec",
        sessionID: "spec-session-1",
        time: { created: 1000 },
      },
      parts: [{ id: "p1", type: "text", text: "Analysing requirements" }],
    },
    {
      info: {
        id: "spec-msg-2",
        role: "assistant",
        agent: "spec",
        sessionID: "spec-session-1",
        time: { created: 2000 },
      },
      parts: [{ id: "p2", type: "text", text: "Generated spec" }],
    },
    {
      info: {
        id: "spec-msg-3",
        role: "assistant",
        agent: "spec",
        sessionID: "spec-session-1",
        time: { created: 3000 },
      },
      parts: [{ id: "p3", type: "text", text: "Refining spec" }],
    },
  ])

  cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards).toHaveLength(3)
  // Round labels: #1, #2, #3
  expect(cards[0]?._agentRound).toBe(1)
  expect(cards[1]?._agentRound).toBe(2)
  expect(cards[2]?._agentRound).toBe(3)
})

test("agent card status updates from running to completed", () => {
  setBoardStore("board", {
    task: {
      status: "evaluating",
    },
  })

  setAgentEvents([
    {
      id: "judge:start",
      stage: "judge",
      kind: "status",
      summary: "Starting evaluation",
      time: { created: 1000 },
      _targetText: "Starting evaluation",
      _liveText: "Starting evaluation",
    },
  ])

  let cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards[0]?._agentStatus).toBe("running")

  // Board changes to completed state
  setBoardStore("board", {
    task: {
      status: "completed",
    },
  })

  setAgentEvents([
    {
      id: "judge:start",
      stage: "judge",
      kind: "status",
      summary: "Evaluation finished",
      time: { created: 1000 },
      _targetText: "Evaluation finished",
      _liveText: "Evaluation finished",
    },
  ])

  cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards[0]?._agentStatus).toBe("completed")
})

test("store agentCards grows as new messages are added incrementally", () => {
  setBoardStore("board", { task: { status: "planning" } })

  const specMsg = (id: string, time: number, text: string) => ({
    info: { id, role: "assistant", agent: "spec", sessionID: "s1", time: { created: time } },
    parts: [{ id: `p-${id}`, type: "text", text }],
  })

  // 1 message → 1 card
  setMessages([specMsg("m1", 100, "a")])
  expect(messageStore.agentCardOrder).toEqual(["spec:message:m1"])
  expect(messageStore.agentCards["spec:message:m1"]._agentMessages).toHaveLength(1)

  // 2 messages → 2 cards (per-message grouping)
  setMessages([specMsg("m1", 100, "a"), specMsg("m2", 200, "b")])
  expect(messageStore.agentCardOrder).toEqual(["spec:message:m1", "spec:message:m2"])
  expect(messageStore.agentCards["spec:message:m1"]._agentMessages).toHaveLength(1)
  expect(messageStore.agentCards["spec:message:m2"]._agentMessages).toHaveLength(1)

  // 3 messages → 3 cards
  setMessages([specMsg("m1", 100, "a"), specMsg("m2", 200, "b"), specMsg("m3", 300, "c")])
  expect(messageStore.agentCardOrder).toEqual(["spec:message:m1", "spec:message:m2", "spec:message:m3"])
  expect(messageStore.agentCards["spec:message:m3"]._agentMessages).toHaveLength(1)
})

test("conversation ui state resets on task switch and tracks tool output expansion externally", () => {
  toggleToolOutputExpanded("tool-part-1")
  expect(toolOutputExpanded("tool-part-1")).toBe(true)

  setSelectedTaskID("task-a")
  expect(toolOutputExpanded("tool-part-1")).toBe(false)

  toggleToolOutputExpanded("tool-part-1")
  expect(toolOutputExpanded("tool-part-1")).toBe(true)
  setSelectedTaskID("task-b")
  expect(toolOutputExpanded("tool-part-1")).toBe(false)
})
