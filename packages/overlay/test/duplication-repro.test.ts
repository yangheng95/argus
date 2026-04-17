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
  // Seed a task with a goal whose per-goal dispatch created a kind="build"
  // container plus planner + executor child sessions.
  setBoardData({
    task: { id: "task-1", title: "t", request: "r", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "goal-1",
        goalTitle: "Goal 1",
        goalStatus: "running",
        steps: [
          { stepID: "build", label: "Build", status: "running" },
        ],
      } as any,
    ],
    goalRuns: [
      {
        goalID: "goal-1",
        sessionID: "exec-sess",
        plannerSessionID: "plan-sess",
        executorSessionID: "exec-sess",
      } as any,
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
    // Build container session (parent = root)
    {
      info: {
        id: "build-msg",
        sessionID: "build-sess",
        role: "assistant",
        channel: "build",
        resolvedRole: "build",
        parentSessionID: "root-sess",
        goalID: "goal-1",
        time: { created: 5 },
      },
      parts: [{ id: "p0b", type: "text", text: "dispatch", sessionID: "build-sess", messageID: "build-msg" }],
    } as any,
    // Planner session (parent = build)
    {
      info: {
        id: "plan-msg",
        sessionID: "plan-sess",
        role: "assistant",
        channel: "planner",
        resolvedRole: "planner",
        parentSessionID: "build-sess",
        goalID: "goal-1",
        time: { created: 10 },
      },
      parts: [{ id: "p1", type: "text", text: "planning", sessionID: "plan-sess", messageID: "plan-msg" }],
    } as any,
    // Executor session (parent = build)
    {
      info: {
        id: "exec-msg",
        sessionID: "exec-sess",
        role: "assistant",
        channel: "executor",
        resolvedRole: "executor",
        parentSessionID: "build-sess",
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
        steps: [{ stepID: "build", label: "Build", status: "running" }],
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
  // Session IDs are deliberately scoped to this test (t3-*) so prior tests'
  // session buckets don't collide with ours — Solid store merge semantics
  // leave previous keys in messagesBySession even after setMessages([]).
  setBoardData({
    task: { id: "t3-task", title: "t", request: "r", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "t3-goal",
        goalTitle: "Goal 1",
        goalStatus: "running",
        steps: [{ stepID: "build", label: "Build", status: "running" }],
      } as any,
    ],
    goalRuns: [
      { goalID: "t3-goal", sessionID: "t3-exec-sess", executorSessionID: "t3-exec-sess" } as any,
    ],
    interactions: [],
  } as any)

  setMessages([
    // Build container (parent = root orchestrator)
    {
      info: {
        id: "t3-build-msg",
        sessionID: "t3-build-sess",
        role: "assistant",
        channel: "build",
        resolvedRole: "build",
        parentSessionID: "t3-root-sess",
        goalID: "t3-goal",
        time: { created: 5 },
      },
      parts: [{ id: "t3-p0", type: "text", text: "dispatch", sessionID: "t3-build-sess", messageID: "t3-build-msg" }],
    } as any,
    // Executor child (parent = build)
    {
      info: {
        id: "t3-exec-msg",
        sessionID: "t3-exec-sess",
        role: "assistant",
        channel: "executor",
        resolvedRole: "executor",
        parentSessionID: "t3-build-sess",
        goalID: "t3-goal",
        time: { created: 20 },
      },
      parts: [{ id: "t3-p2", type: "text", text: "executing", sessionID: "t3-exec-sess", messageID: "t3-exec-msg" }],
    } as any,
  ])

  // Run multiple times to stress-test mutation.
  for (let i = 0; i < 5; i++) {
    const res = computeAgentCards()
    const goalGroupID = "goal-group:t3-goal"
    const c = res.cards[goalGroupID] as any
    if (c && Array.isArray(c.internalCards)) {
      for (const ic of c.internalCards) {
        // A build container has at most 1 child (executor) in this setup.
        expect(ic.children.length).toBeLessThanOrEqual(1)
      }
    }
  }
})
