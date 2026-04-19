/**
 * Query helpers for verification evidence — shared between the delivery-agent
 * `query_evidence` tool and the orchestrator's internal short-circuit logic.
 *
 * See specs/new-arch/09-verification-evidence.md §task-wide aggregate view
 * 保留. The aggregate task.metadata.criteria_results stream stays the primary
 * summary surface (`query_criteria`); these helpers render the structured
 * evidence row for drill-down.
 */
import type {
  EngineEvaluationCheck,
  EngineEvaluationScope,
} from "@/engine/engine.sql"
import {
  findGoalRunEvidence,
  findLatestDeliveryEvidence,
  findLatestGoalRunEvidence,
  strictFailures,
  type VerificationEvidence,
} from "./persist"

export interface QueryEvidenceInput {
  scope: EngineEvaluationScope
  /** Required when scope="goal_run". */
  goalID?: string
  /** Required when scope="goal_run" AND caller wants a specific attempt. */
  goalRunID?: string
  /** Required when scope="delivery". */
  taskID?: string
}

/** Resolve the single evidence row best matching the query. No latest flag
 *  because callers always want the most recent for their scope; if that ever
 *  needs to change we'll add it as an explicit parameter rather than a
 *  boolean flag. */
export function queryEvidence(
  input: QueryEvidenceInput,
): VerificationEvidence | undefined {
  if (input.scope === "goal_run") {
    if (input.goalRunID) return findGoalRunEvidence(input.goalRunID)
    if (input.goalID) return findLatestGoalRunEvidence(input.goalID)
    throw new Error("queryEvidence: scope='goal_run' requires goalID or goalRunID")
  }
  if (input.scope === "delivery") {
    if (!input.taskID) {
      throw new Error("queryEvidence: scope='delivery' requires taskID")
    }
    return findLatestDeliveryEvidence(input.taskID)
  }
  throw new Error(`queryEvidence: unknown scope ${String(input.scope)}`)
}

/** Human-readable rendering of an evidence row — tagged so strict failures
 *  stand out. Delivery agent prompts this into its context via the tool
 *  result; orchestrator logs it when it short-circuits. */
export function renderEvidence(evidence: VerificationEvidence): string {
  const parts: string[] = []
  parts.push(
    `evidence ${evidence.id} scope=${evidence.scope} verdict=${evidence.verdict} status=${evidence.status}`,
  )
  if (evidence.signature) parts.push(`signature=${evidence.signature.slice(0, 16)}…`)
  if (evidence.summary) parts.push(`summary: ${evidence.summary}`)
  const byFamily = new Map<string, EngineEvaluationCheck[]>()
  for (const c of evidence.checks) {
    const key = c.family || "other"
    const list = byFamily.get(key) ?? []
    list.push(c)
    byFamily.set(key, list)
  }
  for (const [family, list] of byFamily) {
    parts.push(`[${family}] ${list.length} check(s):`)
    for (const c of list) {
      const mode = c.mode === "strict" ? "[STRICT]" : c.mode === "soft" ? "[soft]" : ""
      const state = c.status.toUpperCase()
      const exitTag = typeof c.exit_code === "number" ? ` exit=${c.exit_code}` : ""
      const tail = c.evidence ? ` — ${c.evidence.slice(0, 200).replace(/\s+/g, " ")}` : ""
      parts.push(`  ${mode} ${c.name} = ${state}${exitTag}${tail}`)
    }
  }
  const strict = strictFailures(evidence)
  if (strict.length > 0) {
    parts.push(
      `GATE: ${strict.length} strict check(s) failed — binding, verdict must be rejected.`,
    )
  }
  return parts.join("\n")
}
