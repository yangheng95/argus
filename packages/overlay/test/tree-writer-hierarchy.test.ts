import { test, expect } from "bun:test"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const { boardStore, setBoardStore: setBoardStoreRaw } = await import("../src/store/board")
const {
  applyEvent: applyEventRaw,
  flushBufferedPartDeltas,
  resetWriter,
  hydrateConversationView: hydrateConversationViewRaw,
} = await import("../src/services/tree-writer")
const { cardTreeStore } = await import("../src/store/card-tree")
const { isCardBodyMessagePart } = await import("../src/utils/message-part")
const { collectDialogInteractions } = await import("../src/utils/interaction-dialog")
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
  REQUIREMENTS_SID,
  DESIGN_SID,
  ARCHITECT_SID,
  TASK_ID,
} = await import("./fixtures/goal-phase-events")

installRealOverlayI18n()

const INTEGRITY_SID = "ses_integrity"

function testOrderKey(rank: number, time: number, id: string, sequence = 0, domain = "test"): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:${domain}:${id}`
}

function messageOrderKey(id: string, time: number): string {
  return testOrderKey(30, time, id, 0, "message")
}

function partOrderKey(id: string, time: number): string {
  return testOrderKey(31, time, id, 0, "part")
}

function taskOrderKey(id: string, time: number): string {
  return testOrderKey(10, time, id, 0, "task")
}

function boardOrderKey(id: string, time: number, rank: number): string {
  return testOrderKey(rank, time, id, 0, "board")
}

function interactionOrderKey(id: string, time: number): string {
  return testOrderKey(70, time, id, 0, "interaction")
}

function eventOrderKey(type: string, time: number): string {
  return testOrderKey(40, time, `evt_${type}_${time}`, 0, "event")
}

function sessionOrderKey(id: string, time: number): string {
  return testOrderKey(50, time, id, 0, "session")
}

function stampBoardPhase(goal: any, step: any, phaseID: string, phase: any): any {
  return {
    ...phase,
    orderKey: requireExplicitOrderKey(
      phase?.orderKey,
      `goal phase ${String(goal?.goalID || "goal")}/${String(step?.stepID || "step")}/${phaseID}`,
      "board",
    ),
  }
}

function stampBoard(board: any): any {
  if (!board || typeof board !== "object" || Array.isArray(board)) return board
  const task = board.task && typeof board.task === "object" ? board.task : undefined
  return {
    ...board,
    ...(task
      ? {
          task: {
            ...task,
            orderKey: requireExplicitOrderKey(task.orderKey, `task ${String(task.id || TASK_ID)}`, "task"),
          },
        }
      : {}),
    workflow:
      board.workflow && typeof board.workflow === "object"
        ? {
            ...board.workflow,
            steps: Array.isArray(board.workflow.steps)
              ? board.workflow.steps.map((step: any) => ({
                  ...step,
                  orderKey: requireExplicitOrderKey(
                    step.orderKey,
                    `workflow step ${String(task?.id || TASK_ID)}/${String(step?.id || step?.stepID || "step")}`,
                    "board",
                  ),
                }))
              : board.workflow.steps,
          }
        : board.workflow,
    goalWorkflows: Array.isArray(board.goalWorkflows)
      ? board.goalWorkflows.map((goal: any) => ({
          ...goal,
          orderKey: requireExplicitOrderKey(goal?.orderKey, `goal ${String(goal?.goalID || "goal")}`, "board"),
          steps: Array.isArray(goal?.steps)
            ? goal.steps.map((step: any) => ({
                ...step,
                orderKey: requireExplicitOrderKey(
                  step?.orderKey,
                  `goal step ${String(goal?.goalID || "goal")}/${String(step?.stepID || "step")}`,
                  "board",
                ),
                phases:
                  step.phases && typeof step.phases === "object" && !Array.isArray(step.phases)
                    ? Object.fromEntries(
                        Object.entries(step.phases).map(([phaseID, phase]: [string, any]) => [
                          phaseID,
                          stampBoardPhase(goal, step, phaseID, phase),
                        ]),
                      )
                    : step.phases,
              }))
            : goal?.steps,
        }))
      : board.goalWorkflows,
    interactions: Array.isArray(board.interactions)
      ? board.interactions.map((interaction: any) => ({
          ...interaction,
          orderKey: requireExplicitOrderKey(
            interaction?.orderKey,
            `interaction ${String(interaction?.id || "interaction")}`,
            "interaction",
          ),
        }))
      : board.interactions,
  }
}
function setBoardStore(...args: any[]): any {
  if (args[0] === "board" && args.length === 2) return setBoardStoreRaw("board", stampBoard(args[1]))
  return (setBoardStoreRaw as any)(...args)
}

function requireExplicitOrderKey(value: unknown, label: string, domain: "message" | "part" | "session" | "task" | "board" | "interaction"): string {
  const key = typeof value === "string" ? value.trim() : ""
  if (!key) throw new Error(`${label} missing explicit ${domain} orderKey`)
  const actualDomain = key.split(":", 6)[4] || ""
  if (actualDomain !== domain) throw new Error(`${label} expected ${domain} orderKey, got ${actualDomain}: ${key}`)
  return key
}

function stampEvent(event: any): any {
  const type = String(event?.type || "event")
  const props = event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
  if (!props || typeof props !== "object") return event
  if (type === "message.updated" && props.info && typeof props.info === "object") {
    const infoOrderKey = requireExplicitOrderKey(
      props.info.orderKey,
      `message.updated info ${String(props.info.id || "")}`,
      "message",
    )
    const eventOrderKey = requireExplicitOrderKey(event?.orderKey, "message.updated event", "message")
    if (eventOrderKey !== infoOrderKey) throw new Error(`message.updated event orderKey drift: ${eventOrderKey}`)
    return event
  }
  if (type === "message.part.updated" && props.part && typeof props.part === "object") {
    const part = props.part as Record<string, any>
    const propertiesOrderKey = requireExplicitOrderKey(
      props.orderKey,
      `message.part.updated properties ${String(part.messageID || "")}`,
      "message",
    )
    const eventOrderKey = requireExplicitOrderKey(event?.orderKey, "message.part.updated event", "message")
    if (eventOrderKey !== propertiesOrderKey) {
      throw new Error(`message.part.updated event orderKey drift: ${eventOrderKey}`)
    }
    requireExplicitOrderKey(part.orderKey, `message.part.updated part ${String(part.id || "")}`, "part")
    return event
  }
  if (type === "session.status" || type === "session.error" || type === "session.idle") {
    requireExplicitOrderKey(event?.orderKey, `${type} event`, "session")
  }
  return event
}

function applyEvent(event: any): void {
  applyEventRaw(stampEvent(event))
}

function stampTranscript(transcript: any[]): any[] {
  return (Array.isArray(transcript) ? transcript : []).map((message) => {
    const info = message?.info || {}
    requireExplicitOrderKey(info.orderKey, `transcript message ${String(info.id || "")}`, "message")
    return {
      ...message,
      parts: Array.isArray(message?.parts)
        ? message.parts.map((part: any) => {
            requireExplicitOrderKey(part?.orderKey, `transcript part ${String(part?.id || "")}`, "part")
            return part
          })
        : message?.parts,
    }
  })
}

function hydrateConversationView(view: any, transcript: any[]): void {
  const stampedTranscript = stampTranscript(transcript)
  hydrateConversationViewRaw(requireHydrateView(view), stampedTranscript)
}

function stampedInfo(channel: string, info: Record<string, any>) {
  const orderKey = requireExplicitOrderKey(info.orderKey, `message info ${String(info.id || "")}`, "message")
  return {
    ...info,
    orderKey,
    resolvedRole: info.resolvedRole ?? channel,
    agent: info.agent ?? channel,
    channel,
  }
}

function stampedPart(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, ...cleanPart } = part
  const orderKey = requireExplicitOrderKey(part.orderKey, `part ${String(part.id || "")}`, "part")
  return {
    ...cleanPart,
    orderKey,
  }
}

function stampedPartEvent(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, owningMessageOrderKey, ...cleanPart } = part
  const messageKey = requireExplicitOrderKey(
    owningMessageOrderKey,
    `part event owning message ${String(part.messageID || "")}`,
    "message",
  )
  const partKey = requireExplicitOrderKey(cleanPart.orderKey, `part event part ${String(part.id || "")}`, "part")
  return {
    part: {
      ...cleanPart,
      orderKey: partKey,
    },
    orderKey: messageKey,
    resolvedRole: resolvedRole ?? channel,
    channel,
    ...(parentSessionID ? { parentSessionID } : {}),
    ...(goalID ? { goalID } : {}),
  }
}

function transcriptMessageHasDisplay(message: any): boolean {
  return Array.isArray(message?.parts) && message.parts.some((part: any) => String(part?.text || "").trim())
}

function requireHydrateView(view: any): any {
  const sessions = Array.isArray(view?.sessions) ? view.sessions : []
  const messages = Array.isArray(view?.messages) ? view.messages : []
  for (const session of sessions) {
    requireExplicitOrderKey(session?.orderKey, `view session ${String(session?.sessionID || "")}`, "session")
  }
  for (const message of messages) {
    requireExplicitOrderKey(message?.orderKey, `view message ${String(message?.messageID || "")}`, "message")
  }
  return view
}

test("phase cards absorb goal-scoped session parts — no nested session cards", async () => {
  // 正本清源 pass:
  //   - session.kind="executor" is a CONTAINER (no LLM), filtered from UI.
  //   - session.kind="build" is routed DIRECTLY to its phase card
  //     (ensureSessionCard → resolvePhaseOrSessionCardID).
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
  // Current workflow declares one per-goal phase: build.
  const stepCardID = `step:${GOAL_ID}:build` // W2-V26: format reverted 2026-04-26 to attempt-invariant (drop :goalRunID:)
  const buildPhaseID = `${stepCardID}:phase:build`

  // One real message turn = one card: `<stage>:session:<sid>:message:<mid>`.
  const executorCardID = `executor:session:${EXECUTOR_SID}:message:msg_exec_1`
  const buildWorkerCardID = `build:session:${BUILD_SID}:message:msg_build_1`
  const requirementsCardID = `requirements:session:${REQUIREMENTS_SID}:message:msg_requirements_1`
  const designCardID = `frontend-design:session:${DESIGN_SID}:message:msg_design_1`
  const architectCardID = `architect:session:${ARCHITECT_SID}:message:msg_architect_1`
  const rootCardID = `assistant:session:${ROOT_SID}:message:msg_orch_1`

  // Step card exists and has the build phase card — no session
  // cards between step and phase.
  expect(snapshot.nodes[stepCardID]).toBeDefined()
  expect(snapshot.nodes[stepCardID]!.childIDs).toEqual([buildPhaseID])

  // Each phase card exists with the declared kind + phase metadata.
  for (const [id, phaseID] of [[buildPhaseID, "build"]] as const) {
    const node = snapshot.nodes[id]
    expect(node).toBeDefined()
    expect(node!.kind).toBe("phase")
    expect(node!.phaseID).toBe(phaseID)
    expect(node!.goalID).toBe(GOAL_ID)
    expect(node!.round).toBe(1)
    expect(node!.attempt).toBe(1)
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

  // Phase cards must surface the absorbed sessionID via `phaseSessionID` so
  // the inline AgentSessionReplyBox in Card.tsx can target the running
  // sub-agent session. Without this, absorbed build sessions
  // would have no visible operator input on the phase card.
  expect(snapshot.nodes[buildPhaseID]!.phaseSessionID).toBe(BUILD_SID)

  // Build phase's parts include the tool call + text from the build worker
  // session (msg_build_1).
  const buildParts = snapshot.nodes[buildPhaseID]!.parts
  expect(buildParts.some((p) => p.type === "tool" && p.tool === "bash")).toBe(true)
  expect(buildParts.some((p) => p.type === "text" && p.text === "Build passed.")).toBe(true)

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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_executor_reasoning", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("executor", {
        id: "msg_executor_reasoning",
        orderKey: messageOrderKey("msg_executor_reasoning", 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_executor_reasoning", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("executor", {
        id: reasoningPartID,
        orderKey: partOrderKey(reasoningPartID, 1_776_000_001_000),
        owningMessageOrderKey: messageOrderKey("msg_executor_reasoning", 1_776_000_001_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_architect_blank", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_architect_blank",
        orderKey: messageOrderKey("msg_architect_blank", 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_architect_blank", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "part_architect_visible",
        orderKey: partOrderKey("part_architect_visible", 1_776_000_001_000),
        owningMessageOrderKey: messageOrderKey("msg_architect_blank", 1_776_000_001_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_root", 1_776_000_000_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root",
        orderKey: messageOrderKey("msg_root", 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_architect", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_architect",
        orderKey: messageOrderKey("msg_architect", 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_root", 1_776_000_000_000),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "part_root",
        orderKey: partOrderKey("part_root", 1_776_000_000_500),
        owningMessageOrderKey: messageOrderKey("msg_root", 1_776_000_000_000),
        messageID: "msg_root",
        sessionID: ROOT_SID,
        type: "text",
        text: "Root response.",
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_architect", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "part_architect",
        orderKey: partOrderKey("part_architect", 1_776_000_001_000),
        owningMessageOrderKey: messageOrderKey("msg_architect", 1_776_000_001_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_user_followup", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("main", {
        id: "msg_user_followup",
        orderKey: messageOrderKey("msg_user_followup", 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_user_followup", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("main", {
        id: "prt_user_followup",
        orderKey: partOrderKey("prt_user_followup", 1_776_000_001_000),
        owningMessageOrderKey: messageOrderKey("msg_user_followup", 1_776_000_001_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "trace payloads",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      id: "pipeline",
      name: "Pipeline",
      goalLoopStepIDs: ["build"],
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-build`, 1_776_000_000_000, 61),
          label: "Executor",
          tool: "execute_goal",
          scope: "goal",
          skippable: false,
          status: "pending",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: GOAL_ID,
        orderKey: boardOrderKey(GOAL_ID, 1_776_000_001_000, 60),
        goalRunID: GOAL_RUN_ID,
        goalTitle: "Scaffold project",
        goalStatus: "running",
        time: { created: 1_776_000_001_000 },
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${GOAL_ID}-build`, 1_776_000_001_000, 61),
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_001_000,
            summary: "3 planned steps",
            payload: {
              planNodes: [{ id: "pn_1", title: "Create shell", brief: "init app", orderIndex: 1 }],
              buildSessionID: BUILD_SID,
            },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_001_500,
                orderKey: boardOrderKey(`${GOAL_ID}-build-phase`, 1_776_000_001_500, 62),
              },
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
        orderKey: interactionOrderKey("int_claimed", 1_776_000_001_000),
        sessionID: ROOT_SID,
        type: "permission",
        status: "pending",
        title: "Need approval",
        body: "Allow write?",
        time: { created: 1_776_000_001_000 },
      },
      {
        id: "int_orphan",
        orderKey: interactionOrderKey("int_orphan", 1_776_000_002_000),
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
    orderKey: messageOrderKey("msg_root_interaction", 1_776_000_000_500),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root_interaction",
        orderKey: messageOrderKey("msg_root_interaction", 1_776_000_000_500),
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
    orderKey: messageOrderKey("msg_mission_question", 1_780_500_000_000),
    properties: {
      info: stampedInfo("mission", {
        id: "msg_mission_question",
        orderKey: messageOrderKey("msg_mission_question", 1_780_500_000_000),
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
    orderKey: eventOrderKey("question.asked", 1_780_500_000_500),
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
      orderKey: taskOrderKey(TASK_ID, 1_780_600_000_000),
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
    orderKey: messageOrderKey("msg_background_mission_question", 1_780_600_000_100),
    properties: {
      info: stampedInfo("mission", {
        id: "msg_background_mission_question",
        orderKey: messageOrderKey("msg_background_mission_question", 1_780_600_000_100),
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
    orderKey: eventOrderKey("question.asked", 1_780_600_000_500),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: eventOrderKey("question.asked", 1_776_000_000_500),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_root", 1_776_000_000_500),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root",
        orderKey: messageOrderKey("msg_root", 1_776_000_000_500),
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
    orderKey: messageOrderKey("msg_root", 1_776_000_000_500),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_root",
        orderKey: partOrderKey("prt_root", 1_776_000_000_500),
        owningMessageOrderKey: messageOrderKey("msg_root", 1_776_000_000_500),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: messageOrderKey("msg_race", 1_776_000_001_000),
    emittedAt: 1_776_000_000_750,
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("planner", {
        id: "prt_stream",
        orderKey: partOrderKey("prt_stream", 1_776_000_001_000),
        owningMessageOrderKey: messageOrderKey("msg_race", 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_race", 1_776_000_001_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("planner", {
        id: "msg_race",
        orderKey: messageOrderKey("msg_race", 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_root", 1_776_000_000_500),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_root",
        orderKey: messageOrderKey("msg_root", 1_776_000_000_500),
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
    orderKey: messageOrderKey("msg_root", 1_776_000_000_500),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_root_race",
        orderKey: partOrderKey("prt_root_race", 1_776_000_000_500),
        owningMessageOrderKey: messageOrderKey("msg_root", 1_776_000_000_500),
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

test("part-first display message uses message orderKey time for ordering", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "part-first timestamp contract",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })

  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_no_time", 1),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("planner", {
        id: "prt_no_time",
        orderKey: partOrderKey("prt_no_time", 1),
        owningMessageOrderKey: messageOrderKey("msg_no_time", 1),
        messageID: "msg_no_time",
        sessionID: "ses_no_time",
        type: "text",
        text: "display part without event timestamp",
        parentSessionID: ROOT_SID,
      }),
    },
  })

  const cardID = "planner:session:ses_no_time:message:msg_no_time"
  expect(cardTreeStore.cards[cardID]?.time).toBe(1)
})

test("part-first consecutive build messages merge before message.updated arrives", () => {
  seedTurnBoard("part-first build adjacent segment")

  const sessionID = "ses_part_first_build"
  const firstCardID = `build:session:${sessionID}:message:msg_build_part_first_1`
  const secondCardID = `build:session:${sessionID}:message:msg_build_part_first_2`

  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_build_part_first_1", 1_776_000_000_100),
    emittedAt: 1_776_000_000_100,
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_build_part_first_1",
        orderKey: partOrderKey("prt_build_part_first_1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_build_part_first_1", 1_776_000_000_100),
        messageID: "msg_build_part_first_1",
        sessionID,
        type: "text",
        text: "first build stream chunk",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_build_part_first_2", 1_776_000_000_200),
    emittedAt: 1_776_000_000_200,
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_build_part_first_2",
        orderKey: partOrderKey("prt_build_part_first_2", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_build_part_first_2", 1_776_000_000_200),
        messageID: "msg_build_part_first_2",
        sessionID,
        type: "text",
        text: "second build stream chunk",
        time: { created: 1_776_000_000_200 },
      }),
    },
  })

  expect(cardTreeStore.cards[firstCardID]).toBeDefined()
  expect(cardTreeStore.cards[secondCardID]).toBeUndefined()
  expect(cardTreeStore.order.filter((id) => id === firstCardID || id === secondCardID)).toEqual([firstCardID])
  expect(cardTreeStore.cards[firstCardID]?.parts.map((part: any) => [part.type, part.messageID, part.text])).toEqual([
    ["text", "msg_build_part_first_1", "first build stream chunk"],
    ["boundary", "msg_build_part_first_2", undefined],
    ["text", "msg_build_part_first_2", "second build stream chunk"],
  ])
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: eventOrderKey("integrity.review.completed", 1_776_000_002_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: eventOrderKey("integrity.review.completed", 1_776_000_002_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
      orderKey: eventOrderKey("integrity.review.completed", 1_776_000_002_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: eventOrderKey("review.stream.started", 1_776_000_001_000),
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
    orderKey: eventOrderKey("review.stream.progress", 1_776_000_021_000),
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
    orderKey: eventOrderKey("review.stream.progress", 1_776_000_101_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: eventOrderKey("review.stream.started", 1_776_000_001_000),
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
      orderKey: eventOrderKey("review.stream.chunk", 1_776_000_001_100),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: eventOrderKey("integrity.review.completed", 1_776_000_002_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: sessionOrderKey("ses_pending_terminal", 1_776_000_010_000),
    emittedAt: 1_776_000_010_000,
    properties: {
      sessionID: "ses_pending_terminal",
      status: { type: "terminal", reason: "aborted" },
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_pending_terminal", 1_776_000_009_000),
    properties: {
      info: stampedInfo("requirements", {
        id: "msg_pending_terminal",
        orderKey: messageOrderKey("msg_pending_terminal", 1_776_000_009_000),
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
})

test("session.status terminal without event time is rejected instead of using the local clock", () => {
  resetWriter()

  expect(() =>
    applyEvent({
      type: "session.status",
      orderKey: sessionOrderKey("ses_missing_status_time", 1_776_000_010_000),
      properties: {
        sessionID: "ses_missing_status_time",
        status: { type: "terminal", reason: "completed" },
      },
    }),
  ).toThrow(/session\.status terminal missing emittedAt\/timestamp/)
})

test("session.status rejects non-session orderKey domains", () => {
  resetWriter()

  expect(() =>
    applyEvent({
      type: "session.status",
      orderKey: "v1:0001776000010000:0000000000000030:0000000000000000:message:msg_wrong_status_key",
      emittedAt: 1_776_000_010_000,
      properties: {
        sessionID: "ses_wrong_status_key",
        channel: "assistant",
        status: { type: "streaming" },
      },
    }),
  ).toThrow(/expected session orderKey/)
})

test("session.status without a message does not materialize a blank frontend research card", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: sessionOrderKey(sessionID, 1_776_000_010_000),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
    orderKey: sessionOrderKey(sessionID, 1_776_000_001_000),
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
    orderKey: messageOrderKey("msg_frontend_design_lifecycle", 1_776_000_002_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("frontend-design", {
        id: "msg_frontend_design_lifecycle",
        orderKey: messageOrderKey("msg_frontend_design_lifecycle", 1_776_000_002_000),
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
    orderKey: messageOrderKey("msg_frontend_design_lifecycle", 1_776_000_002_000),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("frontend-design", {
        id: "prt_frontend_design_lifecycle",
        orderKey: partOrderKey("prt_frontend_design_lifecycle", 1_776_000_002_000),
        owningMessageOrderKey: messageOrderKey("msg_frontend_design_lifecycle", 1_776_000_002_000),
        messageID: "msg_frontend_design_lifecycle",
        sessionID,
        type: "text",
        text: "frontend design produced visible content",
      }),
    },
  })
  expect(cardTreeStore.order).toContain(messageCardID)
})

test("goal-owned build message without a current board owner stays on a turn card", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "build starts before board phase projection",
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
    orderKey: messageOrderKey("msg_build_phase_stub", 1_776_000_003_000),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_build_phase_stub",
        orderKey: messageOrderKey("msg_build_phase_stub", 1_776_000_003_000),
        sessionID: "ses_build_phase_stub",
        role: "assistant",
        parentSessionID: ROOT_SID,
        goalID: "goal_phase_stub",
        time: { created: 1_776_000_003_000 },
      }),
    },
  })

  const phaseCardID = "step:goal_phase_stub:build:phase:build"
  const messageCardID = "build:session:ses_build_phase_stub:message:msg_build_phase_stub"
  expect(cardTreeStore.cards[phaseCardID]).toBeUndefined()
  expect(cardTreeStore.cards[messageCardID]).toEqual(
    expect.objectContaining({
      id: messageCardID,
      kind: "agent",
      sessionID: "ses_build_phase_stub",
      messageID: "msg_build_phase_stub",
    }),
  )
})

test("goal phase message stays loud when the current board owner exists but its phase card is missing", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "phase card must already exist when current board proves ownership",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-workflow-build`, 1_776_000_000_100, 61),
          label: "Executor",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_phase_stub",
        orderKey: boardOrderKey("goal_phase_stub", 1_776_000_000_100, 60),
        goalTitle: "Phase stub",
        goalStatus: "running",
        time: { created: 1_776_000_000_100 },
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey("goal_phase_stub_build", 1_776_000_000_100, 61),
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_100,
            payload: { buildSessionID: "ses_build_phase_owner" },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_000_100,
                orderKey: boardOrderKey("goal_phase_stub_build_build", 1_776_000_000_100, 62),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  const phaseCardID = "step:goal_phase_stub:build:phase:build"
  delete (cardTreeStore.cards as any)[phaseCardID]

  expect(() =>
    applyEvent({
      type: "message.updated",
      orderKey: messageOrderKey("msg_build_phase_owner", 1_776_000_003_100),
      properties: {
        taskID: TASK_ID,
        info: stampedInfo("build", {
          id: "msg_build_phase_owner",
          orderKey: messageOrderKey("msg_build_phase_owner", 1_776_000_003_100),
          sessionID: "ses_build_phase_owner",
          role: "assistant",
          parentSessionID: ROOT_SID,
          goalID: "goal_phase_stub",
          time: { created: 1_776_000_003_100 },
        }),
      },
    }),
  ).toThrow("goal phase goal_phase_stub/build/build missing backend board projection")
})

