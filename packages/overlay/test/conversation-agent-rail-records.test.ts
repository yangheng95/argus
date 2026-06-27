import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { installRealOverlayI18n } from "./fixtures/i18n"
import { mergeAgentRecords, sortAgentWorkflowRecordsChronologically } from "../src/utils/agent-workflow-records"
import type { AgentWorkflowRecord } from "../src/utils/agent-workflow"
import {
  conversationAgentStore,
  applyLiveConversationAgentMessageUpdated,
  applyLiveConversationAgentPartUpdated,
  applyLiveConversationAgentSessionStatus,
  conversationAgentRecordsForSource,
  hydrateConversationAgentView as hydrateConversationAgentViewRaw,
  resetConversationAgentView,
  attachConversationAgentViewTargets as attachConversationAgentViewTargetsRaw,
} from "../src/store/conversation-agents"
import { applyEvent, resetWriter } from "../src/services/tree-writer"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
installRealOverlayI18n()

function testOrderKey(rank: number, time: number, id: string): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:test:${id}`
}

function messageOrderKey(id: string, time: number): string {
  return testOrderKey(30, time, id)
}

function partOrderKey(id: string, time: number): string {
  return `v1:${String(time).padStart(16, "0")}:0000000000000031:0000000000000000:part:${id}`
}

function sessionOrderKey(id: string, time: number): string {
  return testOrderKey(50, time, id)
}

function eventOrderKey(id: string, time: number): string {
  return testOrderKey(40, time, id)
}

function record(sessionID: string, startedAt: number, renderedCardID?: string): AgentWorkflowRecord {
  return {
    id: sessionID,
    sessionID,
    parentSessionID: "root",
    agentName: "build",
    stage: "build",
    status: "completed",
    orderKey: sessionOrderKey(sessionID, startedAt),
    startedAt,
    lastObservedAt: startedAt + 10,
    completedAt: startedAt + 10,
    attempts: 1,
    depth: 1,
    ...(renderedCardID ? { renderedCardID } : {}),
  }
}

function liveMessageUpdated(info: Record<string, any>) {
  const created = Number(info?.time?.created || 1_779_100_000_000)
  const id = String(info?.id || "msg_live")
  return {
    type: "message.updated",
    properties: {
      info: {
        id,
        orderKey: info.orderKey || messageOrderKey(id, created),
        role: "assistant",
        resolvedRole: info.channel,
        agent: info.channel,
        time: { created: 1_779_100_000_000 },
        ...info,
      },
    },
  }
}

function stampAgentView(view: any): any {
  return {
    ...view,
    messages: Array.isArray(view?.messages)
      ? view.messages.map((message: any) => ({
          ...message,
          orderKey:
            typeof message?.orderKey === "string" && message.orderKey
              ? message.orderKey
              : messageOrderKey(String(message?.messageID || ""), Number(message?.time || 0)),
        }))
      : view?.messages,
    sessions: Array.isArray(view?.sessions)
      ? view.sessions.map((session: any) => {
          const observedAt = Number(session?.firstObservedAt ?? session?.firstMessageTime ?? 0)
          return {
            ...session,
            orderKey:
              typeof session?.orderKey === "string" && session.orderKey
                ? session.orderKey
                : sessionOrderKey(String(session?.sessionID || ""), observedAt),
          }
        })
      : view?.sessions,
  }
}

function hydrateConversationAgentView(sourceKey: string, view: any): void {
  hydrateConversationAgentViewRaw(sourceKey, stampAgentView(view))
}

function attachConversationAgentViewTargets(sourceKey: string, view: any): void {
  attachConversationAgentViewTargetsRaw(sourceKey, stampAgentView(view))
}

function resetRailAndProjection(): void {
  resetConversationAgentView()
  resetWriter()
}

function projectAndApplyLiveMessageUpdated(sourceKey: string, event: any): void {
  applyEvent(event)
  applyLiveConversationAgentMessageUpdated(sourceKey, event)
}

function projectAndApplyLivePartUpdated(sourceKey: string, event: any): void {
  applyEvent(event)
  applyLiveConversationAgentPartUpdated(sourceKey, event)
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

  expect(merged.map((item) => item.sessionID)).toEqual(["ses_build_orphan_1", "ses_build_hydrated", "ses_build_live"])
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

test("ConversationAgentRail locate failures surface through AppLog and notifications", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("function reportLocateFailure")
  expect(source).toContain('AppLog.error("ui", "Agent rail locate failed"')
  expect(source).toContain("notifyWarning({")
  expect(source).toContain("void props.onLocate(current).catch((error) => reportLocateFailure(current, error))")
  expect(source).not.toContain('console.error("[agent-rail] card scroll request failed"')
})

test("hydrated agent records target the latest canonical display message", () => {
  resetRailAndProjection()
  applyEvent(
    liveMessageUpdated({
      id: "msg_old",
      sessionID: "ses_build",
      channel: "build",
      time: { created: 100 },
    }),
  )
  applyEvent(
    liveMessageUpdated({
      id: "msg_latest",
      sessionID: "ses_build",
      channel: "build",
      time: { created: 200 },
    }),
  )
  applyEvent(
    liveMessageUpdated({
      id: "msg_goal_old",
      sessionID: "ses_goal_build",
      channel: "build",
      parentSessionID: "ses_root",
      goalID: "goal_a",
      time: { created: 300 },
    }),
  )
  applyEvent(
    liveMessageUpdated({
      id: "msg_goal_latest",
      sessionID: "ses_goal_build",
      channel: "build",
      parentSessionID: "ses_root",
      goalID: "goal_a",
      time: { created: 400 },
    }),
  )
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

  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("build:session:ses_build:message:msg_old")
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
    orderKey: eventOrderKey(`evt_${sessionID}_${emittedAt}`, emittedAt),
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
  resetRailAndProjection()
  projectAndApplyLiveMessageUpdated(
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
  resetRailAndProjection()
  projectAndApplyLivePartUpdated("task:tsk_live", {
    type: "message.part.updated",
    emittedAt: 1_779_099_998_000,
    properties: {
      orderKey: partOrderKey("part_live_first", 1_779_099_998_000),
      channel: "build",
      resolvedRole: "build",
      parentSessionID: "ses_root",
      part: {
        id: "part_live_first",
        orderKey: partOrderKey("part_live_first", 1_779_099_998_000),
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

test("live part target rejects missing top-level route metadata", () => {
  resetRailAndProjection()
  expect(() =>
    applyLiveConversationAgentPartUpdated("task:tsk_live", {
      type: "message.part.updated",
      emittedAt: 1_779_099_998_000,
      properties: {
        orderKey: partOrderKey("part_missing_route", 1_779_099_998_000),
        parentSessionID: "ses_root",
        part: {
          id: "part_missing_route",
          orderKey: partOrderKey("part_missing_route", 1_779_099_998_000),
          sessionID: "ses_live_build",
          messageID: "msg_part_missing_route",
          channel: "build",
          resolvedRole: "build",
          type: "text",
          text: "visible text must not create a second routing source",
        },
      },
    }),
  ).toThrow(/missing top-level channel\/resolvedRole/)
})

test("older live message fills an empty target after newer session.status", () => {
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus(
    "task:tsk_live",
    liveSessionStatus("ses_live_build", { type: "streaming" }, 1_779_100_001_000),
  )
  projectAndApplyLiveMessageUpdated(
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
  resetRailAndProjection()
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

  applyEvent(
    liveMessageUpdated({
      id: "msg_history",
      sessionID: "ses_history_build",
      channel: "build",
      time: { created: 80 },
    }),
  )
  applyEvent(
    liveMessageUpdated({
      id: "msg_missing",
      sessionID: "ses_missing",
      channel: "build",
      time: { created: 90 },
    }),
  )

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
  resetRailAndProjection()
  applyEvent(
    liveMessageUpdated({
      id: "msg_new",
      sessionID: "ses_history_build",
      channel: "build",
      time: { created: 200 },
    }),
  )
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
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus("task:tsk_live", liveSessionStatus("ses_live_build"))
  projectAndApplyLiveMessageUpdated(
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
  resetRailAndProjection()
  projectAndApplyLiveMessageUpdated(
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
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus("task:tsk_live_phase", {
    type: "session.status",
    orderKey: eventOrderKey("evt_ses_live_plan", 1_779_100_000_100),
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
  projectAndApplyLiveMessageUpdated(
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
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus("session:ses_coding_live", {
    type: "session.status",
    orderKey: eventOrderKey("evt_ses_child_live", 1_779_099_999_000),
    emittedAt: 1_779_099_999_000,
    properties: {
      sessionID: "ses_child_live",
      channel: "assistant",
      resolvedRole: "assistant",
      status: { type: "streaming" },
    },
  })
  projectAndApplyLiveMessageUpdated(
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
