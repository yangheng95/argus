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
 * Terminal payload the build agent records through report_build_passed or
 * report_build_failed. Orchestrator reads this typed result and decides
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
export const BuildResultSchema = z.object({
  status: z.enum(["passed", "failed"]),
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
  error: z
    .string()
    .optional()
    .describe("Concrete failure reason when status=failed. Required in that branch."),
})
export type BuildResult = z.infer<typeof BuildResultSchema>
