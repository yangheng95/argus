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
 * `BuildSemaphore` — no external GoalPool scheduler.
 */

import z from "zod"

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
  acceptance_specs: z.array(z.string()).default([]),
  owned_paths: z.array(z.string()).default([]),
  exports: z.array(z.string()).default([]),
  imports: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
})
export type BuildGoalInput = z.infer<typeof BuildGoalInput>

export const BuildTarget = z.discriminatedUnion("kind", [BuildRequestInput, BuildGoalInput])
export type BuildTarget = z.infer<typeof BuildTarget>

/** One line of evidence a test / check was run. Open-ended so the build
 *  agent can report what its acceptance_specs required without the orchestrator
 *  LLM needing to replay it. */
export const BuildTestResult = z.object({
  name: z.string().min(1).describe("Test / check name, e.g. 'bun test src/note-store.test.ts'"),
  passed: z.boolean(),
  detail: z
    .string()
    .optional()
    .describe("One-line reproducer-grade detail: exit code, failing assertion, etc."),
})
export type BuildTestResult = z.infer<typeof BuildTestResult>

export const BuildFileChange = z.object({
  path: z.string().min(1).describe("Project-relative file path changed by this build."),
  summary: z.string().min(1).describe("Concrete description of what changed in this file."),
  reason: z.string().min(1).describe(
    "Why this file needed to change for the current goal, dependency, or shared integration surface.",
  ),
})
export type BuildFileChange = z.infer<typeof BuildFileChange>

/**
 * Terminal payload the build agent records through report_build_result.
 * Orchestrator reads this typed result and decides
 * whether to call `deliver`, `build` again with feedback, or stop.
 *
 * `status="passed"` means the build agent believes every acceptance_spec is met
 * AND its own verification commands passed. For explicit no-edit analysis
 * requests, it means the requested investigation completed and left no project
 * file changes. `deliver` still runs as an adversarial double-check — build's
 * self-report is trust-but-verify.
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
    .describe("One-line plain-prose description of what changed, what was found, or why it failed."),
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
}

export const BuildPassedResultSchema = z.object({
  status: z.literal("passed"),
  ...BuildResultBase,
  // Empty `files_changed` is legal: the build agent may publish a prior
  // attempt's worktree without further edits, or report passed for a goal
  // whose acceptance was met by environmental setup. The orchestrator LLM
  // cross-checks against the host's `actual_changed_files` ground truth
  // (see RunOutput.actualChangedFiles) and decides if the empty report is
  // honest. CLAUDE.md rule 13 — host doesn't enforce a minimum here.
  files_changed: z.array(BuildFileChange),
}).strict()

export const BuildFailedResultSchema = z.object({
  status: z.literal("failed"),
  ...BuildResultBase,
  files_changed: z.array(BuildFileChange).default([]),
  error: z
    .string()
    .trim()
    .min(1)
    .describe("Concrete failure reason when status=failed."),
}).strict()

export const BuildResultSchema = z.discriminatedUnion("status", [
  BuildPassedResultSchema,
  BuildFailedResultSchema,
])
export type BuildResult = z.infer<typeof BuildResultSchema>

export function formatBuildResultSchemaError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>"
    return `${path}: ${issue.message}`
  })
  const hasPassedWithError = error.issues.some((issue) =>
    issue.code === "unrecognized_keys" &&
    Array.isArray(issue.keys) &&
    issue.keys.includes("error")
  )
  const guidance = hasPassedWithError
    ? "status='passed' cannot include error. If any blocking verification failed, call report_build_result with status='failed' and put the reason in error; otherwise remove error and keep the caveat in summary."
    : "Choose exactly one terminal shape: status='passed' without error, or status='failed' with a non-empty error."
  return `${guidance} Schema issues: ${issues.join("; ")}`
}

/**
 * Typed contract violation thrown by BuildAgent.run when a MirrorCode build
 * session ends without honouring its terminal-tool contract.
 *
 *   - missing_terminal_report — session ended without a `report_build_result`
 *     tool call that validates against BuildResultSchema. Surfaces as a typed
 *     error so the orchestrator's tool result is well-formed (instead of a
 *     generic `terminal build report did not match BuildResultSchema` Error
 *     that hides the underlying agent progress).
 *
 * Scope: MirrorCode executor only. External executors (codex / claude-code)
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
