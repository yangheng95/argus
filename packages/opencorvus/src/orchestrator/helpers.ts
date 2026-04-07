import z from "zod"
import { Instance } from "@/project/instance"
import { Database, eq, desc } from "@/storage/db"
import { WorkbenchTaskNoteTable } from "@/workbench/workbench.sql"
import { Budget } from "./model"
import { OrchestratorConfig } from "./config"
import type { OrchestratorBudget, OrchestratorTaskStatus } from "./orchestrator.sql"
import type { TaskRow, GoalRow } from "./store"
import type { GoalContractFields } from "@/pipeline/types"

export const ORCHESTRATOR_POLL_INTERVAL_MS = 500

// 同步默认值 — 用于无法 await 的场景（如模块级 export）
const syncDefaults = OrchestratorConfig.getDefaults()
export const DEFAULT_MAX_RUNS = syncDefaults.max_runs
export const DEFAULT_MAX_FIX_RUNS = syncDefaults.max_fix_runs
export const MAX_EXECUTOR_GROUPS = syncDefaults.max_executor_groups

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

export interface FixContext {
  source?: "eval_failure" | "delivery_rejection"
  deliverySummary?: string
  changedFiles?: string[]
  checks?: Array<{ name: string; status: string; evidence: string }>
  rootCause?: string
  avoidApproaches?: string[]
  suggestedStrategy?: string
  classification?: string
  deliveryRejectionDetails?: Array<{
    category: string
    file?: string
    error: string
    suggestion?: string
  }>
}


export function buildFixPrompt(summary: string, context?: FixContext) {
  if (!context) {
    return [
      "The previous attempt did not satisfy the acceptance checks.",
      "Failure summary:",
      summary,
      "Fix the issues using the current plan, verify the result, and continue until the task is complete or blocked.",
    ].join("\n\n")
  }

  const isDeliveryRejection = context.source === "delivery_rejection"
  const sections: string[] = [
    isDeliveryRejection
      ? "The delivery verification agent rejected the previous attempt."
      : "The previous attempt did not satisfy the acceptance checks.",
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

  if (context.deliveryRejectionDetails && context.deliveryRejectionDetails.length > 0) {
    const lines = context.deliveryRejectionDetails.map(
      (d) => `- **[${d.category}]**${d.file ? ` ${d.file}` : ""}: ${d.error}${d.suggestion ? ` → ${d.suggestion}` : ""}`,
    )
    sections.push("## Delivery Rejection Details\n" + lines.join("\n"))
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

  sections.push("Fix the issues using the current plan, verify the result, and continue until the task is complete or blocked.")

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
  if (status === "completed") return "completed" as const
  if (status === "cancelled") return "cancelled" as const
  if (status === "failed") return "failed" as const
  return "active" as const
}

export function budgetRow(input?: z.infer<typeof Budget>): OrchestratorBudget | undefined {
  if (!input) return undefined
  return {
    max_runs: input.maxRuns,
    max_fix_runs: input.maxFixRuns,
    max_wall_time_ms: input.maxWallTimeMs,
    max_executor_groups: input.maxExecutorGroups,
  }
}

/**
 * Resolve the effective max executor groups for a task.
 * Priority: task budget > config (env + jsonc) > hardcoded default (2).
 */
export function effectiveMaxExecutorGroups(task: TaskRow): number {
  const budgetMax = (task.budget as OrchestratorBudget | null)?.max_executor_groups
  if (typeof budgetMax === "number" && budgetMax >= 1) return budgetMax
  return MAX_EXECUTOR_GROUPS
}

/**
 * Query operator notes for a task and format as a prompt section.
 * Returns "" if no notes exist.
 */
export function operatorNotesSection(taskID: string): string {
  const notes = Database.use((db) =>
    db
      .select()
      .from(WorkbenchTaskNoteTable)
      .where(eq(WorkbenchTaskNoteTable.task_id, taskID))
      .orderBy(desc(WorkbenchTaskNoteTable.time_created))
      .limit(10)
      .all(),
  ).filter((n) => n.kind === "operator_note" || n.kind === "constraint" || n.kind === "goal_update")
  if (notes.length === 0) return ""
  const items = notes
    .reverse()
    .map((n) => `- [${new Date(n.time_created).toISOString()}] ${n.content}`)
    .join("\n")
  return `\n\n## Operator Notes\n\nThe following messages were sent by the operator during task execution. Incorporate these instructions into your analysis and decisions.\n\n${items}\n`
}

export function goalRowToContract(row: GoalRow | ({ id: string; title: string } & Record<string, unknown>)): GoalContractFields & Record<string, unknown> {
  const r = row as Record<string, unknown>
  return {
    ...row,
    id: row.id,
    title: row.title,
    objective: (r.objective as string) ?? "",
    done_definition: (r.done_definition as string) ?? "",
    owned_paths: (r.owned_paths as string[]) ?? [],
    depends_on: (r.depends_on as string[]) ?? [],
    priority: ((r.priority as string) ?? "blocking") as "blocking" | "advisory",
    kind: (r.kind as string) ?? "feature",
    requirement_ids: (r.requirement_ids as string[]) ?? [],
    exports: (r.exports as string[]) ?? [],
    imports: (r.imports as string[]) ?? [],
  }
}
