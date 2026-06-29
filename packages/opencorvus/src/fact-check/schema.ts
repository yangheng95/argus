/**
 * Fact-Check Protocol Schemas — single source of truth.
 *
 * Per fact-check agent contract §6.1.1 and codex round 4 §C-2,
 * this file MUST stay pure zod with zero runtime imports (no Session,
 * orchestrator, build, persist, tools dependencies). Otherwise it would
 * make a fact-check agent runtime into a project-wide low-level
 * dependency, which is the wrong direction.
 *
 * Consumers:
 *   - fact-check/tools.ts (terminal tool schema)
 *   - fact-check/persist.ts (artifact schema)
 *   - 6 worker terminal schemas (BuildResultSchema, output-tools.ts,
 *     team-schema.ts) that consume FactCheckItemListSchema
 *   - orchestrator/tools.ts (fact_check input/output)
 */

import { z } from "zod"

/**
 * Fact-Check Item (FCI): a single registered factual claim emitted by a
 * worker agent in its terminal report. Worker agents populate
 * `fact_check_items: FactCheckItem[]` on their structured output.
 */
export const FactCheckItemSchema = z
  .object({
    /** Full standalone assertion. min/max enforced to push the agent toward
     *  specific claims; generic words ("tbd", "unknown") are flagged at
     *  fact-check time as ambiguous, not rejected here (rule 20: no host
     *  keyword regex). */
    claim: z.string().min(20).max(280),
    /** Agent self-assessment. Honest "low" is rewarded; over-claiming
     *  "high" surfaces as a verifier finding. */
    confidence: z.enum(["low", "medium", "high"]),
    /** Routes the verifier toward the right retrieval modality. */
    category: z.enum(["api", "library", "number", "history", "path", "protocol", "other"]),
    /** Where the worker got the claim from. Empty string forbidden by
     *  min(3). Conventional values: "assumed", "model prior", "<url>",
     *  "<file:line>", "user-said:<short>". */
    source: z.string().min(3),
  })
  .meta({ ref: "FactCheckItem" })
export type FactCheckItem = z.infer<typeof FactCheckItemSchema>

/**
 * Required array of FCI. No `.default([])`, no `.optional()` — worker
 * agents MUST populate this field explicitly per spec §3.1. Empty array
 * is fine; missing field is a contract violation.
 */
export const FactCheckItemListSchema = z.array(FactCheckItemSchema)
export type FactCheckItemList = z.infer<typeof FactCheckItemListSchema>

/** Evidence pointer for a verified or corrected claim. */
export const FactCheckEvidenceSchema = z
  .object({
    kind: z.enum(["web", "code", "memory"]),
    pointer: z.string().min(1),
    excerpt: z.string().max(800),
  })
  .meta({ ref: "FactCheckEvidence" })
export type FactCheckEvidence = z.infer<typeof FactCheckEvidenceSchema>

/** Verified item — claim was accurate; evidence supports it. */
export const FactCheckVerifiedItemSchema = z.object({
  claim: z.string(),
  evidence: z.array(FactCheckEvidenceSchema).min(1),
})
export type FactCheckVerifiedItem = z.infer<typeof FactCheckVerifiedItemSchema>

/** Corrected item — claim was wrong; correction + evidence + recommended remedy. */
export const FactCheckCorrectedItemSchema = z.object({
  claim: z.string(),
  correction: z.string(),
  severity: z.enum(["minor", "material", "blocking"]),
  evidence: z.array(FactCheckEvidenceSchema).min(1),
  recommended_action: z.enum(["accept_with_note", "modify_goal", "propose_task", "fail_task"]),
})
export type FactCheckCorrectedItem = z.infer<typeof FactCheckCorrectedItemSchema>

/** Unresolved item — couldn't reach a confident verdict. */
export const FactCheckUnresolvedItemSchema = z.object({
  claim: z.string(),
  why_unresolved: z.enum(["no_network", "rate_limited", "ambiguous", "out_of_scope", "tool_failed"]),
  severity: z.enum(["minor", "material", "blocking"]),
})
export type FactCheckUnresolvedItem = z.infer<typeof FactCheckUnresolvedItemSchema>

