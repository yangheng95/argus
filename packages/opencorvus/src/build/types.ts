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

/**
 * Terminal payload the build agent records through report_build_result.
 * Orchestrator reads this typed result and decides
 * whether to call `deliver`, `build` again with feedback, or stop.
 *
 * `status="passed"` means the build agent believes every acceptance_spec is met
 * AND its own verification commands passed. `deliver` still runs as an
 * adversarial double-check — build's self-report is trust-but-verify.
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
    .describe("One-line plain-prose description of what changed (or why it failed)."),
  patch_summary: z
    .string()
    .describe(
      "Short bullet list of the file-level changes the build made. Empty string when no files changed.",
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
}).strict()

export const BuildFailedResultSchema = z.object({
  status: z.literal("failed"),
  ...BuildResultBase,
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

/**
 * Typed contract violation thrown by BuildAgent.run when an opencode build
 * session ends without honouring its terminal-tool contract. Two shapes:
 *
 *   - missing_terminal_report — session ended without a `report_build_result`
 *     tool call that validates against BuildResultSchema. Pre-fix, this
 *     surfaced as a generic `build agent: terminal build report did not
 *     match BuildResultSchema` Error and the orchestrator only saw a tool
 *     error. The actual progress (file edits, tool calls) was invisible
 *     above the BuildResult window.
 *
 *   - merge_back_blocked — session ended with merge_back unfinished after
 *     report_build_result(passed) was rejected. The previous synthesis
 *     path constructed a fake success-encoded-as-failed BuildResult inside
 *     BuildAgent.run (rule-7 fallback); v3 P2 replaces that synthesis with
 *     a typed throw the orchestrator catches and converts.
 *
 * Scope: opencode executor only. External executors (codex / claude-code)
 * host-synthesise the BuildResult after the provider finishes — there is
 * no in-session report_build_result tool call to be missing.
 */
export class BuildAgentContractError extends Error {
  readonly code: "missing_terminal_report" | "merge_back_blocked"
  readonly diagnostics: {
    sessionID?: string
    parseError?: string
    lastMergeBackOutcome?: string | null
  }
  constructor(
    code: "missing_terminal_report" | "merge_back_blocked",
    diagnostics: {
      sessionID?: string
      parseError?: string
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
