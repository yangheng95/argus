import { test, expect } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { applyEvent, resetWriter } from "../src/services/tree-writer";
import { cardTreeStore } from "../src/store/card-tree";
import { replay } from "./fixtures/replay";
import {
  EVENTS,
  INITIAL_BOARD,
  GOAL_ID,
  ROOT_SID,
  GOAL_SID,
  BUILD_SID,
  REQUIREMENTS_SID,
  DESIGN_SID,
  ARCHITECT_SID,
  PLANNER_SID,
  TASK_ID,
} from "./fixtures/goal-phase-events";

test("tree-writer claims goal-scoped sessions under their goal-step card only", async () => {
  // All three goal-scoped sessions (executor / build / planner) share
  // goalID=GOAL_ID and the same "build" step, so they collect under
  // `goal-group:<gid>:step:build` regardless of their session-to-session
  // parent links. Non-goal sub-agent sessions (requirements / design-analyst
  // / architect) surface as independent top-level siblings of the root
  // assistant card — session ↔ session nesting was intentionally removed
  // (see specs/new-arch/07-panel-reactivity.md §身份规则).
  const snapshot = await replay(EVENTS, INITIAL_BOARD);
  const buildStepID = `goal-group:${GOAL_ID}:step:build`;
  const executorCardID = `executor:session:${GOAL_SID}`;
  const buildCardID = `build:session:${BUILD_SID}`;
  const plannerCardID = `planner:session:${PLANNER_SID}`;
  const requirementsCardID = `requirements:session:${REQUIREMENTS_SID}`;
  const designCardID = `design-analyst:session:${DESIGN_SID}`;
  const architectCardID = `architect:session:${ARCHITECT_SID}`;
  const rootCardID = `assistant:session:${ROOT_SID}`;

  expect(snapshot.nodes[buildStepID]).toBeDefined();
  for (const cardID of [
    executorCardID,
    buildCardID,
    plannerCardID,
    requirementsCardID,
    designCardID,
    architectCardID,
    rootCardID,
  ]) {
    expect(snapshot.nodes[cardID]).toBeDefined();
  }

  // Goal-step claims the three goal-scoped sessions.
  for (const cardID of [executorCardID, buildCardID, plannerCardID]) {
    expect(snapshot.nodes[buildStepID]!.childIDs).toContain(cardID);
  }

  // Non-goal sub-agent sessions are top-level siblings, not children of root.
  const rootChildren = snapshot.nodes[rootCardID]!.childIDs || [];
  for (const cardID of [requirementsCardID, designCardID, architectCardID]) {
    expect(rootChildren).not.toContain(cardID);
    expect(snapshot.order).toContain(cardID);
  }
  expect(snapshot.order).toContain(rootCardID);

  // Goal-scoped sessions do NOT nest session-under-session anymore — the old
  // executor→build→planner chain flattens so all three sit as siblings of
  // the goal-step.
  expect(snapshot.nodes[executorCardID]!.childIDs || []).not.toContain(buildCardID);
  expect(snapshot.nodes[buildCardID]!.childIDs || []).not.toContain(plannerCardID);
});

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
  });
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_000 },
      },
    },
  });
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_architect",
        sessionID: "ses_architect",
        role: "assistant",
        resolvedRole: "architect",
        agent: "architect",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      },
    },
  });

  const rootCardID = `assistant:session:${ROOT_SID}`;
  const architectCardID = "architect:session:ses_architect";

  expect(cardTreeStore.order).toContain(rootCardID);
  expect(cardTreeStore.order).toContain(architectCardID);
  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).not.toContain(architectCardID);
});