test("session.error marks the session card with the original stream error", () => {
  resetWriter()

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_stream_error", 1_776_000_009_000),
    properties: {
      info: stampedInfo("frontend-design", {
        id: "msg_stream_error",
        orderKey: messageOrderKey("msg_stream_error", 1_776_000_009_000),
        sessionID: "ses_stream_error",
        role: "assistant",
        time: { created: 1_776_000_009_000 },
      }),
    },
  })

  applyEvent({
    type: "session.error",
    orderKey: sessionOrderKey("ses_stream_error", 1_776_000_010_000),
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
    orderKey: sessionOrderKey("ses_stream_error", 1_776_000_011_000),
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

test("session.error without event time is rejected instead of using the local clock", () => {
  resetWriter()

  expect(() =>
    applyEvent({
      type: "session.error",
      orderKey: sessionOrderKey("ses_missing_error_time", 1_776_000_010_000),
      properties: {
        sessionID: "ses_missing_error_time",
        error: {
          name: "MessageAPIError",
          data: { message: "provider stream failed" },
        },
      },
    }),
  ).toThrow(/session\.error missing emittedAt\/timestamp/)
})

test("session.error with channel buffers until a real assistant message card exists", () => {
  resetWriter()

  const sessionID = "ses_queue_error"
  const lifecycleCardID = `assistant:session:${sessionID}`
  const messageCardID = `assistant:session:${sessionID}:message:msg_queue_error`

  applyEvent({
    type: "session.error",
    orderKey: sessionOrderKey(sessionID, 1_776_000_012_000),
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
    orderKey: messageOrderKey("msg_queue_error", 1_776_000_012_500),
    properties: {
      info: stampedInfo("assistant", {
        id: "msg_queue_error",
        orderKey: messageOrderKey("msg_queue_error", 1_776_000_012_500),
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
    orderKey: messageOrderKey("msg_queue_error", 1_776_000_012_500),
    properties: {
      ...stampedPartEvent("assistant", {
        id: "part_queue_error",
        orderKey: partOrderKey("part_queue_error", 1_776_000_012_500),
        owningMessageOrderKey: messageOrderKey("msg_queue_error", 1_776_000_012_500),
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
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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

function setStrictGoalBoard(input: {
  goalID: string
  stepStatus: string
  goalFields: Record<string, any>
  workflowPhases: Array<{ id: string; label: string; sessionKind: string }>
  stepPayload?: Record<string, any>
  phaseStatus?: string
}): void {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: `strict board ${input.goalID}`,
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-build`, 1_776_000_000_000, 61),
          label: "Build",
          phases: input.workflowPhases,
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: input.goalID,
        orderKey: boardOrderKey(input.goalID, 1_776_000_000_100, 60),
        goalRunID: `${input.goalID}_run`,
        goalTitle: `Strict ${input.goalID}`,
        goalStatus: "running",
        ...input.goalFields,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${input.goalID}-build`, 1_776_000_000_100, 61),
            label: "Build",
            status: input.stepStatus,
            startedAt: 1_776_000_000_100,
            ...(input.stepPayload ? { payload: input.stepPayload } : {}),
            ...(input.phaseStatus
              ? {
                  phases: {
                    build: {
                      orderKey: boardOrderKey(`${input.goalID}-build-phase`, 1_776_000_000_200, 62),
                      status: input.phaseStatus,
                      startedAt: 1_776_000_000_200,
                    },
                  },
                }
              : {}),
          },
        ],
      },
    ],
    interactions: [],
  })
}

test("message.part.updated rejects orderKey drift from an existing message owner", () => {
  seedTurnBoard("existing message owner drift")
  const messageID = "msg_existing_owner_drift"
  const ownerKey = messageOrderKey(messageID, 1_776_000_000_100)
  const driftKey = messageOrderKey(messageID, 1_776_000_000_200)

  applyEvent({
    type: "message.updated",
    orderKey: ownerKey,
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: messageID,
        orderKey: ownerKey,
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_100 },
      }),
    },
  })

  expect(() =>
    applyEvent({
      type: "message.part.updated",
      emittedAt: 1_776_000_000_200,
      orderKey: driftKey,
      properties: {
        taskID: TASK_ID,
        orderKey: driftKey,
        channel: "assistant",
        resolvedRole: "assistant",
        part: {
          id: "prt_existing_owner_drift",
          orderKey: partOrderKey("prt_existing_owner_drift", 1_776_000_000_200),
          sessionID: ROOT_SID,
          messageID,
          type: "text",
          text: "drift",
        },
      },
    }),
  ).toThrow(/drift from existing message owner/)
})

test("message.updated rejects orderKey drift from a pending part-first owner", () => {
  seedTurnBoard("pending part-first owner drift")
  const messageID = "msg_pending_owner_drift"
  const ownerKey = messageOrderKey(messageID, 1_776_000_000_100)
  const driftKey = messageOrderKey(messageID, 1_776_000_000_200)

  applyEvent({
    type: "message.part.updated",
    emittedAt: 1_776_000_000_100,
    orderKey: ownerKey,
    properties: {
      taskID: TASK_ID,
      orderKey: ownerKey,
      channel: "assistant",
      resolvedRole: "assistant",
      part: {
        id: "prt_pending_owner_drift",
        orderKey: partOrderKey("prt_pending_owner_drift", 1_776_000_000_100),
        sessionID: ROOT_SID,
        messageID,
        type: "text",
        text: "first token",
      },
    },
  })

  expect(() =>
    applyEvent({
      type: "message.updated",
      orderKey: driftKey,
      properties: {
        taskID: TASK_ID,
        info: stampedInfo("assistant", {
          id: messageID,
          orderKey: driftKey,
          sessionID: ROOT_SID,
          role: "assistant",
          resolvedRole: "assistant",
          agent: "assistant",
          time: { created: 1_776_000_000_200 },
        }),
      },
    }),
  ).toThrow(/drift from pending part-first owner/)
})

test("goal workflow aborted status renders as skipped", () => {
  resetWriter()
  const goalID = "goal_aborted_status"
  setStrictGoalBoard({
    goalID,
    stepStatus: "aborted",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [],
  })

  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  expect(cardTreeStore.cards[`step:${goalID}:build`]?.status).toBe("skipped")
})

test("goal workflow rejects unknown step status", () => {
  resetWriter()
  setStrictGoalBoard({
    goalID: "goal_unknown_status",
    stepStatus: "paused",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [],
  })

  expect(() => applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })).toThrow(
    /unknown workflow status/,
  )
})

