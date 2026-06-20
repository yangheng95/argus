import { t } from "./i18n"

export const TASK_LIFECYCLE_STATUSES = ["queued", "active", "completed", "failed", "cancelled"] as const
export type TaskLifecycleStatus = (typeof TASK_LIFECYCLE_STATUSES)[number]

export const WORKFLOW_STEP_STATUSES = ["pending", "running", "completed", "skipped", "failed"] as const
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number]

const taskLifecycleStatusSet = new Set<string>(TASK_LIFECYCLE_STATUSES)
const workflowStepStatusSet = new Set<string>(WORKFLOW_STEP_STATUSES)

export class UnsupportedStatusLabelError extends Error {
  constructor(
    readonly domain: "task lifecycle" | "workflow step",
    readonly status: string,
  ) {
    super(`Unsupported ${domain} status label: ${status || "(empty)"}`)
    this.name = "UnsupportedStatusLabelError"
  }
}

export function isTaskLifecycleStatus(status: string): status is TaskLifecycleStatus {
  return taskLifecycleStatusSet.has(status)
}

export function isWorkflowStepStatus(status: string): status is WorkflowStepStatus {
  return workflowStepStatusSet.has(status)
}

function normalizedStatus(status: string): string {
  return String(status).trim()
}

export function taskLifecycleStatusLabel(status: TaskLifecycleStatus): string {
  return t(`task.status.${status}`)
}

export function taskLifecycleStatusLabelFromString(status: string): string {
  const normalized = normalizedStatus(status)
  if (!isTaskLifecycleStatus(normalized)) {
    throw new UnsupportedStatusLabelError("task lifecycle", normalized)
  }
  return taskLifecycleStatusLabel(normalized)
}

export function taskLifecycleStatusOrIdleLabel(status: string | null | undefined): string {
  const normalized = normalizedStatus(status ?? "")
  if (!normalized) return t("task.status.idle")
  return taskLifecycleStatusLabelFromString(normalized)
}

export function workflowStepStatusLabel(status: WorkflowStepStatus): string {
  return t(`workflow.status.${status}`)
}

export function workflowStepStatusLabelFromString(status: string): string {
  const normalized = normalizedStatus(status)
  if (!isWorkflowStepStatus(normalized)) {
    throw new UnsupportedStatusLabelError("workflow step", normalized)
  }
  return workflowStepStatusLabel(normalized)
}
