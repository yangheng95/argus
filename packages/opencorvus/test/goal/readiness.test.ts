import { describe, expect, test } from "bun:test"
import { readyGoalNodes } from "../../src/goal/readiness"
import type { GoalRow, GoalRunRow, PlanNodeRow } from "../../src/engine"

// ── Fixture builders ────────────────────────────────────────────────────────

function planNode(id: string, goal_id: string, depends_on_ids?: string[]): PlanNodeRow {
  return {
    id,
    task_id: "task_1",
    plan_version_id: "plan_1",
    kind: "goal",
    goal_id,
    title: id,
    brief: "",
    depends_on_ids,
    order_index: 0,
    metadata: {},
    time_created: 0,
    time_updated: 0,
  } as PlanNodeRow
}

function goal(id: string, status: GoalRow["status"] = "pending", extras?: Partial<GoalRow>): GoalRow {
  return {
    id,
    task_id: "task_1",
    plan_version_id: "plan_1",
    spec_snapshot_id: null,
    milestone_id: null,
    title: id,
    objective: "",
    acceptance_specs: [],
    owned_paths: [],
    depends_on: [],
    exports: [],
    imports: [],
    kind: "feature",
    requirement_ids: [],
    priority: "blocking",
    source: "spec",
    status,
    retry_count: 0,
    order_index: 0,
    metadata: null,
    time_created: 0,
    time_updated: 0,
    ...extras,
  } as GoalRow
}

function goalRun(goal_id: string, status: GoalRunRow["status"], coordinator_run_id = "run_1"): GoalRunRow {
  return {
    id: `glr_${goal_id}_${status}_${coordinator_run_id}`,
    task_id: "task_1",
    goal_id,
    plan_node_id: null,
    coordinator_run_id,
    session_id: null,
    executor: "opencode",
    status,
    retry_count: 0,
    blocking_reason: null,
    error: null,
    workspace_dir: null,
    base_ref: null,
    merge_ref: null,
    metadata: null,
    lease_until: null,
    time_started: 0,
    time_completed: 0,
    time_created: 0,
    time_updated: 0,
  } as GoalRunRow
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("readyGoalNodes — multi-run task history", () => {
  test("a completed goal_run in a PRIOR run blocks re-dispatch of the same goal", () => {
    // This is the regression for tsk_d9bc59062001xuMSbxYap8hY5t: goal_bootstrap
    // completed in run_1, the orchestrator started run_2, and the readiness
    // check (previously run-scoped) lost sight of run_1's completed goal_run.
    // Fix: the call site in GoalPool now passes TASK-scoped goal_runs so the
    // prior completed run is visible and the goal is not re-queued.
    const nodes = [planNode("pn_bootstrap", "gol_bootstrap")]
    const goals = [goal("gol_bootstrap", "passed")]
    const priorRuns = [goalRun("gol_bootstrap", "completed", "run_1")]

    const ready = readyGoalNodes(nodes, goals, priorRuns)
    expect(ready.map((r) => r.goal.id)).toEqual([])
  })

  test("a dependent goal is ready when its dep completed in a prior run", () => {
    // Forward-progress case: bootstrap passed in run_1; the orchestrator is
    // dispatching downstream goals in run_2. The dep lookup must see the
    // prior completed run or downstream work never unblocks.
    const nodes = [
      planNode("pn_bootstrap", "gol_bootstrap"),
      planNode("pn_layout", "gol_layout", ["pn_bootstrap"]),
    ]
    const goals = [goal("gol_bootstrap", "passed"), goal("gol_layout", "pending")]
    const taskRuns = [goalRun("gol_bootstrap", "completed", "run_1")]

    const ready = readyGoalNodes(nodes, goals, taskRuns)
    expect(ready.map((r) => r.goal.id)).toEqual(["gol_layout"])
  })

  test("aborted goal_run is retriable — goal may re-dispatch after modify_goal", () => {
    // modify_goal now marks existing goal_runs as `aborted` when it resets the
    // goal's status. `aborted` is classified retriable, so readiness admits
    // the goal for a fresh dispatch even though history is task-scoped.
    const nodes = [planNode("pn_g", "gol_x")]
    const goals = [goal("gol_x", "pending")]
    const taskRuns = [goalRun("gol_x", "aborted", "run_1")]

    const ready = readyGoalNodes(nodes, goals, taskRuns)
    expect(ready.map((r) => r.goal.id)).toEqual(["gol_x"])
  })

  test("running goal_run blocks re-dispatch in the same run", () => {
    const nodes = [planNode("pn_g", "gol_x")]
    const goals = [goal("gol_x", "running")]
    const liveRuns = [goalRun("gol_x", "running", "run_1")]

    const ready = readyGoalNodes(nodes, goals, liveRuns)
    expect(ready.map((r) => r.goal.id)).toEqual([])
  })

  test("failed goal_run allows re-dispatch (retriable classifier)", () => {
    const nodes = [planNode("pn_g", "gol_x")]
    const goals = [goal("gol_x", "failed")]
    const failedRuns = [goalRun("gol_x", "failed", "run_1")]

    const ready = readyGoalNodes(nodes, goals, failedRuns)
    expect(ready.map((r) => r.goal.id)).toEqual(["gol_x"])
  })
})
