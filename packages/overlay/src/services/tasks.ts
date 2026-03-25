// ── Tasks service ──
// Exact port of app.js scheduleTasks (debounced task-list reload).
//
// NOTE: task.ts (singular) owns per-task operations (select, delete, submit,
// retry, replan, cancel).  This module (tasks.ts, plural) owns the task
// *list* scheduling logic that was previously spread across the legacy
// global `state.tasksKick` timer.

import { loadTasks } from "../store/board";

// ── Module-private debounce handle ──

let tasksKick: ReturnType<typeof setTimeout> | null = null;

// ── Public: scheduleTasks ──
// Exact port of app.js scheduleTasks.
// Cancels any pending reload and schedules a fresh one after `delay` ms.
// Mirrors app.js pattern: state.tasksKick / clearTimeout / setTimeout / loadTasks().

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
