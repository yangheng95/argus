import { beforeEach, expect, test } from "bun:test"
import { conversationMessages } from "../src/utils/conversation"
import { agentCards, agentCardOrder, clearAgentEvents, setMessages, setAgentEvents, setSelectedTaskID } from "../src/store/messages"
import {
  clearConversationUiState,
  toggleCard,
  cardExpanded,
} from "../src/store/conversation-ui"
import { setBoardStore } from "../src/store/board"
import { routeSSEEvent } from "../src/services/events"

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

test("root task request stays ahead of untimed agent transcript cards", () => {
  setBoardStore("board", {
    task: {
      status: "goal_decomposing",
      request: "Implement a minimal NoteStore",
      time: { created: 1000 },
    },
    interactions: [],
  })

  setMessages([
    {
      info: {
        id: "goal-msg-1",
        role: "assistant",
        agent: "goal",
        sessionID: "goal-session-1",
      },
      parts: [{ id: "goal-part-1", type: "tool", tool: "decompose_goals", state: { status: "running" } }],
    },
  ])

  const items = conversationMessages()

  expect(items[0]?.info?.id).toBe("ctx:user-request")
})

test("store agentCards merges same-session messages into one card", () => {
  setBoardStore("board", { task: { status: "planning" } })

  const specMsg = (id: string, time: number, text: string) => ({
    info: { id, role: "assistant", agent: "spec", sessionID: "s1", time: { created: time } },
    parts: [{ id: `p-${id}`, type: "text", text }],
  })

  // 1 message → 1 card
  setMessages([specMsg("m1", 100, "a")])
  expect(agentCardOrder()).toEqual(["spec:session:s1"])
  expect(agentCards()["spec:session:s1"].messages).toHaveLength(1)

  // 2 messages same session → still 1 card with 2 messages
  setMessages([specMsg("m1", 100, "a"), specMsg("m2", 200, "b")])
  expect(agentCardOrder()).toEqual(["spec:session:s1"])
  expect(agentCards()["spec:session:s1"].messages).toHaveLength(2)

  // 3 messages same session → still 1 card with 3 messages
  setMessages([specMsg("m1", 100, "a"), specMsg("m2", 200, "b"), specMsg("m3", 300, "c")])
  expect(agentCardOrder()).toEqual(["spec:session:s1"])
  expect(agentCards()["spec:session:s1"].messages).toHaveLength(3)
})

// ── Executor Goal Group tests ──

test("multiple executor sessions auto-group by sessionID (no board dependency)", () => {
  // Board has NO goal sessionID data — grouping should still work
  setBoardStore("board", {
    task: {
      status: "running",
      sessionID: "root-session",
    },
  })

  // Executor messages with different sessionIDs → auto-grouped
  setMessages([
    {
      info: {
        id: "exec-msg-a1",
        role: "assistant",
        agent: "opencode",
        sessionID: "exec-session-a",
        time: { created: 1000 },
      },
      parts: [{ id: "p-a1", type: "text", text: "Reading auth.ts" }],
    },
    {
      info: {
        id: "exec-msg-a2",
        role: "assistant",
        agent: "opencode",
        sessionID: "exec-session-a",
        time: { created: 2000 },
      },
      parts: [{ id: "p-a2", type: "text", text: "Writing auth logic" }],
    },
    {
      info: {
        id: "exec-msg-b1",
        role: "assistant",
        agent: "opencode",
        sessionID: "exec-session-b",
        time: { created: 1500 },
      },
      parts: [{ id: "p-b1", type: "text", text: "Reading router.ts" }],
    },
  ])

  // 2 session groups (grouped by sessionID, not by board goal data)
  const goalGroups = Object.values(agentCards()).filter(
    (card: any) => card.kind === "goal",
  )
  expect(goalGroups).toHaveLength(2)

  const groupA = agentCards()["executor:session:exec-session-a"]
  expect(groupA).toBeDefined()
  expect(groupA.kind).toBe("goal")
  expect(groupA.internalCards).toHaveLength(2)
  expect(groupA.internalCards![0].messages[0].parts[0].text).toBe("Reading auth.ts")

  const groupB = agentCards()["executor:session:exec-session-b"]
  expect(groupB).toBeDefined()
  expect(groupB.internalCards).toHaveLength(1)
})

