import { describe, expect, test } from "bun:test"
import { preflightAcceptBuild } from "../../src/orchestrator/tools"

/**
 * Spec build-missing-terminal-review-downgrade-2026-05-07.md §5.2 + §5.3.
 *
 * `preflightAcceptBuild` is the data-shape rejection layer for
 * `accept_build`. It catches the cases that don't require IO before the
 * tool burns time on Worktree.isValid / git diff / Worktree.mergeSafely.
 *
 * Reject paths covered here:
 *   - goal not found
 *   - no goal_run history
 *   - latest goal_run not in failed state
 *   - latest failure is not a missing-terminal contract violation
 *   - no recorded worktree directory or branch
 *   - no recorded baseRef
 *
 * Happy path: returns extracted worktree triple for the IO layer to use.
 */

describe("preflightAcceptBuild", () => {
  const baseInput = {
    goalID: "gol_x",
    goalExists: true,
    latestGoalRun: {
      status: "failed",
      error:
        "AgentRunError: [build] LLM error during build: BuildAgentContractError: Previous build session ended with finish=stop without producing the terminal build report. ...",
    },
    recordedWorkspace: {
      directory: "C:/tmp/worktree/goal-x",
      branch: "goal-x",
      baseRef: "abc123def456",
    },
  }

  test("happy path: missing-terminal failure with intact worktree triple → ok=true", () => {
    const result = preflightAcceptBuild(baseInput)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.worktreeDir).toBe("C:/tmp/worktree/goal-x")
      expect(result.worktreeBranch).toBe("goal-x")
      expect(result.worktreeBaseRef).toBe("abc123def456")
    }
  })

  test("recognises BuildAgentContractError marker in error string", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: {
        status: "failed",
        error: "BuildAgentContractError: code=missing_terminal_report; sessionID=ses_abc",
      },
    })
    expect(result.ok).toBe(true)
  })

  test("recognises missing_terminal_report marker in error string", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: {
        status: "failed",
        error: "code=missing_terminal_report fired in catch path",
      },
    })
    expect(result.ok).toBe(true)
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
      latestGoalRun: { status: "completed", error: null },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("state 'completed', not 'failed'")
    }
  })

  test("rejects when latest goal_run is in live state ('running')", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: { status: "running", error: null },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("state 'running', not 'failed'")
    }
  })

  test("rejects when latest failure is a generic build error (not missing-terminal)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: {
        status: "failed",
        error: "AgentRunError: [build] LLM error during build: APIError: stream interrupted",
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("not a missing-terminal contract violation")
      expect(result.message).toContain("Use build({ goalID }) retry / modify_goal / fail_task")
    }
  })

  test("rejects when failure error is null/empty (defensive)", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: { status: "failed", error: null },
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

  test("rejects when recorded baseRef is missing", () => {
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

  test("invariant order — status check rejects before missing_terminal marker check", () => {
    const result = preflightAcceptBuild({
      ...baseInput,
      latestGoalRun: {
        status: "completed",
        error: "code=missing_terminal_report", // would match missing-terminal but status check first
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("not 'failed'")
      expect(result.message).not.toContain("not a missing-terminal contract violation")
    }
  })
})
