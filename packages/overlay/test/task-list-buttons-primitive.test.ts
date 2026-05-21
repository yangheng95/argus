import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TASK_LIST_SOURCE = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8");

test("TaskList sidebar controls route through the Button primitive", () => {
  expect(TASK_LIST_SOURCE).toContain('import { Button } from "./ui/Button";');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-delete"');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-cancel"');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-export"');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-start-now"');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-list-import-button"');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-list-search-clear"');
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-list-error-retry"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-delete"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-cancel"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-export"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-start-now"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-list-import-button"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-list-search-clear"');
  expect(TASK_LIST_SOURCE).not.toContain('class="task-list-error-retry"');
});

test("TaskList archive flows use the in-app notification center instead of alert()", () => {
  expect(TASK_LIST_SOURCE).toContain("notifyProgress({");
  expect(TASK_LIST_SOURCE).toContain("notifySuccess({");
  expect(TASK_LIST_SOURCE).toContain("notifyError({");
  expect(TASK_LIST_SOURCE).toContain("notifyWarning({");
  expect(TASK_LIST_SOURCE).not.toContain("window.alert(");
});

test("TaskList marks tasks with unread notification facts", () => {
  expect(TASK_LIST_SOURCE).toContain("taskHasUnreadNotification");
  expect(TASK_LIST_SOURCE).toContain('data-notification-unread={hasUnreadNotification() ? "true" : undefined}');
});
