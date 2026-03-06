import z from "zod"
import { Instance } from "@/project/instance"
import { Budget } from "./model"
import type { OrchestratorBudget, OrchestratorTaskStatus } from "./orchestrator.sql"

export const ORCHESTRATOR_POLL_INTERVAL_MS = 1500
export const SAME_PLAN_RETRY_LIMIT = 1
export const DEFAULT_MAX_RUNS = 3
export const DEFAULT_MAX_REPLANS = 1

export const orchestratorState = Instance.state(() => ({
  booted: false,
  syncing: false,
}))

export function deriveTitle(request: string) {
  const line = request
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return "Untitled task"
  if (line.length <= 80) return line
  return line.slice(0, 77) + "..."
}

export function buildRetryPrompt(summary: string) {
  return [
    "The previous attempt did not satisfy the acceptance checks.",
    "Failure summary:",
    summary,
    "Retry the current plan. Fix the issues, verify the result, and continue until the task is complete or blocked.",
  ].join("\n\n")
}

export function buildOperatorPrompt(note: string) {
  return [
    "The operator provided additional input for this task.",
    "Operator note:",
    note,
    "Incorporate the note into the current plan, then continue until the task is complete or blocked.",
  ].join("\n\n")
}

export function progressStatus(status: OrchestratorTaskStatus) {
  if (status === "blocked") return "blocked" as const
  if (status === "completed") return "completed" as const
  if (status === "cancelled") return "cancelled" as const
  if (status === "failed") return "failed" as const
  return "running" as const
}

export function budgetRow(input?: z.infer<typeof Budget>): OrchestratorBudget | undefined {
  if (!input) return undefined
  return {
    max_runs: input.maxRuns,
    max_replans: input.maxReplans,
    max_evaluations: input.maxEvaluations,
    max_wall_time_ms: input.maxWallTimeMs,
  }
}
