// ── Goal-phase SSE event stream fixture ──
//
// Representative stream covering every event type the overlay must handle
// correctly. Used by the reactivity refactor (specs/new-arch/07-panel-reactivity.md)
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

const T0 = 1_776_000_000_000;

export const TASK_ID = "tsk_fixture_goal_phase";
export const ROOT_SID = "ses_root_orch";
export const GOAL_ID = "goal_fixture_g1";
export const GOAL_SID = "ses_goal_exec";
export const BUILD_SID = "ses_goal_build";
export const REQUIREMENTS_SID = "ses_requirements";
export const DESIGN_SID = "ses_design";
export const ARCHITECT_SID = "ses_architect";
export const PLANNER_SID = "ses_planner";

/** Top-level SSE event shape (same as `streamSSE` emits server-side). */
export interface FixtureEvent {
  type: string;
  sequence?: number;
  timestamp?: number;
  taskID?: string;
  /** Either `properties` or `payload` — router treats both. Fixture uses `properties`
   *  to match the protocol routes; `payload` variant is covered in specific tests. */
  properties?: Record<string, any>;
  summary?: string;
  event_id?: string;
}

let seq = 0;
const e = (type: string, properties: Record<string, any> = {}, dt = 0): FixtureEvent => ({
  type,
  sequence: ++seq,
  timestamp: T0 + dt,
  taskID: TASK_ID,
  properties: { taskID: TASK_ID, ...properties },
});