test("goal workflow requires backend orderIndex and retryCount", () => {
  resetWriter()
  setStrictGoalBoard({
    goalID: "goal_missing_order_index",
    stepStatus: "running",
    goalFields: { retryCount: 0 },
    workflowPhases: [],
  })
  expect(() => applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })).toThrow(
    /missing integer orderIndex/,
  )

  resetWriter()
  setStrictGoalBoard({
    goalID: "goal_missing_retry_count",
    stepStatus: "running",
    goalFields: { orderIndex: 0 },
    workflowPhases: [],
  })
  expect(() => applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })).toThrow(
    /missing non-negative integer retryCount/,
  )
})

test("goal workflow phase projection requires declared phases and build session ownership", () => {
  resetWriter()
  setStrictGoalBoard({
    goalID: "goal_unknown_phase",
    stepStatus: "running",
    phaseStatus: "running",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [{ id: "review", label: "Review", sessionKind: "review" }],
    stepPayload: { buildSessionID: "ses_unknown_phase_build" },
  })
  expect(() => applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })).toThrow(
    /phase build is not declared in workflow/,
  )

  resetWriter()
  setStrictGoalBoard({
    goalID: "goal_missing_build_session",
    stepStatus: "running",
    phaseStatus: "running",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [{ id: "build", label: "Build", sessionKind: "build" }],
  })
  expect(() => applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })).toThrow(
    /missing buildSessionID/,
  )
})

