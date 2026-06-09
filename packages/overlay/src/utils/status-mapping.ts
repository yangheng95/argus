import type { IconName } from "../components/Icon"

export type TaskStatus = "idle" | "pending" | "queued" | "active" | "completed" | "failed" | "cancelled"

export const TASK_STATUS_PRIORITY: Record<string, number> = {
  pending: 0,
  queued: 1,
  active: 2,
  completed: 3,
  failed: 3,
  cancelled: 3,
}

const STATUS_ICON_NAME: Record<string, IconName> = {
  idle: "status-idle",
  pending: "status-idle",
  queued: "status-queued",
  active: "status-active",
  running: "status-active",
  completed: "status-completed",
  passed: "status-completed",
  failed: "status-failed",
  error: "status-failed",
  cancelled: "status-cancelled",
  skipped: "status-cancelled",
}

export function statusIconName(status: string): IconName {
  const iconName = STATUS_ICON_NAME[status]
  if (!iconName) {
    throw new Error(`Unsupported status icon mapping: ${status}`)
  }
  return iconName
}

const GOAL_STATUS_TO_TASK_STATUS: Record<string, TaskStatus> = {
  passed: "completed",
  failed: "failed",
  running: "active",
  skipped: "cancelled",
}

export function goalStatusToTaskStatus(s: string): TaskStatus {
  return GOAL_STATUS_TO_TASK_STATUS[s] ?? "idle"
}

const TODO_STATUS_ICON_NAME: Record<string, IconName> = {
  completed: "status-completed",
  in_progress: "status-active",
  cancelled: "status-cancelled",
  pending: "status-idle",
}

export function todoStatusIconName(status: string): IconName {
  const iconName = TODO_STATUS_ICON_NAME[status]
  if (!iconName) {
    throw new Error(`Unsupported todo status icon mapping: ${status}`)
  }
  return iconName
}
