import { describe, expect, test } from "bun:test"
import { renderTaskDescription, type TaskDesc } from "../../src/engine/describe"

describe("describe build terminal report recovery", () => {
  test("tells orchestrator to retry missing report_build_result instead of restarting plan for diagnostic worktree files", () => {
    const desc: TaskDesc = {
      id: "tsk_report_hint",
      title: "Report hint",
      kind: "workflow",
      status: "active",
      request: "Build app",
      goals: [{
        id: "gol_report_hint",
        title: "Bootstrap app",
        kind: "bootstrap",
        priority: "blocking",
        objective: "Create the app scaffold",
        acceptance_summary: "build succeeds",
        owned_paths: ["package.json", "src/main.ts"],
        depends_on: [],
        exports: [],
        imports: [],
        attempts: [{
          goal_run_id: "gr_report_hint",
          outcome: "failed",
          error: "Build agent terminated without a valid report_build_result tool call",
        }],
        attempt_count: 1,
        latest_attempt: {
          goal_run_id: "gr_report_hint",
          outcome: "failed",
          error: "Build agent terminated without a valid report_build_result tool call",
        },
        is_running: false,
        is_terminal_ok: false,
        is_terminal_fail: true,
        is_aborted: false,
        needs_redispatch: false,
        never_dispatched: false,
      }],
      budget: {
        runs_used: 1,
        max_runs: 8,
        fix_count: 0,
        max_fix_runs: 2,
      },
      iterations_count: 0,
    }

    const md = renderTaskDescription(desc)
    expect(md).toContain("Build ended without structured report_build_result")
    expect(md).toContain(".opencorvus/worktrees")
    expect(md).toContain("not primary workspace pollution")
    expect(md).toContain("do not restart_from_stage solely because diagnostic worktree files exist")
  })
})
