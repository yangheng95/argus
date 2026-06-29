import { expect, test } from "bun:test"
import { setBoardStore } from "../src/store/board"
import { cardTreeStore } from "../src/store/card-tree"
import { hydrateConversationView, resetWriter } from "../src/services/tree-writer"

function orderKey(
  domain: "task" | "message" | "part" | "board_goal" | "board_step" | "board_phase",
  time: number,
  id: string,
): string {
  const ranks = {
    task: 10,
    message: 30,
    part: 31,
    board_goal: 60,
    board_step: 61,
    board_phase: 62,
  }
  return `v1:${String(time).padStart(16, "0")}:${String(ranks[domain]).padStart(16, "0")}:0000000000000000:${domain}:${id}`
}

function transcriptMessageHasDisplay(message: any): boolean {
  return Array.isArray(message?.parts) && message.parts.some((part: any) => String(part?.text || "").trim())
}

function requirePositiveTime(value: unknown, label: string): number {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) throw new Error(`${label} missing positive time`)
  return time
}

function viewMessagesForTranscript(transcript: any[]): any[] {
  return transcript.filter(transcriptMessageHasDisplay).map((message) => {
    const info = message.info
    const messageID = String(info.id || "")
    const channel = String(info.channel || "")
    return {
      messageID,
      sessionID: String(info.sessionID || ""),
      stage: channel === "main" ? "user" : channel,
      parentSessionID: info.parentSessionID || undefined,
      goalID: info.goalID || undefined,
      time: requirePositiveTime(info.time?.created, `view message ${messageID}`),
      orderKey: info.orderKey,
      placement: info.goalID ? "goal_phase" : "top_level",
      phase: info.goalID && channel === "build" ? { stepID: "build", phaseID: "build" } : undefined,
    }
  })
}

