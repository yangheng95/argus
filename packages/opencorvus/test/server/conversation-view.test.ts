import { expect, test } from "bun:test"
import { projectConversationView } from "../../src/conversation/view"

test("projectConversationView classifies top-level, hidden, and goal-phase sessions", () => {
  const board = {
    workflow: {
      steps: [
        {
          id: "build",
          phases: [
            { id: "plan", sessionKind: "planner" },
            { id: "build", sessionKind: "build" },
          ],
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
    },
    {
      info: {
        id: "msg_requirements",
        sessionID: "ses_req",
        channel: "requirements",
        parentSessionID: "ses_root",
        time: { created: 20 },
      },
    },
    {
      info: {
        id: "msg_executor",
        sessionID: "ses_executor",
        channel: "executor",
        parentSessionID: "ses_root",
        time: { created: 30 },
      },
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
    }),
  )
})