/**
 * Fact-check report — fact-check agent's terminal output. Schema
 * intentionally has NO `fact_check_items` field; the fact-check agent
 * does NOT register its own factual claims (anti-recursion, schema-level).
 */
export const FactCheckReportSchema = z
  .object({
    scope: z.object({
      target_session_id: z.string(),
      target_agent: z.string(),
      target_message_id: z.string(),
      target_message_content_hash: z.string(),
      items_total: z.number().int().nonnegative(),
      items_inspected: z.number().int().nonnegative(),
    }),
    verified: z.array(FactCheckVerifiedItemSchema),
    corrected: z.array(FactCheckCorrectedItemSchema),
    unresolved: z.array(FactCheckUnresolvedItemSchema),
    overall_verdict: z.enum(["clean", "minor_corrections", "needs_orchestrator_action", "inconclusive"]),
  })
  .meta({ ref: "FactCheckReport" })
export type FactCheckReport = z.infer<typeof FactCheckReportSchema>

/**
 * Persistent record of a fact-check attempt. Stored as an engine_artifact
 * row with kind="fact_check_attempt"; the artifact is the audit trail and
 * also the idempotency cache (see fact-check/persist.ts).
 */
export const FactCheckAttemptArtifactSchema = z
  .object({
    fact_check_session_id: z.string(),
    target_session_id: z.string(),
    target_agent: z.string(),
    target_message_id: z.string(),
    target_message_content_hash: z.string(),
    invoked_by_orchestrator_session_id: z.string(),
    report: FactCheckReportSchema,
    time_started: z.number(),
    time_completed: z.number(),
    outcome: z.enum(["completed", "aborted", "tool_error"]),
  })
  .meta({ ref: "FactCheckAttemptArtifact" })
export type FactCheckAttemptArtifact = z.infer<typeof FactCheckAttemptArtifactSchema>

/**
 * Apply the verdict decision tree from spec §3.3 to a partial report.
 * Pure function; lives here so worker code, fact-check tooling, and tests
 * share one implementation (rule 8 single source).
 */
export function deriveFactCheckVerdict(input: {
  items_total: number
  items_inspected: number
  corrected: FactCheckCorrectedItem[]
  unresolved: FactCheckUnresolvedItem[]
}): FactCheckReport["overall_verdict"] {
  // Explicit boundary: empty registration = clean, no claims to check.
  if (input.items_total === 0) return "clean"

  const hasBlocking =
    input.corrected.some((c) => c.severity === "material" || c.severity === "blocking") ||
    input.unresolved.some((u) => u.severity === "material" || u.severity === "blocking")
  if (hasBlocking) return "needs_orchestrator_action"

  const correctedCount = input.corrected.length
  // Inconclusive when fewer than half inspected AND no minor-or-higher corrections.
  if (input.items_inspected < input.items_total / 2 && correctedCount === 0) {
    return "inconclusive"
  }

  if (correctedCount > 0 || input.unresolved.length > 0) return "minor_corrections"
  return "clean"
}

export function validateFactCheckAgentReportSemantics(report: FactCheckReport): string | undefined {
  if (report.scope.items_inspected > report.scope.items_total) {
    return `items_inspected (${report.scope.items_inspected}) cannot exceed items_total (${report.scope.items_total}).`
  }
  const classifiedCount = report.verified.length + report.corrected.length + report.unresolved.length
  if (classifiedCount !== report.scope.items_inspected) {
    return (
      `classified item count (${classifiedCount}) must equal scope.items_inspected ` +
      `(${report.scope.items_inspected}) for successful fact-check agent reports.`
    )
  }
  const expected = deriveFactCheckVerdict({
    items_total: report.scope.items_total,
    items_inspected: report.scope.items_inspected,
    corrected: report.corrected,
    unresolved: report.unresolved,
  })
  if (report.overall_verdict !== expected) {
    return `overall_verdict must be "${expected}" for the submitted corrected/unresolved/items counts; got "${report.overall_verdict}".`
  }
  return undefined
}
