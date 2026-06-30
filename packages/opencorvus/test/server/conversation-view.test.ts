import { expect, test } from "bun:test"
import {
  conversationMessageHasDisplay,
  projectConversationAgentView,
  projectConversationView,
} from "../../src/conversation/view"
import { timelineOrderKey } from "../../src/timeline/order"

function sessionOrderKey(sessionID: string, timeCreated: number) {
  return timelineOrderKey({ domain: "session", time: timeCreated, id: sessionID })
}

test("projectConversationView classifies top-level, hidden, and goal-phase sessions", () => {
  const board = {
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_1",
        steps: [
          {
            stepID: "build",
            payload: { buildSessionID: "ses_build" },
            phases: { build: { startedAt: 40 } },
          },
        ],
      },
    ],
  }
  const transcript = [
    {
      info: {
        id: "msg_user",
        sessionID: "ses_root",
        channel: "main",
        time: { created: 10 },
      },
      parts: [{ type: "text", text: "start" }],
    },
    {
      info: {
        id: "msg_requirements",
        sessionID: "ses_req",
        channel: "requirements",
        parentSessionID: "ses_root",
        time: { created: 20 },
      },
      parts: [{ type: "step-finish" }],
    },
    {
      info: {
        id: "msg_executor",
        sessionID: "ses_executor",
        channel: "executor",
        parentSessionID: "ses_root",
        time: { created: 30 },
      },
      parts: [{ type: "tool", tool: "build" }],
    },
    {
      info: {
        id: "msg_build",
        sessionID: "ses_build",
        channel: "build",
        goalID: "goal_1",
        parentSessionID: "ses_executor",
        time: { created: 40 },
      },
      parts: [{ type: "tool", tool: "read" }],
    },
  ]

  const view = projectConversationView(board, transcript)

  expect(view.topLevelSessionIDs).toEqual(["ses_root", "ses_req"])
  expect(view.sessions.find((session) => session.sessionID === "ses_executor")?.placement).toBe("hidden")
  expect(view.sessions.find((session) => session.sessionID === "ses_build")).toEqual(
    expect.objectContaining({
      placement: "goal_phase",
      goalID: "goal_1",
      phase: { stepID: "build", phaseID: "build" },
      messageIDs: ["msg_build"],
      lastDisplayMessageID: "msg_build",
    }),
  )
  expect(view.messages.map((message) => [message.messageID, message.stage, message.placement])).toEqual([
    ["msg_user", "user", "top_level"],
    ["msg_executor", "executor", "hidden"],
    ["msg_build", "build", "goal_phase"],
  ])
  expect(view.messages.find((message) => message.messageID === "msg_build")?.goalID).toBe("goal_1")
  expect(view.messages.find((message) => message.messageID === "msg_build")?.phase).toEqual({
    stepID: "build",
    phaseID: "build",
  })
})

test("projectConversationView keeps deleted goal build transcript visible as top-level display", () => {
  const board = {
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [],
  }
  const transcript = [
    {
      info: {
        id: "msg_deleted_goal",
        sessionID: "ses_deleted_goal_build",
        channel: "build",
        goalID: "goal_deleted",
        parentSessionID: "ses_executor",
        time: { created: 40 },
      },
      parts: [{ type: "text", text: "old build output" }],
    },
  ]

  const view = projectConversationView(board, transcript)
  const session = view.sessions.find((item) => item.sessionID === "ses_deleted_goal_build")
  const message = view.messages.find((item) => item.messageID === "msg_deleted_goal")

  expect(view.topLevelSessionIDs).toEqual(["ses_deleted_goal_build"])
  expect(session).toEqual(
    expect.objectContaining({
      placement: "top_level",
      goalID: undefined,
      phase: undefined,
      messageIDs: ["msg_deleted_goal"],
      lastDisplayMessageID: "msg_deleted_goal",
    }),
  )
  expect(message).toEqual(
    expect.objectContaining({
      placement: "top_level",
      goalID: undefined,
      phase: undefined,
    }),
  )
})

test("projectConversationView rejects stale goal phase ownership in the display projection", () => {
  const board = {
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_1",
        steps: [
          {
            stepID: "build",
            payload: { buildSessionID: "ses_current_build" },
            phases: { build: { startedAt: 40 } },
          },
        ],
      },
    ],
  }
  const transcript = [
    {
      info: {
        id: "msg_stale_build",
        sessionID: "ses_stale_build",
        channel: "build",
        goalID: "goal_1",
        parentSessionID: "ses_executor",
        time: { created: 40 },
      },
      parts: [{ type: "text", text: "stale owner output" }],
    },
  ]

  const view = projectConversationView(board, transcript)

  expect(view.topLevelSessionIDs).toEqual(["ses_stale_build"])
  expect(view.sessions[0]).toEqual(
    expect.objectContaining({
      placement: "top_level",
      goalID: undefined,
      phase: undefined,
    }),
  )
  expect(view.messages[0]).toEqual(
    expect.objectContaining({
      placement: "top_level",
      goalID: undefined,
      phase: undefined,
    }),
  )
})