test("hydrate rejects non-message orderKey domains in view message metadata", () => {
  seedTurnBoard("hydrate wrong message domain")

  const messageID = "msg_hydrate_wrong_message_domain"
  const messageTime = 1_776_000_000_100
  expect(() =>
    hydrateConversationViewRaw(
      {
        sessions: [],
        messages: [
          {
            messageID,
            sessionID: ROOT_SID,
            stage: "assistant",
            time: messageTime,
            orderKey: partOrderKey("prt_not_a_message_key", messageTime),
          },
        ],
      },
      [
        {
          info: {
            id: messageID,
            sessionID: ROOT_SID,
            role: "assistant",
            resolvedRole: "assistant",
            agent: "assistant",
            channel: "assistant",
            time: { created: messageTime },
            orderKey: messageOrderKey(messageID, messageTime),
          },
          parts: [
            {
              id: "prt_hydrate_wrong_message_domain",
              messageID,
              sessionID: ROOT_SID,
              orderKey: partOrderKey("prt_hydrate_wrong_message_domain", messageTime),
              type: "text",
              text: "visible",
            },
          ],
        },
      ],
    ),
  ).toThrow(/expected message orderKey/)
})

test("hydrate rejects persisted parts without part orderKey even before display text", () => {
  seedTurnBoard("hydrate empty part missing key")

  const messageID = "msg_hydrate_empty_part_missing_key"
  const messageTime = 1_776_000_000_200
  expect(() =>
    hydrateConversationViewRaw(
      {
        sessions: [],
        messages: [
          {
            messageID,
            sessionID: ROOT_SID,
            stage: "assistant",
            time: messageTime,
            orderKey: messageOrderKey(messageID, messageTime),
          },
        ],
      },
      [
        {
          info: {
            id: messageID,
            sessionID: ROOT_SID,
            role: "assistant",
            resolvedRole: "assistant",
            agent: "assistant",
            channel: "assistant",
            time: { created: messageTime },
            orderKey: messageOrderKey(messageID, messageTime),
          },
          parts: [
            {
              id: "prt_hydrate_empty_part_missing_key",
              messageID,
              sessionID: ROOT_SID,
              type: "reasoning",
              text: "",
            },
          ],
        },
      ],
    ),
  ).toThrow(/persisted message part prt_hydrate_empty_part_missing_key missing orderKey/)
})

