import { describe, expect, test } from "bun:test"
import { isGoalDispatchable } from "../../src/goal/readiness"
import type { GoalRow, GoalRunRow } from "../../src/engine"

function goal(id: string, extras?: Partial<GoalRow>): GoalRow {
  return {
    id,
    task_id: "task_1",
    plan_version_id: "plan_1",
    spec_snapshot_id: null,
    milestone_id: null,
    title: id,
    slug: id,
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
    retry_count: 0,
    order_index: 0,
    workspace_dir: null,
    workspace_branch: null,
    workspace_base_ref: null,
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
    supersede_of: null,
    superseded_reason: null,
    superseded_at: null,
    metadata: null,
    time_started: null,
    time_completed: null,
    last_progress_at: null,
    time_created: 0,
    time_updated: 0,
  } as GoalRunRow
}

describe("isGoalDispatchable — task-scoped tip history", () => {
  test("completed goal_run from a prior run blocks re-dispatch", () => {
    const g = goal("gol_bootstrap")
    const runs = [goalRun("gol_bootstrap", "completed", "run_1")]
    expect(isGoalDispatchable(g, runs)).toBe(false)
  })

  test("dependent goal is dispatchable when its dep completed in a prior run", () => {
    const depGoal = goal("gol_bootstrap")
    const dependent = goal("gol_layout", { depends_on: ["gol_bootstrap"] })
    const runs = [goalRun("gol_bootstrap", "completed", "run_1")]
    expect(isGoalDispatchable(depGoal, runs)).toBe(false)
    expect(isGoalDispatchable(dependent, runs)).toBe(true)
  })

  test("aborted goal_run is retriable — non-satisfying terminal tip allows re-dispatch", () => {
    const g = goal("gol_x")
    const runs = [goalRun("gol_x", "aborted", "run_1")]
    expect(isGoalDispatchable(g, runs)).toBe(true)
  })

  test("running goal_run blocks re-dispatch", () => {
    const g = goal("gol_x")
    const runs = [goalRun("gol_x", "running", "run_1")]
    expect(isGoalDispatchable(g, runs)).toBe(false)
  })

  test("failed goal_run allows re-dispatch (retriable)", () => {
    const g = goal("gol_x")
    const runs = [goalRun("gol_x", "failed", "run_1")]
    expect(isGoalDispatchable(g, runs)).toBe(true)
  })

  test("verification-kind goal dispatches like any other goal (no kind-based exclusion)", () => {
    const g = goal("gol_tests", { kind: "verification" })
    expect(isGoalDispatchable(g, [])).toBe(true)
  })

  test("dependent goal is blocked while its dep is still running", () => {
    const dep = goal("gol_bootstrap")
    const dependent = goal("gol_layout", { depends_on: ["gol_bootstrap"] })
    const runs = [goalRun("gol_bootstrap", "running", "run_1")]
    expect(isGoalDispatchable(dep, runs)).toBe(false)
    expect(isGoalDispatchable(dependent, runs)).toBe(false)
  })
})
