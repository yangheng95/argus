import { expect, test } from "bun:test"
import { buildAgentWorkflowLanes } from "../src/utils/agent-workflow-lanes"
import type { AgentWorkflowRecord } from "../src/utils/agent-workflow"

function record(id: string, parentSessionID: string, startedAt: number, lastObservedAt: number): AgentWorkflowRecord {
  return {
    id,
    sessionID: id,
    parentSessionID,
    agentName: "build",
    stage: "build",
    status: "running",
    startedAt,
    lastObservedAt,
    attempts: 1,
    depth: 0,
  }
}

test("overlapping same-parent records become one parallel lane", () => {
  const lanes = buildAgentWorkflowLanes([record("a", "root", 100, 300), record("b", "root", 200, 400)])

  expect(lanes).toHaveLength(1)
  expect(lanes[0]?.kind).toBe("parallel")
  expect(lanes[0]?.records.map((item) => item.sessionID)).toEqual(["a", "b"])
})

test("non-overlapping records stay in single lanes", () => {
  const lanes = buildAgentWorkflowLanes([record("a", "root", 100, 150), record("b", "root", 200, 300)])

  expect(lanes.map((lane) => lane.kind)).toEqual(["single", "single"])
})

test("different parents do not stack even when times overlap", () => {
  const lanes = buildAgentWorkflowLanes([record("a", "root-a", 100, 300), record("b", "root-b", 200, 400)])

  expect(lanes.map((lane) => lane.kind)).toEqual(["single", "single"])
})

test("zero-duration observations do not create a false parallel lane", () => {
  const lanes = buildAgentWorkflowLanes([record("a", "root", 100, 100), record("b", "root", 100, 100)])

  expect(lanes.map((lane) => lane.kind)).toEqual(["single", "single"])
})
