// More realistic reproduction test — simulates a full register_goal scenario
// with root orchestrator + goal workflow + plan/execute steps with nested
// sub-agent sessions. Verifies no duplicates appear in the final card tree.

import { beforeEach, expect, test } from "bun:test"
import { clearEventQueue, setMessages, computeAgentCards } from "../src/store/messages"
import { setBoardData } from "../src/store/board"
import { conversationMessages } from "../src/utils/conversation"
import { toCardTree } from "../src/utils/card-tree"
import type { CardNode } from "../src/utils/card-tree"

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

function collectNodeIDs(nodes: CardNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id)
    if (n.children) collectNodeIDs(n.children, out)
  }
  return out
}

test("full register_goal scenario: no duplicate card nodes in final tree", () => {
  // Scenario: orchestrator registered a goal; per-goal dispatch created a
  // kind="build" container session and spawned planner + executor as children
  // of build. This matches the single-`build` step pipeline workflow.
  setBoardData({
    task: { id: "task-1", title: "Build trading app", request: "Build it", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "goal-1",
        goalTitle: "Implement NoteStore",
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
    // Root orchestrator assistant messages (main channel, no goal)
    {
      info: {
        id: "root-msg-1",
        sessionID: "root-sess",
        role: "assistant",
        channel: "main",
        resolvedRole: "assistant",
        time: { created: 1 },
      },
      parts: [{ id: "rp1", type: "text", text: "I'll analyze PRD and proceed.", sessionID: "root-sess", messageID: "root-msg-1" }],
    } as any,
    // Build container session (parent = root orchestrator)
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
      parts: [{ id: "p0", type: "text", text: "Dispatching plan + exec for goal", sessionID: "build-sess", messageID: "build-msg" }],
    } as any,
    // Planner session messages (parent = build)
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
      parts: [{ id: "p1", type: "text", text: "Planning steps...", sessionID: "plan-sess", messageID: "plan-msg" }],
    } as any,
    // Executor session messages (parent = build)
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
      parts: [
        { id: "p2a", type: "text", text: "Executing plan...", sessionID: "exec-sess", messageID: "exec-msg" },
        { id: "p2b", type: "tool", tool: "memory_search", sessionID: "exec-sess", messageID: "exec-msg", state: { status: "completed" } },
      ],
    } as any,
  ])

  // Run the full pipeline multiple times to stress-test.
  const idSnapshots: string[][] = []
  for (let i = 0; i < 3; i++) {
    const items = conversationMessages()
    const tree = toCardTree(items)
    const allIDs = collectNodeIDs(tree)
    idSnapshots.push(allIDs)

    // Check for duplicates in this call.
    const dupes = allIDs.filter((id, j) => allIDs.indexOf(id) !== j)
    expect(dupes).toEqual([])

    // Ensure tree structure is as expected:
    // - root orchestrator or main message bubble
    // - goal-group with step children, each step may have sub-children
    expect(tree.length).toBeGreaterThan(0)
  }

  // Each iteration must yield identical ID sets (determinism check)
  expect(idSnapshots[1]).toEqual(idSnapshots[0])
  expect(idSnapshots[2]).toEqual(idSnapshots[0])
})

test("messages in main channel are not also inside agent cards", () => {
  setBoardData({
    task: { id: "task-1", title: "t", request: "r", time: { created: 1 } },
    goalWorkflows: [
      {
        goalID: "goal-1",
        goalTitle: "G",
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
    // Main channel message
    {
      info: {
        id: "main-msg",
        sessionID: "root-sess",
        role: "assistant",
        channel: "main",
        time: { created: 1 },
      },
      parts: [{ id: "mp1", type: "text", text: "MAIN-CONTENT", sessionID: "root-sess", messageID: "main-msg" }],
    } as any,
    // Planner session message
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
      parts: [{ id: "pp1", type: "text", text: "PLANNER-CONTENT", sessionID: "plan-sess", messageID: "plan-msg" }],
    } as any,
  ])

  const items = conversationMessages()

  // Main-channel message should appear as a top-level item
  const mainIDs = items.filter((it: any) => it.info?.id === "main-msg")
  expect(mainIDs.length).toBe(1)

  // Main message should NOT be inside any goal card's internalCards
  const goals = items.filter((it: any) => it.kind === "goal")
  for (const g of goals) {
    const walk = (c: any, acc: string[]) => {
      if (c.kind === "agent" && Array.isArray(c.messages)) {
        for (const m of c.messages) acc.push(m.info?.id)
      }
      for (const child of c.children || c.internalCards || []) walk(child, acc)
    }
    const ids: string[] = []
    walk(g, ids)
    expect(ids).not.toContain("main-msg")
  }
})