test("orchestrator turns stay chronological around child agents", () => {
  seedTurnBoard("interleave turns")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_o1`
  const childCard = "architect:session:ses_child:message:msg_child"
  const o2 = `assistant:session:${ROOT_SID}:message:msg_o2`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_o1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_o1",
        orderKey: messageOrderKey("msg_o1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_o1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_o1",
        orderKey: partOrderKey("prt_o1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_o1", 1_776_000_000_100),
        messageID: "msg_o1",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn one",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_child", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_child",
        orderKey: messageOrderKey("msg_child", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_child", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "prt_child",
        orderKey: partOrderKey("prt_child", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_child", 1_776_000_000_200),
        messageID: "msg_child",
        sessionID: "ses_child",
        type: "text",
        text: "child agent visible content",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_o2", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_o2",
        orderKey: messageOrderKey("msg_o2", 1_776_000_000_300),
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
    orderKey: messageOrderKey("msg_o2", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_o2",
        orderKey: partOrderKey("prt_o2", 1_776_000_000_300),
        owningMessageOrderKey: messageOrderKey("msg_o2", 1_776_000_000_300),
        messageID: "msg_o2",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn two",
      }),
    },
  })

  const ordered = cardTreeStore.order.filter((id) => id === o1 || id === childCard || id === o2)
  expect(ordered).toEqual([o1, childCard, o2])

  const o1Texts = (cardTreeStore.cards[o1]?.parts || []).map((p: any) => p.text)
  expect(o1Texts).toContain("turn one")
  expect(o1Texts).not.toContain("turn two")
  expect((cardTreeStore.cards[o2]?.parts || []).map((p: any) => p.text)).toContain("turn two")

  expect(cardTreeStore.cards[o1]?.status).toBe("completed")
  expect(cardTreeStore.cards[o2]?.status).toBe("running")
  expect(cardTreeStore.cards[o1]?.sessionID).toBe(ROOT_SID)
  expect(cardTreeStore.cards[o1]?.messageID).toBe("msg_o1")
  expect(cardTreeStore.cards[o2]?.sessionID).toBe(ROOT_SID)
  expect(cardTreeStore.cards[o2]?.messageID).toBe("msg_o2")
})

test("late child agent event restores chronological orchestrator card order", () => {
  seedTurnBoard("out-of-order interleave turns")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_late_o1`
  const childCard = "architect:session:ses_late_child:message:msg_late_child"
  const o2 = `assistant:session:${ROOT_SID}:message:msg_late_o2`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_late_o1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_late_o1",
        orderKey: messageOrderKey("msg_late_o1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_late_o1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_late_o1",
        orderKey: partOrderKey("prt_late_o1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_late_o1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_late_o2", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_late_o2",
        orderKey: messageOrderKey("msg_late_o2", 1_776_000_000_300),
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
    orderKey: messageOrderKey("msg_late_o2", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_late_o2",
        orderKey: partOrderKey("prt_late_o2", 1_776_000_000_300),
        owningMessageOrderKey: messageOrderKey("msg_late_o2", 1_776_000_000_300),
        messageID: "msg_late_o2",
        sessionID: ROOT_SID,
        type: "text",
        text: "turn two after late child",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_late_child", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_late_child",
        orderKey: messageOrderKey("msg_late_child", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_late_child", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("architect", {
        id: "prt_late_child",
        orderKey: partOrderKey("prt_late_child", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_late_child", 1_776_000_000_200),
        messageID: "msg_late_child",
        sessionID: "ses_late_child",
        type: "text",
        text: "late child visible content",
      }),
    },
  })

  const ordered = cardTreeStore.order.filter((id) => id === o1 || id === childCard || id === o2)
  expect(ordered).toEqual([o1, childCard, o2])
  expect((cardTreeStore.cards[o1]?.parts || []).map((p: any) => p.text)).not.toContain("turn two after late child")
  expect((cardTreeStore.cards[o2]?.parts || []).map((p: any) => p.text)).toContain("turn two after late child")
})

