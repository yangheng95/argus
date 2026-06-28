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
import { applyEvent, renderedConversationCardTargetForMessage, resetWriter } from "../src/services/tree-writer"
import { setBoardStore } from "../src/store/board"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
installRealOverlayI18n()

function testOrderKey(rank: number, time: number, id: string, domain = "test"): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:0000000000000000:${domain}:${id}`
}

function messageOrderKey(id: string, time: number): string {
  return testOrderKey(30, time, id, "message")
}

function partOrderKey(id: string, time: number): string {
  return `v1:${String(time).padStart(16, "0")}:0000000000000031:0000000000000000:part:${id}`
}

function sessionOrderKey(id: string, time: number): string {
  return testOrderKey(50, time, id, "session")
}

function eventOrderKey(id: string, time: number): string {
  return testOrderKey(40, time, id, "event")
}

function boardOrderKey(id: string, time: number, rank: number): string {
  return testOrderKey(rank, time, id, "board")
}

function projectGoalPhaseCard(input: {
  goalID: string
  phaseID: "plan" | "build"
  sessionKind: "planner" | "build"
  startedAt: number
}): void {
  setBoardStore("board", {
    task: { id: "tsk_goal_phase_projection", status: "active" },
    workflow: {
      steps: [
        {
          id: "build",
          label: "Executor",
          phases: [
            { id: "plan", label: "Plan", sessionKind: "planner" },
            { id: "build", label: "Build", sessionKind: "build" },
          ],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: input.goalID,
        goalTitle: "Goal phase projection",
        goalStatus: "running",
        orderIndex: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${input.goalID}-build`, input.startedAt, 61),
            label: "Executor",
            status: "running",
            startedAt: input.startedAt,
            phases: {
              [input.phaseID]: {
                orderKey: boardOrderKey(`${input.goalID}-build-${input.phaseID}`, input.startedAt, 62),
                status: "running",
                startedAt: input.startedAt,
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  applyEvent({ type: "task.updated" })
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
  const orderKey = info.orderKey || messageOrderKey(id, created)
  return {
    type: "message.updated",
    orderKey,
    properties: {
      info: {
        id,
        orderKey,
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
  setBoardStore("board", null)
}

function projectAndApplyLiveMessageUpdated(sourceKey: string, event: any): void {
  applyEvent(event)
  applyLiveConversationAgentMessageUpdated(sourceKey, event)
}

function visiblePartForMessageUpdated(event: any): any {
  const info = event?.properties?.info
  const messageID = String(info?.id || "")
  const sessionID = String(info?.sessionID || "")
  const created = Number(info?.time?.created || 0)
  const partID = `part_${messageID}`
  return {
    type: "message.part.updated",
    emittedAt: created + 1,
    orderKey: event.orderKey,
    properties: {
      orderKey: event.orderKey,
      channel: info?.channel,
      resolvedRole: info?.resolvedRole,
      parentSessionID: info?.parentSessionID,
      goalID: info?.goalID,
      part: {
        id: partID,
        orderKey: partOrderKey(partID, created + 1),
        sessionID,
        messageID,
        type: "text",
        text: `visible text for ${messageID}`,
      },
    },
  }
}

function projectAndApplyVisibleLiveMessageUpdated(sourceKey: string, event: any): void {
  projectAndApplyLiveMessageUpdated(sourceKey, event)
  projectAndApplyLivePartUpdated(sourceKey, visiblePartForMessageUpdated(event))
}

function projectVisibleMessage(event: any): void {
  applyEvent(event)
  applyEvent(visiblePartForMessageUpdated(event))
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

test("conversation agent target merge uses projection orderKey as the only merge key", () => {
  const source = readFileSync(join(import.meta.dir, "../src/store/conversation-agents.ts"), "utf8")
  expect(source).toContain("const incomingProjection = requireProjectedTargetForRecord(")
  expect(source).toContain("const existingProjection = projectedTargetForRecord(existing)")
  expect(source).toContain("const incomingOrderKey = requireTimelineOrderKey(")
  expect(source).not.toContain("incomingProjection?.orderKey || target.orderKey")
  expect(source).not.toContain("incomingProjection?.orderKey")
})

test("hydrated agent records target the latest canonical display message", () => {
  resetRailAndProjection()
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_old",
      sessionID: "ses_build",
      channel: "build",
      time: { created: 100 },
    }),
  )
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_latest",
      sessionID: "ses_build",
      channel: "build",
      time: { created: 200 },
    }),
  )
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_goal_old",
      sessionID: "ses_goal_build",
      channel: "build",
      parentSessionID: "ses_root",
      goalID: "goal_a",
      time: { created: 300 },
    }),
  )
  projectVisibleMessage(
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
  resetRailAndProjection()
  projectGoalPhaseCard({ goalID: "goal_a", phaseID: "build", sessionKind: "build", startedAt: 100 })
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

test("live goal-phase lifecycle-only status targets only a projected phase card", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_live_lifecycle",
    phaseID: "plan",
    sessionKind: "planner",
    startedAt: 1_779_100_000_000,
  })
  applyLiveConversationAgentSessionStatus("task:tsk_live_lifecycle_phase", {
    type: "session.status",
    orderKey: sessionOrderKey("ses_live_lifecycle_phase", 1_779_100_000_100),
    emittedAt: 1_779_100_000_100,
    properties: {
      sessionID: "ses_live_lifecycle_phase",
      channel: "planner",
      resolvedRole: "planner",
      parentSessionID: "ses_goal_root",
      goalID: "goal_live_lifecycle",
      status: { type: "streaming" },
    },
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_lifecycle_phase" })
  expect(records[0]?.targetMessageID).toBe("")
  expect(records[0]?.cardID).toBe("step:goal_live_lifecycle:build:phase:plan")
  expect(records[0]?.renderedCardID).toBe("step:goal_live_lifecycle:build")
  expect(records[0]?.stepID).toBe("build")
  expect(records[0]?.phaseID).toBe("plan")
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
  channel = "build",
) {
  return {
    type: "session.status",
    orderKey: sessionOrderKey(sessionID, emittedAt),
    emittedAt,
    properties: {
      sessionID,
      channel,
      resolvedRole: channel,
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
  projectAndApplyVisibleLiveMessageUpdated(
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

test("live same-millisecond out-of-order messages keep target by orderKey and refresh rendered segment target", () => {
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus("task:tsk_same_ms", liveSessionStatus("ses_same_ms"))
  const created = 1_779_100_000_000
  const targetMessageOrderKey = messageOrderKey("msg_same_b", created)
  projectAndApplyVisibleLiveMessageUpdated(
    "task:tsk_same_ms",
    liveMessageUpdated({
      id: "msg_same_b",
      sessionID: "ses_same_ms",
      channel: "build",
      orderKey: targetMessageOrderKey,
      time: { created },
    }),
  )
  projectAndApplyVisibleLiveMessageUpdated(
    "task:tsk_same_ms",
    liveMessageUpdated({
      id: "msg_same_a",
      sessionID: "ses_same_ms",
      channel: "build",
      orderKey: messageOrderKey("msg_same_a", created),
      time: { created },
    }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_same_ms" })
  expect(records[0]?.targetMessageID).toBe("msg_same_b")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_same_ms:message:msg_same_a")
  expect(renderedConversationCardTargetForMessage("msg_same_b")).toMatchObject({
    renderedCardID: "build:session:ses_same_ms:message:msg_same_a",
    orderKey: targetMessageOrderKey,
  })
})

test("pending same-millisecond live targets use orderKey when session.status arrives later", () => {
  resetRailAndProjection()
  const created = 1_779_100_000_000
  projectAndApplyVisibleLiveMessageUpdated(
    "task:tsk_pending_same_ms",
    liveMessageUpdated({
      id: "msg_pending_b",
      sessionID: "ses_pending_same_ms",
      channel: "build",
      orderKey: messageOrderKey("msg_pending_b", created),
      time: { created },
    }),
  )
  projectAndApplyVisibleLiveMessageUpdated(
    "task:tsk_pending_same_ms",
    liveMessageUpdated({
      id: "msg_pending_a",
      sessionID: "ses_pending_same_ms",
      channel: "build",
      orderKey: messageOrderKey("msg_pending_a", created),
      time: { created },
    }),
  )
  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_pending_same_ms" })).toEqual([])

  applyLiveConversationAgentSessionStatus("task:tsk_pending_same_ms", liveSessionStatus("ses_pending_same_ms"))

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_pending_same_ms" })
  expect(records[0]?.targetMessageID).toBe("msg_pending_b")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_pending_same_ms:message:msg_pending_a")
})

test("live part target is retained until session.status creates rail existence", () => {
  resetRailAndProjection()
  projectAndApplyLivePartUpdated("task:tsk_live", {
    type: "message.part.updated",
    emittedAt: 1_779_099_998_000,
    orderKey: messageOrderKey("msg_part_first", 1_779_099_998_000),
    properties: {
      orderKey: messageOrderKey("msg_part_first", 1_779_099_998_000),
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
      orderKey: messageOrderKey("msg_part_missing_route", 1_779_099_998_000),
      properties: {
        orderKey: messageOrderKey("msg_part_missing_route", 1_779_099_998_000),
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
  projectAndApplyVisibleLiveMessageUpdated(
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

  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_history",
      sessionID: "ses_history_build",
      channel: "build",
      time: { created: 80 },
    }),
  )
  projectVisibleMessage(
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

test("history target attachment replaces stale existing targets with the current projection", () => {
  resetRailAndProjection()
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_stale_projection",
      sessionID: "ses_stale_projection",
      channel: "build",
      time: { created: 100 },
    }),
  )
  hydrateConversationAgentView("task:tsk_stale_projection", {
    sessions: [
      {
        sessionID: "ses_stale_projection",
        stage: "build",
        messageIDs: ["msg_stale_projection"],
        lastDisplayMessageID: "msg_stale_projection",
        firstMessageTime: 100,
        lastMessageTime: 100,
        placement: "top_level",
      },
    ],
  })
  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_stale_projection" })[0]?.targetMessageID).toBe(
    "msg_stale_projection",
  )

  resetWriter()
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_replacement_projection",
      sessionID: "ses_stale_projection",
      channel: "build",
      time: { created: 200 },
    }),
  )

  attachConversationAgentViewTargets("task:tsk_stale_projection", {
    messages: [
      {
        sessionID: "ses_stale_projection",
        stage: "build",
        messageID: "msg_replacement_projection",
        time: 200,
        placement: "top_level",
      },
    ],
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_stale_projection" })
  expect(records[0]?.targetMessageID).toBe("msg_replacement_projection")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_stale_projection:message:msg_replacement_projection")
})

test("history target attachment sorts by incoming projection while retaining a newer existing target", () => {
  resetRailAndProjection()
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_projection_new",
      sessionID: "ses_projection_sort",
      channel: "build",
      time: { created: 300 },
    }),
  )
  hydrateConversationAgentView("task:tsk_projection_sort", {
    sessions: [
      {
        sessionID: "ses_projection_other",
        stage: "build",
        messageIDs: [],
        firstMessageTime: 150,
        lastMessageTime: 150,
        placement: "top_level",
      },
      {
        sessionID: "ses_projection_sort",
        stage: "build",
        messageIDs: ["msg_projection_new"],
        lastDisplayMessageID: "msg_projection_new",
        firstMessageTime: 250,
        lastMessageTime: 300,
        placement: "top_level",
      },
    ],
  })

  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_projection_old",
      sessionID: "ses_projection_sort",
      channel: "build",
      time: { created: 100 },
    }),
  )
  attachConversationAgentViewTargets("task:tsk_projection_sort", {
    messages: [
      {
        sessionID: "ses_projection_sort",
        stage: "build",
        messageID: "msg_projection_old",
        time: 100,
        placement: "top_level",
      },
    ],
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_projection_sort" })
  expect(records.map((record) => record.sessionID)).toEqual(["ses_projection_sort", "ses_projection_other"])
  expect(records[0]?.orderKey).toBe(messageOrderKey("msg_projection_old", 100))
  expect(records[0]?.targetMessageID).toBe("msg_projection_new")
  expect(records[0]?.renderedCardID).toBe("build:session:ses_projection_sort:message:msg_projection_old")
})

test("history target attachment does not overwrite a newer target", () => {
  resetRailAndProjection()
  projectVisibleMessage(
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
  projectAndApplyVisibleLiveMessageUpdated(
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

test("live message.updated without rendered body does not attach a rail target", () => {
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus(
    "task:tsk_error_only",
    liveSessionStatus("ses_error_only", { type: "streaming" }, 1_779_100_000_000, "visual-qa"),
  )
  projectAndApplyLiveMessageUpdated(
    "task:tsk_error_only",
    liveMessageUpdated({
      id: "msg_error_only",
      sessionID: "ses_error_only",
      channel: "visual-qa",
      time: { created: 1_779_100_000_100, completed: 1_779_100_000_200 },
      finish: "error",
      error: {
        name: "PromptBudgetOverflowError",
        data: { message: "context overflow" },
      },
    }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_error_only" })
  expect(records.map((item) => item.sessionID)).toEqual(["ses_error_only"])
  expect(records[0]?.targetMessageID).toBe("")
  expect(records[0]?.renderedCardID).toBeUndefined()
})

test("message removal clears stale rail target projection on read", () => {
  resetRailAndProjection()
  applyLiveConversationAgentSessionStatus("task:tsk_remove", liveSessionStatus("ses_remove"))
  projectAndApplyVisibleLiveMessageUpdated(
    "task:tsk_remove",
    liveMessageUpdated({
      id: "msg_removed_target",
      sessionID: "ses_remove",
      channel: "build",
      time: { created: 1_779_100_000_100 },
    }),
  )
  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_remove" })[0]?.targetMessageID).toBe(
    "msg_removed_target",
  )

  applyEvent({
    type: "message.removed",
    orderKey: eventOrderKey("message.removed", 1_779_100_000_300),
    properties: {
      sessionID: "ses_remove",
      messageID: "msg_removed_target",
    },
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_remove" })
  expect(records[0]?.targetMessageID).toBe("")
  expect(records[0]?.renderedCardID).toBeUndefined()
})

test("live message.updated does not create rail existence without a session ledger record", () => {
  resetRailAndProjection()
  projectAndApplyVisibleLiveMessageUpdated(
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
    orderKey: sessionOrderKey("ses_live_plan", 1_779_100_000_100),
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
  projectAndApplyVisibleLiveMessageUpdated(
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
    orderKey: sessionOrderKey("ses_child_live", 1_779_099_999_000),
    emittedAt: 1_779_099_999_000,
    properties: {
      sessionID: "ses_child_live",
      channel: "assistant",
      resolvedRole: "assistant",
      status: { type: "streaming" },
    },
  })
  projectAndApplyVisibleLiveMessageUpdated(
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
