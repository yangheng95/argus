import { test, expect } from "bun:test"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const { boardStore, setBoardStore } = await import("../src/store/board")
const { applyEvent, flushBufferedPartDeltas, resetWriter, hydrateConversationView } = await import(
  "../src/services/tree-writer"
)
const { cardTreeStore } = await import("../src/store/card-tree")
const { collectDialogInteractions } = await import("../src/utils/interaction-dialog")
const { statusBadge } = await import("../src/utils/status-badge")
const { installRealOverlayI18n } = await import("./fixtures/i18n")
const { replay } = await import("./fixtures/replay")
const {
  EVENTS,
  INITIAL_BOARD,
  GOAL_ID,
  GOAL_RUN_ID,
  ROOT_SID,
  EXECUTOR_SID,
  BUILD_SID,
  PLANNER_SID,
  REQUIREMENTS_SID,
  DESIGN_SID,
  ARCHITECT_SID,
  TASK_ID,
} = await import("./fixtures/goal-phase-events")

installRealOverlayI18n()

const INTEGRITY_SID = "ses_integrity"

function stampedInfo(channel: string, info: Record<string, any>) {
  return {
    ...info,
    resolvedRole: info.resolvedRole ?? channel,
    agent: info.agent ?? channel,
    channel,
  }
}

function stampedPart(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, ...cleanPart } = part
  return cleanPart
}

function stampedPartEvent(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, ...cleanPart } = part
  return {
    part: cleanPart,
    resolvedRole: resolvedRole ?? channel,
    channel,
    ...(parentSessionID ? { parentSessionID } : {}),
    ...(goalID ? { goalID } : {}),
  }
}

test("phase cards absorb goal-scoped session parts — no nested session cards", async () => {
  // 正本清源 pass:
  //   - session.kind="executor" is a CONTAINER (no LLM), filtered from UI.
  //   - session.kind="planner" / "build" / "evaluator" all routed DIRECTLY
  //     to their phase card (ensureSessionCard → resolvePhaseOrSessionCardID).
  //     No separate `<stage>:session:<sid>` card is created; the phase card
  //     owns the session's parts. This eliminates the "Build (phase) / 构建
  //     (session)" label mirror that existed when phases had nested agent
  //     children.
  //   - Non-goal sub-agents (requirements / frontend-design / architect)
  //     surface as top-level siblings of the root assistant card.
  const snapshot = await replay(EVENTS, INITIAL_BOARD)

  // 2026-04-19 flatten: the goal-group wrapper card is gone. Each goal's
  // single goal-scope executor step is now a top-level card with goal
  // title / round / description / contracts stamped on it.
  // 2026-04-20: per-goal evaluator removed; build step has plan + build
  // phases only (`evaluate` phase dropped with the deterministic runner).
  const stepCardID = `step:${GOAL_ID}:build` // W2-V26: format reverted 2026-04-26 to attempt-invariant (drop :goalRunID:)
  const planPhaseID = `${stepCardID}:phase:plan`
  const buildPhaseID = `${stepCardID}:phase:build`

  // One real message turn = one card: `<stage>:session:<sid>:message:<mid>`.
  const executorCardID = `executor:session:${EXECUTOR_SID}:message:msg_exec_1`
  const buildWorkerCardID = `build:session:${BUILD_SID}:message:msg_build_1`
  const plannerCardID = `planner:session:${PLANNER_SID}:message:msg_planner_1`
  const requirementsCardID = `requirements:session:${REQUIREMENTS_SID}:message:msg_requirements_1`
  const designCardID = `frontend-design:session:${DESIGN_SID}:message:msg_design_1`
  const architectCardID = `architect:session:${ARCHITECT_SID}:message:msg_architect_1`
  const rootCardID = `assistant:session:${ROOT_SID}:message:msg_orch_1`

  // Step card exists and has the two phase cards in order — no session
  // cards between step and phase.
  expect(snapshot.nodes[stepCardID]).toBeDefined()
  expect(snapshot.nodes[stepCardID]!.childIDs).toEqual([planPhaseID, buildPhaseID])

  // Each phase card exists with the declared kind + phase metadata.
  for (const [id, phaseID] of [
    [planPhaseID, "plan"],
    [buildPhaseID, "build"],
  ] as const) {
    const node = snapshot.nodes[id]
    expect(node).toBeDefined()
    expect(node!.kind).toBe("phase")
    expect(node!.phaseID).toBe(phaseID)
    // Phase cards never nest session cards as children (the session's
    // parts live directly on the phase card). Interaction cards are a
    // separate concern — they can appear as phase children when their
    // sessionID resolves to a phase-absorbed session.
    for (const childID of node!.childIDs || []) {
      expect(childID).not.toMatch(/:session:/)
    }
  }

  // The phase-absorbed session cards DO NOT exist as independent cards.
  // Their parts live on the phase card they were routed to.
  expect(snapshot.nodes[buildWorkerCardID]).toBeUndefined()
  expect(snapshot.nodes[plannerCardID]).toBeUndefined()

  // Phase cards must surface the absorbed sessionID via `phaseSessionID` so
  // the inline AgentSessionReplyBox in Card.tsx can target the running
  // sub-agent session. Without this, absorbed build / planner sessions
  // would have no visible operator input on the phase card.
  expect(snapshot.nodes[buildPhaseID]!.phaseSessionID).toBe(BUILD_SID)
  expect(snapshot.nodes[planPhaseID]!.phaseSessionID).toBe(PLANNER_SID)

  // Build phase's parts include the tool call + text from the build worker
  // session (msg_build_1). Planner phase's parts include the planner's text.
  const buildParts = snapshot.nodes[buildPhaseID]!.parts
  expect(buildParts.some((p) => p.type === "tool" && p.tool === "bash")).toBe(true)
  expect(buildParts.some((p) => p.type === "text" && p.text === "Build passed.")).toBe(true)

  const planParts = snapshot.nodes[planPhaseID]!.parts
  expect(planParts.some((p) => p.type === "text" && p.text === "Planned the build sequence.")).toBe(true)

  // Executor container is NOT rendered as its own card and NOT in top-level.
  expect(snapshot.order).not.toContain(executorCardID)

  // Non-goal sub-agents surface at top level, not nested under root.
  const rootChildren = snapshot.nodes[rootCardID]!.childIDs || []
  for (const cardID of [requirementsCardID, designCardID, architectCardID]) {
    expect(rootChildren).not.toContain(cardID)
    expect(snapshot.order).toContain(cardID)
  }
  expect(snapshot.order).toContain(rootCardID)
})

test("executor sessions surface when they contain visible reasoning", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "show executor reasoning",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  const executorCardID = `executor:session:${EXECUTOR_SID}:message:msg_executor_reasoning`
  const reasoningPartID = "part_executor_reasoning"
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("executor", {
        id: "msg_executor_reasoning",
        sessionID: EXECUTOR_SID,
        role: "assistant",
        resolvedRole: "executor",
        agent: "executor",
        time: { created: 1_776_000_001_000 },
      }),
    },
  })

  expect(cardTreeStore.order).not.toContain(executorCardID)

  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("executor", {
        id: reasoningPartID,
        messageID: "msg_executor_reasoning",
        sessionID: EXECUTOR_SID,
        type: "reasoning",
        text: "",
      }),
    },
  })
  expect(cardTreeStore.order).not.toContain(executorCardID)

  applyEvent({
    type: "message.part.delta",
    properties: {
      taskID: TASK_ID,
      partID: reasoningPartID,
      messageID: "msg_executor_reasoning",
      sessionID: EXECUTOR_SID,
      field: "text",
      delta: "thinking through the executor path",
    },
  })
  flushBufferedPartDeltas()

  expect(cardTreeStore.order).toContain(executorCardID)
  expect(
    cardTreeStore.cards[executorCardID]?.parts.some(
      (part: any) => part.type === "reasoning" && part.text.includes("executor path"),
    ),
  ).toBe(true)
})

