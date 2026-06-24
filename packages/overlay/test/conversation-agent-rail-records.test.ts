import { expect, test } from "bun:test"
import { mergeAgentRecords, sortAgentWorkflowRecordsChronologically } from "../src/utils/agent-workflow-records"
import type { AgentWorkflowRecord } from "../src/utils/agent-workflow"
import {
  conversationAgentStore,
  applyLiveConversationAgentMessageUpdated,
  conversationAgentRecordsForSource,
  hydrateConversationAgentView,
  resetConversationAgentView,
} from "../src/store/conversation-agents"

function record(sessionID: string, startedAt: number, renderedCardID?: string): AgentWorkflowRecord {
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

function liveMessageUpdated(info: Record<string, any>) {
  return {
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        resolvedRole: info.channel,
        agent: info.channel,
        time: { created: 1_779_100_000_000 },
        ...info,
      },
    },
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

test("ConversationAgentRail merge keeps hydrated canonical identity over live card labels", () => {
  const merged = mergeAgentRecords(
    [
      {
        ...record("ses_architect", 100, "architect:session:ses_architect:message:msg_architect"),
        agentName: "architect",
        stage: "architect",
      },
    ],
    [
      {
        ...record("ses_architect", 110, "assistant:session:ses_architect:message:msg_architect"),
        agentName: "assistant",
        stage: "assistant",
      },
    ],
  )

  expect(merged).toHaveLength(1)
  expect(merged[0]?.agentName).toBe("architect")
  expect(merged[0]?.stage).toBe("architect")
  expect(merged[0]?.renderedCardID).toBe("assistant:session:ses_architect:message:msg_architect")
})

test("ConversationAgentRail records stay in global chronological order", () => {
  const sorted = sortAgentWorkflowRecordsChronologically([
    record("later_parent_a", 300, "card:later_parent_a"),
    record("early_parent_b", 200, "card:early_parent_b"),
    record("earliest_parent_a", 100, "card:earliest_parent_a"),
  ])

  expect(sorted.map((item) => item.sessionID)).toEqual(["earliest_parent_a", "early_parent_b", "later_parent_a"])
})

test("hydrated agent records target the latest canonical display message", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    messages: [
      {
        sessionID: "ses_build",
        stage: "build",
        messageID: "msg_old",
        time: 100,
        placement: "top_level",
      },
      {
        sessionID: "ses_build",
        stage: "build",
        messageID: "msg_latest",
        time: 200,
        placement: "top_level",
      },
      {
        sessionID: "ses_goal_build",
        stage: "build",
        parentSessionID: "ses_root",
        goalID: "goal_a",
        messageID: "msg_goal_old",
        time: 300,
        placement: "goal_phase",
        phase: { stepID: "build", phaseID: "build" },
      },
      {
        sessionID: "ses_goal_build",
        stage: "build",
        parentSessionID: "ses_root",
        goalID: "goal_a",
        messageID: "msg_goal_latest",
        time: 400,
        placement: "goal_phase",
        phase: { stepID: "build", phaseID: "build" },
      },
    ],
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

  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("build:session:ses_build:message:msg_latest")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("msg_latest")
  expect(conversationAgentStore.records[1]?.renderedCardID).toBe("step:goal_a:build")
  expect(conversationAgentStore.records[1]?.targetMessageID).toBe("msg_goal_latest")
})

test("hydrated top-level agent records require a display message target", () => {
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

  expect(conversationAgentStore.records).toEqual([])
})

test("hydrated lifecycle-only agent records do not create blank session cards", () => {
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

  expect(conversationAgentStore.records).toEqual([])
})

test("hydrated goal-phase agent records may target the phase card without a display message", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_build_goal",
        stage: "build",
        parentSessionID: "ses_root",
        goalID: "goal_a",
        messageIDs: [],
        firstMessageTime: 100,
        lastMessageTime: 110,
        placement: "goal_phase",
        phase: { stepID: "build", phaseID: "build" },
      },
    ],
  })

  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("step:goal_a:build")
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("")
})

test("hydrated agent records are scoped to the selected task or session source", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:task_a", {
    messages: [
      {
        sessionID: "ses_build_a",
        stage: "build",
        messageID: "msg_a",
        time: 120,
        placement: "top_level",
      },
    ],
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
    messages: [
      {
        sessionID: "ses_coding_child",
        stage: "assistant",
        messageID: "msg_coding",
        time: 220,
        placement: "top_level",
      },
    ],
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
  expect(
    conversationAgentRecordsForSource({ kind: "session", id: "ses_coding" }).map((record) => record.sessionID),
  ).toEqual(["ses_coding_child"])
})

test("live message.updated creates a rail record without waiting for hydrate", () => {
  resetConversationAgentView()
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live",
    liveMessageUpdated({
      id: "msg_live",
      sessionID: "ses_live_build",
      channel: "build",
      time: { created: 1_779_100_000_100 },
    }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })
  expect(records.map((item) => item.sessionID)).toEqual(["ses_live_build"])
  expect(records[0]?.status).toBe("running")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_live_build:message:msg_live")
  expect(records[0]?.targetMessageID).toBe("msg_live")
})

test("live message.updated retargets goal-phase records to the rendered step card", () => {
  resetConversationAgentView()
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live_phase",
    liveMessageUpdated({
      id: "msg_plan",
      sessionID: "ses_live_plan",
      parentSessionID: "ses_goal_root",
      channel: "planner",
      goalID: "goal_live",
      time: { created: 1_779_100_000_200, completed: 1_779_100_000_250 },
    }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_phase" })
  expect(records[0]?.status).toBe("completed")
  expect(records[0]?.parentSessionID).toBe("ses_goal_root")
  expect(records[0]?.cardID).toBe("step:goal_live:build:phase:plan")
  expect(records[0]?.renderedCardID).toBe("step:goal_live:build")
  expect(records[0]?.stepID).toBe("build")
  expect(records[0]?.phaseID).toBe("plan")
})

test("live message.updated ignores non-agent channels", () => {
  resetConversationAgentView()
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live_ignored",
    liveMessageUpdated({
      id: "msg_user",
      sessionID: "ses_user",
      channel: "main",
      role: "user",
      resolvedRole: "user",
      agent: "user",
    }),
  )
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live_ignored",
    liveMessageUpdated({
      id: "msg_filtered",
      sessionID: "ses_filtered",
      channel: "filtered",
      resolvedRole: "filtered",
      agent: "filtered",
    }),
  )

  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_ignored" })).toEqual([])
})

test("live message.updated records are scoped by task and session source keys", () => {
  resetConversationAgentView()
  applyLiveConversationAgentMessageUpdated(
    "session:ses_coding_live",
    liveMessageUpdated({
      id: "msg_coding_live",
      sessionID: "ses_child_live",
      channel: "assistant",
    }),
  )

  expect(conversationAgentRecordsForSource({ kind: "task", id: "ses_coding_live" })).toEqual([])
  expect(
    conversationAgentRecordsForSource({ kind: "session", id: "ses_coding_live" }).map((item) => item.sessionID),
  ).toEqual(["ses_child_live"])
})