function seedHydrateBoard(taskID: string, created = 1_776_000_050_000): void {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: taskID })
  setBoardStore("board", {
    task: {
      id: taskID,
      status: "active",
      request: "strict hydrate contract",
      sessionID: "ses_root",
      orderKey: orderKey("task", created, taskID),
      time: { created },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
}

function strictTranscriptMessage(input: {
  messageID: string
  sessionID: string
  role?: string
  channel?: string
  time: number
  partID: string
  partOrderKey?: string
}): any {
  return {
    info: {
      id: input.messageID,
      sessionID: input.sessionID,
      ...(input.role === undefined ? {} : { role: input.role }),
      resolvedRole: input.channel || input.role || "assistant",
      channel: input.channel || "assistant",
      orderKey: orderKey("message", input.time, input.messageID),
      time: { created: input.time },
    },
    parts: [
      {
        id: input.partID,
        messageID: input.messageID,
        sessionID: input.sessionID,
        type: "text",
        text: "strict hydrate text",
        ...(input.partOrderKey === undefined ? {} : { orderKey: input.partOrderKey }),
      },
    ],
  }
}

test("hydrateConversationView rejects display view messages without orderKey", () => {
  seedHydrateBoard("tsk_missing_view_order")
  const transcript = [
    strictTranscriptMessage({
      messageID: "msg_missing_view_order",
      sessionID: "ses_missing_view_order",
      role: "assistant",
      time: 1_776_000_050_100,
      partID: "part_missing_view_order",
      partOrderKey: orderKey("part", 1_776_000_050_101, "part_missing_view_order"),
    }),
  ]
  const viewMessages = viewMessagesForTranscript(transcript).map(({ orderKey: _orderKey, ...message }) => message)

  expect(() => hydrateConversationView({ sessions: [], messages: viewMessages }, transcript)).toThrow(
    "hydrateConversationView message msg_missing_view_order missing orderKey",
  )
})

test("hydrateConversationView rejects transcript messages without role", () => {
  seedHydrateBoard("tsk_missing_hydrate_role")
  const transcript = [
    strictTranscriptMessage({
      messageID: "msg_missing_role",
      sessionID: "ses_missing_role",
      time: 1_776_000_050_200,
      partID: "part_missing_role",
      partOrderKey: orderKey("part", 1_776_000_050_201, "part_missing_role"),
    }),
  ]

  expect(() => hydrateConversationView({ sessions: [], messages: viewMessagesForTranscript(transcript) }, transcript))
    .toThrow("hydrateConversationView: message msg_missing_role missing info.role")
})

test("hydrateConversationView rejects display parts without orderKey", () => {
  seedHydrateBoard("tsk_missing_part_order")
  const transcript = [
    strictTranscriptMessage({
      messageID: "msg_missing_part_order",
      sessionID: "ses_missing_part_order",
      role: "assistant",
      time: 1_776_000_050_300,
      partID: "part_missing_order",
    }),
  ]

  expect(() => hydrateConversationView({ sessions: [], messages: viewMessagesForTranscript(transcript) }, transcript))
    .toThrow("persisted message part part_missing_order missing orderKey")
})

test("hydrateConversationView rejects parts without their own message and session identity", () => {
  seedHydrateBoard("tsk_missing_part_owner")
  const transcript = [
    strictTranscriptMessage({
      messageID: "msg_missing_part_owner",
      sessionID: "ses_missing_part_owner",
      role: "assistant",
      time: 1_776_000_050_400,
      partID: "part_missing_owner",
      partOrderKey: orderKey("part", 1_776_000_050_401, "part_missing_owner"),
    }),
  ]
  delete transcript[0].parts[0].messageID

  expect(() => hydrateConversationView({ sessions: [], messages: viewMessagesForTranscript(transcript) }, transcript))
    .toThrow("hydrateConversationView: part part_missing_owner missing messageID/sessionID")
})

test("hydrateConversationView routes goal-phase transcript messages into the phase card", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_hydrate_view" })
  setBoardStore("board", {
    task: {
      id: "tsk_hydrate_view",
      status: "active",
      request: "restore view",
      sessionID: "ses_root",
      orderKey: orderKey("task", 1_776_000_000_000, "tsk_hydrate_view"),
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_1",
        goalRunID: "gr_1",
        goalTitle: "Restore build",
        goalStatus: "running",
        orderKey: orderKey("board_goal", 1_776_000_000_100, "goal_1"),
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_100,
            orderKey: orderKey("board_step", 1_776_000_000_100, "goal_1-build"),
            summary: "restore",
            payload: { buildSessionID: "ses_build" },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_000_200,
                orderKey: orderKey("board_phase", 1_776_000_000_200, "goal_1-build-build"),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })

  const transcript = [
    {
      info: {
        id: "msg_build",
        sessionID: "ses_build",
        role: "assistant",
        resolvedRole: "build",
        channel: "build",
        goalID: "goal_1",
        parentSessionID: "ses_executor",
        orderKey: orderKey("message", 1_776_000_000_300, "msg_build"),
        time: { created: 1_776_000_000_300 },
      },
      parts: [
        {
          id: "part_build_text",
          messageID: "msg_build",
          sessionID: "ses_build",
          type: "text",
          text: "Recovered build output.",
          orderKey: orderKey("part", 1_776_000_000_301, "part_build_text"),
        },
      ],
    },
  ]

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_build",
          stage: "build",
          goalID: "goal_1",
          parentSessionID: "ses_executor",
          messageIDs: ["msg_build"],
          firstMessageTime: 1_776_000_000_300,
        },
      ],
      messages: viewMessagesForTranscript(transcript),
    },
    transcript,
  )

  const phaseCardID = "step:goal_1:build:phase:build"
  expect(cardTreeStore.cards["build:session:ses_build"]).toBeUndefined()
  expect(cardTreeStore.cards[phaseCardID]).toBeDefined()
  expect(
    cardTreeStore.cards[phaseCardID]?.parts.some(
      (part) => part.type === "text" && String(part.text || "").includes("Recovered build output."),
    ),
  ).toBe(true)
})

