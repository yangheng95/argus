/**
 * Delivery verdict schema.
 *
 * Factored out of agent.ts so that output-tools.ts can consume the same Zod
 * shape for the mandatory `submit_verdict` tool without introducing a circular
 * import with agent.ts.
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

export const DeliveryVerdict = z.object({
  verdict: z.enum(["accepted", "rejected"]),
  summary: z.string().min(1),
  launch_command: z.string().optional().describe("The exact verified command to start the application (only present when startup_verification.success is true). Will be used to auto-launch after publish."),
  startup_verification: StartupVerification,
  frontend_check: FrontendCheck,
  issues_found: z.array(z.string()).default([]),
  /** The set of goal IDs the rejection attributes the failure to. The
   *  orchestrator uses this set directly to decide which goals to re-open
   *  via startNewAttempt — no downstream string-matching. Rule: when
   *  `verdict === "rejected"` this array MUST be non-empty; when
   *  `verdict === "accepted"` it is ignored (and normalized to [] by the
   *  submit_verdict tool). Each id must also be referenced by at least one
   *  rejection_details entry's `goal_id`, enforced at submit time. */
  affected_goal_ids: z.array(z.string()).default([]).describe(
    "Goal IDs this rejection blames. Required (non-empty) when verdict is rejected; must be a superset of all rejection_details[].goal_id values.",
  ),
  rejection_details: z.array(z.object({
    goal_id: z.string().describe("The goal id (gol_...) this rejection is attributed to. Must appear in affected_goal_ids."),
    category: z.enum(["build", "test", "lint", "runtime", "quality", "startup", "visual"]).describe("Category of the issue. Use 'visual' when the rejection traces back to a design_spec on task.design_specs."),
    file: z.string().optional().describe("Affected file path, if applicable"),
    error: z.string().describe("Description of the error or issue"),
    suggestion: z.string().optional().describe("Suggested fix approach for the executor"),
    visual_spec_id: z.string().optional().describe("Design-analyst spec id (vis-*) this rejection violates — cite when category='visual' and the violation maps to a specific design_spec entry on task.design_specs."),
  })).optional().describe("Structured rejection details for the executor to fix. Required when verdict is rejected."),
  deferred_checks: z.array(z.object({
    name: z.string().describe("Check name (e.g. code_review, dead_code_review)"),
    result: z.enum(["passed", "failed", "skipped"]),
    evidence: z.string().describe("Brief evidence or reason"),
  })).optional().describe("Extended checks that the evaluator deferred to delivery"),
})

export type DeliveryVerdictType = z.infer<typeof DeliveryVerdict>
