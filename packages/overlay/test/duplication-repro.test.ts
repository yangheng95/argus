// Reproduction test for card duplication bug.
// Simulates a register_goal scenario: a goal with multiple sub-agent sessions
// (spec → planner → executor), and verifies that repeated calls to
// computeAgentCards() / conversationMessages() don't accumulate duplicates.

import { beforeEach, expect, test } from "bun:test"
import { clearEventQueue, setMessages, computeAgentCards } from "../src/store/messages"
import { setBoardData } from "../src/store/board"
import { conversationMessages } from "../src/utils/conversation"

if (typeof globalThis.requestAnimationFrame === "undefined") {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    cb()
    return 0
  }
}

beforeEach(() => {
  clearEventQueue()
  setMessages([])
  setBoardData(null as any)
})

test("computeAgentCards() does not accumulate duplicates across repeated calls", () => {
  // Seed a task with a goal and sub-agent sessions.
  setBoardData({
    task: { id: "task-1", title: "t", request: "r", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "goal-1",
        goalTitle: "Goal 1",
        goalStatus: "running",
        steps: [
          { stepID: "plan", label: "Plan", status: "completed" },
          { stepID: "execute", label: "Execute", status: "running" },
        ],
      } as any,
    ],
    goalRuns: [
      { goalID: "goal-1", sessionID: "plan-sess", plannerSessionID: "plan-sess" } as any,
      { goalID: "goal-1", sessionID: "exec-sess", executorSessionID: "exec-sess" } as any,
    ],
    interactions: [],
  } as any)

  setMessages([
    // Root assistant (main)
    {
      info: {
        id: "root-msg",
        sessionID: "root-sess",
        role: "assistant",
        channel: "main",
        time: { created: 1 },
      },
      parts: [{ id: "p0", type: "text", text: "root text", sessionID: "root-sess", messageID: "root-msg" }],
    } as any,
    // Planner session (stage="planner")
    {
      info: {
        id: "plan-msg",
        sessionID: "plan-sess",
        role: "assistant",
        channel: "agent",
        resolvedRole: "planner",
        goalID: "goal-1",
        time: { created: 10 },
      },
      parts: [{ id: "p1", type: "text", text: "planning", sessionID: "plan-sess", messageID: "plan-msg" }],
    } as any,
    // Executor session (stage="executor")
    {
      info: {
        id: "exec-msg",
        sessionID: "exec-sess",
        role: "assistant",
        channel: "agent",
        resolvedRole: "executor",
        parentSessionID: "plan-sess",
        goalID: "goal-1",
        time: { created: 20 },
      },
      parts: [{ id: "p2", type: "text", text: "executing", sessionID: "exec-sess", messageID: "exec-msg" }],
    } as any,
  ])

  // First call.
  const call1 = computeAgentCards()
  const call1OrderIDs = [...call1.order]

  // Second call immediately — if there's mutation-based accumulation, internal
  // cards' `children` will grow.
  const call2 = computeAgentCards()

  // Same number of top-level cards.
  expect(call2.order.length).toBe(call1.order.length)

  // For every top-level card, inner children must not have grown across calls.
  for (const id of call2.order) {
    const c1 = call1.cards[id] as any
    const c2 = call2.cards[id] as any
    if (Array.isArray(c1?.internalCards)) {
      expect(c2.internalCards.length).toBe(c1.internalCards.length)
      // Check each internal card's children count
      for (let i = 0; i < c1.internalCards.length; i++) {
        expect(c2.internalCards[i].children.length).toBe(c1.internalCards[i].children.length)
      }
    }
    if (c1?.kind === "agent" && Array.isArray(c1.children)) {
      expect(c2.children.length).toBe(c1.children.length)
    }
  }
})

test("conversationMessages() returns no duplicate IDs across repeated calls", () => {
  setBoardData({
    task: { id: "task-1", title: "t", request: "r", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "goal-1",
        goalTitle: "Goal 1",
        goalStatus: "running",
        steps: [{ stepID: "plan", label: "Plan", status: "running" }],
      } as any,
    ],
    goalRuns: [
      { goalID: "goal-1", sessionID: "plan-sess", plannerSessionID: "plan-sess" } as any,
    ],
    interactions: [],
  } as any)

  setMessages([
    {
      info: {
        id: "plan-msg",
        sessionID: "plan-sess",
        role: "assistant",
        channel: "agent",
        resolvedRole: "planner",
        goalID: "goal-1",
        time: { created: 10 },
      },
      parts: [{ id: "p1", type: "text", text: "planning", sessionID: "plan-sess", messageID: "plan-msg" }],
    } as any,
  ])

  // Running conversationMessages twice should yield two independent arrays,
  // each with no duplicates.
  const run1 = conversationMessages()
  const run2 = conversationMessages()

  const ids1 = run1.map((r: any) => r.info?.id || r.id)
  const ids2 = run2.map((r: any) => r.info?.id || r.id)

  const dupes1 = ids1.filter((id: string, i: number) => ids1.indexOf(id) !== i)
  const dupes2 = ids2.filter((id: string, i: number) => ids2.indexOf(id) !== i)

  expect(dupes1).toEqual([])
  expect(dupes2).toEqual([])
  expect(ids2).toEqual(ids1)
})

test("computeAgentCards() with parent-child sessions does not duplicate children", () => {
  // Parent session + child session in same goal — this is the case where
  // nestWithinBucket's mutation bug manifests.
  setBoardData({
    task: { id: "task-1", title: "t", request: "r", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "goal-1",
        goalTitle: "Goal 1",
        goalStatus: "running",
        steps: [{ stepID: "execute", label: "Execute", status: "running" }],
      } as any,
    ],
    goalRuns: [
      { goalID: "goal-1", sessionID: "parent-sess", executorSessionID: "parent-sess" } as any,
    ],
    interactions: [],
  } as any)

  setMessages([
    // Parent (executor)
    {
      info: {
        id: "parent-msg",
        sessionID: "parent-sess",
        role: "assistant",
        channel: "agent",
        resolvedRole: "executor",
        goalID: "goal-1",
        time: { created: 10 },
      },
      parts: [{ id: "p1", type: "text", text: "parent", sessionID: "parent-sess", messageID: "parent-msg" }],
    } as any,
    // Child (build, parent is parent-sess)
    {
      info: {
        id: "child-msg",
        sessionID: "child-sess",
        role: "assistant",
        channel: "agent",
        resolvedRole: "build",
        parentSessionID: "parent-sess",
        goalID: "goal-1",
        time: { created: 20 },
      },
      parts: [{ id: "p2", type: "text", text: "child", sessionID: "child-sess", messageID: "child-msg" }],
    } as any,
  ])

  // Run multiple times to stress-test mutation.
  for (let i = 0; i < 5; i++) {
    const res = computeAgentCards()
    for (const id of res.order) {
      const c = res.cards[id] as any
      if (Array.isArray(c?.internalCards)) {
        // Each internalCard shouldn't have accumulated children across runs.
        for (const ic of c.internalCards) {
          // A parent executor card has at most 1 child (build).
          expect(ic.children.length).toBeLessThanOrEqual(1)
        }
      }
    }
  }
})
