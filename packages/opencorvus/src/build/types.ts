/**
 * Build agent types — the contract the orchestrator's `build` tool returns.
 *
 * Phase 5-b of specs/new-arch/16-unified-teardown.md §7-5. This file defines
 * the wire shape only — the implementation lands in src/build/agent.ts
 * alongside its system prompt + tool set in a separate commit. Separating
 * the schema from the run() body keeps the next cron cycle's
 * build-agent work from having to re-settle the API shape.
 *
 * The `build` tool replaces the dispatch_goal + submit_execution +
 * exec_goal + retry_goal + create_run path. Orchestrator calls it with a
 * goal description (or a free-form request in the direct-build path) and
 * gets back a single terminal `BuildResult` per invocation. Multi-goal
 * parallelism happens through AI SDK parallel tool_calls, capped by
 * `AgentSemaphore` — no external GoalPool scheduler.
 */

import z from "zod"
import { ArchitectContractGraphSchema } from "@/architect/contract-graph"
import { FactCheckItemListSchema } from "@/fact-check/schema"

/** Free-form request passed through the `direct` workflow — no goal
 *  decomposition, no per-goal acceptance. The build agent does the work
 *  in-place and reports what it changed. */
export const BuildRequestInput = z.object({
  kind: z.literal("request"),
  text: z.string().min(1).describe("The user's request, verbatim."),
})
export type BuildRequestInput = z.infer<typeof BuildRequestInput>

/** Pipeline workflow: the architect already decomposed into goals. Build
 *  executes one goal with its acceptance_specs as the verification contract. */
export const BuildGoalInput = z.object({
  kind: z.literal("goal"),
  id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)).default([]),
  acceptance_specs: z.array(z.string()).default([]),
  owned_paths: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
})
export type BuildGoalInput = z.infer<typeof BuildGoalInput>

export const BuildTarget = z.discriminatedUnion("kind", [BuildRequestInput, BuildGoalInput])
export type BuildTarget = z.infer<typeof BuildTarget>

export const BuildContractGraphContext = ArchitectContractGraphSchema
export type BuildContractGraphContext = z.infer<typeof BuildContractGraphContext>

/** One line of evidence a test / check was run. Open-ended so the build
 *  agent can report what its acceptance_specs required without the orchestrator
 *  LLM needing to replay it. */
export const BuildTestResult = z.object({
  name: z.string().min(1).describe("Test / check name, e.g. 'bun test src/note-store.test.ts'"),
  passed: z.boolean(),
  detail: z.string().optional().describe("One-line reproducer-grade detail: exit code, failing assertion, etc."),
})
export type BuildTestResult = z.infer<typeof BuildTestResult>

export const BuildFileChange = z.object({
  path: z.string().min(1).describe("Project-relative file path changed by this build."),
  summary: z.string().min(1).describe("Concrete description of what changed in this file."),
  reason: z
    .string()
    .min(1)
    .describe("Why this file needed to change for the current goal, dependency, or shared integration surface."),
})
export type BuildFileChange = z.infer<typeof BuildFileChange>

export const BuildRepairVerificationCommand = z.object({
  command: z.string().min(1).describe("Command or manual check performed for this repair."),
  passed: z.boolean(),
  detail: z.string().optional().describe("One-line evidence: exit code, assertion, visual observation, etc."),
})
export type BuildRepairVerificationCommand = z.infer<typeof BuildRepairVerificationCommand>

export const BuildRepairedFinding = z.object({
  finding_id: z.string().min(1),
  fingerprint: z.string().min(1),
  changed_files: z.array(z.string().min(1)).min(1),
  verification_commands: z.array(BuildRepairVerificationCommand).min(1),
})
export type BuildRepairedFinding = z.infer<typeof BuildRepairedFinding>

export const BuildUnrepairedFinding = z.object({
  finding_id: z.string().min(1),
  fingerprint: z.string().min(1),
  reason: z.string().min(1),
})
export type BuildUnrepairedFinding = z.infer<typeof BuildUnrepairedFinding>

export const BuildRepairReport = z
  .object({
    repaired_findings: z.array(BuildRepairedFinding).default([]),
    unrepaired_findings: z.array(BuildUnrepairedFinding).default([]),
    unrelated_changes: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Map<string, string>()
    for (const item of value.repaired_findings) {
      const prior = seen.get(item.fingerprint)
      if (prior) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repaired_findings"],
          message: `fingerprint ${item.fingerprint} appears in both ${prior} and repaired_findings`,
        })
      }
      seen.set(item.fingerprint, "repaired_findings")
    }
    for (const item of value.unrepaired_findings) {
      const prior = seen.get(item.fingerprint)
      if (prior) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unrepaired_findings"],
          message: `fingerprint ${item.fingerprint} appears in both ${prior} and unrepaired_findings`,
        })
      }
      seen.set(item.fingerprint, "unrepaired_findings")
    }
  })