test("projectConversationView rejects transcript messages without backend created time", () => {
  expect(() =>
    projectConversationView({}, [
      {
        info: {
          id: "msg_missing_time",
          sessionID: "ses_missing_time",
          channel: "assistant",
        },
        parts: [{ type: "text", text: "missing time" }],
      },
    ]),
  ).toThrow("projectConversationView: message msg_missing_time missing info.time.created")
})

test("projectConversationView tracks the last message with displayable content", () => {
  const transcript = [
    {
      info: {
        id: "msg_first",
        sessionID: "ses_build",
        channel: "build",
        time: { created: 10 },
      },
      parts: [{ type: "step-start" }],
    },
    {
      info: {
        id: "msg_display",
        sessionID: "ses_build",
        channel: "build",
        time: { created: 20 },
      },
      parts: [{ type: "text", text: "checked files" }],
    },
    {
      info: {
        id: "msg_finish",
        sessionID: "ses_build",
        channel: "build",
        time: { created: 30 },
      },
      parts: [{ type: "step-finish" }],
    },
  ]

  const view = projectConversationView({}, transcript)

  expect(view.sessions[0]).toEqual(
    expect.objectContaining({
      messageIDs: ["msg_first", "msg_display", "msg_finish"],
      lastDisplayMessageID: "msg_display",
    }),
  )
  expect(view.messages.map((message) => message.messageID)).toEqual(["msg_display"])
})

test("projectConversationView preserves display message identity across shared-session turns", () => {
  const transcript = [
    {
      info: {
        id: "msg_user_1",
        sessionID: "ses_shared",
        channel: "main",
        time: { created: 10 },
      },
      parts: [{ type: "text", text: "first user" }],
    },
    {
      info: {
        id: "msg_mission_1",
        sessionID: "ses_shared",
        channel: "mission",
        time: { created: 20 },
      },
      parts: [{ type: "text", text: "first mission" }],
    },
    {
      info: {
        id: "msg_user_2",
        sessionID: "ses_shared",
        channel: "main",
        time: { created: 30 },
      },
      parts: [{ type: "text", text: "second user" }],
    },
    {
      info: {
        id: "msg_mission_2",
        sessionID: "ses_shared",
        channel: "mission",
        time: { created: 40 },
      },
      parts: [{ type: "text", text: "second mission" }],
    },
  ]

  const view = projectConversationView({}, transcript)

  expect(view.sessions).toHaveLength(1)
  expect(view.sessions[0]?.messageIDs).toEqual(["msg_user_1", "msg_mission_1", "msg_user_2", "msg_mission_2"])
  expect(view.messages.map((message) => [message.messageID, message.stage, message.sessionID])).toEqual([
    ["msg_user_1", "user", "ses_shared"],
    ["msg_mission_1", "mission", "ses_shared"],
    ["msg_user_2", "user", "ses_shared"],
    ["msg_mission_2", "mission", "ses_shared"],
  ])
})

test("projectConversationView orders equal-time display messages by message id", () => {
  const transcript = [
    {
      info: {
        id: "msg_b",
        sessionID: "ses_b",
        channel: "assistant",
        time: { created: 10 },
      },
      parts: [{ type: "text", text: "b" }],
    },
    {
      info: {
        id: "msg_a",
        sessionID: "ses_a",
        channel: "assistant",
        time: { created: 10 },
      },
      parts: [{ type: "text", text: "a" }],
    },
  ]

  const view = projectConversationView({}, transcript)

  expect(view.messages.map((message) => message.messageID)).toEqual(["msg_a", "msg_b"])
  expect(view.sessions.map((session) => session.sessionID)).toEqual(["ses_a", "ses_b"])
})

test("projectConversationView keeps lifecycle-only events out of display sessions", () => {
  const view = projectConversationView(
    {},
    [],
    [
      {
        type: "session.status",
        emittedAt: 1_776_000_010_000,
        payload: {
          sessionID: "ses_frontend_research_failed",
          channel: "frontend-research",
          parentSessionID: "ses_orchestrator",
          status: {
            type: "terminal",
            reason: "error",
            error: "page evidence preparation failed",
          },
        },
      },
    ],
  )

  expect(view.topLevelSessionIDs).toEqual([])
  expect(view.sessions).toEqual([])
  expect(view.messages).toEqual([])
})

test("projectConversationAgentView includes ledger-only execution sessions", () => {
  const view = projectConversationAgentView(
    {},
    [],
    [],
    [
      {
        sessionID: "ses_frontend_research_created",
        stage: "frontend-research",
        parentSessionID: "ses_orchestrator",
        timeCreated: 1_776_000_009_000,
        timeUpdated: 1_776_000_009_500,
        orderKey: sessionOrderKey("ses_frontend_research_created", 1_776_000_009_000),
      },
    ],
  )

  expect(view.topLevelSessionIDs).toEqual([])
  expect(view.messages).toEqual([])
  expect(view.sessions).toEqual([
    expect.objectContaining({
      sessionID: "ses_frontend_research_created",
      stage: "frontend-research",
      parentSessionID: "ses_orchestrator",
      messageIDs: [],
      firstObservedAt: 1_776_000_009_000,
      lastObservedAt: 1_776_000_009_500,
      status: "pending",
      placement: "top_level",
    }),
  ])
})

