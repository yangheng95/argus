import { describe, expect, test } from "bun:test"
import { BuildAgentContractError, BuildResultSchema } from "../../src/build/types"
import { convertMissingTerminalToolError, createMergeBackSingleFlight, evaluateBuildReportSubmission } from "../../src/build/agent"
import { AgentRunError } from "../../src/agent/runner"
import { Message } from "../../src/session/message"

/**
 * Regression for specs/scheduler-fix-plan-2026-04-30.md P2 (commit
 * e87333dbb) + audit §11.1 / L1. Pre-fix, a OpenCorvus build session that
 * ended without calling report_build_result emitted a generic
 * `Error("build agent: terminal build report did not match
 * BuildResultSchema: …")` from build/agent.ts:633. The orchestrator
 * caught it via the generic infra-error path and rethrew, so the only
 * thing visible above the BuildResult window was "build tool failed":
 * the agent's actual progress was invisible.
 *
 * The fix introduces a typed BuildAgentContractError that:
 *   - distinguishes contract violation from infra failure (codex P2 #1
 *     scope: OpenCorvus executor only — external executors host-synthesise
 *     BuildResult and don't have report_build_result, so they keep the
 *     generic Error throw),
 *   - carries diagnostic context (sessionID, parseError or
 *     lastMergeBackOutcome) for the orchestrator to inject into the next
 *     attempt's prompt via decision_log phase=retry,
 *   - converts in the orchestrator to a SCHEMA-VALID failed BuildResult
 *     (codex P2 #2: BuildFailedResultSchema is .strict() and requires
 *     {status, summary, files_changed, tests, error}, no extra fields).
 *
 * This test asserts the converter shape only (the typed-throw integration
 * is exercised by the orchestrator-build path's existing tests via
 * mocked agents). Direct unit coverage of the conversion guarantees the
 * shape stays schema-valid even if BuildResultSchema evolves.
 */

describe("BuildAgentContractError", () => {
  test("missing_terminal_report carries sessionID diagnostic", () => {
    const err = new BuildAgentContractError(
      "missing_terminal_report",
      { sessionID: "ses_abc123" },
      "Build agent terminated without a valid report_build_result tool call. Retry this goal with files_changed; not primary workspace pollution.",
    )
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("missing_terminal_report")
    expect(err.diagnostics.sessionID).toBe("ses_abc123")
    expect(err.message).toMatch(/report_build_result/)
    expect(err.message).toMatch(/files_changed/)
    expect(err.message).not.toMatch(/same-session recovery/)
    expect(err.message).toMatch(/not primary workspace pollution/)
    expect(err.name).toBe("BuildAgentContractError")
  })

  test("missing_terminal_report carries lastMergeBackOutcome diagnostic when supplied", () => {
    // The host no longer throws a separate merge_back_blocked variant
    // (spec architecture-rework-loosening-plan-2026-05-06.md B8): the
    // orchestrator LLM reads the merge facts in the build tool result and
    // decides next. But missing_terminal_report still surfaces the most
    // recent merge_back tool outcome in its diagnostics so the orchestrator
    // can include it in the next attempt's prompt.
    const err = new BuildAgentContractError(
      "missing_terminal_report",
      { sessionID: "ses_xyz", lastMergeBackOutcome: "conflict on src/main.ts" },
      "Build agent terminated without a valid report_build_result tool call: …",
    )
    expect(err.code).toBe("missing_terminal_report")
    expect(err.diagnostics.lastMergeBackOutcome).toBe("conflict on src/main.ts")
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
      files_changed: [],
      tests: [],
      error: err.message,
      // Host-synthesised BuildResult: LLM never reached terminal tool,
      // so fact_check_items defaults to empty array
      // (specs/fact-check-agent-2026-05-25.md §6.1.3 — host construction site).
      fact_check_items: [],
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
      files_changed: [],
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
      files_changed: [],
      tests: [],
      error: "test error",
      worktree: "/some/path", // strict() rejects unknown keys
    }
    const parsed = BuildResultSchema.safeParse(stray)
    expect(parsed.success).toBe(false)
  })
})

