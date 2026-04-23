import { expect, test } from "bun:test";
import { setBoardStore, setBoardData } from "../src/store/board";
import { cardTreeStore } from "../src/store/card-tree";
import { resetWriter } from "../src/services/tree-writer";

const TASK_ID = "tsk_board_projection";
const STEP_ID = "step:goal_projection:gr_projection:build";
const PHASE_ID = `${STEP_ID}:phase:plan`;

function boardWith(status: "running" | "failed") {
  return {
    task: {
      id: TASK_ID,
      status: "active",
      request: "sync projected cards",
      sessionID: "ses_root",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [{ id: "plan", label: "Plan", sessionKind: "planner" }],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_projection",
        goalRunID: "gr_projection",
        goalTitle: "Projection",
        goalStatus: status === "failed" ? "failed" : "running",
        orderIndex: 0,
        retryCount: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status,
            startedAt: 1_776_000_100_100,
            ...(status === "failed" ? { completedAt: 1_776_000_100_300 } : {}),
            phases: {
              plan: {
                status: status === "failed" ? "completed" : "running",
                startedAt: 1_776_000_100_200,
                ...(status === "failed" ? { completedAt: 1_776_000_100_300 } : {}),
              },
            },
          },
        ],
      },
    ],
    interactions: [],
  };
}

test("setBoardData reprojects step and phase cards immediately", () => {
  resetWriter();
  setBoardStore("selectedTaskID", TASK_ID);

  setBoardData(boardWith("running"));
  expect(cardTreeStore.cards[STEP_ID]?.status).toBe("running");
  expect(cardTreeStore.cards[PHASE_ID]?.status).toBe("running");

  setBoardData(boardWith("failed"));
  expect(cardTreeStore.cards[STEP_ID]?.status).toBe("error");
  expect(cardTreeStore.cards[PHASE_ID]?.status).toBe("completed");
});