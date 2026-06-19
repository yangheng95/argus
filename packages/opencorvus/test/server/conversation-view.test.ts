import { expect, test } from "bun:test"
import { conversationMessageHasDisplay, projectConversationView } from "../../src/conversation/view"

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
  expect(view.messages.find((message) => message.messageID === "msg_build")?.phase).toEqual({
    stepID: "build",
    phaseID: "build",
  })
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
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "text", text: "visible" }] })).toBe(true)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "reasoning", text: "visible" }] })).toBe(true)
  expect(conversationMessageHasDisplay({ ...base, parts: [{ type: "tool", tool: "read" }] })).toBe(true)
})
