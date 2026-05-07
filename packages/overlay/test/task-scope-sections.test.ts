import { expect, test } from "bun:test";
import { taskScopeSectionVisibility } from "../src/utils/task-scope-sections";

test("task-scope workflow sections are visible while their steps are active", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "requirements", status: "running" },
        { id: "architect", status: "pending" },
      ],
    },
    requirements: [],
    architect: null,
  });

  expect(visibility.requirements).toBe(true);
  expect(visibility.architect).toBe(false);
});

test("task-scope workflow sections remain visible once data exists", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "requirements", status: "completed" },
        { id: "architect", status: "pending" },
      ],
    },
    requirements: [{ id: "req_1" }],
    architect: { contractCount: 3 },
  });

  expect(visibility.requirements).toBe(true);
  expect(visibility.architect).toBe(true);
});

test("task-scope workflow sections stay hidden before backend progress exists", () => {
  const visibility = taskScopeSectionVisibility({
    workflow: {
      steps: [
        { id: "requirements", status: "pending" },
        { id: "architect", status: "pending" },
      ],
    },
    requirements: [],
    architect: null,
  });

  expect(visibility).toEqual({ requirements: false, architect: false });
});
