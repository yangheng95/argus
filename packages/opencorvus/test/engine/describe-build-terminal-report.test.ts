import { describe, expect, test } from "bun:test"
import { renderTaskDescription, type TaskDesc } from "../../src/engine/describe"

describe("describe build terminal report failure", () => {
  test("tells orchestrator to retry with explicit terminal report instructions", () => {
    const desc: TaskDesc = {
      id: "tsk_report_hint",
      title: "Report hint",
      kind: "workflow",
      status: "active",
      request: "Build app",
      goals: [
        {
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
          attempts: [
            {
              goal_run_id: "gr_report_hint",
              outcome: "failed",
              error: "Build agent terminated without a valid report_build_result tool call",
            },
          ],
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
        },
      ],
      budget: {
        runs_used: 1,
        fix_count: 0,
        max_executor_groups: 3,
      },
      iterations_count: 0,
    }

    const md = renderTaskDescription(desc)
    expect(md).toContain("Build ended without a structured report_build_result terminal call")
    expect(md).toContain(".opencorvus/runtime")
    expect(md).toContain("not primary workspace pollution")
    expect(md).toContain("Retry this goal with explicit report_build_result(files_changed[]) instructions")
    expect(md).toContain("do not restart_from_stage solely because diagnostic worktree files exist")
  })
})
