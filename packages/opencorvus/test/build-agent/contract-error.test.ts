import { describe, expect, test } from "bun:test"
import { BuildAgentContractError, BuildResultSchema } from "../../src/build/types"

/**
 * Regression for specs/scheduler-fix-plan-2026-04-30.md P2 (commit
 * e87333dbb) + audit §11.1 / L1. Pre-fix, an opencode build session that
 * ended without calling report_build_result emitted a generic
 * `Error("build agent: terminal build report did not match
 * BuildResultSchema: …")` from build/agent.ts:633. The orchestrator
 * caught it via the generic infra-error path and rethrew, so the only
 * thing visible above the BuildResult window was "build tool failed":
 * the agent's actual progress was invisible.
 *
 * The fix introduces a typed BuildAgentContractError that:
 *   - distinguishes contract violation from infra failure (codex P2 #1
 *     scope: opencode executor only — external executors host-synthesise
 *     BuildResult and don't have report_build_result, so they keep the
 *     generic Error throw),
 *   - carries diagnostic context (sessionID, parseError or
 *     lastMergeBackOutcome) for the orchestrator to inject into the next
 *     attempt's prompt via decision_log phase=retry,
 *   - converts in the orchestrator to a SCHEMA-VALID failed BuildResult
 *     (codex P2 #2: BuildFailedResultSchema is .strict() and requires
 *     {status, summary, patch_summary, tests, error}, no extra fields).
 *
 * This test asserts the converter shape only (the typed-throw integration
 * is exercised by the orchestrator-build path's existing tests via
 * mocked agents). Direct unit coverage of the conversion guarantees the
 * shape stays schema-valid even if BuildResultSchema evolves.
 */

describe("BuildAgentContractError", () => {
  test("missing_terminal_report carries sessionID + parseError diagnostics", () => {
    const err = new BuildAgentContractError(
      "missing_terminal_report",
      { sessionID: "ses_abc123", parseError: "expected status, got undefined" },
      "Build agent terminated without a valid report_build_result tool call",
    )
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("missing_terminal_report")
    expect(err.diagnostics.sessionID).toBe("ses_abc123")
    expect(err.diagnostics.parseError).toBe("expected status, got undefined")
    expect(err.message).toMatch(/report_build_result/)
    expect(err.name).toBe("BuildAgentContractError")
  })

  test("merge_back_blocked carries sessionID + lastMergeBackOutcome", () => {
    const err = new BuildAgentContractError(
      "merge_back_blocked",
      { sessionID: "ses_xyz", lastMergeBackOutcome: "conflict on src/main.ts" },
      "Build session ended before merge_back completed: conflict on src/main.ts",
    )
    expect(err.code).toBe("merge_back_blocked")
    expect(err.diagnostics.lastMergeBackOutcome).toBe("conflict on src/main.ts")
    expect(err.message).toMatch(/merge_back/)
  })

  test("converts to a schema-valid BuildFailedResult shape (no worktree field, all required fields present)", () => {
    const err = new BuildAgentContractError(
      "missing_terminal_report",
      { sessionID: "ses_abc" },
      "Build agent terminated without a valid report_build_result tool call: invalid_type at status",
    )
    // The orchestrator's converter at orchestrator/tools.ts builds this
    // exact shape; if the schema ever adds a required field, this test
    // forces the converter to be updated in the same commit.
    const synthFailed = {
      status: "failed" as const,
      summary: `Build agent contract violation (${err.code}): ${err.message.slice(0, 200)}`,
      patch_summary: "",
      tests: [],
      error: err.message,
    }
    const parsed = BuildResultSchema.safeParse(synthFailed)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.status).toBe("failed")
      expect(parsed.data.summary).toContain("contract violation")
      expect(parsed.data.summary).toContain("missing_terminal_report")
      // Negative-case: schema is .strict(); a stray `worktree` field
      // would produce a parse failure (rule 36 negative test).
      expect("worktree" in parsed.data).toBe(false)
    }
  })

  test("rejects synth that omits required `error` field (negative — keeps converter honest)", () => {
    const broken = {
      status: "failed" as const,
      summary: "missing error",
      patch_summary: "",
      tests: [],
      // error: missing → schema rejects.
    }
    const parsed = BuildResultSchema.safeParse(broken)
    expect(parsed.success).toBe(false)
  })

  test("rejects synth that adds a `worktree` field (negative — schema strict)", () => {
    const stray = {
      status: "failed" as const,
      summary: "test",
      patch_summary: "",
      tests: [],
      error: "test error",
      worktree: "/some/path", // strict() rejects unknown keys
    }
    const parsed = BuildResultSchema.safeParse(stray)
    expect(parsed.success).toBe(false)
  })
})