test("non-goal agent message shells stay hidden until display content arrives", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "hide blank architect shell",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  const architectCardID = "architect:session:ses_architect_blank:message:msg_architect_blank"
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_architect_blank",
        sessionID: "ses_architect_blank",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      }),
    },
  })

  expect(cardTreeStore.cards[architectCardID]).toBeDefined()
  expect(cardTreeStore.order).not.toContain(architectCardID)

  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "part_architect_visible",
        messageID: "msg_architect_blank",
        sessionID: "ses_architect_blank",
        type: "text",
        text: "Architect produced a visible plan.",
      }),
    },
  })

  expect(cardTreeStore.order).toContain(architectCardID)
  expect(cardTreeStore.order.filter((id) => id === architectCardID)).toHaveLength(1)
})

test("non-goal sub-agent sessions surface at top level, not under their parent session", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "trace hierarchy",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_000 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_architect",
        sessionID: "ses_architect",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "part_root",
        messageID: "msg_root",
        sessionID: ROOT_SID,
        type: "text",
        text: "Root response.",
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "part_architect",
        messageID: "msg_architect",
        sessionID: "ses_architect",
        type: "text",
        text: "Architect response.",
      }),
    },
  })

  const rootCardID = `assistant:session:${ROOT_SID}:message:msg_root`
  const architectCardID = "architect:session:ses_architect:message:msg_architect"

  expect(cardTreeStore.order).toContain(rootCardID)
  expect(cardTreeStore.order).toContain(architectCardID)
  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).not.toContain(architectCardID)
})

test("follow-up user sessions render as plain user bubbles without boundary chrome", () => {
  const USER_SID = "ses_user_followup"

  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "initial request",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("main", {
        id: "msg_user_followup",
        sessionID: USER_SID,
        role: "user",
        resolvedRole: "user",
        agent: "user",
        time: { created: 1_776_000_001_000 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("main", {
        id: "prt_user_followup",
        messageID: "msg_user_followup",
        sessionID: USER_SID,
        type: "text",
        text: "继续",
      }),
    },
  })

  const userCardID = `user:session:${USER_SID}:message:msg_user_followup`
  const userCard = cardTreeStore.cards[userCardID]

  expect(userCard).toBeDefined()
  expect(userCard?.kind).toBe("message")
  expect(userCard?.role).toBe("user")
  expect((userCard?.parts || []).map((part) => part.type)).toEqual(["text"])
  expect(cardTreeStore.order).toContain(userCardID)
})

test("tree-writer preserves step summaries and payloads from board.goalWorkflows", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "trace payloads",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: INITIAL_BOARD.workflow,
    goalWorkflows: [
      {
        goalID: GOAL_ID,
        goalRunID: GOAL_RUN_ID,
        goalTitle: "Scaffold project",
        goalStatus: "running",
        orderIndex: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_001_000,
            summary: "3 planned steps",
            payload: {
              planNodes: [{ id: "pn_1", title: "Create shell", brief: "init app", orderIndex: 1 }],
              buildSessionID: BUILD_SID,
            },
            phases: {
              plan: { status: "completed", startedAt: 1_776_000_001_000, completedAt: 1_776_000_001_500 },
              build: { status: "running", startedAt: 1_776_000_001_500 },
              evaluate: { status: "pending" },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  applyEvent({
    type: "task.updated",
    properties: {
      taskID: TASK_ID,
      task: { id: TASK_ID, goalWorkflows: [] },
    },
  })

  const stepCardID = `step:${GOAL_ID}:build` // W2-V26: format reverted 2026-04-26 to attempt-invariant (drop :goalRunID:)
  // Step headers no longer duplicate the summary into `subtitle`; the
  // summary lives in the structured step payload instead.
  expect(cardTreeStore.cards[stepCardID]?.subtitle).toBeUndefined()
  expect(cardTreeStore.cards[stepCardID]?.title).toBe("Scaffold project")
  expect(cardTreeStore.cards[stepCardID]?.round).toBe(1)
  expect(cardTreeStore.cards[stepCardID]?.stepID).toBe("build")
  expect(cardTreeStore.cards[stepCardID]?.goalID).toBe(GOAL_ID)
  expect(cardTreeStore.cards[stepCardID]?.stepPayload?.buildSessionID).toBe(BUILD_SID)
  expect(cardTreeStore.cards[stepCardID]?.stepPayload?.planNodes?.[0]?.title).toBe("Create shell")
  // §6.4 negative guard — worktree was demoted from step payload to the
  // goal-level workspaceDir/workspaceBranch (board.ts projection). The
  // copied step payload must not regrow it; otherwise the wire-collapse
  // gets silently undone (rule 8 — single source).
  expect(Object.keys(cardTreeStore.cards[stepCardID]?.stepPayload ?? {})).not.toContain("workspaceDir")
})

test("tree-writer projects interactions into session children and top-level cards", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "trace interactions",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [
      {
        id: "int_claimed",
        sessionID: ROOT_SID,
        type: "permission",
        status: "pending",
        title: "Need approval",
        body: "Allow write?",
        time: { created: 1_776_000_001_000 },
      },
      {
        id: "int_orphan",
        type: "question",
        status: "pending",
        title: "Need input",
        body: "Which mode?",
        time: { created: 1_776_000_002_000 },
      },
    ],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root_interaction",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      }),
    },
  })

  const rootCardID = `assistant:session:${ROOT_SID}:message:msg_root_interaction`
  const claimedCardID = "interaction-card:ctx:interaction:int_claimed"
  const orphanCardID = "interaction-card:ctx:interaction:int_orphan"

  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).toContain(claimedCardID)
  expect(cardTreeStore.order).toContain(orphanCardID)
  expect(cardTreeStore.cards[claimedCardID]?.parts?.[0]?.type).toBe("interaction-permission")
  expect(cardTreeStore.cards[orphanCardID]?.parts?.[0]?.type).toBe("interaction-question")
})