test("hydrateConversationView restores persisted goal-phase parts with backend-owned part identity", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_hydrate_persisted_parts" })
  setBoardStore("board", {
    task: {
      id: "tsk_hydrate_persisted_parts",
      status: "active",
      request: "restore persisted build parts",
      sessionID: "ses_root",
      orderKey: orderKey("task", 1_776_000_010_000, "tsk_hydrate_persisted_parts"),
      time: { created: 1_776_000_010_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_persisted_parts",
        goalRunID: "gr_persisted_parts",
        goalTitle: "Persisted build",
        goalStatus: "running",
        orderKey: orderKey("board_goal", 1_776_000_010_100, "goal_persisted_parts"),
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            label: "Build",
            status: "running",
            startedAt: 1_776_000_010_100,
            orderKey: orderKey("board_step", 1_776_000_010_100, "goal_persisted_parts-build"),
            payload: { buildSessionID: "ses_build_persisted" },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_010_200,
                orderKey: orderKey("board_phase", 1_776_000_010_200, "goal_persisted_parts-build-build"),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_build_persisted",
          stage: "build",
          goalID: "goal_persisted_parts",
          parentSessionID: "ses_executor",
          messageIDs: ["msg_build_persisted_1", "msg_build_persisted_2"],
          firstMessageTime: 1_776_000_010_300,
          lastMessageTime: 1_776_000_010_400,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
      messages: [
        {
          messageID: "msg_build_persisted_1",
          sessionID: "ses_build_persisted",
          stage: "build",
          parentSessionID: "ses_executor",
          goalID: "goal_persisted_parts",
          time: 1_776_000_010_300,
          orderKey: orderKey("message", 1_776_000_010_300, "msg_build_persisted_1"),
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
        {
          messageID: "msg_build_persisted_2",
          sessionID: "ses_build_persisted",
          stage: "build",
          parentSessionID: "ses_executor",
          goalID: "goal_persisted_parts",
          time: 1_776_000_010_400,
          orderKey: orderKey("message", 1_776_000_010_400, "msg_build_persisted_2"),
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
    },
    [
      {
        info: {
          id: "msg_build_persisted_1",
          sessionID: "ses_build_persisted",
          role: "assistant",
          resolvedRole: "build",
          channel: "build",
          orderKey: orderKey("message", 1_776_000_010_300, "msg_build_persisted_1"),
          time: { created: 1_776_000_010_300 },
        },
        parts: [
          {
            id: "part_build_persisted_1",
            messageID: "msg_build_persisted_1",
            sessionID: "ses_build_persisted",
            type: "text",
            text: "First persisted build body.",
            orderKey: orderKey("part", 1_776_000_010_301, "part_build_persisted_1"),
          },
        ],
      },
      {
        info: {
          id: "msg_build_persisted_2",
          sessionID: "ses_build_persisted",
          role: "assistant",
          resolvedRole: "build",
          channel: "build",
          orderKey: orderKey("message", 1_776_000_010_400, "msg_build_persisted_2"),
          time: { created: 1_776_000_010_400 },
        },
        parts: [
          {
            id: "part_build_persisted_2",
            messageID: "msg_build_persisted_2",
            sessionID: "ses_build_persisted",
            channel: "filtered",
            type: "text",
            text: "Second persisted build body.",
            orderKey: orderKey("part", 1_776_000_010_401, "part_build_persisted_2"),
          },
        ],
      },
    ],
  )

  const phaseCardID = "step:goal_persisted_parts:build:phase:build"
  const phaseParts = cardTreeStore.cards[phaseCardID]?.parts ?? []
  expect(cardTreeStore.cards["build:session:ses_build_persisted"]).toBeUndefined()
  expect(cardTreeStore.cards["filtered:session:ses_stale_part_session:message:msg_stale_part_message"]).toBeUndefined()
  expect(
    phaseParts.some(
      (part) =>
        part.id === "part_build_persisted_1" &&
        part.messageID === "msg_build_persisted_1" &&
        part.sessionID === "ses_build_persisted" &&
        String(part.text || "").includes("First persisted build body."),
    ),
  ).toBe(true)
  expect(
    phaseParts.some(
      (part) =>
        part.id === "part_build_persisted_2" &&
        part.messageID === "msg_build_persisted_2" &&
        part.sessionID === "ses_build_persisted" &&
        String(part.text || "").includes("Second persisted build body."),
    ),
  ).toBe(true)
})

test("hydrateConversationView restores task-scope agent cards with reasoning parts", () => {
  resetWriter()
  setBoardStore("selectedSource", { kind: "task", id: "tsk_task_scope_hydrate" })
  setBoardStore("board", {
    task: {
      id: "tsk_task_scope_hydrate",
      status: "active",
      request: "restore task-scope transcript",
      sessionID: "ses_root",
      orderKey: orderKey("task", 1_776_000_100_000, "tsk_task_scope_hydrate"),
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "requirements",
          status: "completed",
          completedAt: 1_776_000_101_000,
        },
        {
          id: "architect",
          status: "running",
          startedAt: 1_776_000_102_000,
        },
      ],
    },
    goalWorkflows: [],
    interactions: [],
  })

  const transcript = [
    {
      info: {
        id: "msg_requirements",
        sessionID: "ses_requirements",
        role: "assistant",
        resolvedRole: "requirements",
        channel: "requirements",
        orderKey: orderKey("message", 1_776_000_101_100, "msg_requirements"),
        time: { created: 1_776_000_101_100 },
      },
      parts: [
        {
          id: "part_requirements_reasoning",
          messageID: "msg_requirements",
          sessionID: "ses_requirements",
          type: "reasoning",
          text: "Reading the user request and extracting requirements.",
          orderKey: orderKey("part", 1_776_000_101_101, "part_requirements_reasoning"),
        },
        {
          id: "part_requirements_text",
          messageID: "msg_requirements",
          sessionID: "ses_requirements",
          type: "text",
          text: "Requirements registered.",
          orderKey: orderKey("part", 1_776_000_101_102, "part_requirements_text"),
        },
      ],
    },
    {
      info: {
        id: "msg_architect",
        sessionID: "ses_architect",
        role: "assistant",
        resolvedRole: "architect",
        channel: "architect",
        orderKey: orderKey("message", 1_776_000_102_100, "msg_architect"),
        time: { created: 1_776_000_102_100 },
      },
      parts: [
        {
          id: "part_architect_reasoning",
          messageID: "msg_architect",
          sessionID: "ses_architect",
          type: "reasoning",
          text: "Designing goals and contracts.",
          orderKey: orderKey("part", 1_776_000_102_101, "part_architect_reasoning"),
        },
        {
          id: "part_architect_text",
          messageID: "msg_architect",
          sessionID: "ses_architect",
          type: "text",
          text: "Architect is preparing contracts.",
          orderKey: orderKey("part", 1_776_000_102_102, "part_architect_text"),
        },
      ],
    },
  ]

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_requirements",
          stage: "requirements",
          messageIDs: ["msg_requirements"],
          firstMessageTime: 1_776_000_101_100,
          placement: "top_level",
        },
        {
          sessionID: "ses_architect",
          stage: "architect",
          messageIDs: ["msg_architect"],
          firstMessageTime: 1_776_000_102_100,
          placement: "top_level",
        },
      ],
      messages: viewMessagesForTranscript(transcript),
    },
    transcript,
  )

  const requirementsCardID = "requirements:session:ses_requirements:message:msg_requirements"
  const architectCardID = "architect:session:ses_architect:message:msg_architect"
  expect(cardTreeStore.order).toContain(requirementsCardID)
  expect(cardTreeStore.order).toContain(architectCardID)
  expect(
    cardTreeStore.cards[requirementsCardID]?.parts.some(
      (part) => part.type === "reasoning" && String(part.text || "").includes("extracting requirements"),
    ),
  ).toBe(true)
  expect(
    cardTreeStore.cards[architectCardID]?.parts.some(
      (part) => part.type === "reasoning" && String(part.text || "").includes("Designing goals"),
    ),
  ).toBe(true)
})
