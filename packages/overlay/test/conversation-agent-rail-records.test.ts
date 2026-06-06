import { expect, test } from "bun:test"
import {
  mergeAgentRecords,
  sortAgentWorkflowRecordsChronologically,
} from "../src/utils/agent-workflow-records"
import type { AgentWorkflowRecord } from "../src/utils/agent-workflow"
import {
  conversationAgentStore,
  conversationAgentRecordsForSource,
  hydrateConversationAgentView,
  resetConversationAgentView,
} from "../src/store/conversation-agents"

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

test("hydrated agent records target the latest display message in the session", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_build",
        stage: "build",
        messageIDs: ["msg_old", "msg_latest"],
        lastDisplayMessageID: "msg_old",
        firstMessageTime: 100,
        lastMessageTime: 200,
        placement: "top_level",
      },
      {
        sessionID: "ses_goal_build",
        stage: "build",
        parentSessionID: "ses_root",
        goalID: "goal_a",
        messageIDs: ["msg_goal_old", "msg_goal_latest"],
        lastDisplayMessageID: "msg_goal_old",
        firstMessageTime: 300,
        lastMessageTime: 400,
        placement: "goal_phase",
        phase: { stepID: "build", phaseID: "build" },
      },
    ],
  })

  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("build:session:ses_build:message:msg_old")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("msg_old")
  expect(conversationAgentStore.records[1]?.renderedCardID).toBe("step:goal_a:build")
  expect(conversationAgentStore.records[1]?.targetMessageID).toBe("msg_goal_old")
})

test("hydrated agent records fall back to the latest message without a display marker", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_build",
        stage: "build",
        messageIDs: ["msg_old", "msg_latest"],
        firstMessageTime: 100,
        lastMessageTime: 200,
        placement: "top_level",
      },
    ],
  })

  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("build:session:ses_build:message:msg_latest")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("msg_latest")
})

test("hydrated lifecycle-only agent records target the message-less session card", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_frontend_research_failed",
        stage: "frontend-research",
        messageIDs: [],
        firstMessageTime: 100,
        lastMessageTime: 110,
        placement: "top_level",
      },
    ],
  })

  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("frontend-research:session:ses_frontend_research_failed")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("")
})

test("hydrated agent records are scoped to the selected task or session source", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:task_a", {
    sessions: [
      {
        sessionID: "ses_build_a",
        stage: "build",
        messageIDs: ["msg_a"],
        firstMessageTime: 100,
        lastMessageTime: 120,
        placement: "top_level",
      },
    ],
  })

  expect(conversationAgentRecordsForSource({ kind: "task", id: "task_b" })).toEqual([])
  expect(conversationAgentRecordsForSource({ kind: "session", id: "task_a" })).toEqual([])
  expect(conversationAgentRecordsForSource({ kind: "task", id: "task_a" }).map((record) => record.sessionID)).toEqual([
    "ses_build_a",
  ])

  hydrateConversationAgentView("session:ses_coding", {
    sessions: [
      {
        sessionID: "ses_coding_child",
        stage: "assistant",
        messageIDs: ["msg_coding"],
        firstMessageTime: 200,
        lastMessageTime: 220,
        placement: "top_level",
      },
    ],
  })

  expect(conversationAgentRecordsForSource({ kind: "task", id: "task_a" })).toEqual([])
  expect(conversationAgentRecordsForSource({ kind: "session", id: "ses_coding" }).map((record) => record.sessionID)).toEqual([
    "ses_coding_child",
  ])
})