test("tree-writer projects raw Mission question events into the session card", () => {
  const MISSION_SID = "ses_mission_question"
  const QUESTION_ID = "que_mission_stack"
  setBoardStore("board", {
    kind: "session",
    sessionID: MISSION_SID,
    status: "active",
    title: "Mission Control",
    directory: "D:/repo",
  })
  setBoardStore("selectedSource", { kind: "session", id: MISSION_SID })
  expect(boardStore.selectedSource).toEqual({ kind: "session", id: MISSION_SID })
  resetWriter()

  applyEvent({
    type: "message.updated",
    properties: {
      info: stampedInfo("mission", {
        id: "msg_mission_question",
        sessionID: MISSION_SID,
        role: "assistant",
        resolvedRole: "mission",
        agent: "mission",
        channel: "mission",
        time: { created: 1_780_500_000_000 },
      }),
    },
  })

  applyEvent({
    type: "question.asked",
    emittedAt: 1_780_500_000_500,
    properties: {
      id: QUESTION_ID,
      sessionID: MISSION_SID,
      questions: [
        {
          header: "Tech Stack",
          question: "What tech stack should the Mission use?",
          options: [{ label: "Vite + React", description: "Fast local app" }],
        },
      ],
      tool: { messageID: "msg_mission_question", callID: "call_question" },
    },
  })

  const missionCardID = `mission:session:${MISSION_SID}:message:msg_mission_question`
  const questionCardID = `interaction-card:ctx:interaction:${QUESTION_ID}`
  const questionPart = cardTreeStore.cards[questionCardID]?.parts?.[0] as any

  expect(cardTreeStore.cards[missionCardID]?.childIDs || []).toContain(questionCardID)
  expect(questionPart?.type).toBe("interaction-question")
  expect(questionPart?.interaction?.replyEndpoint).toBe("question")
  expect(questionPart?.interaction?.payload?.questions?.[0]?.header).toBe("Tech Stack")
  expect(collectDialogInteractions(cardTreeStore.cards).map((item) => item.id)).toContain(QUESTION_ID)
})

test("tree-writer keeps background Mission questions available for the popup host", () => {
  const MISSION_SID = "ses_background_mission_question"
  const QUESTION_ID = "que_background_mission_stack"
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "active task while mission runs",
      sessionID: ROOT_SID,
      time: { created: 1_780_600_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent({
    type: "message.updated",
    properties: {
      info: stampedInfo("mission", {
        id: "msg_background_mission_question",
        sessionID: MISSION_SID,
        role: "assistant",
        resolvedRole: "mission",
        agent: "mission",
        channel: "mission",
        time: { created: 1_780_600_000_100 },
      }),
    },
  })

  applyEvent({
    type: "question.asked",
    emittedAt: 1_780_600_000_500,
    properties: {
      id: QUESTION_ID,
      sessionID: MISSION_SID,
      questions: [
        {
          header: "Priority",
          question: "Should the Mission continue waiting for the external deployment?",
          options: [{ label: "Wait", description: "Keep the mission open" }],
        },
      ],
      tool: { messageID: "msg_background_mission_question", callID: "call_question" },
    },
  })

  const missionCardID = `mission:session:${MISSION_SID}:message:msg_background_mission_question`
  const questionCardID = `interaction-card:ctx:interaction:${QUESTION_ID}`
  expect(cardTreeStore.cards[missionCardID]?.childIDs || []).toContain(questionCardID)
  expect(collectDialogInteractions(cardTreeStore.cards).map((item) => item.id)).toContain(QUESTION_ID)
})

test("tree-writer does not duplicate task questions from raw question events", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "task question",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent({
    type: "question.asked",
    emittedAt: 1_776_000_000_500,
    properties: {
      id: "que_task_normalized_elsewhere",
      sessionID: ROOT_SID,
      questions: [{ header: "Task", question: "Should not render raw?" }],
    },
  })

  expect(cardTreeStore.cards["interaction-card:ctx:interaction:que_task_normalized_elsewhere"]).toBeUndefined()
})

test("root assistant session with parentSessionID pointing to task-virtual root surfaces at top level", () => {
  // Mirrors real backend shape (task-message-protocol-bridge.ts stamps
  // task.sessionID onto every event; the root assistant session therefore
  // has parentSessionID = task.sessionID even though task.sessionID never
  // emits any message.updated). Regression guard for the Step 2 rewrite
  // that initially hid the root assistant behind a pending-parent check
  // and left the overlay completely blank.
  const TASK_VIRTUAL_SID = "ses_task_virtual_root"
  const ROOT_ASSISTANT_SID = "ses_real_assistant"

  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "virtual root",
      sessionID: TASK_VIRTUAL_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root",
        sessionID: ROOT_ASSISTANT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        parentSessionID: TASK_VIRTUAL_SID,
        time: { created: 1_776_000_000_500 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_root",
        messageID: "msg_root",
        sessionID: ROOT_ASSISTANT_SID,
        type: "text",
        text: "root assistant visible content",
      }),
    },
  })

  const rootCardID = `assistant:session:${ROOT_ASSISTANT_SID}:message:msg_root`
  expect(cardTreeStore.cards[rootCardID]).toBeDefined()
  expect(cardTreeStore.order).toContain(rootCardID)
})

test("channel-stamped part.updated materializes the correct session card immediately", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "trace pending sessions",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  // A message.part.updated arrives before any message.updated for this
  // session (high-cadence streaming race). Because the fixture now carries
  // the bridge-stamped channel, tree-writer can materialize the correct
  // staged session card immediately instead of creating a pending stub.
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("planner", {
        id: "prt_stream",
        messageID: "msg_race",
        sessionID: "ses_race",
        type: "text",
        text: "partial stream",
        parentSessionID: ROOT_SID,
      }),
    },
  })

  const plannerRaceCardID = "planner:session:ses_race:message:msg_race"
  expect(cardTreeStore.cards["pending:session:ses_race"]).toBeUndefined()
  expect(cardTreeStore.cards[plannerRaceCardID]).toBeDefined()
  expect(cardTreeStore.order).toContain(plannerRaceCardID)

  // Once message.updated arrives, the same planner turn card stays put.
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("planner", {
        id: "msg_race",
        sessionID: "ses_race",
        role: "assistant",
        resolvedRole: "planner",
        agent: "planner",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      }),
    },
  })

  const rootCardID = `assistant:session:${ROOT_SID}:message:msg_root`
  expect(cardTreeStore.cards["pending:session:ses_race"]).toBeUndefined()
  expect(cardTreeStore.cards[plannerRaceCardID]).toBeDefined()
  expect(cardTreeStore.order).not.toContain(rootCardID)
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_root_race",
        messageID: "msg_root",
        sessionID: ROOT_SID,
        type: "text",
        text: "root stream after race",
      }),
    },
  })
  expect(cardTreeStore.order).toContain(rootCardID)
  // Planner is now a top-level sibling of the root assistant, not a child.
  expect(cardTreeStore.order).toContain(plannerRaceCardID)
  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).not.toContain(plannerRaceCardID)
})

// ── Integrity review (renamed from "fidelity" 2026-04+) ──
//
// `integrity.review.completed` is the single event type the writer
// projects into a dedicated integrity session card. The card is a
// regular session card (kind="agent", stage="integrity") materialized
// via ensureSessionCard; the structured verdict lives on
// `node.integrity` and the IntegrityBody renderer keys off that field.
// Running integrity cards now come from the shared `review.stream.*`
// lifecycle; completed integrity verdicts remain phase-specific.

