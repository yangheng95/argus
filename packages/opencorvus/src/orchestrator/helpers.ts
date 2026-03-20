import z from "zod"
import { Instance } from "@/project/instance"
import { Budget } from "./model"
import type { OrchestratorBudget, OrchestratorTaskStatus } from "./orchestrator.sql"

export const ORCHESTRATOR_POLL_INTERVAL_MS = 1500
export const SAME_PLAN_RETRY_LIMIT = parseInt(process.env.OPENCORVUS_SAME_PLAN_RETRY_LIMIT || "2", 10)
export const DEFAULT_MAX_RUNS = parseInt(process.env.OPENCORVUS_MAX_RUNS || "10", 10)
export const DEFAULT_MAX_REPLANS = parseInt(process.env.OPENCORVUS_MAX_REPLANS || "3", 10)

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

export interface RetryContext {
  deliverySummary?: string
  changedFiles?: string[]
  checks?: Array<{ name: string; status: string; evidence: string }>
  rootCause?: string
  avoidApproaches?: string[]
  suggestedStrategy?: string
  classification?: string
}

export function buildRetryPrompt(summary: string, context?: RetryContext) {
  if (!context) {
    return [
      "The previous attempt did not satisfy the acceptance checks.",
      "Failure summary:",
      summary,
      "Retry the current plan. Fix the issues, verify the result, and continue until the task is complete or blocked.",
    ].join("\n\n")
  }

  const sections: string[] = [
    "The previous attempt did not satisfy the acceptance checks.",
  ]

  if (context.deliverySummary || (context.changedFiles && context.changedFiles.length > 0)) {
    const parts = ["## What Was Attempted"]
    if (context.deliverySummary) parts.push(context.deliverySummary)
    if (context.changedFiles && context.changedFiles.length > 0) {
      parts.push("Changed files:\n" + context.changedFiles.map((f) => `- ${f}`).join("\n"))
    }
    sections.push(parts.join("\n\n"))
  }

  if (context.checks && context.checks.length > 0) {
    const lines = context.checks.map(
      (c) => `- **${c.name}**: ${c.status}${c.evidence ? ` — ${c.evidence.slice(0, 500)}` : ""}`,
    )
    sections.push("## Check Results\n" + lines.join("\n"))
  }

  if (context.rootCause) {
    sections.push("## Root Cause\n" + context.rootCause)
  }

  if (context.avoidApproaches && context.avoidApproaches.length > 0) {
    sections.push("## What To Avoid\n" + context.avoidApproaches.map((a) => `- ${a}`).join("\n"))
  }

  if (context.suggestedStrategy) {
    sections.push("## Suggested Strategy\n" + context.suggestedStrategy)
  }

  sections.push("Retry the current plan. Fix the issues, verify the result, and continue until the task is complete or blocked.")

  return sections.join("\n\n")
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
