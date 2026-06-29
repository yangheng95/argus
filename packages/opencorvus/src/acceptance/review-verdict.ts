/**
 * Structured acceptance review verdict used by post-build evidence checks and
 * integrity-facing review artifacts.
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

export const AcceptanceEvidenceFacet = z.enum(["startup", "runtime", "frontend", "visual"])
export type AcceptanceEvidenceFacetType = z.infer<typeof AcceptanceEvidenceFacet>

export const DeferredCheck = z.object({
  name: z.string().min(1).describe("Check name (e.g. code_review, dead_code_review)"),
  result: z.enum(["passed", "failed", "skipped", "advisory_failed"]),
  evidence: z.string().min(1).describe("Brief evidence or reason"),
})
export type DeferredCheckType = z.infer<typeof DeferredCheck>

export const ToolCallEvidence = z.object({
  tool: z.string().min(1).describe("Tool name as declared on the acceptance review tool set."),
  passed: z
    .boolean()
    .describe(
      "Whether this invocation passed the check the tool performed. Tools that gather evidence still set true/false based on whether they completed successfully.",
    ),
  detail: z
    .string()
    .min(8)
    .describe("Reproducer-grade evidence: key numbers, URL, selector, response hash, exit code, or equivalent."),
})
export type ToolCallEvidenceType = z.infer<typeof ToolCallEvidence>

export const RejectionDetail = z.object({
  goal_id: z
    .string()
    .min(1)
    .optional()
    .describe("The goal id this rejection is attributed to. Omit for task-scope failures."),
  category: z.enum(["build", "test", "lint", "runtime", "quality", "startup", "visual"]),
  check_id: z.string().min(1).optional().describe("Deferred check id this rejection directly cites."),
  file: z.string().optional().describe("Affected file path, if applicable"),
  error: z.string().min(8).describe("Description of the error or issue. Minimum 8 chars."),
  suggestion: z.string().optional().describe("Suggested fix approach for the next build/replan step"),
  visual_spec_id: z.string().optional().describe("Frontend-design spec id this rejection violates."),
})
export type RejectionDetailType = z.infer<typeof RejectionDetail>

const SharedVerdictFields = {
  summary: z.string().min(1),
  startup_verification: StartupVerification.optional().describe(
    "Startup verification evidence. Required only when startup is applicable.",
  ),
  frontend_check: FrontendCheck.optional().describe(
    "Frontend/render evidence. Required only when frontend or visual review is applicable.",
  ),
  deferred_checks: z.array(DeferredCheck).default([]),
  tool_call_evidence: z
    .array(ToolCallEvidence)
    .min(1)
    .describe("Evidence that verification tools actually ran. Required for both accepted and rejected verdicts."),
} as const

export const AcceptedAcceptanceVerdict = z.object({
  verdict: z.literal("accepted"),
  ...SharedVerdictFields,
  launch_command: z
    .string()
    .optional()
    .describe("Verified command to start the application, only when startup verification succeeded."),
})

export const RejectedAcceptanceVerdict = z.object({
  verdict: z.literal("rejected"),
  ...SharedVerdictFields,
  rejection_details: z
    .array(RejectionDetail)
    .min(1)
    .describe("Per-rejection attribution. Required when verdict='rejected'."),
})

export const AcceptanceReviewVerdict = z.discriminatedUnion("verdict", [
  AcceptedAcceptanceVerdict,
  RejectedAcceptanceVerdict,
])

export type AcceptedAcceptanceVerdictType = z.infer<typeof AcceptedAcceptanceVerdict>
export type RejectedAcceptanceVerdictType = z.infer<typeof RejectedAcceptanceVerdict>
export type AcceptanceReviewVerdictType = z.infer<typeof AcceptanceReviewVerdict>

export function affectedGoalIDs(verdict: AcceptanceReviewVerdictType): string[] {
  if (verdict.verdict === "accepted") return []
  return Array.from(
    new Set(verdict.rejection_details.map((d) => d.goal_id).filter((item): item is string => Boolean(item))),
  )
}

export function issuesFound(verdict: AcceptanceReviewVerdictType): string[] {
  if (verdict.verdict === "accepted") return []
  return verdict.rejection_details.map((d) => d.error)
}
