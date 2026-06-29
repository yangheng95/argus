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
import {
  applyEvent,
  renderedConversationCardTargetForGoalPhase,
  renderedConversationCardTargetForMessage,
  resetWriter,
} from "../src/services/tree-writer"
import { cardTreeStore } from "../src/store/card-tree"
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

function taskOrderKey(id: string, time: number): string {
  return testOrderKey(10, time, id, "task")
}

function requirePositiveTime(value: unknown, label: string): number {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) throw new Error(`${label} missing positive time`)
  return time
}

function boardOrderKey(id: string, time: number, rank: number): string {
  return testOrderKey(rank, time, id, "board")
}

function projectGoalPhaseCard(input: {
  goalID: string
  phaseID: "build"
  sessionKind: "build"
  sessionID?: string
  startedAt: number
}): void {
  setBoardStore("board", {
    task: {
      id: "tsk_goal_phase_projection",
      status: "active",
      orderKey: taskOrderKey("tsk_goal_phase_projection", input.startedAt),
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey("tsk_goal_phase_projection-build", input.startedAt, 61),
          label: "Executor",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: input.goalID,
        orderKey: boardOrderKey(input.goalID, input.startedAt, 60),
        goalTitle: "Goal phase projection",
        goalStatus: "running",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${input.goalID}-build`, input.startedAt, 61),
            label: "Executor",
            status: "running",
            startedAt: input.startedAt,
            payload: { buildSessionID: input.sessionID || `ses_${input.goalID}_${input.phaseID}` },
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
  const created = requirePositiveTime(info?.time?.created, "live message.updated info.time.created")
  const id = String(info?.id || "msg_live")
  const orderKey = typeof info.orderKey === "string" && info.orderKey.length > 0 ? info.orderKey : ""
  if (!orderKey) throw new Error(`live message.updated ${id} missing orderKey`)
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
        time: { created },
        ...info,
      },
    },
  }
}

function stampAgentView(view: any): any {
  return {
    ...view,
    messages: Array.isArray(view?.messages)
      ? view.messages.map((message: any) => {
          if (typeof message?.orderKey !== "string" || message.orderKey.length === 0) {
            throw new Error(`agent view message ${String(message?.messageID || "<unknown>")} missing orderKey`)
          }
          return message
        })
      : view?.messages,
    sessions: Array.isArray(view?.sessions)
      ? view.sessions.map((session: any) => {
          if (typeof session?.orderKey !== "string" || session.orderKey.length === 0) {
            throw new Error(`agent view session ${String(session?.sessionID || "<unknown>")} missing orderKey`)
          }
          return session
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
  const created = requirePositiveTime(info?.time?.created, `message part fixture ${messageID || "<unknown>"}`)
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
      orderKey: messageOrderKey("msg_old", 100),
      time: { created: 100 },
    }),
  )
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_latest",
      sessionID: "ses_build",
      channel: "build",
      orderKey: messageOrderKey("msg_latest", 200),
      time: { created: 200 },
    }),
  )
  projectGoalPhaseCard({
    goalID: "goal_a",
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_goal_build",
    startedAt: 300,
  })
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_goal_old",
      sessionID: "ses_goal_build",
      channel: "build",
      parentSessionID: "ses_root",
      goalID: "goal_a",
      orderKey: messageOrderKey("msg_goal_old", 300),
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
      orderKey: messageOrderKey("msg_goal_latest", 400),
      time: { created: 400 },
    }),
  )
  hydrateConversationAgentView("task:tsk", {
    messages: [
      {
        sessionID: "ses_build",
        stage: "build",
        messageID: "msg_old",
        orderKey: messageOrderKey("msg_old", 100),
        time: 100,
        placement: "top_level",
      },
      {
        sessionID: "ses_build",
        stage: "build",
        messageID: "msg_latest",
        orderKey: messageOrderKey("msg_latest", 200),
        time: 200,
        placement: "top_level",
      },
      {
        sessionID: "ses_goal_build",
        stage: "build",
        parentSessionID: "ses_root",
        goalID: "goal_a",
        messageID: "msg_goal_old",
        orderKey: messageOrderKey("msg_goal_old", 300),
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
        orderKey: messageOrderKey("msg_goal_latest", 400),
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
        orderKey: sessionOrderKey("ses_build", 100),
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
        orderKey: sessionOrderKey("ses_goal_build", 300),
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
        orderKey: sessionOrderKey("ses_build", 90),
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
        orderKey: sessionOrderKey("ses_frontend_research_failed", 100),
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
  projectGoalPhaseCard({
    goalID: "goal_a",
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_build_goal",
    startedAt: 100,
  })
  hydrateConversationAgentView("task:tsk", {
    sessions: [
      {
        sessionID: "ses_build_goal",
        stage: "build",
        parentSessionID: "ses_root",
        goalID: "goal_a",
        messageIDs: [],
        orderKey: sessionOrderKey("ses_build_goal", 100),
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
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_live_lifecycle_phase",
    startedAt: 1_779_100_000_000,
  })
  applyLiveConversationAgentSessionStatus("task:tsk_live_lifecycle_phase", {
    type: "session.status",
    orderKey: sessionOrderKey("ses_live_lifecycle_phase", 1_779_100_000_100),
    emittedAt: 1_779_100_000_100,
    properties: {
      sessionID: "ses_live_lifecycle_phase",
      channel: "build",
      resolvedRole: "build",
      parentSessionID: "ses_goal_root",
      goalID: "goal_live_lifecycle",
      status: { type: "streaming" },
    },
  })

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_lifecycle_phase" })
  expect(records[0]?.targetMessageID).toBe("")
  expect(records[0]?.cardID).toBe("step:goal_live_lifecycle:build:phase:build")
  expect(records[0]?.renderedCardID).toBe("step:goal_live_lifecycle:build")
  expect(records[0]?.stepID).toBe("build")
  expect(records[0]?.phaseID).toBe("build")
})

test("live goal-phase lifecycle-only status rejects a non-owner phase session", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_live_lifecycle_owner",
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_current_phase_owner",
    startedAt: 1_779_100_005_000,
  })

  expect(() =>
    applyLiveConversationAgentSessionStatus("task:tsk_live_lifecycle_owner", {
      type: "session.status",
      orderKey: sessionOrderKey("ses_stale_phase_owner", 1_779_100_005_100),
      emittedAt: 1_779_100_005_100,
      properties: {
        sessionID: "ses_stale_phase_owner",
        channel: "build",
        resolvedRole: "build",
        parentSessionID: "ses_goal_root",
        goalID: "goal_live_lifecycle_owner",
        status: { type: "streaming" },
      },
    }),
  ).toThrow("goal phase goal_live_lifecycle_owner/build/build expected session ses_current_phase_owner, got ses_stale_phase_owner")
})

test("rendered goal-phase targets require projected card time evidence", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_missing_phase_time",
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_goal_missing_phase_time_build",
    startedAt: 1_779_100_010_000,
  })
  cardTreeStore.cards["step:goal_missing_phase_time:build:phase:build"].time = 0

  expect(() =>
    renderedConversationCardTargetForGoalPhase({
      goalID: "goal_missing_phase_time",
      stepID: "build",
      phaseID: "build",
      stage: "build",
      sessionID: "ses_goal_missing_phase_time_build",
    }),
  ).toThrow("rendered conversation card step:goal_missing_phase_time:build:phase:build time must be positive")
})

test("rendered goal-phase targets validate explicit phase against session stage", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_phase_source",
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_goal_phase_source_build",
    startedAt: 1_779_100_020_000,
  })

  expect(() =>
    renderedConversationCardTargetForGoalPhase({
      goalID: "goal_phase_source",
      stepID: "other",
      phaseID: "build",
      stage: "build",
      sessionID: "ses_goal_phase_source_build",
    }),
  ).toThrow("does not match stage build workflow phase build/build")
  expect(() =>
    renderedConversationCardTargetForGoalPhase({
      goalID: "goal_phase_source",
      stepID: "build",
      phaseID: "build",
    }),
  ).toThrow("goal-owned session goal_phase_source missing stage for phase projection")
})

test("goal phase target projection does not normalize stage aliases into workflow phases", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_stage_alias",
    phaseID: "build",
    sessionKind: "build",
    startedAt: 1_779_100_030_000,
  })

  expect(renderedConversationCardTargetForGoalPhase({ goalID: "goal_stage_alias", stage: "executor" })).toBeNull()
  expect(() => renderedConversationCardTargetForGoalPhase({ goalID: "goal_stage_alias", stage: "codex" })).toThrow(
    "goal-owned session goal_stage_alias stage codex is not declared as a workflow phase",
  )
  expect(() =>
    renderedConversationCardTargetForGoalPhase({
      goalID: "goal_stage_alias",
      stepID: "build",
      phaseID: "build",
      stage: "coding",
    }),
  ).toThrow("goal-owned session goal_stage_alias stage coding is not declared as a workflow phase")
})

test("hydrated rail records validate goal phase targets with raw backend stage", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_raw_stage",
    phaseID: "build",
    sessionKind: "build",
    startedAt: 1_779_100_040_000,
  })

  expect(() =>
    hydrateConversationAgentView("task:tsk_raw_stage", {
      sessions: [
        {
          sessionID: "ses_raw_coding",
          stage: "coding",
          parentSessionID: "ses_root",
          goalID: "goal_raw_stage",
          messageIDs: [],
          orderKey: sessionOrderKey("ses_raw_coding", 1_779_100_040_100),
          firstMessageTime: 1_779_100_040_100,
          lastMessageTime: 1_779_100_040_100,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
    }),
  ).toThrow("goal-owned session goal_raw_stage stage coding is not declared as a workflow phase")
})

test("live rail records validate goal phase targets with raw channel", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_live_raw_stage",
    phaseID: "build",
    sessionKind: "build",
    startedAt: 1_779_100_050_000,
  })

  expect(() =>
    applyLiveConversationAgentSessionStatus("task:tsk_live_raw_stage", {
      type: "session.status",
      orderKey: sessionOrderKey("ses_live_raw_coding", 1_779_100_050_100),
      emittedAt: 1_779_100_050_100,
      properties: {
        sessionID: "ses_live_raw_coding",
        channel: "coding",
        resolvedRole: "coding",
        parentSessionID: "ses_goal_root",
        goalID: "goal_live_raw_stage",
        status: { type: "streaming" },
      },
    }),
  ).toThrow("goal-owned session goal_live_raw_stage stage coding is not declared as a workflow phase")
})

test("hydrated agent records are scoped to the selected task or session source", () => {
  resetConversationAgentView()
  hydrateConversationAgentView("task:task_a", {
    messages: [
      {
        sessionID: "ses_build_a",
        stage: "build",
        messageID: "msg_a",
        orderKey: messageOrderKey("msg_a", 120),
        time: 120,
        placement: "top_level",
      },
    ],
    sessions: [
      {
        sessionID: "ses_build_a",
        stage: "build",
        messageIDs: ["msg_a"],
        orderKey: sessionOrderKey("ses_build_a", 100),
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
        orderKey: messageOrderKey("msg_coding", 220),
        time: 220,
        placement: "top_level",
      },
    ],
    sessions: [
      {
        sessionID: "ses_coding_child",
        stage: "assistant",
        messageIDs: ["msg_coding"],
        orderKey: sessionOrderKey("ses_coding_child", 200),
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
      orderKey: messageOrderKey("msg_live_first", 1_779_099_998_000),
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
      orderKey: messageOrderKey("msg_older", 1_779_100_000_000),
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
        orderKey: sessionOrderKey("ses_history_build", 100),
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
      orderKey: messageOrderKey("msg_history", 80),
      time: { created: 80 },
    }),
  )
  projectVisibleMessage(
    liveMessageUpdated({
      id: "msg_missing",
      sessionID: "ses_missing",
      channel: "build",
      orderKey: messageOrderKey("msg_missing", 90),
      time: { created: 90 },
    }),
  )

  attachConversationAgentViewTargets("task:tsk_history", {
    messages: [
      {
        sessionID: "ses_history_build",
        stage: "build",
        messageID: "msg_history",
        orderKey: messageOrderKey("msg_history", 80),
        time: 80,
        placement: "top_level",
      },
      {
        sessionID: "ses_missing",
        stage: "build",
        messageID: "msg_missing",
        orderKey: messageOrderKey("msg_missing", 90),
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
      orderKey: messageOrderKey("msg_stale_projection", 100),
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
        orderKey: sessionOrderKey("ses_stale_projection", 100),
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
      orderKey: messageOrderKey("msg_replacement_projection", 200),
      time: { created: 200 },
    }),
  )

  attachConversationAgentViewTargets("task:tsk_stale_projection", {
    messages: [
      {
        sessionID: "ses_stale_projection",
        stage: "build",
        messageID: "msg_replacement_projection",
        orderKey: messageOrderKey("msg_replacement_projection", 200),
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
      orderKey: messageOrderKey("msg_projection_new", 300),
      time: { created: 300 },
    }),
  )
  hydrateConversationAgentView("task:tsk_projection_sort", {
    sessions: [
      {
        sessionID: "ses_projection_other",
        stage: "build",
        messageIDs: [],
        orderKey: sessionOrderKey("ses_projection_other", 150),
        firstMessageTime: 150,
        lastMessageTime: 150,
        placement: "top_level",
      },
      {
        sessionID: "ses_projection_sort",
        stage: "build",
        messageIDs: ["msg_projection_new"],
        lastDisplayMessageID: "msg_projection_new",
        orderKey: sessionOrderKey("ses_projection_sort", 250),
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
      orderKey: messageOrderKey("msg_projection_old", 100),
      time: { created: 100 },
    }),
  )
  attachConversationAgentViewTargets("task:tsk_projection_sort", {
    messages: [
      {
        sessionID: "ses_projection_sort",
        stage: "build",
        messageID: "msg_projection_old",
        orderKey: messageOrderKey("msg_projection_old", 100),
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
      orderKey: messageOrderKey("msg_new", 200),
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
        orderKey: sessionOrderKey("ses_history_build", 100),
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
        orderKey: messageOrderKey("msg_old", 100),
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
      orderKey: messageOrderKey("msg_live", 1_779_100_000_100),
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
      orderKey: messageOrderKey("msg_error_only", 1_779_100_000_100),
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
      orderKey: messageOrderKey("msg_removed_target", 1_779_100_000_100),
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
      orderKey: messageOrderKey("msg_live", 1_779_100_000_100),
      time: { created: 1_779_100_000_100 },
    }),
  )

  expect(conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_no_status" })).toEqual([])
})

test("live message.updated retargets goal-phase records to the rendered step card", () => {
  resetRailAndProjection()
  projectGoalPhaseCard({
    goalID: "goal_live",
    phaseID: "build",
    sessionKind: "build",
    sessionID: "ses_live_build",
    startedAt: 1_779_100_000_100,
  })
  applyLiveConversationAgentSessionStatus("task:tsk_live_phase", {
    type: "session.status",
    orderKey: sessionOrderKey("ses_live_build", 1_779_100_000_100),
    emittedAt: 1_779_100_000_100,
    properties: {
      sessionID: "ses_live_build",
      channel: "build",
      resolvedRole: "build",
      parentSessionID: "ses_goal_root",
      goalID: "goal_live",
      status: { type: "streaming" },
    },
  })
  projectAndApplyVisibleLiveMessageUpdated(
    "task:tsk_live_phase",
    liveMessageUpdated({
      id: "msg_build",
      sessionID: "ses_live_build",
      parentSessionID: "ses_goal_root",
      channel: "build",
      goalID: "goal_live",
      orderKey: messageOrderKey("msg_build", 1_779_100_000_200),
      time: { created: 1_779_100_000_200, completed: 1_779_100_000_250 },
    }),
  )

  const records = conversationAgentRecordsForSource({ kind: "task", id: "tsk_live_phase" })
  expect(records[0]?.status).toBe("running")
  expect(records[0]?.parentSessionID).toBe("ses_goal_root")
  expect(records[0]?.cardID).toBe("step:goal_live:build:phase:build")
  expect(records[0]?.renderedCardID).toBe("step:goal_live:build")
  expect(records[0]?.stepID).toBe("build")
  expect(records[0]?.phaseID).toBe("build")
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
      orderKey: messageOrderKey("msg_user", 1_779_100_000_100),
      time: { created: 1_779_100_000_100 },
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
      orderKey: messageOrderKey("msg_filtered", 1_779_100_000_200),
      time: { created: 1_779_100_000_200 },
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
      orderKey: messageOrderKey("msg_coding_live", 1_779_100_000_300),
      time: { created: 1_779_100_000_300 },
    }),
  )

  expect(conversationAgentRecordsForSource({ kind: "task", id: "ses_coding_live" })).toEqual([])
  expect(
    conversationAgentRecordsForSource({ kind: "session", id: "ses_coding_live" }).map((item) => item.sessionID),
  ).toEqual(["ses_child_live"])
})