export const EVENTS: FixtureEvent[] = [
  // ── Task bootstrap ──
  e("task.created", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "复刻网页，包含完整前后端和组件交互",
      sessionID: ROOT_SID,
      time: { created: T0 },
      attachments: [],
    },
  }, 0),

  // ── Orchestrator session: assistant message with reasoning + text ──
  e("message.updated", {
    info: {
      id: "msg_orch_1",
      sessionID: ROOT_SID,
      role: "assistant",
      resolvedRole: "assistant",
      agent: "assistant",
      time: { created: T0 + 1000 },
    },
  }, 1000),

  // Reasoning part streamed via deltas
  e("message.part.updated", {
    part: {
      id: "part_orch_reason",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      type: "reasoning",
      text: "",
    },
  }, 1100),
  e("message.part.delta", {
    partID: "part_orch_reason",
    messageID: "msg_orch_1",
    sessionID: ROOT_SID,
    field: "text",
    delta: "Analyzing ",
  }, 1200),
  e("message.part.delta", {
    partID: "part_orch_reason",
    messageID: "msg_orch_1",
    sessionID: ROOT_SID,
    field: "text",
    delta: "the request.",
  }, 1300),

  // Text reply streamed
  e("message.part.updated", {
    part: {
      id: "part_orch_text",
      messageID: "msg_orch_1",
      sessionID: ROOT_SID,
      type: "text",
      text: "",
    },
  }, 1400),
  e("message.part.delta", {
    partID: "part_orch_text",
    messageID: "msg_orch_1",
    sessionID: ROOT_SID,
    field: "text",
    delta: "Will plan the work.",
  }, 1500),

  // ── Goal created ──
  e("goal.created", {
    goalID: GOAL_ID,
    goalTitle: "Scaffold project",
    goalStatus: "pending",
  }, 2000),

  // ── Explicit no-op / board lifecycle events that must not crash tree-writer ──
  e("spec.created", {
    specID: "spec_fixture_1",
    summary: "Acceptance spec drafted",
  }, 2050),
  e("spec.updated", {
    specID: "spec_fixture_1",
    status: "active",
    summary: "Acceptance spec refined",
  }, 2100),
  e("spec.approved", {
    specID: "spec_fixture_1",
    summary: "Acceptance spec approved",
  }, 2150),
  e("milestone.activated", {
    milestoneID: "ms_fixture_build",
    summary: "Build milestone activated",
  }, 2200),

  // ── Goal running (board.goalWorkflows updates via task.updated) ──
  e("task.updated", {
    task: {
      id: TASK_ID,
      status: "active",
      goalWorkflows: [{
        goalID: GOAL_ID,
        goalTitle: "Scaffold project",
        goalStatus: "running",
        steps: [{ stepID: "build", label: "Build", status: "running" }],
      }],
    },
  }, 2500),

  // ── Non-goal child sessions under the root orchestrator ──
  e("message.updated", {
    info: {
      id: "msg_requirements_1",
      sessionID: REQUIREMENTS_SID,
      role: "assistant",
      resolvedRole: "requirements",
      agent: "requirements",
      parentSessionID: ROOT_SID,
      time: { created: T0 + 2600 },
    },
  }, 2600),
  e("message.part.updated", {
    part: {
      id: "part_requirements_text",
      messageID: "msg_requirements_1",
      sessionID: REQUIREMENTS_SID,
      type: "text",
      text: "Collected product requirements.",
    },
  }, 2650),
  e("message.updated", {
    info: {
      id: "msg_design_1",
      sessionID: DESIGN_SID,
      role: "assistant",
      resolvedRole: "design-analyst",
      agent: "design-analyst",
      parentSessionID: ROOT_SID,
      time: { created: T0 + 2700 },
    },
  }, 2700),
  e("message.part.updated", {
    part: {
      id: "part_design_text",
      messageID: "msg_design_1",
      sessionID: DESIGN_SID,
      type: "text",
      text: "Captured the visual system.",
    },
  }, 2750),
  e("message.updated", {
    info: {
      id: "msg_architect_1",
      sessionID: ARCHITECT_SID,
      role: "assistant",
      resolvedRole: "architect",
      agent: "architect",
      parentSessionID: ROOT_SID,
      time: { created: T0 + 2800 },
    },
  }, 2800),
  e("message.part.updated", {
    part: {
      id: "part_architect_text",
      messageID: "msg_architect_1",
      sessionID: ARCHITECT_SID,
      type: "text",
      text: "Defined the system contracts.",
    },
  }, 2850),

  // ── Executor session (child of orchestrator, bound to GOAL_ID) ──
  e("message.updated", {
    info: {
      id: "msg_exec_1",
      sessionID: GOAL_SID,
      role: "assistant",
      resolvedRole: "executor",
      agent: "executor",
      parentSessionID: ROOT_SID,
      goalID: GOAL_ID,
      time: { created: T0 + 3000 },
    },
  }, 3000),

  // Tool call (running) — a bash command
  e("message.part.updated", {
    part: {
      id: "part_exec_tool_1",
      messageID: "msg_exec_1",
      sessionID: GOAL_SID,
      type: "tool",
      tool: "bash",
      callID: "call_bash_1",
      state: {
        status: "running",
        input: { command: "npm install" },
        time: { start: T0 + 3100 },
      },
    },
  }, 3100),

  // Tool completed (output arrives)
  e("message.part.updated", {
    part: {
      id: "part_exec_tool_1",
      messageID: "msg_exec_1",
      sessionID: GOAL_SID,
      type: "tool",
      tool: "bash",
      callID: "call_bash_1",
      state: {
        status: "completed",
        input: { command: "npm install" },
        output: "added 42 packages",
        time: { start: T0 + 3100, end: T0 + 4000 },
      },
    },
  }, 4000),

  e("agent.updated", {
    stage: "executor",
    summary: "Executor heartbeat",
  }, 4100),
  e("message.injected", {
    runID: "run_fixture_1",
    text: "Please continue with the active task.",
    summary: "Operator message injected into running session",
  }, 4200),

  // ── Interaction (permission request) during execution ──
  e("interaction.created", {
    interaction: {
      id: "int_1",
      type: "permission",
      sessionID: GOAL_SID,
      status: "pending",
      prompt: "Allow writing to src/server/index.ts?",
      time: { created: T0 + 4500 },
    },
  }, 4500),

  e("interaction.resolved", {
    interaction: {
      id: "int_1",
      type: "permission",
      sessionID: GOAL_SID,
      status: "resolved",
      prompt: "Allow writing to src/server/index.ts?",
      response: "allow",
      time: { created: T0 + 4500, resolved: T0 + 5000 },
    },
  }, 5000),

  e("milestone.passed", {
    milestoneID: "ms_fixture_build",
    summary: "Build milestone passed",
  }, 5200),

  // ── Build sub-session (child of executor) ──
  e("message.updated", {
    info: {
      id: "msg_build_1",
      sessionID: BUILD_SID,
      role: "assistant",
      resolvedRole: "build",
      agent: "build",
      parentSessionID: GOAL_SID,
      goalID: GOAL_ID,
      time: { created: T0 + 6000 },
    },
  }, 6000),

  e("message.updated", {
    info: {
      id: "msg_planner_1",
      sessionID: PLANNER_SID,
      role: "assistant",
      resolvedRole: "planner",
      agent: "planner",
      parentSessionID: BUILD_SID,
      goalID: GOAL_ID,
      time: { created: T0 + 6050 },
    },
  }, 6050),
  e("message.part.updated", {
    part: {
      id: "part_planner_text",
      messageID: "msg_planner_1",
      sessionID: PLANNER_SID,
      type: "text",
      text: "Planned the build sequence.",
    },
  }, 6075),

  e("message.part.updated", {
    part: {
      id: "part_build_text",
      messageID: "msg_build_1",
      sessionID: BUILD_SID,
      type: "text",
      text: "Build passed.",
    },
  }, 6100),

  // ── Goal passed ──
  e("task.updated", {
    task: {
      id: TASK_ID,
      status: "active",
      goalWorkflows: [{
        goalID: GOAL_ID,
        goalTitle: "Scaffold project",
        goalStatus: "passed",
        steps: [
          { stepID: "build", label: "Build", status: "completed" },
        ],
      }],
    },
  }, 7000),

  e("milestone.failed", {
    milestoneID: "ms_fixture_obsolete",
    summary: "Obsolete milestone ignored",
  }, 7100),

  // ── Task completed ──
  e("task.completed", {
    task: { id: TASK_ID, status: "completed" },
  }, 7500),
];

/** Minimal `board` object the fixture expects Conversation.tsx to read.
 *  In a real run this is populated by loadBoard(). For the replay harness,
 *  we seed it before replaying events. */
export const INITIAL_BOARD = {
  task: {
    id: TASK_ID,
    status: "active",
    request: "复刻网页，包含完整前后端和组件交互",
    sessionID: ROOT_SID,
    time: { created: T0 },
    attachments: [],
  },
  goalWorkflows: [],
  interactions: [],
};