test("tree-writer preserves step summaries and payloads from board.goalWorkflows", () => {
  resetWriter();
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "trace payloads",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [
      {
        goalID: GOAL_ID,
        goalTitle: "Scaffold project",
        goalStatus: "running",
        steps: [
          {
            stepID: "build",
            label: "Build",
            status: "running",
            summary: "3 planned steps",
            payload: {
              planNodes: [{ id: "pn_1", title: "Create shell", brief: "init app", orderIndex: 1 }],
              executorSessionID: GOAL_SID,
            },
          },
        ],
      },
    ],
    interactions: [],
  });
  setBoardStore("selectedTaskID", TASK_ID);
  applyEvent({
    type: "task.updated",
    properties: {
      taskID: TASK_ID,
      task: { id: TASK_ID, goalWorkflows: [] },
    },
  });

  const stepCardID = `goal-group:${GOAL_ID}:step:build`;
  expect(cardTreeStore.cards[stepCardID]?.subtitle).toBe("3 planned steps");
  expect(cardTreeStore.cards[stepCardID]?.stepID).toBe("build");
  expect(cardTreeStore.cards[stepCardID]?.stepPayload?.executorSessionID).toBe(GOAL_SID);
  expect(cardTreeStore.cards[stepCardID]?.stepPayload?.planNodes?.[0]?.title).toBe("Create shell");
});

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
  });
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root_interaction",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      },
    },
  });

  const rootCardID = `assistant:session:${ROOT_SID}`;
  const claimedCardID = "interaction-card:ctx:interaction:int_claimed";
  const orphanCardID = "interaction-card:ctx:interaction:int_orphan";

  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).toContain(claimedCardID);
  expect(cardTreeStore.order).toContain(orphanCardID);
  expect(cardTreeStore.cards[claimedCardID]?.parts?.[0]?.type).toBe("interaction-permission");
  expect(cardTreeStore.cards[orphanCardID]?.parts?.[0]?.type).toBe("interaction-question");
});

test("root assistant session with parentSessionID pointing to task-virtual root surfaces at top level", () => {
  // Mirrors real backend shape (task-message-protocol-bridge.ts stamps
  // task.sessionID onto every event; the root assistant session therefore
  // has parentSessionID = task.sessionID even though task.sessionID never
  // emits any message.updated). Regression guard for the Step 2 rewrite
  // that initially hid the root assistant behind a pending-parent check
  // and left the overlay completely blank.
  const TASK_VIRTUAL_SID = "ses_task_virtual_root";
  const ROOT_ASSISTANT_SID = "ses_real_assistant";

  resetWriter();
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
  });
  setBoardStore("selectedTaskID", TASK_ID);

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root",
        sessionID: ROOT_ASSISTANT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        parentSessionID: TASK_VIRTUAL_SID,
        time: { created: 1_776_000_000_500 },
      },
    },
  });

  const rootCardID = `assistant:session:${ROOT_ASSISTANT_SID}`;
  expect(cardTreeStore.cards[rootCardID]).toBeDefined();
  expect(cardTreeStore.order).toContain(rootCardID);
});

test("pending:session:* placeholder does not escape to top-level order", () => {
  resetWriter();
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
  });
  setBoardStore("selectedTaskID", TASK_ID);

  // A message.part.updated arrives before any message.updated for this
  // session (high-cadence streaming race). ensureSessionCard creates a
  // pending:session:<sid> placeholder; it MUST NOT show up at top level.
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: "prt_stream",
        messageID: "msg_race",
        sessionID: "ses_race",
        type: "text",
        text: "partial stream",
      },
    },
  });

  expect(cardTreeStore.cards["pending:session:ses_race"]).toBeDefined();
  expect(cardTreeStore.order).not.toContain("pending:session:ses_race");

  // Once message.updated arrives with a real stage, the card renames and
  // claims its place under its parent (assistant root).
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_race",
        sessionID: "ses_race",
        role: "assistant",
        resolvedRole: "planner",
        agent: "planner",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      },
    },
  });
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      },
    },
  });

  const rootCardID = `assistant:session:${ROOT_SID}`;
  expect(cardTreeStore.cards["pending:session:ses_race"]).toBeUndefined();
  expect(cardTreeStore.cards["planner:session:ses_race"]).toBeDefined();
  expect(cardTreeStore.order).toContain(rootCardID);
  // Planner is now a top-level sibling of the root assistant, not a child.
  expect(cardTreeStore.order).toContain("planner:session:ses_race");
  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).not.toContain(
    "planner:session:ses_race",
  );
});

test("fidelity card attaches under requirements session when session is known", () => {
  resetWriter();
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "fidelity ordering",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", TASK_ID);

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      },
    },
  });
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_req",
        sessionID: REQUIREMENTS_SID,
        role: "assistant",
        resolvedRole: "requirements",
        agent: "requirements",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      },
    },
  });
  applyEvent({
    type: "fidelity.review.completed",
    properties: {
      taskID: TASK_ID,
      sessionID: REQUIREMENTS_SID,
      verdict: "needs_correction",
      issues: [{ type: "uncovered", description: "missing goal X" }],
      corrections: [],
      missingGoals: [],
      attempts: 1,
    },
  });

  const requirementsCardID = `requirements:session:${REQUIREMENTS_SID}`;
  const fidelityCardID = `fidelity:${TASK_ID}`;
  expect(cardTreeStore.cards[fidelityCardID]).toBeDefined();
  expect(cardTreeStore.order).not.toContain(fidelityCardID);
  expect(
    cardTreeStore.cards[requirementsCardID]?.childIDs || [],
  ).toContain(fidelityCardID);
});