test("integrity completed event materializes an integrity session card with structured verdict", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "integrity ordering",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "integrity.review.completed",
    emittedAt: 1_776_000_002_000,
    properties: {
      taskID: TASK_ID,
      sessionID: INTEGRITY_SID,
      verdict: "needs_correction",
      summary: "team found a blocking gap",
      teamReportMarkdown: "Blocking: missing goal X",
      reviewers: [
        {
          reviewerID: "completion",
          scope: "completion",
          verdict: "needs_correction",
          summary: "missing goal X",
          evidence: ["request asks X"],
          findings: [],
          openQuestions: [],
        },
        {
          reviewerID: "runtime",
          scope: "runtime",
          verdict: "pass",
          summary: "no runtime issue",
          evidence: [],
          findings: [],
          openQuestions: [],
        },
      ],
      findings: [
        {
          id: "missing-x",
          severity: "blocking",
          verdictImpact: "needs_correction",
          title: "Missing X",
          description: "missing goal X",
          evidence: ["request asks X"],
          targetIDs: [],
          requirementIDs: [],
          specIDs: [],
          filePaths: [],
          repair: "Add X",
          reviewers: ["completion"],
          consensus: "agreed",
        },
      ],
      rounds: [],
      requiredRepairs: [
        { id: "repair-x", description: "Add X", evidence: ["request asks X"], targetIDs: [], filePaths: [] },
      ],
      unresolvedDisagreements: [],
      attempts: 1,
    },
  })

  const integrityCardID = `integrity:session:${INTEGRITY_SID}`
  expect(cardTreeStore.cards[integrityCardID]).toBeDefined()
  expect(cardTreeStore.cards[integrityCardID]?.kind).toBe("agent")
  expect(cardTreeStore.cards[integrityCardID]?.stage).toBe("integrity")
  expect(cardTreeStore.cards[integrityCardID]?.integrity?.verdict).toBe("needs_correction")
  expect(cardTreeStore.cards[integrityCardID]?.integrity?.findings?.[0]?.id).toBe("missing-x")
  expect(cardTreeStore.cards[integrityCardID]?.integrity?.requiredRepairs?.[0]?.id).toBe("repair-x")
  expect(cardTreeStore.order).toContain(integrityCardID)
})

test("integrity completed event can materialize before any message stream arrives", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "integrity race",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  // The protocol event itself carries enough identity to create the
  // integrity session card even before any message/part stream arrives.
  applyEvent({
    type: "integrity.review.completed",
    emittedAt: 1_776_000_002_000,
    properties: {
      taskID: TASK_ID,
      sessionID: INTEGRITY_SID,
      verdict: "pass",
      summary: "all clean",
      teamReportMarkdown: "No findings.",
      reviewers: [
        {
          reviewerID: "completion",
          scope: "completion",
          verdict: "pass",
          summary: "complete",
          evidence: [],
          findings: [],
          openQuestions: [],
        },
        {
          reviewerID: "runtime",
          scope: "runtime",
          verdict: "pass",
          summary: "runtime ok",
          evidence: [],
          findings: [],
          openQuestions: [],
        },
      ],
      findings: [],
      rounds: [],
      requiredRepairs: [],
      unresolvedDisagreements: [],
      attempts: 1,
    },
  })

  const integrityCardID = `integrity:session:${INTEGRITY_SID}`
  expect(cardTreeStore.cards[integrityCardID]).toBeDefined()
  expect(cardTreeStore.cards[integrityCardID]?.status).toBe("completed")
  expect(cardTreeStore.cards[integrityCardID]?.integrity?.verdict).toBe("pass")
  expect(cardTreeStore.order).toContain(integrityCardID)
})

test("integrity event missing sessionID throws (schema became required)", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "integrity schema",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  expect(() =>
    applyEvent({
      type: "integrity.review.completed",
      emittedAt: 1_776_000_002_000,
      properties: {
        taskID: TASK_ID,
        verdict: "pass",
        summary: "",
        teamReportMarkdown: "",
        reviewers: [],
        findings: [],
        rounds: [],
        requiredRepairs: [],
        unresolvedDisagreements: [],
        attempts: 0,
      },
    }),
  ).toThrow(/missing sessionID/)
})

test("integrity progress no longer writes elapsed string into subtitle", () => {
  // 2026-05-11: previously tree-writer composed `"Xm Ys elapsed"` (and
  // `"attempt N · Xm Ys elapsed"`) into the running integrity card's
  // subtitle every 20s. That double-sourced the elapsed UX against
  // CardHeader's `.card__duration` chip. Subtitle now carries only the
  // attempt label; CardHeader owns the live elapsed string.
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "integrity elapsed single source",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "review.stream.started",
    emittedAt: 1_776_000_001_000,
    properties: {
      taskID: TASK_ID,
      reviewID: `integrity:${INTEGRITY_SID}`,
      phase: "integrity",
      sessionID: INTEGRITY_SID,
    },
  })
  applyEvent({
    type: "review.stream.progress",
    emittedAt: 1_776_000_021_000,
    properties: {
      taskID: TASK_ID,
      reviewID: `integrity:${INTEGRITY_SID}`,
      phase: "integrity",
      currentStep: "agent",
      attempt: 0,
      elapsedMs: 20_000,
    },
  })

  const integrityCardID = `integrity:session:${INTEGRITY_SID}`
  const beforeRetry = cardTreeStore.cards[integrityCardID]
  expect(beforeRetry).toBeDefined()
  expect(beforeRetry!.status).toBe("running")
  // attempt 0 → no subtitle at all.
  expect(beforeRetry!.subtitle).toBeUndefined()

  applyEvent({
    type: "review.stream.progress",
    emittedAt: 1_776_000_101_000,
    properties: {
      taskID: TASK_ID,
      reviewID: `integrity:${INTEGRITY_SID}`,
      phase: "integrity",
      currentStep: "agent",
      attempt: 2,
      elapsedMs: 100_000,
    },
  })

  const afterRetry = cardTreeStore.cards[integrityCardID]!
  // Subtitle reflects the retry attempt; nothing about elapsed time.
  expect(afterRetry.subtitle).toBeDefined()
  expect(afterRetry.subtitle).not.toContain("elapsed")
  expect(afterRetry.subtitle).toMatch(/attempt 2|integrity\.attempt_label/)
  // `time` is set from the started event so CardHeader can subtract from
  // the shared 1Hz tick to display the running duration.
  expect(afterRetry.time).toBe(1_776_000_001_000)
})

test("integrity reasoning chunks append byte-identical text without changing the rendered part shape", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "integrity reasoning streaming",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "review.stream.started",
    emittedAt: 1_776_000_001_000,
    properties: {
      taskID: TASK_ID,
      reviewID: `integrity:${INTEGRITY_SID}`,
      phase: "integrity",
      sessionID: INTEGRITY_SID,
    },
  })

  for (const delta of ["plan ", "then ", "verify"]) {
    applyEvent({
      type: "review.stream.chunk",
      emittedAt: 1_776_000_001_100,
      properties: {
        taskID: TASK_ID,
        reviewID: `integrity:${INTEGRITY_SID}`,
        phase: "integrity",
        kind: "reasoning",
        attempt: 1,
        delta,
      },
    })
  }

  const integrityCardID = `integrity:session:${INTEGRITY_SID}`
  const part = cardTreeStore.cards[integrityCardID]?.parts.find(
    (entry: any) => entry?.partID === `review:integrity:${INTEGRITY_SID}:reasoning:1`,
  )
  expect(part).toEqual({
    type: "reasoning",
    partID: `review:integrity:${INTEGRITY_SID}:reasoning:1`,
    text: "plan then verify",
  })
  expect(String(part?.text || "")).toBe("plan then verify")
})