/**
 * Spec build-missing-terminal-signal-restore-2026-05-07.md §5.1 +
 * codex review BLOCKING B1: `BuildAgentContractError` must have ONE
 * throw site (rule 8 single source). The original throw at
 * build/agent.ts:704-714 was unreachable dead code (runAgentSession
 * threw AgentRunError before parsed was computed). The new throw site
 * is the catch block on the runAgentSession try (line 588 region):
 * recognise AgentRunError carrying TerminalToolMissingError as cause
 * → convert to BuildAgentContractError. Other AgentRunError types
 * (provider errors, abort, etc.) re-throw unchanged.
 */
describe("convertMissingTerminalToolError", () => {
  test("AgentRunError carrying TerminalToolMissingError → BuildAgentContractError", () => {
    const innerErr = new Message.TerminalToolMissingError({
      message: "Model did not call terminal tool report_build_result before the turn ended (finish=stop)",
      toolName: "report_build_result",
      retries: 0,
    })
    const wrapped = new AgentRunError("build", `LLM error during build: TerminalToolMissingError: ${innerErr.message}`, {
      cause: innerErr,
    })
    const converted = convertMissingTerminalToolError(wrapped, {
      sessionID: "ses_abc123",
      lastMergeBackOutcome: null,
    })
    expect(converted).not.toBeNull()
    expect(converted).toBeInstanceOf(BuildAgentContractError)
    expect(converted!.code).toBe("missing_terminal_report")
    expect(converted!.diagnostics.sessionID).toBe("ses_abc123")
    expect(converted!.diagnostics.lastMergeBackOutcome).toBeNull()
    // The recovery hint MUST describe the missing-terminal failure mode
    // and direct the next attempt back to the standard build-agent
    // contract (terminal report tool, not turn-final prose). It must
    // NOT carry the modify_goal-based generic feedback the orchestrator
    // LLM defaulted to before the fix ("re-read acceptance_specs"),
    // and must NOT inline prompt protocol text verbatim
    // (visible-brief-hygiene constraint, rule 8 single source).
    expect(converted!.message).toMatch(/terminal build report/)
    expect(converted!.message).toMatch(/standard build-agent contract/)
    expect(converted!.message).toMatch(/structured terminal report/)
    expect(converted!.message).toMatch(/not turn-final prose/)
    expect(converted!.message).not.toMatch(/re-read acceptance_specs/)
    // Hygiene: the recovery hint must not duplicate forbidden visible
    // brief snippets (test/agent/visible-brief-hygiene.test.ts).
    expect(converted!.message).not.toMatch(/call report_build_result exactly once/)
  })

  test("AgentRunError without cause (e.g. plain provider error) → null (re-throw unchanged)", () => {
    const wrapped = new AgentRunError("build", "LLM error during build: APIError: stream interrupted")
    const converted = convertMissingTerminalToolError(wrapped, { sessionID: "ses_x" })
    expect(converted).toBeNull()
  })

  test("AgentRunError with non-terminal-missing cause → null", () => {
    const innerErr = new Message.AbortedError({ message: "user pressed stop" })
    const wrapped = new AgentRunError("build", "aborted", { cause: innerErr })
    const converted = convertMissingTerminalToolError(wrapped, { sessionID: "ses_x" })
    expect(converted).toBeNull()
  })

  test("non-AgentRunError → null", () => {
    const plain = new Error("worktree create failed")
    const converted = convertMissingTerminalToolError(plain, { sessionID: "ses_x" })
    expect(converted).toBeNull()
  })

  test("non-Error value (defensive) → null", () => {
    const converted = convertMissingTerminalToolError("string thrown", { sessionID: "ses_x" })
    expect(converted).toBeNull()
  })

  test("forwards lastMergeBackOutcome from caller (so the orchestrator sees the merge state alongside the contract violation)", () => {
    const innerErr = new Message.TerminalToolMissingError({
      message: "missing report",
      toolName: "report_build_result",
      retries: 0,
    })
    const wrapped = new AgentRunError("build", "LLM error during build: TerminalToolMissingError", {
      cause: innerErr,
    })
    const converted = convertMissingTerminalToolError(wrapped, {
      sessionID: "ses_y",
      lastMergeBackOutcome: "conflict on src/components/MessageList.tsx",
    })
    expect(converted!.diagnostics.lastMergeBackOutcome).toBe("conflict on src/components/MessageList.tsx")
  })
})

