import { expect, test } from "bun:test";
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

