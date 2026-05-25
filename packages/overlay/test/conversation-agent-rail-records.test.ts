import { expect, test } from "bun:test"
import {
  mergeAgentRecords,
  sortAgentWorkflowRecordsChronologically,
} from "../src/utils/agent-workflow-records"
import type { AgentWorkflowRecord } from "../src/utils/agent-workflow"

function record(
  sessionID: string,
  startedAt: number,
  renderedCardID?: string,
): AgentWorkflowRecord {
  return {
    id: sessionID,
    sessionID,
    parentSessionID: "root",
    agentName: "build",
    stage: "build",
    status: "completed",
    startedAt,
    lastObservedAt: startedAt + 10,
    completedAt: startedAt + 10,
    attempts: 1,
    depth: 1,
    ...(renderedCardID ? { renderedCardID } : {}),
  }
}

test("ConversationAgentRail keeps hydrated sessions with deterministic rendered card targets", () => {
  const merged = mergeAgentRecords(
    [
      record("ses_build_orphan_1", 100),
      record("ses_build_hydrated", 110, "build:session:ses_build_hydrated:message:msg_1"),
      { ...record("ses_build_live", 120), goalID: "goal_a" },
    ],
    [
      {
        ...record("ses_build_live", 120, "step:goal_a:build"),
        cardID: "step:goal_a:build:phase:build",
        phaseID: "build",
      },
    ],
  )

  expect(merged.map((item) => item.sessionID)).toEqual(["ses_build_hydrated", "ses_build_live"])
  expect(merged[0]?.renderedCardID).toBe("build:session:ses_build_hydrated:message:msg_1")
  expect(merged[1]?.renderedCardID).toBe("step:goal_a:build")
  expect(merged[1]?.goalID).toBe("goal_a")
})

test("ConversationAgentRail records stay in global chronological order", () => {
  const sorted = sortAgentWorkflowRecordsChronologically([
    record("later_parent_a", 300, "card:later_parent_a"),
    record("early_parent_b", 200, "card:early_parent_b"),
    record("earliest_parent_a", 100, "card:earliest_parent_a"),
  ])

  expect(sorted.map((item) => item.sessionID)).toEqual([
    "earliest_parent_a",
    "early_parent_b",
    "later_parent_a",
  ])
})
