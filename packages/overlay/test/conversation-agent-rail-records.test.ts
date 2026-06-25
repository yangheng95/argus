import { expect, test } from "bun:test"
import { mergeAgentRecords, sortAgentWorkflowRecordsChronologically } from "../src/utils/agent-workflow-records"
import type { AgentWorkflowRecord } from "../src/utils/agent-workflow"
import {
  attachConversationAgentViewTargets,
  conversationAgentStore,
  applyLiveConversationAgentMessageUpdated,
  applyLiveConversationAgentPartUpdated,
  applyLiveConversationAgentSessionStatus,
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

  expect(merged.map((item) => item.sessionID)).toEqual([
    "ses_build_orphan_1",
    "ses_build_hydrated",
    "ses_build_live",
  ])
  expect(merged[0]?.renderedCardID).toBeUndefined()
  expect(merged[1]?.renderedCardID).toBe("build:session:ses_build_hydrated:message:msg_1")
  expect(merged[2]?.renderedCardID).toBe("step:goal_a:build")
  expect(merged[2]?.goalID).toBe("goal_a")
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

test("hydrated top-level execution records do not require a display message target", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_build",
        stage: "build",
        messageIDs: ["msg_old", "msg_latest"],
        firstMessageTime: 100,
        lastMessageTime: 200,
        firstObservedAt: 90,
        lastObservedAt: 210,
        status: "running",
        placement: "top_level",
      },
    ],
  })

  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_build"])
  expect(conversationAgentStore.records[0]?.status).toBe("running")
  expect(conversationAgentStore.records[0]?.startedAt).toBe(90)
  expect(conversationAgentStore.records[0]?.lastObservedAt).toBe(210)
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
})

test("hydrated lifecycle-only agent records create rail entries without blank card targets", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_frontend_research_failed",
        stage: "frontend-research",
        messageIDs: [],
        firstMessageTime: 100,
        lastMessageTime: 110,
        firstObservedAt: 100,
        lastObservedAt: 110,
        status: "error",
        placement: "top_level",
      },
    ],
  })

  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual(["ses_frontend_research_failed"])
  expect(conversationAgentStore.records[0]?.stage).toBe("frontend-research")
  expect(conversationAgentStore.records[0]?.status).toBe("error")
  expect(conversationAgentStore.records[0]?.renderedCardID).toBeUndefined()
  expect(conversationAgentStore.records[0]?.targetMessageID).toBe("")
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

function liveSessionStatus(
  sessionID: string,
  status: Record<string, any> = { type: "streaming" },
  emittedAt = 1_779_099_999_000,
) {
  return {
    type: "session.status",
    emittedAt,
    properties: {
      sessionID,
      channel: "build",
      resolvedRole: "build",
      parentSessionID: "ses_root",
      status,
    },
  }
}

test("live session.status creates a rail record without waiting for hydrate", () => {
  resetConversationAgentView()
  applyLiveConversationAgentSessionStatus("task:tsk_live", liveSessionStatus("ses_live_build"))

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })
  expect(records.map((item) => item.sessionID)).toEqual(["ses_live_build"])
  expect(records[0]?.status).toBe("running")
  expect(records[0]?.renderedCardID).toBeUndefined()
  expect(records[0]?.targetMessageID).toBe("")
})

test("live message target is retained until session.status creates rail existence", () => {
  resetConversationAgentView()
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live",
    liveMessageUpdated({
      id: "msg_live_first",
      sessionID: "ses_live_build",
      channel: "build",
      time: { created: 1_779_099_998_000 },
    }),
  )
  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })).toEqual([])

  applyLiveConversationAgentSessionStatus("task:tsk_live", liveSessionStatus("ses_live_build"))

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })
  expect(records.map((item) => item.sessionID)).toEqual(["ses_live_build"])
  expect(records[0]?.targetMessageID).toBe("msg_live_first")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_live_build:message:msg_live_first")
  expect(records[0]?.lastObservedAt).toBe(1_779_099_999_000)
})

test("live part target is retained until session.status creates rail existence", () => {
  resetConversationAgentView()
  applyLiveConversationAgentPartUpdated("task:tsk_live", {
    type: "message.part.updated",
    emittedAt: 1_779_099_998_000,
    properties: {
      channel: "build",
      resolvedRole: "build",
      parentSessionID: "ses_root",
      part: {
        id: "part_live_first",
        sessionID: "ses_live_build",
        messageID: "msg_part_first",
        type: "text",
        text: "first visible token",
      },
    },
  })
  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })).toEqual([])

  applyLiveConversationAgentSessionStatus("task:tsk_live", liveSessionStatus("ses_live_build"))

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })
  expect(records.map((item) => item.sessionID)).toEqual(["ses_live_build"])
  expect(records[0]?.targetMessageID).toBe("msg_part_first")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_live_build:message:msg_part_first")
})