test("resetWriter clears integrity session cards materialized from protocol events", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "integrity reset",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "integrity.review.completed",
    emittedAt: 1_776_000_002_000,
    properties: {
      taskID: TASK_ID,
      sessionID: INTEGRITY_SID,
      verdict: "pass",
      summary: "",
      teamReportMarkdown: "No findings.",
      reviewers: [
        {
          reviewerID: "completion",
          scope: "completion",
          verdict: "pass",
          summary: "complete",
          evidence: [],
          findings: [],
          openQuestions: [],
        },
        {
          reviewerID: "runtime",
          scope: "runtime",
          verdict: "pass",
          summary: "runtime ok",
          evidence: [],
          findings: [],
          openQuestions: [],
        },
      ],
      findings: [],
      rounds: [],
      requiredRepairs: [],
      unresolvedDisagreements: [],
      attempts: 1,
    },
  })

  resetWriter()

  const integrityCardID = `integrity:session:${INTEGRITY_SID}`
  expect(cardTreeStore.cards[integrityCardID]).toBeUndefined()
})

test("tree-writer explicitly accepts non-projected protocol events", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "trace no-op events",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  const beforeOrder = [...cardTreeStore.order]
  const beforeCards = Object.keys(cardTreeStore.cards)
  const events = [
    { type: "spec.created", properties: { taskID: TASK_ID, specID: "spec_1", summary: "drafted" } },
    { type: "spec.updated", properties: { taskID: TASK_ID, specID: "spec_1", status: "active", summary: "updated" } },
    { type: "spec.approved", properties: { taskID: TASK_ID, specID: "spec_1", summary: "approved" } },
    { type: "milestone.activated", properties: { taskID: TASK_ID, milestoneID: "ms_1", summary: "active" } },
    { type: "milestone.passed", properties: { taskID: TASK_ID, milestoneID: "ms_1", summary: "passed" } },
    { type: "milestone.failed", properties: { taskID: TASK_ID, milestoneID: "ms_2", summary: "failed" } },
    {
      type: "message.injected",
      properties: { taskID: TASK_ID, runID: "run_1", text: "continue", summary: "injected" },
    },
    { type: "agent.updated", properties: { taskID: TASK_ID, stage: "executor", summary: "heartbeat" } },
    { type: "session.created", properties: { info: { id: "ses_created" } } },
    { type: "session.updated", properties: { info: { id: "ses_updated" } } },
    { type: "session.deleted", properties: { info: { id: "ses_deleted" } } },
    { type: "session.diff", properties: { sessionID: "ses_diff", diff: [] } },
  ]

  for (const event of events) applyEvent(event)

  expect(cardTreeStore.order).toEqual(beforeOrder)
  expect(Object.keys(cardTreeStore.cards)).toEqual(beforeCards)
})

test("session.status preserves terminal reason when status arrives before the card", () => {
  resetWriter()

  applyEvent({
    type: "session.status",
    emittedAt: 1_776_000_010_000,
    properties: {
      sessionID: "ses_pending_terminal",
      status: { type: "terminal", reason: "aborted" },
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      info: stampedInfo("requirements", {
        id: "msg_pending_terminal",
        sessionID: "ses_pending_terminal",
        role: "assistant",
        time: { created: 1_776_000_009_000 },
      }),
    },
  })

  const card = cardTreeStore.cards["requirements:session:ses_pending_terminal:message:msg_pending_terminal"]!
  expect(card.status).toBe("completed")
  expect(card.terminalReason).toBe("aborted")
  expect(card.timeCompleted).toBe(1_776_000_010_000)
  expect(statusBadge(card)).toEqual({ tone: "cancelled", glyph: "⊘" })
})

test("session.status without a message does not materialize a blank frontend research card", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "frontend research preparation failure",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  const sessionID = "ses_frontend_research_prepare_failed"
  const cardID = `frontend-research:session:${sessionID}`
  applyEvent({
    type: "session.status",
    emittedAt: 1_776_000_010_000,
    properties: {
      sessionID,
      channel: "frontend-research",
      resolvedRole: "frontend-research",
      parentSessionID: ROOT_SID,
      status: {
        type: "terminal",
        reason: "error",
        error: "Node runtime state capture failed during navigate: page.goto timeout",
      },
    },
  })

  expect(cardTreeStore.cards[cardID]).toBeUndefined()
  expect(cardTreeStore.order).not.toContain(cardID)
})

test("message arrival applies buffered lifecycle status without creating a duplicate blank card", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "frontend design starts before first message",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  const sessionID = "ses_frontend_design_lifecycle"
  const lifecycleCardID = `frontend-design:session:${sessionID}`
  const messageCardID = `frontend-design:session:${sessionID}:message:msg_frontend_design_lifecycle`

  applyEvent({
    type: "session.status",
    emittedAt: 1_776_000_001_000,
    properties: {
      sessionID,
      channel: "frontend-design",
      resolvedRole: "frontend-design",
      parentSessionID: ROOT_SID,
      status: { type: "streaming" },
    },
  })

  expect(cardTreeStore.cards[lifecycleCardID]).toBeUndefined()
  expect(cardTreeStore.order).not.toContain(lifecycleCardID)

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("frontend-design", {
        id: "msg_frontend_design_lifecycle",
        sessionID,
        role: "assistant",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_002_000 },
      }),
    },
  })

  expect(cardTreeStore.cards[lifecycleCardID]).toBeUndefined()
  expect(cardTreeStore.cards[messageCardID]).toBeDefined()
  expect(cardTreeStore.cards[messageCardID]?.sessionID).toBe(sessionID)
  expect(cardTreeStore.cards[messageCardID]?.messageID).toBe("msg_frontend_design_lifecycle")
  expect(cardTreeStore.order).not.toContain(lifecycleCardID)
  expect(cardTreeStore.order).not.toContain(messageCardID)
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("frontend-design", {
        id: "prt_frontend_design_lifecycle",
        messageID: "msg_frontend_design_lifecycle",
        sessionID,
        type: "text",
        text: "frontend design produced visible content",
      }),
    },
  })
  expect(cardTreeStore.order).toContain(messageCardID)
})

test("goal phase stub title is an i18n role key, not the raw phase id", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "planner starts before board phase projection",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("planner", {
        id: "msg_planner_phase_stub",
        sessionID: "ses_planner_phase_stub",
        role: "assistant",
        parentSessionID: ROOT_SID,
        goalID: "goal_phase_stub",
        time: { created: 1_776_000_003_000 },
      }),
    },
  })

  const phaseCardID = "step:goal_phase_stub:build:phase:plan"
  expect(cardTreeStore.cards[phaseCardID]).toBeDefined()
  expect(cardTreeStore.cards[phaseCardID]?.title).toBe("chat.role.planner")
})

