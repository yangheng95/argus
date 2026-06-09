/**
 * Query helpers for verification evidence — shared between acceptance review
 * tools and the orchestrator's internal drill-down.
 *
 * These helpers render the structured evaluation row for audit. Gating
 * decisions now live in src/metrics/arbiter.ts (engine_metric_result +
 * engine_iteration); this module is read-only audit data.
 */
import type { EngineEvaluationCheck, EngineEvaluationScope } from "@/engine/engine.sql"
import {
  findGoalRunEvidence,
  findLatestAcceptanceEvidence,
  findLatestGoalRunEvidence,
  type VerificationEvidence,
} from "./persist"

export interface QueryEvidenceInput {
  scope: EngineEvaluationScope
  /** Required when scope="goal_run". */
  goalID?: string
  /** Required when scope="goal_run" AND caller wants a specific attempt. */
  goalRunID?: string
  /** Required when scope="acceptance". */
  taskID?: string
}

/** Resolve the single evidence row best matching the query. No latest flag
 *  because callers always want the most recent for their scope; if that ever
 *  needs to change we'll add it as an explicit parameter rather than a
 *  boolean flag. */
export function queryEvidence(input: QueryEvidenceInput): VerificationEvidence | undefined {
  if (input.scope === "goal_run") {
    if (input.goalRunID) return findGoalRunEvidence(input.goalRunID)
    if (input.goalID) return findLatestGoalRunEvidence(input.goalID)
    throw new Error("queryEvidence: scope='goal_run' requires goalID or goalRunID")
  }
  if (input.scope === "acceptance") {
    if (!input.taskID) {
      throw new Error("queryEvidence: scope='acceptance' requires taskID")
    }
    return findLatestAcceptanceEvidence(input.taskID)
  }
  throw new Error(`queryEvidence: unknown scope ${String(input.scope)}`)
}

/** Human-readable rendering of an evidence row — tagged so strict failures
 *  stand out. Acceptance review tools prompt this into their context via the
 *  tool result; orchestrator logs it when it short-circuits. */
export function renderEvidence(evidence: VerificationEvidence): string {
  const parts: string[] = []
  parts.push(`evidence ${evidence.id} scope=${evidence.scope} verdict=${evidence.verdict} status=${evidence.status}`)
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
      const state = c.status.toUpperCase()
      const exitTag = typeof c.exit_code === "number" ? ` exit=${c.exit_code}` : ""
      const tail = c.evidence ? ` — ${c.evidence.slice(0, 200).replace(/\s+/g, " ")}` : ""
      parts.push(`  ${c.name} = ${state}${exitTag}${tail}`)
    }
  }
  return parts.join("\n")
}
