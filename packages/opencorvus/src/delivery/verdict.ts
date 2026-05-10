/**
 * Delivery verdict schema.
 *
 * Factored out of agent.ts so that output-tools.ts can consume the same Zod
 * shape for the mandatory `submit_verdict` tool without introducing a circular
 * import with agent.ts.
 *
 * Schema design rules (lessons from the 2026-04 qwen-loop incident):
 *
 *   1. Schema MUST tell the truth. If the runtime requires a non-empty
 *      array, the schema says `.min(1)` — never `.default([])` paired with
 *      an execute()-time non-empty check (the LLM gets contradictory
 *      signals: schema says optional, prompt says required).
 *
 *   2. No dual-source-of-truth fields. The model lists rejection details
 *      ONCE, in `rejection_details`. Aggregate views (which goals were
 *      blamed, the human-readable issues list) are DERIVED via the
 *      helpers at the bottom of this file. Older shapes had separate
 *      `affected_goal_ids` + `issues_found` fields and a runtime
 *      consistency check — that was three places telling the same story.
 *
 *   3. Discriminated union over `verdict`. Accepted and rejected payloads
 *      have genuinely different shape requirements (rejected MUST attach
 *      details, accepted MUST NOT). Encoding that in the schema means the
 *      LLM picks the right branch up front instead of failing a runtime
 *      consistency check on every retry.
 *
 *   4. Every required field has a runtime min-length matching the schema
 *      min-length. `detail` and `error` strings demand reproducer-grade
 *      content (≥8 chars), so the schema says `.min(8)` — not `.min(1)`
 *      with the real bar buried in execute().
 *
 *   5. Optional fields exist only when they have a real callsite. Pure
 *      narrative slots (`target`, `attachment_sha` on prior evidence
 *      shape) were dropped — they were never read after submission and
 *      just gave weak tool-callers more to JSON-stringify incorrectly.
 */
import z from "zod"

export const StartupVerification = z.object({
  attempted: z.boolean().describe("Whether startup verification was attempted"),
  command: z.string().optional().describe("Command used to start the application"),
  success: z.boolean().describe("Whether the application started successfully"),
  output: z.string().optional().describe("Relevant startup output or error messages"),
})

export const FrontendCheck = z.object({
  attempted: z.boolean().describe("Whether frontend verification was attempted"),
  renders_correctly: z.boolean().optional().describe("Whether the frontend renders without errors"),
  issues: z.array(z.string()).optional().describe("Frontend issues found"),
})

export const DeliveryEvidenceFacet = z.enum(["startup", "runtime", "frontend", "visual"])
export type DeliveryEvidenceFacetType = z.infer<typeof DeliveryEvidenceFacet>

export const DeferredCheck = z.object({
  name: z.string().min(1).describe("Check name (e.g. code_review, dead_code_review)"),
  result: z.enum(["passed", "failed", "skipped", "advisory_failed"]),
  evidence: z.string().min(1).describe("Brief evidence or reason"),
})
export type DeferredCheckType = z.infer<typeof DeferredCheck>

/**
 * Evidence that a particular verification tool was actually called and what it
 * returned. Used to enforce skill `required_tools` contracts: a skill can
 * declare a tool MUST run (and pass) before verdict=accepted; submit_verdict
 * then checks every required tool is represented here with passed=true.
 *
 * `detail` is free-form but MUST let a reviewer reproduce the check — URL,
 * selector, response hash, exit code, etc. Prose like "checked the chart" is
 * rejected as non-evidentiary; the `.min(8)` schema constraint enforces the
 * floor inline so the LLM gets the real bar from the schema, not from
 * runtime consistency-check feedback.
 *
 * Optional narrative-only fields (`target`, `attachment_sha`) were intentionally
 * removed: nothing downstream reads them, and weak tool-calling models
 * occasionally JSON-stringify an array-of-objects when too many optional fields
 * pile up in a single object.
 */
export const ToolCallEvidence = z.object({
  tool: z.string().min(1).describe("Tool name as declared on the delivery tool set (e.g. 'verify_page_integrity', 'screenshot', 'run_command')."),
  passed: z.boolean().describe("Whether this invocation passed the check the tool performed. Tools that purely gather evidence without a pass/fail semantic must still set true/false based on whether they completed successfully."),
  detail: z.string().min(8).describe("Reproducer-grade evidence: headline numbers + key signals the tool reported. NOT prose narration. Minimum 8 characters."),
})
export type ToolCallEvidenceType = z.infer<typeof ToolCallEvidence>