export type BuildRepairReport = z.infer<typeof BuildRepairReport>

/**
 * Terminal payload the build agent records through report_build_result.
 * Orchestrator reads this typed result and decides whether to call
 * `visual_qa`, `integrity`, `build` again with feedback, modify the goal,
 * or fail/question from the evidence.
 *
 * `status="passed"` means the build agent believes every acceptance_spec is met
 * AND its own verification commands passed. For honest no-change implementation
 * outcomes, it may also mean the requested behavior was already present and no
 * project file changes were needed. Integrity remains the final workflow
 * acceptance review; build's self-report is implementation evidence, not task
 * completion.
 *
 * When `status="failed"` the payload MUST describe why (`error`), not just be a
 * rejection. The orchestrator wants actionable feedback so it can decide
 * between re-dispatch, modify_goal, or fail_task without re-reading the
 * session transcript.
 */
const BuildResultBase = {
  summary: z
    .string()
    .min(1)
    .describe(
      "One-line plain-prose description of what changed or why it failed. " +
        "For explicit investigation/report deliverables, this may contain the detailed multi-section report.",
    ),
  files_changed: z
    .array(BuildFileChange)
    .describe(
      "Every project file changed by this build, with the build agent's own explanation. " +
        "Passed builds must explain each changed file; failed builds may be empty only when no file was changed.",
    ),
  commit_ref: z
    .string()
    .optional()
    .describe(
      "Short git SHA of the build's final commit inside the worktree. Absent when no commit was produced (status=failed without any partial progress).",
    ),
  tests: z
    .array(BuildTestResult)
    .default([])
    .describe("Evidence the build actually ran verification; empty when no tests were required."),
  reference_comparison_evidence_refs: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional task-scoped browser_preview_evidence refs when the build actually generated region comparison evidence.",
    ),
  contract_restatement: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Detailed restatement of the effective req/goal contract you actually implemented or failed: " +
        "user request, goal objective, relevant acceptance specs, requirement ids, and scoped non-goals. " +
        "Use this to prevent later agents from underestimating what the work really covered.",
    ),
  followup_workload_guidance: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Explicit warning for subsequent agents about remaining or hidden work surface. " +
        "Call out underestimation traps, evidence they must read deeper, and whether workload_analysis / " +
        "architect re-sizing should be revisited before more implementation.",
    ),
  repair_report: BuildRepairReport.optional().describe(
    "Integrity repair ledger for builds dispatched from integrity feedback. Every blocking integrity fingerprint must be listed exactly once as repaired or unrepaired.",
  ),
  // Fact-check item registration. Optional at the BuildResult boundary:
  // missing means "no items registered" and does not force a fact-check
  // phase. The downstream fact_check orchestrator tool still reads this
  // list when workers provide it.
  fact_check_items: FactCheckItemListSchema.default([]).describe(
    "Every factual claim (API behaviour, library version, third-party protocol, number, path, history) you have NOT verified via tool calls in this session. Empty array when you have only opinions, plans, or in-session-verified statements.",
  ),
}

export const BuildPassedResultSchema = z
  .object({
    status: z.literal("passed"),
    ...BuildResultBase,
    // Empty `files_changed` is legal: the build agent may publish a prior
    // attempt's worktree without further edits, or report passed for a goal
    // whose acceptance was met by environmental setup. The orchestrator LLM
    // cross-checks against the host's `actual_changed_files` ground truth
    // (see RunOutput.actualChangedFiles) and decides if the empty report is
    // honest. CLAUDE.md rule 13 — host doesn't enforce a minimum here.
    files_changed: z.array(BuildFileChange),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.repair_report) return
    if (value.repair_report.unrepaired_findings.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repair_report", "unrepaired_findings"],
        message: "passed build result cannot contain unrepaired integrity findings",
      })
    }
    for (const [findingIndex, finding] of value.repair_report.repaired_findings.entries()) {
      for (const [commandIndex, command] of finding.verification_commands.entries()) {
        if (command.passed) continue
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repair_report", "repaired_findings", findingIndex, "verification_commands", commandIndex, "passed"],
          message: "passed build result cannot contain failed repair verification commands",
        })
      }
    }
  })

