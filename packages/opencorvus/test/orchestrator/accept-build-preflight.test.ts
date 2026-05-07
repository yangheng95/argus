import { describe, expect, test } from "bun:test"
import { preflightAcceptBuild } from "../../src/orchestrator/tools"

/**
 * Spec build-missing-terminal-review-downgrade-2026-05-07.md §5.2 + §5.3.
 *
 * `preflightAcceptBuild` is the data-shape rejection layer for
 * `accept_build`. It catches the cases that don't require IO before the
 * tool burns time on Worktree.isValid / git diff / Worktree.mergeSafely.
 *
 * Codex round-2 BLOCKING B-1 fix: contract-violation detection is now
 * by **typed decision_log key** (`latestContractViolationKey ===
 * "build_agent_contract_violation"`) instead of error-string substring
 * match. The execute caller does the IO read of decision_log; preflight
 * stays pure + typed (rule 20 — no keyword-match rule logic).
 *
 * Reject paths covered here:
 *   - goal not found
 *   - no goal_run history
 *   - latest goal_run not in failed state
 *   - no build_agent_contract_violation decision_log entry for this goal
 *   - no recorded worktree directory or branch
 *   - no recorded baseRef
 *
 * Happy path: returns extracted worktree triple for the IO layer to use.
 */

describe("preflightAcceptBuild", () => {
  const baseInput = {
    goalID: "gol_x",
    goalExists: true,
    latestGoalRun: { status: "failed" },
    latestContractViolationKey: "build_agent_contract_violation",
    recordedWorkspace: {
      directory: "C:/tmp/worktree/goal-x",
      branch: "goal-x",
      baseRef: "abc123def456",
    },
  }

  test("happy path: typed contract-violation key + intact worktree triple → ok=true", () => {
    const result = preflightAcceptBuild(baseInput)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.worktreeDir).toBe("C:/tmp/worktree/goal-x")
      expect(result.worktreeBranch).toBe("goal-x")
      expect(result.worktreeBaseRef).toBe("abc123def456")
    }
  })

  test("rejects when goalExists=false", () => {
    const result = preflightAcceptBuild({ ...baseInput, goalExists: false })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("goal gol_x not found")
    }
  })

  test("rejects when no goal_run history", () => {
    const result = preflightAcceptBuild({ ...baseInput, latestGoalRun: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no goal_run history")
      expect(result.message).toContain("Run build({ goalID }) first")
    }
  })

  test("rejects when latest goal_run is in 'completed' state (not failed)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: { status: "completed" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("state 'completed', not 'failed'")
    }
  })

  test("rejects when latest goal_run is in live state ('running')", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: { status: "running" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("state 'running', not 'failed'")
    }
  })

  test("rejects when latestContractViolationKey is undefined (no decision_log entry)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestContractViolationKey: undefined,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("not a missing-terminal contract violation")
      expect(result.message).toContain("no build_agent_contract_violation decision_log entry")
    }
  })

  test("rejects when latestContractViolationKey is some other phase=retry key (e.g. modify_goal generic)", () => {
    // modify_goal writes phase=retry with key="retry_analysis_<goalID>".
    // accept_build is scoped to build_agent_contract_violation only.
    const result = preflightAcceptBuild({
      ...baseInput,
      latestContractViolationKey: "retry_analysis_gol_x",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("not a missing-terminal contract violation")
    }
  })

  test("rejects when recorded worktree directory is missing", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      recordedWorkspace: { directory: null, branch: "goal-x", baseRef: "abc123" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no recorded worktree")
      expect(result.message).toContain("directory=null")
    }
  })

  test("rejects when recorded worktree branch is missing", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      recordedWorkspace: { directory: "C:/tmp/x", branch: null, baseRef: "abc123" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no recorded worktree")
      expect(result.message).toContain("branch=null")
    }
  })

  test("rejects when recorded directory is whitespace-only (trim catches empty)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      recordedWorkspace: { directory: "   ", branch: "goal-x", baseRef: "abc123" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no recorded worktree")
    }
  })

  test("rejects when recorded baseRef is missing (null)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      recordedWorkspace: { directory: "C:/tmp/x", branch: "goal-x", baseRef: null },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no recorded baseRef")
      expect(result.message).toContain("re-establish the contribution base")
    }
  })

  test("rejects when recorded baseRef is undefined", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      recordedWorkspace: { directory: "C:/tmp/x", branch: "goal-x", baseRef: undefined },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no recorded baseRef")
    }
  })

  test("invariant order — goal-not-found rejects before goal_run check (defence-in-depth)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      goalExists: false,
      latestGoalRun: null, // both invariants fail; goal-not-found wins
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("goal gol_x not found")
      expect(result.message).not.toContain("no goal_run history")
    }
  })

  test("invariant order — status check rejects before contract-violation key check", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: { status: "completed" },
      latestContractViolationKey: "build_agent_contract_violation", // would pass key check, but status check first
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("not 'failed'")
      expect(result.message).not.toContain("not a missing-terminal contract violation")
    }
  })

  test("rule 20 — no error-string substring matching (regression pin)", () => {
    // The B-1 fix replaced `errStr.includes("missing_terminal_report") ||
    // errStr.includes("BuildAgentContractError")` with a typed decision_log
    // key check. Pin: an error string that DOES contain those substrings
    // but where the decision_log key is undefined → still rejects. This
    // proves the matcher is no longer doing keyword detection and that
    // the prior unit-test fixtures' fake error strings are no longer
    // load-bearing.
    const result = preflightAcceptBuild({
      ...baseInput,
      latestContractViolationKey: undefined,
      // This fixture's old "error" content lives nowhere in the new shape;
      // the typed key is the single source of truth.
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("no build_agent_contract_violation decision_log entry")
    }
  })
})