describe("evaluateBuildReportSubmission", () => {
  test("rejects invalid build terminal payload as visible feedback instead of throwing", () => {
    const evaluated = evaluateBuildReportSubmission({
      result: {
        status: "passed",
        summary: "",
        files_changed: [],
        tests: [],
      },
      ownsWorktree: true,
      worktreeBranch: "opencorvus/task/t/goal/g/run/r",
    })

    expect(evaluated.accepted).toBe(false)
    expect(evaluated.output).toContain("REJECTED: build report did not match BuildResultSchema")
    expect(evaluated.output).toContain("summary")
    expect(evaluated.output).toContain("call report_build_result again")
  })

  test("accepts missing fact_check_items as an empty registration list", () => {
    const evaluated = evaluateBuildReportSubmission({
      result: {
        status: "passed",
        summary: "Implemented the goal",
        files_changed: [],
        tests: [],
      },
      ownsWorktree: true,
      worktreeBranch: "opencorvus/task/t/goal/g/run/r",
    })

    expect(evaluated.accepted).toBe(true)
    if (evaluated.accepted) expect(evaluated.result.fact_check_items).toEqual([])
  })

  test("accepts valid build terminal payload and normalizes managed worktree commit_ref", () => {
    const evaluated = evaluateBuildReportSubmission({
      result: {
        status: "passed",
        summary: "Implemented the goal",
        files_changed: [],
        tests: [],
        fact_check_items: [],
        commit_ref: "worktree-only",
      },
      ownsWorktree: true,
      worktreeBranch: "opencorvus/task/t/goal/g/run/r",
    })

    expect(evaluated.accepted).toBe(true)
    if (evaluated.accepted) {
      expect(evaluated.result.commit_ref).toBe("")
      expect(evaluated.output).toBe("RECORDED: build report status=passed.")
    }
  })
})

describe("createMergeBackSingleFlight", () => {
  test("coalesces concurrent merge_back calls into one real merge", async () => {
    let calls = 0
    let release!: (value: { status: "merged"; primary_head: string }) => void
    const unblock = new Promise<{ status: "merged"; primary_head: string }>((resolve) => {
      release = resolve
    })
    const mergeBack = createMergeBackSingleFlight(async () => {
      calls += 1
      return await unblock
    })

    const first = mergeBack()
    const second = mergeBack()
    release({ status: "merged", primary_head: "abc123" })

    await expect(first).resolves.toEqual({ status: "merged", primary_head: "abc123" })
    await expect(second).resolves.toEqual({ status: "merged", primary_head: "abc123" })
    expect(calls).toBe(1)
  })

  test("returns cached merged result instead of running a second real merge", async () => {
    let calls = 0
    const mergeBack = createMergeBackSingleFlight(async () => {
      calls += 1
      return { status: "merged" as const, primary_head: `head-${calls}` }
    })

    await expect(mergeBack()).resolves.toEqual({ status: "merged", primary_head: "head-1" })
    await expect(mergeBack()).resolves.toEqual({ status: "merged", primary_head: "head-1" })
    expect(calls).toBe(1)
  })

  test("allows a later retry after a non-merged outcome", async () => {
    let calls = 0
    const mergeBack = createMergeBackSingleFlight(async () => {
      calls += 1
      return calls === 1
        ? { status: "blocked" as const, reason: "dirty" }
        : { status: "merged" as const, primary_head: "fixed" }
    })

    await expect(mergeBack()).resolves.toEqual({ status: "blocked", reason: "dirty" })
    await expect(mergeBack()).resolves.toEqual({ status: "merged", primary_head: "fixed" })
    expect(calls).toBe(2)
  })
})