test("consecutive messages from the same agent merge into one adjacent segment card", () => {
  seedTurnBoard("consecutive turns")

  const cardID = `assistant:session:${ROOT_SID}:message:msg_c1`
  const secondCardID = `assistant:session:${ROOT_SID}:message:msg_c2`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_c1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_c1",
        orderKey: messageOrderKey("msg_c1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_c1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_c1",
        orderKey: partOrderKey("prt_c1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_c1", 1_776_000_000_100),
        messageID: "msg_c1",
        sessionID: ROOT_SID,
        type: "text",
        text: "first consecutive turn",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_c2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_c2",
        orderKey: messageOrderKey("msg_c2", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_c2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_c2",
        orderKey: partOrderKey("prt_c2", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_c2", 1_776_000_000_200),
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
  expect((cardTreeStore.cards[cardID]?.parts || []).map((p: any) => [p.type, p.messageID, p.text])).toEqual([
    ["text", "msg_c1", "first consecutive turn"],
    ["boundary", "msg_c2", undefined],
    ["text", "msg_c2", "second consecutive turn"],
  ])
})

test("integrity messages separated by a user turn do not merge across the timeline", () => {
  seedTurnBoard("integrity non-adjacent turns")

  const firstIntegrityCardID = `integrity:session:${INTEGRITY_SID}:message:msg_integrity_first`
  const userCardID = `user:session:${ROOT_SID}:message:msg_integrity_user_between`
  const secondIntegrityCardID = `integrity:session:${INTEGRITY_SID}:message:msg_integrity_second`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_integrity_first", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("integrity", {
        id: "msg_integrity_first",
        orderKey: messageOrderKey("msg_integrity_first", 1_776_000_000_100),
        sessionID: INTEGRITY_SID,
        role: "assistant",
        resolvedRole: "integrity",
        agent: "integrity",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_integrity_first", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("integrity", {
        id: "prt_integrity_first",
        orderKey: partOrderKey("prt_integrity_first", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_integrity_first", 1_776_000_000_100),
        messageID: "msg_integrity_first",
        sessionID: INTEGRITY_SID,
        type: "text",
        text: "first integrity turn",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_integrity_user_between", 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("main", {
        id: "msg_integrity_user_between",
        orderKey: messageOrderKey("msg_integrity_user_between", 1_776_000_000_150),
        sessionID: ROOT_SID,
        role: "user",
        resolvedRole: "user",
        agent: "user",
        time: { created: 1_776_000_000_150 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_integrity_user_between", 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("main", {
        id: "prt_integrity_user_between",
        orderKey: partOrderKey("prt_integrity_user_between", 1_776_000_000_150),
        owningMessageOrderKey: messageOrderKey("msg_integrity_user_between", 1_776_000_000_150),
        messageID: "msg_integrity_user_between",
        sessionID: ROOT_SID,
        resolvedRole: "user",
        type: "text",
        text: "user turn between integrity messages",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_integrity_second", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("integrity", {
        id: "msg_integrity_second",
        orderKey: messageOrderKey("msg_integrity_second", 1_776_000_000_200),
        sessionID: INTEGRITY_SID,
        role: "assistant",
        resolvedRole: "integrity",
        agent: "integrity",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_integrity_second", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("integrity", {
        id: "prt_integrity_second",
        orderKey: partOrderKey("prt_integrity_second", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_integrity_second", 1_776_000_000_200),
        messageID: "msg_integrity_second",
        sessionID: INTEGRITY_SID,
        type: "text",
        text: "second integrity turn",
      }),
    },
  })

  expect(cardTreeStore.cards[`integrity:session:${INTEGRITY_SID}`]).toBeUndefined()
  expect(cardTreeStore.cards[firstIntegrityCardID]).toBeDefined()
  expect(cardTreeStore.cards[userCardID]).toBeDefined()
  expect(cardTreeStore.cards[secondIntegrityCardID]).toBeDefined()
  expect(cardTreeStore.order.filter((id) => [firstIntegrityCardID, userCardID, secondIntegrityCardID].includes(id))).toEqual([
    firstIntegrityCardID,
    userCardID,
    secondIntegrityCardID,
  ])
  expect((cardTreeStore.cards[firstIntegrityCardID]?.parts || []).map((part: any) => part.text)).not.toContain(
    "second integrity turn",
  )
})

test("repeated message.updated for the same agent message does not reset card start time", () => {
  seedTurnBoard("stable message timer")

  const cardID = "frontend-research:session:ses_timer_stable:message:msg_timer_stable"

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_timer_stable", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("frontend-research", {
        id: "msg_timer_stable",
        orderKey: messageOrderKey("msg_timer_stable", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_timer_stable", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("frontend-research", {
        id: "prt_timer_stable",
        orderKey: partOrderKey("prt_timer_stable", 1_776_000_012_000),
        owningMessageOrderKey: messageOrderKey("msg_timer_stable", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_timer_stable", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("frontend-research", {
        id: "msg_timer_stable",
        orderKey: messageOrderKey("msg_timer_stable", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_explore_1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("explore", {
        id: "msg_explore_1",
        orderKey: messageOrderKey("msg_explore_1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_explore_1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("explore", {
        id: "prt_explore_1",
        orderKey: partOrderKey("prt_explore_1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_explore_1", 1_776_000_000_100),
        messageID: "msg_explore_1",
        sessionID: "ses_explore_mixed",
        type: "text",
        text: "inspect repo",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_explore_2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("explore", {
        id: "msg_explore_2",
        orderKey: messageOrderKey("msg_explore_2", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_explore_2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("explore", {
        id: "prt_explore_2",
        orderKey: partOrderKey("prt_explore_2", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_explore_2", 1_776_000_000_200),
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
  expect(card?.parts.map((part: any) => [part.type, part.messageID, part.text])).toEqual([
    ["text", "msg_explore_1", "inspect repo"],
    ["boundary", "msg_explore_2", undefined],
    ["text", "msg_explore_2", "repo inspected"],
  ])
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
          orderKey: sessionOrderKey("ses_mission_split", 1_776_000_000_100),
          stage: "user",
          messageIDs: ["msg_mission_user"],
          placement: "top_level",
        },
        {
          sessionID: "ses_mission_split",
          orderKey: sessionOrderKey("ses_mission_split", 1_776_000_000_100),
          stage: "mission",
          messageIDs: ["msg_mission_agent"],
          placement: "top_level",
        },
      ],
      messages: [
        {
          messageID: "msg_mission_user",
          orderKey: messageOrderKey("msg_mission_user", 1_776_000_000_100),
          sessionID: "ses_mission_split",
          stage: "user",
          time: 1_776_000_000_100,
          placement: "top_level",
        },
        {
          messageID: "msg_mission_agent",
          orderKey: messageOrderKey("msg_mission_agent", 1_776_000_000_200),
          sessionID: "ses_mission_split",
          stage: "mission",
          time: 1_776_000_000_200,
          placement: "top_level",
        },
      ],
    },
    [
      {
        info: stampedInfo("main", {
          id: "msg_mission_user",
          orderKey: messageOrderKey("msg_mission_user", 1_776_000_000_100),
          sessionID: "ses_mission_split",
          role: "user",
          resolvedRole: "user",
          time: { created: 1_776_000_000_100 },
        }),
        parts: [
          stampedPart("main", {
            id: "prt_mission_user",
            orderKey: partOrderKey("prt_mission_user", 1_776_000_000_100),
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
          orderKey: messageOrderKey("msg_mission_agent", 1_776_000_000_200),
          sessionID: "ses_mission_split",
          role: "assistant",
          resolvedRole: "mission",
          agent: "mission",
          time: { created: 1_776_000_000_200 },
        }),
        parts: [
          stampedPart("mission", {
            id: "prt_mission_agent",
            orderKey: partOrderKey("prt_mission_agent", 1_776_000_000_200),
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

test("phase-absorbed agent does not merge surrounding orchestrator turns", () => {
  seedTurnBoard("phase interruption")
  const phaseGoalID = "goal_phase_interrupt"
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "phase interruption",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-build`, 1_776_000_000_000, 61),
          label: "Executor",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: phaseGoalID,
        orderKey: boardOrderKey(phaseGoalID, 1_776_000_000_150, 60),
        goalTitle: "Phase interruption",
        goalStatus: "running",
        time: { created: 1_776_000_000_150 },
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${phaseGoalID}-build`, 1_776_000_000_150, 61),
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_150,
            payload: { buildSessionID: "ses_phase_build_interrupt" },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_000_150,
                orderKey: boardOrderKey(`${phaseGoalID}-build-phase`, 1_776_000_000_150, 62),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  const o1 = `assistant:session:${ROOT_SID}:message:msg_phase_i1`
  const o2 = `assistant:session:${ROOT_SID}:message:msg_phase_i2`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_phase_i1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_phase_i1",
        orderKey: messageOrderKey("msg_phase_i1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_phase_i1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_phase_i1",
        orderKey: partOrderKey("prt_phase_i1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_phase_i1", 1_776_000_000_100),
        messageID: "msg_phase_i1",
        sessionID: ROOT_SID,
        type: "text",
        text: "orchestrator before phase",
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_phase_build", 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_phase_build",
        orderKey: messageOrderKey("msg_phase_build", 1_776_000_000_150),
        sessionID: "ses_phase_build_interrupt",
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID: phaseGoalID,
        time: { created: 1_776_000_000_150 },
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_phase_i2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_phase_i2",
        orderKey: messageOrderKey("msg_phase_i2", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_phase_i2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_phase_i2",
        orderKey: partOrderKey("prt_phase_i2", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_phase_i2", 1_776_000_000_200),
        messageID: "msg_phase_i2",
        sessionID: ROOT_SID,
        type: "text",
        text: "orchestrator after phase",
      }),
    },
  })

  expect(cardTreeStore.cards[o1]).toBeDefined()
  expect(cardTreeStore.cards[o2]).toBeDefined()
  expect(cardTreeStore.order.filter((id) => id === o1 || id === o2)).toEqual([o1, o2])
  expect((cardTreeStore.cards[o1]?.parts || []).map((p: any) => p.text)).toEqual(["orchestrator before phase"])
  expect((cardTreeStore.cards[o2]?.parts || []).map((p: any) => p.text)).toEqual(["orchestrator after phase"])
})

test("late goal step materialization splits an already merged top-level segment", () => {
  seedTurnBoard("late step boundary")
  const phaseGoalID = "goal_late_step_boundary"
  const firstCardID = `assistant:session:${ROOT_SID}:message:msg_late_step_before`
  const secondCardID = `assistant:session:${ROOT_SID}:message:msg_late_step_after`
  const stepCardID = `step:${phaseGoalID}:build`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_late_step_before", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_late_step_before",
        orderKey: messageOrderKey("msg_late_step_before", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_late_step_before", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_late_step_before",
        orderKey: partOrderKey("prt_late_step_before", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_late_step_before", 1_776_000_000_100),
        messageID: "msg_late_step_before",
        sessionID: ROOT_SID,
        type: "text",
        text: "before late step",
      }),
    },
  })
  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_late_step_after", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_late_step_after",
        orderKey: messageOrderKey("msg_late_step_after", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_late_step_after", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_late_step_after",
        orderKey: partOrderKey("prt_late_step_after", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_late_step_after", 1_776_000_000_200),
        messageID: "msg_late_step_after",
        sessionID: ROOT_SID,
        type: "text",
        text: "after late step",
      }),
    },
  })

  expect(cardTreeStore.cards[firstCardID]).toBeDefined()
  expect(cardTreeStore.cards[secondCardID]).toBeUndefined()

  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "late step boundary",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-build`, 1_776_000_000_000, 61),
          label: "Executor",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: phaseGoalID,
        orderKey: boardOrderKey(phaseGoalID, 1_776_000_000_150, 60),
        goalTitle: "Late step boundary",
        goalStatus: "running",
        time: { created: 1_776_000_000_150 },
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${phaseGoalID}-build`, 1_776_000_000_150, 61),
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_150,
            payload: { buildSessionID: "ses_late_step_boundary_build" },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_000_150,
                orderKey: boardOrderKey(`${phaseGoalID}-build-phase`, 1_776_000_000_150, 62),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  expect(cardTreeStore.cards[stepCardID]).toBeDefined()
  expect(cardTreeStore.cards[secondCardID]).toBeDefined()
  expect(cardTreeStore.order.filter((id) => [firstCardID, stepCardID, secondCardID].includes(id))).toEqual([
    firstCardID,
    stepCardID,
    secondCardID,
  ])
  expect((cardTreeStore.cards[firstCardID]?.parts || []).map((part: any) => part.text)).toEqual(["before late step"])
  expect((cardTreeStore.cards[secondCardID]?.parts || []).map((part: any) => part.text)).toEqual(["after late step"])
})

test("goal phase internals do not repeatedly split adjacent top-level build segments", () => {
  seedTurnBoard("phase internals are not repeated top-level boundaries")
  const phaseGoalID = "goal_phase_internal_boundary"
  const topSessionID = "ses_top_build_diagnostics"
  const phaseSessionID = "ses_goal_phase_internal_build"
  const firstCardID = `build:session:${topSessionID}:message:msg_top_build_before_step`
  const afterStepCardID = `build:session:${topSessionID}:message:msg_top_build_after_step_a`
  const splitCardID = `build:session:${topSessionID}:message:msg_top_build_after_step_b`
  const phaseStepCardID = `step:${phaseGoalID}:build`
  const phaseCardID = `${phaseStepCardID}:phase:build`

  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "phase internals are not repeated top-level boundaries",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-build`, 1_776_000_000_000, 61),
          label: "Executor",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: phaseGoalID,
        orderKey: boardOrderKey(phaseGoalID, 1_776_000_000_150, 60),
        goalTitle: "Visible goal step boundary",
        goalStatus: "running",
        time: { created: 1_776_000_000_150 },
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${phaseGoalID}-build`, 1_776_000_000_150, 61),
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_150,
            payload: { buildSessionID: phaseSessionID },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_000_150,
                orderKey: boardOrderKey(`${phaseGoalID}-build-phase`, 1_776_000_000_150, 62),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_top_build_before_step", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_top_build_before_step",
        orderKey: messageOrderKey("msg_top_build_before_step", 1_776_000_000_100),
        sessionID: topSessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_100 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_top_build_before_step", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_top_build_before_step",
        orderKey: partOrderKey("prt_top_build_before_step", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_top_build_before_step", 1_776_000_000_100),
        messageID: "msg_top_build_before_step",
        sessionID: topSessionID,
        type: "text",
        text: "top build before visible step",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_top_build_after_step_a", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_top_build_after_step_a",
        orderKey: messageOrderKey("msg_top_build_after_step_a", 1_776_000_000_200),
        sessionID: topSessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_top_build_after_step_a", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_top_build_after_step_a",
        orderKey: partOrderKey("prt_top_build_after_step_a", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_top_build_after_step_a", 1_776_000_000_200),
        messageID: "msg_top_build_after_step_a",
        sessionID: topSessionID,
        type: "text",
        text: "top build after visible step",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_goal_phase_internal", 1_776_000_000_250),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_goal_phase_internal",
        orderKey: messageOrderKey("msg_goal_phase_internal", 1_776_000_000_250),
        sessionID: phaseSessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID: phaseGoalID,
        time: { created: 1_776_000_000_250 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_goal_phase_internal", 1_776_000_000_250),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_goal_phase_internal",
        orderKey: partOrderKey("prt_goal_phase_internal", 1_776_000_000_250),
        owningMessageOrderKey: messageOrderKey("msg_goal_phase_internal", 1_776_000_000_250),
        messageID: "msg_goal_phase_internal",
        sessionID: phaseSessionID,
        type: "text",
        text: "internal goal phase build output",
        parentSessionID: ROOT_SID,
        goalID: phaseGoalID,
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_top_build_after_step_b", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_top_build_after_step_b",
        orderKey: messageOrderKey("msg_top_build_after_step_b", 1_776_000_000_300),
        sessionID: topSessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_000_300 },
      }),
    },
  })
  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey("msg_top_build_after_step_b", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_top_build_after_step_b",
        orderKey: partOrderKey("prt_top_build_after_step_b", 1_776_000_000_300),
        owningMessageOrderKey: messageOrderKey("msg_top_build_after_step_b", 1_776_000_000_300),
        messageID: "msg_top_build_after_step_b",
        sessionID: topSessionID,
        type: "text",
        text: "top build still visually adjacent",
      }),
    },
  })

  expect(cardTreeStore.cards[phaseStepCardID]).toBeDefined()
  expect(cardTreeStore.cards[phaseCardID]).toBeDefined()
  expect(cardTreeStore.cards[firstCardID]).toBeDefined()
  expect(cardTreeStore.cards[afterStepCardID]).toBeDefined()
  expect(cardTreeStore.cards[splitCardID]).toBeUndefined()
  expect(
    cardTreeStore.order.filter((id) => [firstCardID, phaseStepCardID, afterStepCardID, splitCardID].includes(id)),
  ).toEqual([firstCardID, phaseStepCardID, afterStepCardID])
  expect(
    (cardTreeStore.cards[afterStepCardID]?.parts || []).map((part: any) => [part.type, part.messageID, part.text]),
  ).toEqual([
    ["text", "msg_top_build_after_step_a", "top build after visible step"],
    ["boundary", "msg_top_build_after_step_b", undefined],
    ["text", "msg_top_build_after_step_b", "top build still visually adjacent"],
  ])
})