test("older live message fills an empty target after newer session.status", () => {
  resetConversationAgentView()
  applyLiveConversationAgentSessionStatus(
    "task:tsk_live",
    liveSessionStatus("ses_live_build", { type: "streaming" }, 1_779_100_001_000),
  )
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live",
    liveMessageUpdated({
      id: "msg_older",
      sessionID: "ses_live_build",
      channel: "build",
      time: { created: 1_779_100_000_000 },
    }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })
  expect(records[0]?.targetMessageID).toBe("msg_older")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_live_build:message:msg_older")
  expect(records[0]?.lastObservedAt).toBe(1_779_100_001_000)
})

test("live aborted session.status is a non-success rail status", () => {
  resetConversationAgentView()
  applyLiveConversationAgentSessionStatus(
    "task:tsk_live",
    liveSessionStatus("ses_live_build", { type: "terminal", reason: "aborted" }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live" })
  expect(records.map((item) => item.sessionID)).toEqual(["ses_live_build"])
  expect(records[0]?.status).toBe("skipped")
  expect(records[0]?.completedAt).toBe(1_779_099_999_000)
})

test("history target attachment updates existing rail records without creating existence", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk_history", {
    sessions: [
      {
        sessionID: "ses_history_build",
        stage: "build",
        messageIDs: [],
        firstMessageTime: 100,
        lastMessageTime: 100,
        placement: "top_level",
      },
    ],
  })

  attachConversationAgentViewTargets("task:tsk_history", {
    messages: [
      {
        sessionID: "ses_history_build",
        stage: "build",
        messageID: "msg_history",
        time: 80,
        placement: "top_level",
      },
      {
        sessionID: "ses_missing",
        stage: "build",
        messageID: "msg_missing",
        time: 90,
        placement: "top_level",
      },
    ],
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_history" })
  expect(records.map((record) => record.sessionID)).toEqual(["ses_history_build"])
  expect(records[0]?.targetMessageID).toBe("msg_history")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_history_build:message:msg_history")
})

test("history target attachment does not overwrite a newer target", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:tsk_history", {
    sessions: [
      {
        sessionID: "ses_history_build",
        stage: "build",
        messageIDs: ["msg_new"],
        lastDisplayMessageID: "msg_new",
        firstMessageTime: 100,
        lastMessageTime: 200,
        placement: "top_level",
      },
    ],
  })
  attachConversationAgentViewTargets("task:tsk_history", {
    messages: [
      {
        sessionID: "ses_history_build",
        stage: "build",
        messageID: "msg_old",
        time: 100,
        placement: "top_level",
      },
    ],
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_history" })
  expect(records[0]?.targetMessageID).toBe("msg_new")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_history_build:message:msg_new")
})

test("live message.updated attaches target to an existing rail execution record", () => {
  resetConversationAgentView()
  applyLiveConversationAgentSessionStatus("task:tsk_live", liveSessionStatus("ses_live_build"))
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

test("live message.updated does not create rail existence without a session ledger record", () => {
  resetConversationAgentView()
  applyLiveConversationAgentMessageUpdated(
    "task:tsk_live_no_status",
    liveMessageUpdated({
      id: "msg_live",
      sessionID: "ses_live_build",
      channel: "build",
      time: { created: 1_779_100_000_100 },
    }),
  )

  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_no_status" })).toEqual([])
})

test("live message.updated retargets goal-phase records to the rendered step card", () => {
  resetConversationAgentView()
  applyLiveConversationAgentSessionStatus("task:tsk_live_phase", {
    type: "session.status",
    emittedAt: 1_779_100_000_100,
    properties: {
      sessionID: "ses_live_plan",
      channel: "planner",
      resolvedRole: "planner",
      parentSessionID: "ses_goal_root",
      goalID: "goal_live",
      status: { type: "streaming" },
    },
  })
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
  expect(records[0]?.status).toBe("running")
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
  applyLiveConversationAgentSessionStatus("session:ses_coding_live", {
    type: "session.status",
    emittedAt: 1_779_099_999_000,
    properties: {
      sessionID: "ses_child_live",
      channel: "assistant",
      resolvedRole: "assistant",
      status: { type: "streaming" },
    },
  })
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