test("goal title comes from board when available", () => {
  setBoardStore("board", {
    task: {
      status: "running",
      sessionID: "root-session",
    },
    goalWorkflows: [{
      goalID: "goal-a",
      goalTitle: "Implement auth",
      goalStatus: "running",
      priority: "blocking",
      steps: [],
    }],
    goalRuns: [{
      id: "gr-a",
      goalID: "goal-a",
      status: "running",
      sessionID: "exec-session-a",
      time: { created: 1000, updated: 1000 },
    }],
  })

  setMessages([
    {
      info: { id: "m1", role: "assistant", agent: "opencode", sessionID: "exec-session-a", time: { created: 1000 } },
      parts: [{ id: "p1", type: "text", text: "Work A" }],
    },
    {
      info: { id: "m2", role: "assistant", agent: "opencode", sessionID: "exec-session-b", time: { created: 2000 } },
      parts: [{ id: "p2", type: "text", text: "Work B" }],
    },
  ])

  // Group A has title from board, group B has empty title (no board match)
  const groupA = agentCards()["executor:session:exec-session-a"]
  expect(groupA.goalTitle).toBe("Implement auth")

  const groupB = agentCards()["executor:session:exec-session-b"]
  expect(groupB.goalTitle).toBe("")
})

test("single executor session merges into one card (no grouping)", () => {
  setBoardStore("board", {
    task: {
      status: "running",
      sessionID: "root-session",
    },
  })

  setMessages([
    {
      info: { id: "m1", role: "assistant", agent: "opencode", sessionID: "single-session", time: { created: 1000 } },
      parts: [{ id: "p1", type: "text", text: "Step 1" }],
    },
    {
      info: { id: "m2", role: "assistant", agent: "opencode", sessionID: "single-session", time: { created: 2000 } },
      parts: [{ id: "p2", type: "text", text: "Step 2" }],
    },
  ])

  // Single session → merged into one flat card, no goal group
  const goalGroups = Object.values(agentCards()).filter(
    (card: any) => card.kind === "goal",
  )
  expect(goalGroups).toHaveLength(0)

  const cards = Object.values(agentCards()).filter(
    (card: any) => card.stage === "executor",
  )
  expect(cards).toHaveLength(1)
  expect(cards[0].messages).toHaveLength(2)
  expect(cards[0].round).toBe(0)
})

test("conversation keeps single executor session as a collapsible card", () => {
  setBoardStore("board", {
    task: {
      status: "running",
      sessionID: "root-session",
    },
    interactions: [],
  })

  setMessages([
    {
      info: { id: "m1", role: "assistant", agent: "opencode", sessionID: "single-session", time: { created: 1000 } },
      parts: [{ id: "p1", type: "text", text: "Step 1" }],
    },
    {
      info: { id: "m2", role: "assistant", agent: "opencode", sessionID: "single-session", time: { created: 2000 } },
      parts: [{ id: "p2", type: "text", text: "Step 2" }],
    },
  ])

  const items = conversationMessages()

  expect(items).toHaveLength(1)
  expect(items[0]?.kind).toBe("agent")
  expect(items[0]?.stage).toBe("executor")
  expect(items[0]?.messages).toHaveLength(2)
  expect(items[0]?.messages[0]?.parts[0]?.text).toBe("Step 1")
})

test("conversation still flattens non-executor agent cards", () => {
  setBoardStore("board", {
    task: {
      status: "planning",
      sessionID: "root-session",
    },
    interactions: [],
  })

  setMessages([
    {
      info: { id: "spec-1", role: "assistant", agent: "spec", sessionID: "spec-session", time: { created: 1000 } },
      parts: [{ id: "spec-p1", type: "text", text: "Drafting spec" }],
    },
  ])

  const items = conversationMessages()

  expect(items).toHaveLength(1)
  expect(items[0]?.kind).not.toBe("agent")
  expect(items[0]?.info?.id).toBe("spec-1")
})

