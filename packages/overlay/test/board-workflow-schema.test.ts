import { expect, test } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { currentExecutionDirectory } from "../src/services/workspace";
import { deliveryGoalProgress, goalStepStatus } from "../src/utils/goal-workflow";

test("goalStepStatus reads only the canonical build step", () => {
  expect(
    goalStepStatus(
      {
        steps: [{ stepID: "build", status: "completed" }],
      },
      "build",
    ),
  ).toBe("completed");

  expect(
    goalStepStatus(
      {
        steps: [{ stepID: "execute", status: "completed" }],
      },
      "build",
    ),
  ).toBe("pending");
});

test("deliveryGoalProgress tracks only build completion or passed goals", () => {
  const progress = deliveryGoalProgress([
    { goalStatus: "running", steps: [{ stepID: "build", status: "completed" }] },
    { goalStatus: "running", steps: [{ stepID: "execute", status: "failed" }] },
    { goalStatus: "passed", steps: [{ stepID: "build", status: "running" }] },
  ]);

  expect(progress).toEqual({
    completed: 2,
    failed: 0,
    total: 3,
  });
});

test("currentExecutionDirectory reads only canonical goal step payloads", () => {
  setBoardStore("board", {
    goalWorkflows: [
      {
        goalID: "goal_old",
        steps: [
          {
            stepID: "execute",
            status: "running",
            payload: { workspaceDir: "D:/tmp/legacy-execute" },
          },
        ],
      },
      {
        goalID: "goal_new",
        steps: [
          {
            stepID: "build",
            status: "running",
            startedAt: 200,
            payload: { workspaceDir: "D:/tmp/canonical-build" },
          },
        ],
      },
    ],
    goalRuns: [
      { workspaceDir: "D:/tmp/legacy-goal-run", status: "running" },
    ],
  } as any);

  expect(currentExecutionDirectory()).toBe("D:/tmp/canonical-build");
});