test("session.error marks the session card with the original stream error", () => {
  resetWriter()

  applyEvent({
    type: "message.updated",
    properties: {
      info: stampedInfo("frontend-design", {
        id: "msg_stream_error",
        sessionID: "ses_stream_error",
        role: "assistant",
        time: { created: 1_776_000_009_000 },
      }),
    },
  })

  applyEvent({
    type: "session.error",
    emittedAt: 1_776_000_010_000,
    properties: {
      sessionID: "ses_stream_error",
      error: {
        name: "MessageAPIError",
        data: { message: "upstream closed while starting tool call" },
      },
    },
  })

  applyEvent({
    type: "session.status",
    emittedAt: 1_776_000_011_000,
    properties: {
      sessionID: "ses_stream_error",
      status: { type: "idle" },
    },
  })

  const card = cardTreeStore.cards["frontend-design:session:ses_stream_error:message:msg_stream_error"]!
  expect(card.status).toBe("error")
  expect(card.terminalReason).toBe("error")
  expect(card.errorReason).toBe("upstream closed while starting tool call")
  expect(card.timeCompleted).toBe(1_776_000_010_000)
})

test("session.error with channel buffers until a real assistant message card exists", () => {
  resetWriter()

  const sessionID = "ses_queue_error"
  const lifecycleCardID = `assistant:session:${sessionID}`
  const messageCardID = `assistant:session:${sessionID}:message:msg_queue_error`

  applyEvent({
    type: "session.error",
    emittedAt: 1_776_000_012_000,
    properties: {
      sessionID,
      channel: "assistant",
      resolvedRole: "assistant",
      error: {
        name: "UnknownError",
        data: { message: "provider rejected request" },
      },
    },
  })

  expect(cardTreeStore.cards[lifecycleCardID]).toBeUndefined()
  expect(cardTreeStore.order).not.toContain(lifecycleCardID)

  applyEvent({
    type: "message.updated",
    properties: {
      info: stampedInfo("assistant", {
        id: "msg_queue_error",
        sessionID,
        role: "assistant",
        time: { created: 1_776_000_012_500 },
      }),
    },
  })

  const card = cardTreeStore.cards[messageCardID]!
  expect(card).toBeDefined()
  expect(card.status).toBe("error")
  expect(card.terminalReason).toBe("error")
  expect(card.errorReason).toBe("provider rejected request")
  expect(card.timeCompleted).toBe(1_776_000_012_000)
  expect(cardTreeStore.order).not.toContain(messageCardID)

  applyEvent({
    type: "message.part.updated",
    properties: {
      ...stampedPartEvent("assistant", {
        id: "part_queue_error",
        messageID: "msg_queue_error",
        sessionID,
        type: "text",
        text: "Visible assistant output after queued error.",
      }),
    },
  })

  expect(cardTreeStore.order).toContain(messageCardID)
})

// ── Message-turn cards (2026-05-16) ──
//
// A long-lived orchestrator session emits a fresh real message every time
// it resumes. Each must become its own top-level card so later turns sort
// AFTER the child agent cards that ran in between, instead of back-filling
// the earliest card.

function seedTurnBoard(request: string): void {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request,
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()
}

test("orchestrator turns stay in one complete session card around child agents", () => {
  seedTurnBoard("interleave turns")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_o1`
  const childCard = "architect:session:ses_child:message:msg_child"
  const o2 = `assistant:session:${ROOT_SID}:message:msg_o2`

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_o1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_o1",
        messageID: "msg_o1",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn one",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_child",
        sessionID: "ses_child",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "prt_child",
        messageID: "msg_child",
        sessionID: "ses_child",
        type: "text",
        text: "child agent visible content",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_o2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_300 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_o2",
        messageID: "msg_o2",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn two",
      }),
    },
  })

  const ordered = cardTreeStore.order.filter((id) => id === o1 || id === childCard || id === o2)
  expect(ordered).toEqual([o1, childCard])

  const o1Texts = (cardTreeStore.cards[o1]?.parts || []).map((p: any) => p.text)
  expect(o1Texts).toContain("turn one")
  expect(o1Texts).toContain("turn two")
  expect(cardTreeStore.cards[o2]).toBeUndefined()

  expect(cardTreeStore.cards[o1]?.status).toBe("running")
  expect(cardTreeStore.cards[o1]?.sessionID).toBe(ROOT_SID)
  expect(cardTreeStore.cards[o1]?.messageID).toBe("msg_o1")
})

test("late child agent event does not split an already-arrived orchestrator session card", () => {
  seedTurnBoard("out-of-order interleave turns")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_late_o1`
  const childCard = "architect:session:ses_late_child:message:msg_late_child"
  const o2 = `assistant:session:${ROOT_SID}:message:msg_late_o2`

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_late_o1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_late_o1",
        messageID: "msg_late_o1",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn one before late child",
      }),
    },
  })

  // The orchestrator resume event can reach the overlay before the child
  // agent's ephemeral message event even though the child belongs between
  // O1/O2 in the persisted message timeline.
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_late_o2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_300 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_late_o2",
        messageID: "msg_late_o2",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn two after late child",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_late_child",
        sessionID: "ses_late_child",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "prt_late_child",
        messageID: "msg_late_child",
        sessionID: "ses_late_child",
        type: "text",
        text: "late child visible content",
      }),
    },
  })

  const ordered = cardTreeStore.order.filter((id) => id === o1 || id === childCard || id === o2)
  expect(ordered).toEqual([o1, childCard])
  expect(cardTreeStore.cards[o2]).toBeUndefined()
  expect((cardTreeStore.cards[o1]?.parts || []).map((p: any) => p.text)).toContain("turn two after late child")
})

test("consecutive messages from the same agent stay in one card", () => {
  seedTurnBoard("consecutive turns")

  const cardID = `assistant:session:${ROOT_SID}:message:msg_c1`
  const secondCardID = `assistant:session:${ROOT_SID}:message:msg_c2`

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_c1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_c1",
        messageID: "msg_c1",
        sessionID: ROOT_SID,
        type: "text",
        text: "first consecutive turn",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_c2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_c2",
        messageID: "msg_c2",
        sessionID: ROOT_SID,
        type: "text",
        text: "second consecutive turn",
      }),
    },
  })

  expect(cardTreeStore.cards[cardID]).toBeDefined()
  expect(cardTreeStore.cards[secondCardID]).toBeUndefined()
  expect(cardTreeStore.order.filter((id) => id === cardID || id === secondCardID)).toEqual([cardID])
  expect((cardTreeStore.cards[cardID]?.parts || []).map((p: any) => p.text)).toEqual([
    "first consecutive turn",
    undefined,
    "second consecutive turn",
  ])
  expect(cardTreeStore.cards[cardID]?.parts.some((p: any) => p.type === "boundary" && p.role === "assistant")).toBe(
    true,
  )
})

test("repeated message.updated for the same agent message does not reset card start time", () => {
  seedTurnBoard("stable message timer")

  const cardID = "frontend-research:session:ses_timer_stable:message:msg_timer_stable"

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("frontend-research", {
        id: "msg_timer_stable",
        sessionID: "ses_timer_stable",
        role: "assistant",
        resolvedRole: "frontend-research",
        agent: "frontend-research",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("frontend-research", {
        id: "prt_timer_stable",
        messageID: "msg_timer_stable",
        sessionID: "ses_timer_stable",
        type: "text",
        text: "initial research",
      }),
    },
  })

  expect(cardTreeStore.cards[cardID]?.time).toBe(1_776_000_000_100)

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("frontend-research", {
        id: "msg_timer_stable",
        sessionID: "ses_timer_stable",
        role: "assistant",
        resolvedRole: "frontend-research",
        agent: "frontend-research",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_012_000 },
      }),
    },
  })

  expect(cardTreeStore.cards[cardID]?.time).toBe(1_776_000_000_100)
  expect((cardTreeStore.cards[cardID]?.parts || []).map((part: any) => part.text)).toContain("initial research")
})