test("projectConversationAgentView uses lifecycle status only to update ledger sessions", () => {
  const view = projectConversationAgentView(
    {},
    [],
    [
      {
        type: "session.status",
        emittedAt: 1_776_000_010_000,
        payload: {
          sessionID: "ses_frontend_research_failed",
          channel: "frontend-research",
          parentSessionID: "ses_orchestrator",
          status: {
            type: "terminal",
            reason: "error",
            error: "page evidence preparation failed",
          },
        },
      },
    ],
    [
      {
        sessionID: "ses_frontend_research_failed",
        stage: "frontend-research",
        parentSessionID: "ses_orchestrator",
        timeCreated: 1_776_000_009_000,
        timeUpdated: 1_776_000_009_500,
        orderKey: sessionOrderKey("ses_frontend_research_failed", 1_776_000_009_000),
      },
    ],
  )

  expect(view.topLevelSessionIDs).toEqual([])
  expect(view.messages).toEqual([])
  expect(view.sessions).toEqual([
    expect.objectContaining({
      sessionID: "ses_frontend_research_failed",
      stage: "frontend-research",
      parentSessionID: "ses_orchestrator",
      messageIDs: [],
      firstObservedAt: 1_776_000_009_000,
      lastObservedAt: 1_776_000_010_000,
      status: "error",
      placement: "top_level",
    }),
  ])
})

test("projectConversationAgentView applies latest ledger status without replay events", () => {
  const view = projectConversationAgentView(
    {},
    [],
    [],
    [
      {
        sessionID: "ses_cancelled_build",
        stage: "build",
        parentSessionID: "ses_orchestrator",
        timeCreated: 1_776_000_009_000,
        timeUpdated: 1_776_000_009_500,
        orderKey: sessionOrderKey("ses_cancelled_build", 1_776_000_009_000),
        latestStatus: {
          type: "terminal",
          reason: "aborted",
        },
        latestStatusEmittedAt: 1_776_000_011_000,
      },
    ],
  )

  expect(view.sessions).toEqual([
    expect.objectContaining({
      sessionID: "ses_cancelled_build",
      stage: "build",
      status: "skipped",
      firstObservedAt: 1_776_000_009_000,
      lastObservedAt: 1_776_000_011_000,
    }),
  ])
})

test("projectConversationAgentView ignores orphan lifecycle status as rail existence", () => {
  const view = projectConversationAgentView(
    {},
    [],
    [
      {
        type: "session.status",
        emittedAt: 1_776_000_010_000,
        payload: {
          sessionID: "ses_orphan_status",
          channel: "frontend-research",
          parentSessionID: "ses_orchestrator",
          status: { type: "streaming" },
        },
      },
    ],
    [],
  )

  expect(view.sessions).toEqual([])
  expect(view.messages).toEqual([])
})

test("projectConversationAgentView ignores non-status events for rail lifecycle ordering", () => {
  const view = projectConversationAgentView(
    {},
    [],
    [
      {
        type: "run.output",
        payload: {
          sessionID: "ses_frontend_research_created",
          channel: "frontend-research",
        },
      },
      {
        type: "session.status",
        emittedAt: 1_776_000_010_000,
        payload: {
          sessionID: "ses_frontend_research_created",
          channel: "frontend-research",
          parentSessionID: "ses_orchestrator",
          status: { type: "streaming" },
        },
      },
    ],
    [
      {
        sessionID: "ses_frontend_research_created",
        stage: "frontend-research",
        parentSessionID: "ses_orchestrator",
        timeCreated: 1_776_000_009_000,
        timeUpdated: 1_776_000_009_500,
        orderKey: sessionOrderKey("ses_frontend_research_created", 1_776_000_009_000),
      },
    ],
  )

  expect(view.sessions).toEqual([
    expect.objectContaining({
      sessionID: "ses_frontend_research_created",
      lastObservedAt: 1_776_000_010_000,
      status: "running",
    }),
  ])
})

test("conversationMessageHasDisplay rejects envelope-only and control-only messages", () => {
  const base = {
    info: {
      id: "msg",
      sessionID: "ses",
      channel: "build",
      time: { created: 10 },
    },
  }

  expect(conversationMessageHasDisplay({ ...base, parts: [] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "step-start" }] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "step-finish" }] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "boundary" }] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "text", text: "   " }] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "reasoning", text: "" }] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "reasoning", text: "[]" }] })).toBe(false)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "text", text: "visible" }] })).toBe(true)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "reasoning", text: "visible" }] })).toBe(true)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "tool", tool: "read" }] })).toBe(true)
})