test("goal group status reflects child card states", () => {
  setBoardStore("board", {
    task: {
      status: "running",
      sessionID: "root-session",
    },
  })

  // Two sessions so grouping triggers
  setMessages([
    {
      info: { id: "m1", role: "assistant", agent: "opencode", sessionID: "sess-a", time: { created: 1000 } },
      parts: [{ id: "p1", type: "text", text: "Step 1" }],
    },
    {
      info: { id: "m2", role: "assistant", agent: "opencode", sessionID: "sess-a", time: { created: 2000 } },
      parts: [{ id: "p2", type: "text", text: "Step 2" }],
    },
    {
      info: { id: "m3", role: "assistant", agent: "opencode", sessionID: "sess-b", time: { created: 1500 } },
      parts: [{ id: "p3", type: "text", text: "Other" }],
    },
  ])

  const group = agentCards()["executor:session:sess-a"]
  expect(group).toBeDefined()
  expect(group.status).toBe("running")
  expect(group.internalCards![0].status).toBe("completed")
  expect(group.internalCards![1].status).toBe("running")
})

test("coding executor ids classify as executor cards", () => {
  setBoardStore("board", {
    task: {
      status: "running",
      sessionID: "root-session",
    },
  })

  for (const agent of ["opencode", "codex", "claude-code"]) {
    setMessages([
      {
        info: {
          id: `msg-${agent}`,
          role: "assistant",
          agent,
          sessionID: `session-${agent}`,
          time: { created: 1000 },
        },
        parts: [{ id: `part-${agent}`, type: "text", text: `${agent} text` }],
      },
    ])

    const card = agentCards()[`executor:session:session-${agent}`]
    expect(card).toBeDefined()
    expect(card?.stage).toBe("executor")
    expect(card?.messages[0]?.parts[0]?.text).toBe(`${agent} text`)
  }
})

test("live agent.updated events render agent cards before transcript persistence", async () => {
  setSelectedTaskID("task-1")
  setBoardStore("selectedTaskID", "task-1")
  setBoardStore("board", {
    task: {
      id: "task-1",
      status: "active",
      sessionID: "root-session",
    },
    interactions: [],
  })

  expect(routeSSEEvent({
    type: "agent.updated",
    payload: {
      taskID: "task-1",
      stage: "architect",
      kind: "status",
      summary: "Designing contracts",
    },
  })).toBe(true)

  await Bun.sleep(40)

  const items = conversationMessages()
  expect(items).toHaveLength(1)
  expect(items[0]?.kind).toBe("agent")
  expect(items[0]?.stage).toBe("architect")
  expect(items[0]?.messages).toHaveLength(1)
})

test("run.progress keeps executor messages attached to the real goal session", async () => {
  setSelectedTaskID("task-1")
  setBoardStore("selectedTaskID", "task-1")
  setBoardStore("board", {
    task: {
      id: "task-1",
      status: "running",
      sessionID: "root-session",
    },
    interactions: [],
    goalWorkflows: [{
      goalID: "goal-1",
      goalTitle: "Implement auth",
      goalStatus: "running",
      priority: "blocking",
      steps: [],
    }],
    goalRuns: [{
      id: "gr-1",
      goalID: "goal-1",
      status: "running",
      sessionID: "goal-session-1",
      time: { created: 1000, updated: 1000 },
    }],
  })

  expect(routeSSEEvent({
    type: "run.progress",
    timestamp: 1000,
    summary: "Tool call: read_file",
    payload: {
      taskID: "task-1",
      runID: "run-1",
      type: "tool_call",
      sessionID: "goal-session-1",
      sourceID: "tool-1",
      name: "read_file",
      input: { file: "src/auth.ts" },
    },
  })).toBe(true)

  await Bun.sleep(80)

  const group = agentCards()["goal-group:goal-1"]
  expect(group).toBeDefined()
  expect(group.kind).toBe("goal")
  expect(group.internalCards).toHaveLength(1)
  expect(group.internalCards?.[0]?.stage).toBe("executor")
})

test("conversation ui state resets on task switch", () => {
  // Default for an unknown card is true; toggling flips to false (override stored).
  toggleCard("card-1", "completed", true)
  expect(cardExpanded("card-1", "completed", true)).toBe(false)

  setSelectedTaskID("task-a")
  // After task switch the override store is cleared → default returns.
  expect(cardExpanded("card-1", "completed", true)).toBe(true)

  toggleCard("card-1", "completed", true)
  expect(cardExpanded("card-1", "completed", true)).toBe(false)
  setSelectedTaskID("task-b")
  expect(cardExpanded("card-1", "completed", true)).toBe(true)
})