test("explore channel owns the card while resolvedRole owns in-card authorship", () => {
  seedTurnBoard("explore card ownership")

  const cardID = "explore:session:ses_explore_mixed:message:msg_explore_1"
  const secondCardID = "explore:session:ses_explore_mixed:message:msg_explore_2"

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("explore", {
        id: "msg_explore_1",
        sessionID: "ses_explore_mixed",
        role: "user",
        resolvedRole: "orchestrator",
        agent: "build",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("explore", {
        id: "prt_explore_1",
        messageID: "msg_explore_1",
        sessionID: "ses_explore_mixed",
        type: "text",
        text: "inspect repo",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("explore", {
        id: "msg_explore_2",
        sessionID: "ses_explore_mixed",
        role: "assistant",
        resolvedRole: "orchestrator",
        agent: "build",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("explore", {
        id: "prt_explore_2",
        messageID: "msg_explore_2",
        sessionID: "ses_explore_mixed",
        type: "text",
        text: "repo inspected",
      }),
    },
  })

  const card = cardTreeStore.cards[cardID]
  expect(card).toBeDefined()
  expect(cardTreeStore.cards[secondCardID]).toBeUndefined()
  expect(card?.stage).toBe("explore")
  expect(card?.title).toBe("chat.role.explore")
  expect(card?.parts.map((part: any) => part.text)).toEqual(["inspect repo", undefined, "repo inspected"])
  expect(card?.parts.some((part: any) => part.type === "boundary" && part.role === "orchestrator")).toBe(true)
})

test("mission session splits user turns from mission agent turns", () => {
  resetWriter()
  setBoardStore("board", {
    kind: "session",
    sessionID: "ses_mission_split",
    title: "Mission Control",
  } as any)

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_mission_split",
          stage: "user",
          messageIDs: ["msg_mission_user"],
          placement: "top_level",
        },
        {
          sessionID: "ses_mission_split",
          stage: "mission",
          messageIDs: ["msg_mission_agent"],
          placement: "top_level",
        },
      ],
    },
    [
      {
        info: stampedInfo("main", {
          id: "msg_mission_user",
          sessionID: "ses_mission_split",
          role: "user",
          resolvedRole: "user",
          time: { created: 1_776_000_000_100 },
        }),
        parts: [
          stampedPart("main", {
            id: "prt_mission_user",
            messageID: "msg_mission_user",
            sessionID: "ses_mission_split",
            type: "text",
            text: "start mission",
          }),
        ],
      },
      {
        info: stampedInfo("mission", {
          id: "msg_mission_agent",
          sessionID: "ses_mission_split",
          role: "assistant",
          resolvedRole: "mission",
          agent: "mission",
          time: { created: 1_776_000_000_200 },
        }),
        parts: [
          stampedPart("mission", {
            id: "prt_mission_agent",
            messageID: "msg_mission_agent",
            sessionID: "ses_mission_split",
            type: "text",
            text: "mission accepted",
          }),
        ],
      },
    ],
  )

  const userCard = cardTreeStore.cards["user:session:ses_mission_split:message:msg_mission_user"]
  const missionCard = cardTreeStore.cards["mission:session:ses_mission_split:message:msg_mission_agent"]

  expect(userCard?.kind).toBe("message")
  expect(userCard?.stage).toBe("user")
  expect(userCard?.parts.map((part: any) => part.text)).toEqual(["start mission"])
  expect(missionCard?.kind).toBe("agent")
  expect(missionCard?.stage).toBe("mission")
  expect(missionCard?.title).toBe("chat.role.mission")
  expect(missionCard?.parts.map((part: any) => part.text)).toEqual(["mission accepted"])
  expect(cardTreeStore.order).toContain(userCard!.id)
  expect(cardTreeStore.order).toContain(missionCard!.id)
})

