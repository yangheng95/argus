// ── Goal-phase SSE event stream fixture ──
//
// Representative stream covering every event type the overlay must handle
// correctly. Used by the reactivity refactor (specs/current/architecture/07-panel-reactivity.md)
// as the P0 baseline: both the old pipeline and the new cardTreeStore/tree-writer
// pipeline must produce the SAME normalized tree after applying these events.
//
// Coverage:
//   - task-level: task.created / updated / completed
//   - board: goal.* (status changes), interaction.*
//   - messages: message.updated, message.part.updated, message.part.delta
//     (text + reasoning streaming, tool call + tool result)
//   - cross-session: parent (orchestrator) + child (executor) + grandchild (build)
//
// Times are monotonic and start at 1_776_000_000_000 ms.

const T0 = 1_776_000_000_000

export const TASK_ID = "tsk_fixture_goal_phase"
export const ROOT_SID = "ses_root_orch"
export const GOAL_ID = "goal_fixture_g1"
/** Tip goal_run id emitted by the backend on goalWorkflows[].goalRunID.
 *  Drives the per-attempt step card scoping (2026-04-21). Held constant
 *  through this fixture — only a retry/rework event would produce a new
 *  value, which the fixture does not exercise. */
export const GOAL_RUN_ID = "glr_fixture_attempt1"
/** kind="executor" container session — empty parent that groups
 *  planner / build worker children. Does NOT render as a card; the
 *  step card in the overlay represents it. (2026-04-20: the per-goal
 *  evaluator child session was retired.) */
export const EXECUTOR_SID = "ses_goal_executor"
/** kind="build" worker session — the LLM that actually writes code. */
export const BUILD_SID = "ses_goal_build"
export const PLANNER_SID = "ses_goal_planner"
export const REQUIREMENTS_SID = "ses_requirements"
export const DESIGN_SID = "ses_design"
export const ARCHITECT_SID = "ses_architect"

/** Top-level SSE event shape (same as `streamSSE` emits server-side). */
export interface FixtureEvent {
  type: string
  sequence?: number
  timestamp?: number
  orderKey?: string
  taskID?: string
  /** Either `properties` or `payload` — router treats both. Fixture uses `properties`
   *  to match the protocol routes; `payload` variant is covered in specific tests. */
  properties?: Record<string, any>
  summary?: string
  event_id?: string
}

