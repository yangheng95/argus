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

test("tree-writer nests goal sessions under goal steps and parent sessions", async () => {
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
  expect(snapshot.nodes[executorCardID]).toBeDefined();
  expect(snapshot.nodes[buildCardID]).toBeDefined();
  expect(snapshot.nodes[plannerCardID]).toBeDefined();
  expect(snapshot.nodes[requirementsCardID]).toBeDefined();
  expect(snapshot.nodes[designCardID]).toBeDefined();
  expect(snapshot.nodes[architectCardID]).toBeDefined();
  expect(snapshot.nodes[buildStepID]!.childIDs).toContain(executorCardID);
  expect(snapshot.nodes[executorCardID]!.childIDs).toContain(buildCardID);
  expect(snapshot.nodes[buildCardID]!.childIDs).toContain(plannerCardID);
  expect(snapshot.nodes[rootCardID]!.childIDs).toContain(requirementsCardID);
  expect(snapshot.nodes[rootCardID]!.childIDs).toContain(designCardID);
  expect(snapshot.nodes[rootCardID]!.childIDs).toContain(architectCardID);
});

test("tree-writer nests non-goal child sessions under their parent session card", () => {
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
  expect(cardTreeStore.order).not.toContain(architectCardID);
  expect(cardTreeStore.cards[rootCardID]?.childIDs || []).toContain(architectCardID);
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