export const RejectionDetail = z.object({
  goal_id: z.string().min(1).optional().describe("The goal id (gol_...) this rejection is attributed to. Omit for task-scope delivery failures that cannot be truthfully assigned to one goal."),
  category: z.enum(["build", "test", "lint", "runtime", "quality", "startup", "visual"]).describe("Category of the issue. Use 'visual' when the rejection traces back to a design_spec on task.design_specs."),
  check_id: z.string().min(1).optional().describe("Deferred check id this rejection directly cites. Use the exact deferred_checks[].name when the rejection is caused by a check result."),
  file: z.string().optional().describe("Affected file path, if applicable"),
  error: z.string().min(8).describe("Description of the error or issue. Minimum 8 characters of reproducer-grade signal."),
  suggestion: z.string().optional().describe("Suggested fix approach for the executor"),
  visual_spec_id: z.string().optional().describe("Design-analyst spec id (vis-*) this rejection violates — cite when category='visual'."),
})
export type RejectionDetailType = z.infer<typeof RejectionDetail>

const SharedVerdictFields = {
  summary: z.string().min(1),
  startup_verification: StartupVerification.optional().describe(
    "Startup verification evidence. Required only when the host marks the startup facet as applicable to this task.",
  ),
  frontend_check: FrontendCheck.optional().describe(
    "Frontend render evidence. Required only when the host marks the frontend or visual facet as applicable to this task.",
  ),
  deferred_checks: z.array(DeferredCheck).default([]).describe(
    "Extended checks that the evaluator deferred to delivery. Empty when no extended checks were required.",
  ),
  // Mandatory non-empty for BOTH verdicts: even a rejection requires evidence
  // that you actually ran probes — otherwise the rejection itself is
  // unverified. Schema says `.min(1)` so the LLM sees "required, non-empty"
  // up front, not via runtime feedback.
  tool_call_evidence: z.array(ToolCallEvidence).min(1).describe(
    "Evidence that verification tools actually ran. Required (≥1 entry) for both accepted and rejected verdicts — every verdict must be auditable. When a skill declares required_tools, every entry in that list must appear here with passed=true before verdict='accepted' is allowed.",
  ),
} as const

export const AcceptedVerdict = z.object({
  verdict: z.literal("accepted"),
  ...SharedVerdictFields,
  launch_command: z.string().optional().describe("The exact verified command to start the application (only present when startup_verification.success is true and startup is applicable). Will be used to auto-launch after publish."),
})

export const RejectedVerdict = z.object({
  verdict: z.literal("rejected"),
  ...SharedVerdictFields,
  rejection_details: z.array(RejectionDetail).min(1).describe(
    "Per-rejection attribution. Required (≥1 entry) when verdict='rejected'. Entries without goal_id are task-scope failures and MUST NOT reopen every goal.",
  ),
})

export const DeliveryVerdict = z.discriminatedUnion("verdict", [AcceptedVerdict, RejectedVerdict])

export type AcceptedVerdictType = z.infer<typeof AcceptedVerdict>
export type RejectedVerdictType = z.infer<typeof RejectedVerdict>
export type DeliveryVerdictType = z.infer<typeof DeliveryVerdict>

// ---------------------------------------------------------------------------
// Derived views — the canonical way to get aggregate goal / issue lists.
// Callers must NOT reach into rejection_details directly to derive these;
// route through these helpers so a future schema change has one rewrite site.
// ---------------------------------------------------------------------------

/** Distinct goal IDs the rejection blames. `[]` for accepted verdicts. */
export function affectedGoalIDs(verdict: DeliveryVerdictType): string[] {
  if (verdict.verdict === "accepted") return []
  return Array.from(new Set(verdict.rejection_details.map((d) => d.goal_id).filter((item): item is string => Boolean(item))))
}

/** Human-readable issue strings derived from rejection_details. `[]` for accepted. */
export function issuesFound(verdict: DeliveryVerdictType): string[] {
  if (verdict.verdict === "accepted") return []
  return verdict.rejection_details.map((d) => d.error)
}