let seq = 0
function orderKey(rank: number, time: number, id: string, sequence = 0, domain: string): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:${domain}:${id}`
}

function messageOrderKey(id: string, time: number): string {
  return orderKey(30, time, id, 0, "message")
}

function partOrderKey(id: string, time: number): string {
  return orderKey(31, time, id, 0, "part")
}

function protocolOrderKey(id: string, time: number, sequence: number): string {
  return orderKey(40, time, id, sequence, "protocol")
}

function taskOrderKey(id: string, time: number): string {
  return orderKey(10, time, id, 0, "task")
}

function boardOrderKey(id: string, time: number, rank: number): string {
  return orderKey(rank, time, id, 0, "board")
}

function interactionOrderKey(id: string, time: number): string {
  return orderKey(70, time, id, 0, "interaction")
}

const e = (type: string, properties: Record<string, any> = {}, dt = 0): FixtureEvent => {
  const payload = { taskID: TASK_ID, ...properties }
  const eventOrderKey =
    type === "message.updated" && payload.info?.orderKey
      ? payload.info.orderKey
      : type === "message.part.updated" && payload.orderKey
        ? payload.orderKey
        : protocolOrderKey(`evt_${seq + 1}`, T0 + dt, seq + 1)
  return {
    type,
    sequence: ++seq,
    timestamp: T0 + dt,
    orderKey: eventOrderKey,
    taskID: TASK_ID,
    properties: payload,
  }
}

function messageInfo(channel: string, info: Record<string, any>) {
  const created = Number(info?.time?.created || 0)
  return {
    info: {
      ...info,
      orderKey: info.orderKey ?? messageOrderKey(String(info.id || ""), created),
      resolvedRole: info.resolvedRole ?? channel,
      agent: info.agent ?? channel,
      channel,
    },
  }
}

function messagePart(channel: string, part: Record<string, any>) {
  const { resolvedRole, channel: _channel, parentSessionID, goalID, ...cleanPart } = part
  const time = Number(part.time?.created || 0) || T0 + 1000
  const messageID = String(part.messageID || "")
  const partID = String(part.id || "")
  if (!messageID || !partID) throw new Error("goal phase fixture message part missing id/messageID")
  const messageKey = messageOrderKey(messageID, time)
  const partKey = partOrderKey(partID, time)
  return {
    orderKey: messageKey,
    part: {
      ...cleanPart,
      orderKey: partKey,
    },
    resolvedRole: resolvedRole ?? channel,
    channel,
    ...(parentSessionID ? { parentSessionID } : {}),
    ...(goalID ? { goalID } : {}),
  }
}

export const EVENTS: FixtureEvent[] = [
  // ── Task bootstrap ──
  e(
    "task.created",
    {
      task: {
        id: TASK_ID,
        orderKey: taskOrderKey(TASK_ID, T0),
        status: "active",
        request: "复刻网页，包含完整前后端和组件交互",
        sessionID: ROOT_SID,
        time: { created: T0 },
        attachments: [],
      },
    },
    0,
  ),

  // ── Orchestrator session: assistant message with reasoning + text ──
  e(
    "message.updated",
    messageInfo("assistant", {
      id: "msg_orch_1",
      sessionID: ROOT_SID,
      role: "assistant",
      resolvedRole: "assistant",
      agent: "assistant",
      time: { created: T0 + 1000 },
    }),
    1000,
  ),

  // Reasoning part streamed via deltas
  e(
    "message.part.updated",
    messagePart("assistant", {
      id: "part_orch_reason",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      type: "reasoning",
      text: "",
    }),
    1100,
  ),
  e(
    "message.part.delta",
    {
      partID: "part_orch_reason",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      field: "text",
      delta: "Analyzing ",
    },
    1200,
  ),
  e(
    "message.part.delta",
    {
      partID: "part_orch_reason",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      field: "text",
      delta: "the request.",
    },
    1300,
  ),

  // Text reply streamed
  e(
    "message.part.updated",
    messagePart("assistant", {
      id: "part_orch_text",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      type: "text",
      text: "",
    }),
    1400,
  ),
  e(
    "message.part.delta",
    {
      partID: "part_orch_text",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      field: "text",
      delta: "Will plan the work.",
    },
    1500,
  ),

  // ── Goal created ──
  e(
    "goal.created",
    {
      goalID: GOAL_ID,
      goalTitle: "Scaffold project",
      goalStatus: "pending",
    },
    2000,
  ),

  // ── Explicit no-op / board lifecycle events that must not crash tree-writer ──
  e(
    "spec.created",
    {
      specID: "spec_fixture_1",
      summary: "Acceptance spec drafted",
    },
    2050,
  ),
  e(
    "spec.updated",
    {
      specID: "spec_fixture_1",
      status: "active",
      summary: "Acceptance spec refined",
    },
    2100,
  ),
  e(
    "spec.approved",
    {
      specID: "spec_fixture_1",
      summary: "Acceptance spec approved",
    },
    2150,
  ),
  e(
    "milestone.activated",
    {
      milestoneID: "ms_fixture_build",
      summary: "Build milestone activated",
    },
    2200,
  ),

  // ── Goal running (board.goalWorkflows updates via task.updated) ──
  // Per-goal step payload ships `phases` as a record — per-phase status
  // for the plan / build phases inside the `build` step.
  // goal_run.status="running" maps to plan=completed, build=running via
  // projectPhases() in the backend; here we bake the projection into the
  // fixture directly. (The legacy `evaluate` phase was dropped on
  // 2026-04-20 together with the per-goal evaluator.)
  e(
    "task.updated",
    {
      task: {
        id: TASK_ID,
        orderKey: taskOrderKey(TASK_ID, T0),
        status: "active",
        goalWorkflows: [
          {
            goalID: GOAL_ID,
            orderKey: boardOrderKey(GOAL_ID, T0 + 2000, 60),
            goalRunID: GOAL_RUN_ID,
            goalTitle: "Scaffold project",
            goalStatus: "running",
            orderIndex: 0,
            steps: [
              {
                stepID: "build",
                orderKey: boardOrderKey(`${GOAL_ID}-build`, T0 + 2500, 61),
                label: "Executor",
                status: "running",
                startedAt: T0 + 2500,
                phases: {
                  plan: {
                    orderKey: boardOrderKey(`${GOAL_ID}-build-plan`, T0 + 2500, 62),
                    status: "completed",
                    startedAt: T0 + 2500,
                    completedAt: T0 + 2800,
                  },
                  build: {
                    orderKey: boardOrderKey(`${GOAL_ID}-build-build`, T0 + 2800, 62),
                    status: "running",
                    startedAt: T0 + 2800,
                  },
                },
              },
            ],
          },
        ],
      },
    },
    2500,
  ),

  // ── Non-goal child sessions under the root orchestrator ──
  e(
    "message.updated",
    messageInfo("requirements", {
      id: "msg_requirements_1",
      sessionID: REQUIREMENTS_SID,
      role: "assistant",
      resolvedRole: "requirements",
      agent: "requirements",
      parentSessionID: ROOT_SID,
      time: { created: T0 + 2600 },
    }),
    2600,
  ),
  e(
    "message.part.updated",
    messagePart("requirements", {
      id: "part_requirements_text",
      messageID: "msg_requirements_1",
      sessionID: REQUIREMENTS_SID,
      type: "text",
      text: "Collected product requirements.",
    }),
    2650,
  ),
  e(
    "message.updated",
    messageInfo("frontend-design", {
      id: "msg_design_1",
      sessionID: DESIGN_SID,
      role: "assistant",
      resolvedRole: "frontend-design",
      agent: "frontend-design",
      parentSessionID: ROOT_SID,
      time: { created: T0 + 2700 },
    }),
    2700,
  ),
  e(
    "message.part.updated",
    messagePart("frontend-design", {
      id: "part_design_text",
      messageID: "msg_design_1",
      sessionID: DESIGN_SID,
      type: "text",
      text: "Captured the visual system.",
    }),
    2750,
  ),
  e(
    "message.updated",
    messageInfo("architect", {
      id: "msg_architect_1",
      sessionID: ARCHITECT_SID,
      role: "assistant",
      resolvedRole: "architect",
      agent: "architect",
      parentSessionID: ROOT_SID,
      time: { created: T0 + 2800 },
    }),
    2800,
  ),
  e(
    "message.part.updated",
    messagePart("architect", {
      id: "part_architect_text",
      messageID: "msg_architect_1",
      sessionID: ARCHITECT_SID,
      type: "text",
      text: "Defined the system contracts.",
    }),
    2850,
  ),

  // ── Executor container session (child of orchestrator, bound to GOAL_ID) ──
  // The container itself has no visible card — overlay filters it out via
  // `stage === "executor"` so the step card represents it visually.
  e(
    "message.updated",
    messageInfo("executor", {
      id: "msg_exec_1",
      sessionID: EXECUTOR_SID,
      role: "assistant",
      resolvedRole: "executor",
      agent: "executor",
      parentSessionID: ROOT_SID,
      goalID: GOAL_ID,
      time: { created: T0 + 3000 },
    }),
    3000,
  ),

  e(
    "agent.updated",
    {
      stage: "executor",
      summary: "Executor heartbeat",
    },
    4100,
  ),
  e(
    "message.injected",
    {
      runID: "run_fixture_1",
      text: "Please continue with the active task.",
      summary: "Operator message injected into running session",
    },
    4200,
  ),

  // ── Interaction (permission request) during execution ──
  e(
    "interaction.requested",
    {
      interaction: {
        id: "int_1",
        orderKey: interactionOrderKey("int_1", T0 + 4500),
        type: "permission",
        sessionID: BUILD_SID,
        status: "pending",
        prompt: "Allow writing to src/server/index.ts?",
        time: { created: T0 + 4500 },
      },
    },
    4500,
  ),

  e(
    "interaction.resolved",
    {
      interaction: {
        id: "int_1",
        orderKey: interactionOrderKey("int_1", T0 + 4500),
        type: "permission",
        sessionID: BUILD_SID,
        status: "resolved",
        prompt: "Allow writing to src/server/index.ts?",
        response: "allow",
        time: { created: T0 + 4500, resolved: T0 + 5000 },
      },
    },
    5000,
  ),

  e(
    "milestone.passed",
    {
      milestoneID: "ms_fixture_build",
      summary: "Build milestone passed",
    },
    5200,
  ),

  // ── Planner (plan phase) — first child of executor container ──
  e(
    "message.updated",
    messageInfo("planner", {
      id: "msg_planner_1",
      sessionID: PLANNER_SID,
      role: "assistant",
      resolvedRole: "planner",
      agent: "planner",
      parentSessionID: EXECUTOR_SID,
      goalID: GOAL_ID,
      time: { created: T0 + 5800 },
    }),
    5800,
  ),
  e(
    "message.part.updated",
    messagePart("planner", {
      id: "part_planner_text",
      messageID: "msg_planner_1",
      sessionID: PLANNER_SID,
      type: "text",
      text: "Planned the build sequence.",
    }),
    5850,
  ),

  // ── Build worker (build phase) — writes code ──
  e(
    "message.updated",
    messageInfo("build", {
      id: "msg_build_1",
      sessionID: BUILD_SID,
      role: "assistant",
      resolvedRole: "build",
      agent: "build",
      parentSessionID: EXECUTOR_SID,
      goalID: GOAL_ID,
      time: { created: T0 + 6000 },
    }),
    6000,
  ),

  // Build worker runs a bash tool
  e(
    "message.part.updated",
    messagePart("build", {
      id: "part_build_tool_1",
      messageID: "msg_build_1",
      sessionID: BUILD_SID,
      type: "tool",
      tool: "bash",
      callID: "call_bash_1",
      state: {
        status: "completed",
        input: { command: "npm install" },
        output: "added 42 packages",
        time: { start: T0 + 6050, end: T0 + 6080 },
      },
    }),
    6080,
  ),

  e(
    "message.part.updated",
    messagePart("build", {
      id: "part_build_text",
      messageID: "msg_build_1",
      sessionID: BUILD_SID,
      type: "text",
      text: "Build passed.",
    }),
    6100,
  ),

  // ── Goal passed: all phases complete ──
  e(
    "task.updated",
    {
      task: {
        id: TASK_ID,
        orderKey: taskOrderKey(TASK_ID, T0),
        status: "active",
        goalWorkflows: [
          {
            goalID: GOAL_ID,
            orderKey: boardOrderKey(GOAL_ID, T0 + 2000, 60),
            goalRunID: GOAL_RUN_ID,
            goalTitle: "Scaffold project",
            goalStatus: "passed",
            orderIndex: 0,
            steps: [
              {
                stepID: "build",
                orderKey: boardOrderKey(`${GOAL_ID}-build`, T0 + 2500, 61),
                label: "Executor",
                status: "completed",
                startedAt: T0 + 2500,
                completedAt: T0 + 7000,
                phases: {
                  plan: {
                    orderKey: boardOrderKey(`${GOAL_ID}-build-plan`, T0 + 2500, 62),
                    status: "completed",
                    startedAt: T0 + 2500,
                    completedAt: T0 + 2800,
                  },
                  build: {
                    orderKey: boardOrderKey(`${GOAL_ID}-build-build`, T0 + 2800, 62),
                    status: "completed",
                    startedAt: T0 + 2800,
                    completedAt: T0 + 7000,
                  },
                },
              },
            ],
          },
        ],
      },
    },
    7000,
  ),

  e(
    "milestone.failed",
    {
      milestoneID: "ms_fixture_obsolete",
      summary: "Obsolete milestone ignored",
    },
    7100,
  ),

  // ── Task completed ──
  e(
    "task.completed",
    {
      task: { id: TASK_ID, orderKey: taskOrderKey(TASK_ID, T0), status: "completed" },
    },
    7500,
  ),
]

/** Minimal `board` object the fixture expects Conversation.tsx to read.
 *  In a real run this is populated by loadBoard(). For the replay harness,
 *  we seed it before replaying events. */
export const INITIAL_BOARD = {
  task: {
    id: TASK_ID,
    orderKey: taskOrderKey(TASK_ID, T0),
    status: "active",
    request: "复刻网页，包含完整前后端和组件交互",
    sessionID: ROOT_SID,
    time: { created: T0 },
    attachments: [],
  },
  workflow: {
    id: "pipeline",
    name: "Pipeline",
    goalLoopStepIDs: ["build"],
    steps: [
      {
        id: "frontend_design",
        orderKey: boardOrderKey(`${TASK_ID}-frontend_design`, T0, 61),
        label: "Design",
        tool: "frontend_design",
        scope: "task",
        skippable: true,
        status: "pending",
      },
      {
        id: "requirements",
        orderKey: boardOrderKey(`${TASK_ID}-requirements`, T0, 61),
        label: "Requirements",
        tool: "requirements",
        scope: "task",
        skippable: false,
        status: "pending",
      },
      {
        id: "architect",
        orderKey: boardOrderKey(`${TASK_ID}-architect`, T0, 61),
        label: "Architect",
        tool: "architect",
        scope: "task",
        skippable: true,
        status: "pending",
      },
      {
        id: "build",
        orderKey: boardOrderKey(`${TASK_ID}-build`, T0, 61),
        label: "Executor",
        tool: "execute_goal",
        scope: "goal",
        skippable: false,
        status: "pending",
        phases: [
          { id: "plan", label: "Plan", sessionKind: "planner" },
          { id: "build", label: "Build", sessionKind: "build" },
        ],
      },
      {
        id: "deliver",
        orderKey: boardOrderKey(`${TASK_ID}-deliver`, T0, 61),
        label: "Deliver",
        tool: "deliver",
        scope: "task",
        skippable: false,
        status: "pending",
      },
    ],
  },
  goalWorkflows: [],
  interactions: [],
}