test("phase-absorbed empty build messages do not create timestamp-only boundaries", () => {
  seedTurnBoard("empty build envelope")

  const goalID = "goal_empty_build"
  const sessionID = "ses_empty_build"
  const messageID = "msg_empty_build"
  setStrictGoalBoard({
    goalID,
    stepStatus: "running",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [{ id: "build", label: "Build", sessionKind: "build" }],
    stepPayload: { buildSessionID: sessionID },
    phaseStatus: "running",
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })
  const hasEmptyBoundary = () =>
    Object.values(cardTreeStore.cards).some((card: any) =>
      (card?.parts || []).some((part: any) => part.type === "boundary" && part.messageID === messageID),
    )
  const hasVisibleMessagePart = () =>
    Object.values(cardTreeStore.cards).some((card: any) =>
      (card?.parts || []).some(
        (part: any) => part.messageID === messageID && isCardBodyMessagePart(part),
      ),
    )
  const hasPartID = (partID: string) =>
    Object.values(cardTreeStore.cards).some((card: any) =>
      (card?.parts || []).some((part: any) => part.id === partID),
    )

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey(messageID, 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: messageID,
        orderKey: messageOrderKey(messageID, 1_776_000_000_150),
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
  expect(hasPartID("prt_empty_step")).toBe(false)

  applyEvent({
    type: "message.part.updated",
    orderKey: messageOrderKey(messageID, 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_empty_step",
        orderKey: partOrderKey("prt_empty_step", 1_776_000_000_150),
        owningMessageOrderKey: messageOrderKey(messageID, 1_776_000_000_150),
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
    orderKey: messageOrderKey(messageID, 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_visible_text",
        orderKey: partOrderKey("prt_visible_text", 1_776_000_000_150),
        owningMessageOrderKey: messageOrderKey(messageID, 1_776_000_000_150),
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
  setStrictGoalBoard({
    goalID,
    stepStatus: "running",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [{ id: "build", label: "Build", sessionKind: "build" }],
    stepPayload: { buildSessionID: sessionID },
    phaseStatus: "running",
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey(assistantMessageID, 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: assistantMessageID,
        orderKey: messageOrderKey(assistantMessageID, 1_776_000_000_200),
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
    orderKey: messageOrderKey(assistantMessageID, 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_phase_prompt_order_assistant",
        orderKey: partOrderKey("prt_phase_prompt_order_assistant", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey(assistantMessageID, 1_776_000_000_200),
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
    orderKey: messageOrderKey(promptMessageID, 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: promptMessageID,
        orderKey: messageOrderKey(promptMessageID, 1_776_000_000_100),
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
    orderKey: messageOrderKey(promptMessageID, 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("build", {
        id: "prt_phase_prompt_order_user",
        orderKey: partOrderKey("prt_phase_prompt_order_user", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey(promptMessageID, 1_776_000_000_100),
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

test("stale build owner falls back to its own turn card while the current phase stays intact", () => {
  seedTurnBoard("phase stale lifecycle owner")

  const goalID = "goal_phase_stale_owner"
  const staleSessionID = "ses_phase_stale_owner_old"
  const currentSessionID = "ses_phase_stale_owner_current"
  const phaseStepCardID = `step:${goalID}:build`
  const phaseCardID = `${phaseStepCardID}:phase:build`

  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
      status: "active",
      request: "phase stale lifecycle owner",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          orderKey: boardOrderKey(`${TASK_ID}-build`, 1_776_000_000_000, 61),
          label: "Executor",
          phases: [{ id: "build", label: "Build", sessionKind: "build" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID,
        orderKey: boardOrderKey(goalID, 1_776_000_000_100, 60),
        goalTitle: "Phase stale owner",
        goalStatus: "running",
        time: { created: 1_776_000_000_100 },
        orderIndex: 10,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            orderKey: boardOrderKey(`${goalID}-build`, 1_776_000_000_100, 61),
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_100,
            payload: { buildSessionID: currentSessionID },
            phases: {
              build: {
                status: "running",
                startedAt: 1_776_000_000_100,
                orderKey: boardOrderKey("phase_stale_owner_build", 1_776_000_000_100, 22),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_phase_current", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_phase_current",
        orderKey: messageOrderKey("msg_phase_current", 1_776_000_000_300),
        sessionID: currentSessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID,
        time: { created: 1_776_000_000_300 },
      }),
    },
  })
  expect(cardTreeStore.cards[phaseCardID]?.phaseSessionID).toBe(currentSessionID)

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_phase_stale", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("build", {
        id: "msg_phase_stale",
        orderKey: messageOrderKey("msg_phase_stale", 1_776_000_000_200),
        sessionID: staleSessionID,
        role: "assistant",
        resolvedRole: "build",
        agent: "build",
        parentSessionID: ROOT_SID,
        goalID,
        time: { created: 1_776_000_000_200 },
      }),
    },
  })
  expect(cardTreeStore.cards[`build:session:${staleSessionID}:message:msg_phase_stale`]).toEqual(
    expect.objectContaining({
      kind: "agent",
      sessionID: staleSessionID,
      messageID: "msg_phase_stale",
    }),
  )
  expect(cardTreeStore.cards[phaseCardID]?.phaseSessionID).toBe(currentSessionID)

  applyEvent({
    type: "session.status",
    orderKey: sessionOrderKey(staleSessionID, 1_776_000_000_400),
    emittedAt: 1_776_000_000_400,
    properties: {
      sessionID: staleSessionID,
      status: { type: "terminal", reason: "aborted", error: "stale worker cancel" },
    },
  })
  expect(cardTreeStore.cards[phaseCardID]?.phaseSessionID).toBe(currentSessionID)
  expect(cardTreeStore.cards[phaseCardID]?.status).toBe("running")
  expect(cardTreeStore.cards[phaseCardID]?.terminalReason).toBeUndefined()

  applyEvent({
    type: "session.status",
    orderKey: sessionOrderKey(currentSessionID, 1_776_000_000_500),
    emittedAt: 1_776_000_000_500,
    properties: {
      sessionID: currentSessionID,
      status: { type: "terminal", reason: "completed" },
    },
  })
  expect(cardTreeStore.cards[phaseCardID]?.status).toBe("completed")
  expect(cardTreeStore.cards[phaseCardID]?.terminalReason).toBe("completed")
})

test("hydrate skips empty build transcript messages before boundary projection", () => {
  seedTurnBoard("hydrate empty build envelope")

  const goalID = "goal_hydrate_empty"
  const visibleSessionID = "ses_hydrate_visible"
  setStrictGoalBoard({
    goalID,
    stepStatus: "running",
    goalFields: { orderIndex: 0, retryCount: 0 },
    workflowPhases: [{ id: "build", label: "Build", sessionKind: "build" }],
    stepPayload: { buildSessionID: visibleSessionID },
    phaseStatus: "running",
  })
  applyEvent({ type: "task.updated", properties: { taskID: TASK_ID } })
  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: visibleSessionID,
          orderKey: sessionOrderKey(visibleSessionID, 1_776_000_000_200),
          stage: "build",
          parentSessionID: ROOT_SID,
          goalID,
          messageIDs: ["msg_hydrate_empty", "msg_hydrate_visible"],
          lastDisplayMessageID: "msg_hydrate_visible",
          firstMessageTime: 1_776_000_000_150,
          lastMessageTime: 1_776_000_000_200,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
      topLevelSessionIDs: [],
      messages: [
        {
          messageID: "msg_hydrate_visible",
          orderKey: messageOrderKey("msg_hydrate_visible", 1_776_000_000_200),
          sessionID: visibleSessionID,
          stage: "build",
          parentSessionID: ROOT_SID,
          goalID,
          time: 1_776_000_000_200,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
    },
    [
      {
        info: stampedInfo("build", {
          id: "msg_hydrate_empty",
          orderKey: messageOrderKey("msg_hydrate_empty", 1_776_000_000_150),
          sessionID: visibleSessionID,
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
          orderKey: messageOrderKey("msg_hydrate_visible", 1_776_000_000_200),
          sessionID: visibleSessionID,
          role: "assistant",
          parentSessionID: ROOT_SID,
          goalID,
          time: { created: 1_776_000_000_200 },
        }),
        parts: [
          {
            id: "prt_hydrate_step_start",
            orderKey: partOrderKey("prt_hydrate_step_start", 1_776_000_000_199),
            messageID: "msg_hydrate_visible",
            sessionID: visibleSessionID,
            type: "step-start",
          },
          {
            id: "prt_hydrate_visible",
            orderKey: partOrderKey("prt_hydrate_visible", 1_776_000_000_200),
            messageID: "msg_hydrate_visible",
            sessionID: visibleSessionID,
            type: "text",
            text: "hydrated build output",
          },
          {
            id: "prt_hydrate_step_finish",
            orderKey: partOrderKey("prt_hydrate_step_finish", 1_776_000_000_201),
            messageID: "msg_hydrate_visible",
            sessionID: visibleSessionID,
            type: "step-finish",
          },
        ],
      },
    ],
  )

  const phaseCard = Object.values(cardTreeStore.cards).find(
    (card: any) => card?.phaseSessionID === visibleSessionID,
  ) as any
  expect(phaseCard).toBeDefined()
  expect(phaseCard.parts.some((part: any) => part.type === "boundary" && part.messageID === "msg_hydrate_empty")).toBe(
    false,
  )
  expect(phaseCard.parts.some((part: any) => part.type === "text" && part.text === "hydrated build output")).toBe(true)
  expect(phaseCard.parts.some((part: any) => part.id === "prt_hydrate_step_start")).toBe(false)
  expect(phaseCard.parts.some((part: any) => part.id === "prt_hydrate_step_finish")).toBe(false)
})

test("interaction remains attached to the turn active at interaction time", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
        orderKey: interactionOrderKey("int_turn_owner", 1_776_000_000_150),
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
    orderKey: messageOrderKey("msg_i1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_i1",
        orderKey: messageOrderKey("msg_i1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_i2", 1_776_000_000_300),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_i2",
        orderKey: messageOrderKey("msg_i2", 1_776_000_000_300),
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
    orderKey: messageOrderKey("msg_d1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_d1",
        orderKey: messageOrderKey("msg_d1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_d1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_d1",
        orderKey: partOrderKey("prt_d1", 1_776_000_000_100),
        owningMessageOrderKey: messageOrderKey("msg_d1", 1_776_000_000_100),
        messageID: "msg_d1",
        sessionID: ROOT_SID,
        type: "text",
        text: "",
      }),
    },
  })

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_d2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_d2",
        orderKey: messageOrderKey("msg_d2", 1_776_000_000_200),
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
    orderKey: messageOrderKey("msg_d2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      ...stampedPartEvent("assistant", {
        id: "prt_d2",
        orderKey: partOrderKey("prt_d2", 1_776_000_000_200),
        owningMessageOrderKey: messageOrderKey("msg_d2", 1_776_000_000_200),
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

test("session.status terminal updates the active message card", () => {
  seedTurnBoard("status active only")

  const o1 = `assistant:session:${ROOT_SID}:message:msg_s1`
  const o2 = `assistant:session:${ROOT_SID}:message:msg_s2`

  applyEvent({
    type: "message.updated",
    orderKey: messageOrderKey("msg_s1", 1_776_000_000_100),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_s1",
        orderKey: messageOrderKey("msg_s1", 1_776_000_000_100),
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
    orderKey: messageOrderKey("msg_s_child", 1_776_000_000_150),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("architect", {
        id: "msg_s_child",
        orderKey: messageOrderKey("msg_s_child", 1_776_000_000_150),
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
    orderKey: messageOrderKey("msg_s2", 1_776_000_000_200),
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("assistant", {
        id: "msg_s2",
        orderKey: messageOrderKey("msg_s2", 1_776_000_000_200),
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
    orderKey: sessionOrderKey(ROOT_SID, 1_776_000_000_300),
    emittedAt: 1_776_000_000_300,
    properties: {
      sessionID: ROOT_SID,
      status: { type: "terminal", reason: "completed" },
    },
  })

  expect(cardTreeStore.cards[o1]?.status).toBe("completed")
  expect(cardTreeStore.cards[o1]?.terminalReason).toBeUndefined()
  expect(cardTreeStore.cards[o2]?.status).toBe("completed")
  expect(cardTreeStore.cards[o2]?.terminalReason).toBe("completed")
})

test("hydrate merges consecutive same-agent messages into one adjacent segment card", () => {
  resetWriter()
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      orderKey: taskOrderKey(TASK_ID, 1_776_000_000_000),
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
      orderKey: messageOrderKey(id, created),
      sessionID: ROOT_SID,
      role: "assistant",
      resolvedRole: "assistant",
      agent: "assistant",
      channel: "assistant",
      time: { created },
    },
    parts: [{ id: `prt_${id}`, orderKey: partOrderKey(`prt_${id}`, created), messageID: id, sessionID: ROOT_SID, type: "text", text }],
  })
  const transcript = [mk("msg_h1", 1_776_000_000_100, "first turn"), mk("msg_h2", 1_776_000_000_200, "second turn")]

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: ROOT_SID,
          orderKey: sessionOrderKey(ROOT_SID, 1_776_000_000_100),
          stage: "assistant",
          messageIDs: ["msg_h1", "msg_h2"],
          placement: "top_level",
        },
      ],
      messages: [
        {
          messageID: "msg_h1",
          orderKey: messageOrderKey("msg_h1", 1_776_000_000_100),
          sessionID: ROOT_SID,
          stage: "assistant",
          time: 1_776_000_000_100,
          placement: "top_level",
        },
        {
          messageID: "msg_h2",
          orderKey: messageOrderKey("msg_h2", 1_776_000_000_200),
          sessionID: ROOT_SID,
          stage: "assistant",
          time: 1_776_000_000_200,
          placement: "top_level",
        },
      ],
    },
    transcript,
  )

  const h1 = `assistant:session:${ROOT_SID}:message:msg_h1`
  const h2 = `assistant:session:${ROOT_SID}:message:msg_h2`
  expect(cardTreeStore.order).toContain(h1)
  expect(cardTreeStore.order).not.toContain(h2)
  expect(cardTreeStore.cards[h1]?.parts.some((p: any) => p.text === "first turn")).toBe(true)
  expect(cardTreeStore.cards[h1]?.parts.map((p: any) => [p.type, p.messageID, p.text])).toEqual([
    ["text", "msg_h1", "first turn"],
    ["boundary", "msg_h2", undefined],
    ["text", "msg_h2", "second turn"],
  ])
  expect(cardTreeStore.cards[h2]).toBeUndefined()
  expect(cardTreeStore.cards[`assistant:session:${ROOT_SID}`]).toBeUndefined()
})
