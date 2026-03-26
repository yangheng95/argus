// ── Tasks service ──
// NOTE: task.ts (singular) owns per-task operations (select, delete, submit,
// retry, replan, cancel). This module (tasks.ts, plural) owns the task
// *list* scheduling logic that was previously spread across
// global `state.tasksKick` timer.

import { loadTasks } from "../store/board";

// ── Module-private debounce handle ──

let tasksKick: ReturnType<typeof setTimeout> | null = null;

// ── Public: scheduleTasks ──
// Cancels any pending reload and schedules a fresh one after `delay` ms.

export function scheduleTasks(delay = 0): void {
  if (tasksKick !== null) {
    clearTimeout(tasksKick);
    tasksKick = null;
  }
  tasksKick = setTimeout(() => {
    tasksKick = null;
    loadTasks();
  }, delay);
}