test("phase-absorbed agent does not split a later orchestrator turn", () => {
  seedTurnBoard("phase interruption")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_phase_i1`
  const o2 = `assistant:session:${ROOT_SID}:message:msg_phase_i2`

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_phase_i1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_phase_i1",
        messageID: "msg_phase_i1",
        sessionID: ROOT_SID,
        type: "text",
        text: "orchestrator before phase",
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_phase_build",
        sessionID: "ses_phase_build_interrupt",
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID: "goal_phase_interrupt",
        time: { created: 1_776_000_000_150 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_phase_i2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_200 },
      }),
    },
  })

  expect(cardTreeStore.cards[o1]).toBeDefined()
  expect(cardTreeStore.cards[o2]).toBeUndefined()
  expect(cardTreeStore.order.filter((id) => id === o1 || id === o2)).toEqual([o1])
})

test("phase-absorbed empty build messages do not create timestamp-only boundaries", () => {
  seedTurnBoard("empty build envelope")

  const goalID = "goal_empty_build"
  const sessionID = "ses_empty_build"
  const messageID = "msg_empty_build"
  const hasEmptyBoundary = () =>
    Object.values(cardTreeStore.cards).some((card: any) =>
      (card?.parts || []).some((part: any) => part.type === "boundary" && part.messageID === messageID),
    )
  const hasVisibleMessagePart = () =>
    Object.values(cardTreeStore.cards).some((card: any) =>
      (card?.parts || []).some(
        (part: any) =>
          part.messageID === messageID &&
          part.type !== "step-start" &&
          part.type !== "step-finish" &&
          part.type !== "boundary",
      ),
    )

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: messageID,
        sessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID,
        time: { created: 1_776_000_000_150 },
      }),
    },
  })

  expect(hasEmptyBoundary()).toBe(false)
  expect(hasVisibleMessagePart()).toBe(false)

  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_empty_step",
        messageID,
        sessionID,
        type: "step-start",
        parentSessionID: ROOT_SID,
        goalID,
      }),
    },
  })

  expect(hasEmptyBoundary()).toBe(false)
  expect(hasVisibleMessagePart()).toBe(false)

  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_visible_text",
        messageID,
        sessionID,
        type: "text",
        text: "visible build output",
        parentSessionID: ROOT_SID,
        goalID,
      }),
    },
  })

  const phaseCard = Object.values(cardTreeStore.cards).find((card: any) => card?.phaseSessionID === sessionID) as any
  expect(phaseCard).toBeDefined()
  expect(phaseCard.parts.some((part: any) => part.type === "boundary" && part.messageID === messageID)).toBe(true)
  expect(phaseCard.parts.some((part: any) => part.type === "text" && part.text === "visible build output")).toBe(true)
})

test("phase-absorbed build card orders prompt parts before later assistant output by message time", () => {
  seedTurnBoard("visual contract prompt order")

  const goalID = "goal_phase_prompt_order"
  const sessionID = "ses_phase_prompt_order"
  const promptMessageID = "msg_phase_prompt_order_user"
  const assistantMessageID = "msg_phase_prompt_order_assistant"

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: assistantMessageID,
        sessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_phase_prompt_order_assistant",
        messageID: assistantMessageID,
        sessionID,
        type: "text",
        text: "assistant started implementation",
        parentSessionID: ROOT_SID,
        goalID,
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: promptMessageID,
        sessionID,
        role: "user",
        resolvedRole: "user",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID,
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_phase_prompt_order_user",
        messageID: promptMessageID,
        sessionID,
        type: "text",
        text: "## Visual Reference Contract (binding for this dispatch)\nreference.png",
        parentSessionID: ROOT_SID,
        goalID,
      }),
    },
  })

  const phaseCard = Object.values(cardTreeStore.cards).find((card: any) => card?.phaseSessionID === sessionID) as any
  expect(phaseCard).toBeDefined()
  expect(
    phaseCard.parts
      .filter((part: any) => part.type === "text" || part.type === "boundary")
      .map((part: any) => part.messageID),
  ).toEqual([promptMessageID, promptMessageID, assistantMessageID, assistantMessageID])
  expect(phaseCard.parts.filter((part: any) => part.type === "text").map((part: any) => part.text)).toEqual([
    "## Visual Reference Contract (binding for this dispatch)\nreference.png",
    "assistant started implementation",
  ])
})

test("hydrate skips empty build transcript messages before boundary projection", () => {
  seedTurnBoard("hydrate empty build envelope")

  const goalID = "goal_hydrate_empty"
  const emptySessionID = "ses_hydrate_empty"
  const visibleSessionID = "ses_hydrate_visible"
  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: emptySessionID,
          stage: "build",
          parentSessionID: ROOT_SID,
          goalID,
          messageIDs: ["msg_hydrate_empty"],
          firstMessageTime: 1_776_000_000_150,
          lastMessageTime: 1_776_000_000_150,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
        {
          sessionID: visibleSessionID,
          stage: "build",
          parentSessionID: ROOT_SID,
          goalID,
          messageIDs: ["msg_hydrate_visible"],
          lastDisplayMessageID: "msg_hydrate_visible",
          firstMessageTime: 1_776_000_000_200,
          lastMessageTime: 1_776_000_000_200,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
      topLevelSessionIDs: [],
    },
    [
      {
        info: stampedInfo("build", {
          id: "msg_hydrate_empty",
          sessionID: emptySessionID,
          role: "assistant",
          parentSessionID: ROOT_SID,
          goalID,
          time: { created: 1_776_000_000_150 },
        }),
        parts: [],
      },
      {
        info: stampedInfo("build", {
          id: "msg_hydrate_visible",
          sessionID: visibleSessionID,
          role: "assistant",
          parentSessionID: ROOT_SID,
          goalID,
          time: { created: 1_776_000_000_200 },
        }),
        parts: [{ id: "prt_hydrate_visible", type: "text", text: "hydrated build output" }],
      },
    ],
  )

  expect(Object.values(cardTreeStore.cards).some((card: any) => card?.phaseSessionID === emptySessionID)).toBe(false)
  const phaseCard = Object.values(cardTreeStore.cards).find(
    (card: any) => card?.phaseSessionID === visibleSessionID,
  ) as any
  expect(phaseCard).toBeDefined()
  expect(phaseCard.parts.some((part: any) => part.type === "text" && part.text === "hydrated build output")).toBe(true)
})

test("interaction remains attached to the turn active at interaction time", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "interaction turn ownership",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [
      {
        id: "int_turn_owner",
        sessionID: ROOT_SID,
        type: "permission",
        status: "pending",
        title: "Need approval",
        body: "Allow this turn?",
        time: { created: 1_776_000_000_150 },
      },
    ],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  const o1 = `assistant:session:${ROOT_SID}:message:msg_i1`
  const o2 = `assistant:session:${ROOT_SID}:message:msg_i2`
  const interactionCardID = "interaction-card:ctx:interaction:int_turn_owner"

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_i1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_i2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_300 },
      }),
    },
  })

  expect(cardTreeStore.cards[o1]?.childIDs || []).toContain(interactionCardID)
  expect(cardTreeStore.cards[o2]?.childIDs || []).not.toContain(interactionCardID)
})

test("late part.delta lands on the original turn card after a newer message starts", () => {
  seedTurnBoard("late delta")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_d1`
  const o2 = `assistant:session:${ROOT_SID}:message:msg_d2`

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_d1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_d1",
        messageID: "msg_d1",
        sessionID: ROOT_SID,
        type: "text",
        text: "",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_d2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_d2",
        messageID: "msg_d2",
        sessionID: ROOT_SID,
        type: "text",
        text: "",
      }),
    },
  })

  applyEvent({
    type: "message.part.delta",
    properties: {
      taskID: TASK_ID,
      partID: "prt_d1",
      messageID: "msg_d1",
      sessionID: ROOT_SID,
      field: "text",
      delta: "late tail",
    },
  })
  flushBufferedPartDeltas()

  expect((cardTreeStore.cards[o1]?.parts || []).map((p: any) => p.text)).toContain("late tail")
  expect((cardTreeStore.cards[o2]?.parts || []).map((p: any) => p.text)).not.toContain("late tail")
})

test("session.status terminal updates the complete session card", () => {
  seedTurnBoard("status active only")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_s1`
  const o2 = `assistant:session:${ROOT_SID}:message:msg_s2`

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_s1",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_s_child",
        sessionID: "ses_status_child",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_150 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_s2",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_200 },
      }),
    },
  })

  applyEvent({
    type: "session.status",
    emittedAt: 1_776_000_000_300,
    properties: {
      sessionID: ROOT_SID,
      status: { type: "terminal", reason: "completed" },
    },
  })

  expect(cardTreeStore.cards[o1]?.status).toBe("completed")
  expect(cardTreeStore.cards[o1]?.terminalReason).toBe("completed")
  expect(cardTreeStore.cards[o2]).toBeUndefined()
})

test("hydrate keeps consecutive same-agent messages in one card", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "hydrate multi message",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  const mk = (id: string, created: number, text: string) => ({
    info: {
      id,
      sessionID: ROOT_SID,
      role: "assistant",
      resolvedRole: "assistant",
      agent: "assistant",
      channel: "assistant",
      time: { created },
    },
    parts: [{ id: `prt_${id}`, messageID: id, sessionID: ROOT_SID, type: "text", text }],
  })
  const transcript = [mk("msg_h1", 1_776_000_000_100, "first turn"), mk("msg_h2", 1_776_000_000_200, "second turn")]

  hydrateConversationView({ sessions: [{ sessionID: ROOT_SID, stage: "assistant" }] }, transcript)

  const h1 = `assistant:session:${ROOT_SID}:message:msg_h1`
  const h2 = `assistant:session:${ROOT_SID}:message:msg_h2`
  expect(cardTreeStore.order).toContain(h1)
  expect(cardTreeStore.order).not.toContain(h2)
  expect(cardTreeStore.cards[h1]?.parts.some((p: any) => p.text === "first turn")).toBe(true)
  expect(cardTreeStore.cards[h1]?.parts.some((p: any) => p.text === "second turn")).toBe(true)
  expect(cardTreeStore.cards[h1]?.parts.some((p: any) => p.type === "boundary" && p.role === "assistant")).toBe(true)
  expect(cardTreeStore.cards[h2]).toBeUndefined()
  expect(cardTreeStore.cards[`assistant:session:${ROOT_SID}`]).toBeUndefined()
})