test("fidelity event with unknown session holds payload out-of-band (no unreachable store entry)", () => {
  resetWriter();
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "fidelity race",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", TASK_ID);

  // Fidelity event arrives before the requirements session's first
  // message.updated. Card must NOT be in cardTreeStore.cards (would be
  // unreachable), and NOT in order (would escape).
  applyEvent({
    type: "fidelity.review.completed",
    properties: {
      taskID: TASK_ID,
      sessionID: REQUIREMENTS_SID,
      verdict: "faithful",
      issues: [],
      corrections: [],
      missingGoals: [],
      attempts: 1,
    },
  });

  const fidelityCardID = `fidelity:${TASK_ID}`;
  expect(cardTreeStore.cards[fidelityCardID]).toBeUndefined();
  expect(cardTreeStore.order).not.toContain(fidelityCardID);

  // When the session arrives, the held payload materializes and attaches.
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      },
    },
  });
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_req",
        sessionID: REQUIREMENTS_SID,
        role: "assistant",
        resolvedRole: "requirements",
        agent: "requirements",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      },
    },
  });

  const requirementsCardID = `requirements:session:${REQUIREMENTS_SID}`;
  expect(cardTreeStore.cards[fidelityCardID]).toBeDefined();
  expect(cardTreeStore.order).not.toContain(fidelityCardID);
  expect(
    cardTreeStore.cards[requirementsCardID]?.childIDs || [],
  ).toContain(fidelityCardID);
});

test("fidelity event missing sessionID throws (schema became required)", () => {
  resetWriter();
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "fidelity schema",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", TASK_ID);

  expect(() =>
    applyEvent({
      type: "fidelity.review.completed",
      properties: {
        taskID: TASK_ID,
        verdict: "faithful",
        issues: [],
        corrections: [],
        missingGoals: [],
        attempts: 0,
      },
    }),
  ).toThrow(/missing sessionID/);
});

test("resetWriter clears pendingFidelity so a later session does not resurrect a stale payload", () => {
  resetWriter();
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "fidelity reset",
      sessionID: ROOT_SID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", TASK_ID);

  applyEvent({
    type: "fidelity.review.completed",
    properties: {
      taskID: TASK_ID,
      sessionID: REQUIREMENTS_SID,
      verdict: "faithful",
      issues: [],
      corrections: [],
      missingGoals: [],
      attempts: 1,
    },
  });

  resetWriter();

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_root",
        sessionID: ROOT_SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_000_500 },
      },
    },
  });
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: "msg_req",
        sessionID: REQUIREMENTS_SID,
        role: "assistant",
        resolvedRole: "requirements",
        agent: "requirements",
        parentSessionID: ROOT_SID,
        time: { created: 1_776_000_001_000 },
      },
    },
  });

  const fidelityCardID = `fidelity:${TASK_ID}`;
  expect(cardTreeStore.cards[fidelityCardID]).toBeUndefined();
});

test("tree-writer explicitly accepts non-projected protocol events", () => {
  resetWriter();
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
  });
  setBoardStore("selectedTaskID", TASK_ID);

  const beforeOrder = [...cardTreeStore.order];
  const beforeCards = Object.keys(cardTreeStore.cards);
  const events = [
    { type: "spec.created", properties: { taskID: TASK_ID, specID: "spec_1", summary: "drafted" } },
    { type: "spec.updated", properties: { taskID: TASK_ID, specID: "spec_1", status: "active", summary: "updated" } },
    { type: "spec.approved", properties: { taskID: TASK_ID, specID: "spec_1", summary: "approved" } },
    { type: "milestone.activated", properties: { taskID: TASK_ID, milestoneID: "ms_1", summary: "active" } },
    { type: "milestone.passed", properties: { taskID: TASK_ID, milestoneID: "ms_1", summary: "passed" } },
    { type: "milestone.failed", properties: { taskID: TASK_ID, milestoneID: "ms_2", summary: "failed" } },
    { type: "message.injected", properties: { taskID: TASK_ID, runID: "run_1", text: "continue", summary: "injected" } },
    { type: "agent.updated", properties: { taskID: TASK_ID, stage: "executor", summary: "heartbeat" } },
  ];

  for (const event of events) applyEvent(event);

  expect(cardTreeStore.order).toEqual(beforeOrder);
  expect(Object.keys(cardTreeStore.cards)).toEqual(beforeCards);
});