export const BuildFailedResultSchema = z
  .object({
    status: z.literal("failed"),
    ...BuildResultBase,
    files_changed: z.array(BuildFileChange).default([]),
    error: z.string().trim().min(1).describe("Concrete failure reason when status=failed."),
  })
  .strict()

export const BuildResultSchema = z.discriminatedUnion("status", [BuildPassedResultSchema, BuildFailedResultSchema])
export type BuildResult = z.infer<typeof BuildResultSchema>

export function validateBuildIntegrityRepairReport(
  result: BuildResult,
  requiredFingerprints: string[],
): string | undefined {
  const required = [...new Set(requiredFingerprints)].sort()
  if (required.length === 0) return undefined
  if (!result.repair_report) {
    return `missing repair_report for required integrity fingerprints: ${required.join(", ")}`
  }
  const occurrences = new Map<string, Array<"repaired" | "unrepaired">>()
  for (const item of result.repair_report.repaired_findings) {
    occurrences.set(item.fingerprint, [...(occurrences.get(item.fingerprint) ?? []), "repaired"])
  }
  for (const item of result.repair_report.unrepaired_findings) {
    occurrences.set(item.fingerprint, [...(occurrences.get(item.fingerprint) ?? []), "unrepaired"])
  }
  const missing = required.filter((fingerprint) => !occurrences.has(fingerprint))
  if (missing.length > 0) return `missing required fingerprints: ${missing.join(", ")}`
  const duplicated = required.filter((fingerprint) => (occurrences.get(fingerprint)?.length ?? 0) !== 1)
  if (duplicated.length > 0) return `required fingerprints must appear exactly once: ${duplicated.join(", ")}`
  if (result.status === "passed") {
    const unrepaired = required.filter((fingerprint) => occurrences.get(fingerprint)?.[0] === "unrepaired")
    if (unrepaired.length > 0) return `passed result still reports unrepaired fingerprints: ${unrepaired.join(", ")}`
  }
  return undefined
}

export function formatBuildResultSchemaError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>"
    return `${path}: ${issue.message}`
  })
  const hasPassedWithError = error.issues.some(
    (issue) => issue.code === "unrecognized_keys" && Array.isArray(issue.keys) && issue.keys.includes("error"),
  )
  const hasFactCheckItemsIssue = error.issues.some(
    (issue) => issue.path.length === 1 && issue.path[0] === "fact_check_items",
  )
  const guidance = hasPassedWithError
    ? "status='passed' cannot include error. If any blocking verification failed, call report_build_result with status='failed' and put the reason in error; otherwise remove error and keep the caveat in summary."
    : hasFactCheckItemsIssue
      ? "fact_check_items must be an array when provided. Use fact_check_items: [] when you have no unverified factual claims, or omit the field."
      : "Choose exactly one terminal shape: status='passed' without error, or status='failed' with a non-empty error."
  return `${guidance} Schema issues: ${issues.join("; ")}`
}

/**
 * Typed contract violation thrown by BuildAgent.run when a OpenCorvus build
 * session ends without honouring its terminal-tool contract.
 *
 *   - missing_terminal_report — session ended without a `report_build_result`
 *     tool call that validates against BuildResultSchema. Surfaces as a typed
 *     error so the orchestrator's tool result is well-formed (instead of a
 *     generic `terminal build report did not match BuildResultSchema` Error
 *     that hides the underlying agent progress).
 *
 * Scope: OpenCorvus executor only. External executors (codex / claude-code)
 * host-synthesise the BuildResult after the provider finishes — there is
 * no in-session report_build_result tool call to be missing.
 *
 * The earlier `merge_back_blocked` variant was removed alongside the host-
 * side merge_back-before-passed guard: the orchestrator LLM now reads the
 * merge_back facts (RunOutput.mergeBackStatus / lastMergeBackOutcome /
 * publishedCommitRef) returned in the build tool result and decides what
 * to do, rather than the host throwing on its behalf. Spec
 * architecture-rework-loosening-plan-2026-05-06.md (B8).
 */
export class BuildAgentContractError extends Error {
  readonly code: "missing_terminal_report"
  readonly diagnostics: {
    sessionID?: string
    lastMergeBackOutcome?: string | null
  }
  constructor(
    code: "missing_terminal_report",
    diagnostics: {
      sessionID?: string
      lastMergeBackOutcome?: string | null
    },
    message: string,
  ) {
    super(message)
    this.name = "BuildAgentContractError"
    this.code = code
    this.diagnostics = diagnostics
  }
}
