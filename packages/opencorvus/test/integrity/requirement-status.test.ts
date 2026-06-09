import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { AcceptanceSpec } from "../../src/acceptance/types"
import type { EngineGoalRunStatus } from "../../src/engine/engine.sql"
import { computeRequirementStatusSnapshot, type RequirementStatusDeps } from "../../src/integrity/requirement-status"

/**
 * Pure-projection tests for `computeRequirementStatusSnapshot`. Deps are
 * passed in directly so tests don't `mock.module()` the engine store —
 * that approach leaks the mock across the Bun test runner's pooled processes
 * and breaks unrelated suites that legitimately rely on the real store.
 */

type RequirementRowStub = {
  id: string
  description: string
  metadata: Record<string, unknown> | null
}

type GoalRowStub = {
  id: string
  title: string
  spec_snapshot_id: string
  requirement_ids: string[]
  acceptance_specs: AcceptanceSpec[]
}

type GoalRunRowStub = { id: string; status: EngineGoalRunStatus } | undefined
type EvidenceRowStub =
  | {
      checks: Array<{ spec_id?: string; status: "passed" | "failed" | "skipped"; evidence?: string }>
    }
  | undefined

let requirementsByID: Record<string, RequirementRowStub[]> = {}
let goalsByTask: Record<string, GoalRowStub[]> = {}
let tipRunByGoal: Record<string, GoalRunRowStub> = {}
let evidenceByGoalRun: Record<string, EvidenceRowStub> = {}

function makeDeps(): RequirementStatusDeps {
  return {
    findRequirements: (specSnapshotID: string) =>
      (requirementsByID[specSnapshotID] ?? []) as unknown as ReturnType<RequirementStatusDeps["findRequirements"]>,
    listGoals: (taskID: string) =>
      (goalsByTask[taskID] ?? []) as unknown as ReturnType<RequirementStatusDeps["listGoals"]>,
    findLatestTipGoalRun: (goalID: string) =>
      tipRunByGoal[goalID] as unknown as ReturnType<RequirementStatusDeps["findLatestTipGoalRun"]>,
    findGoalRunEvidence: (goalRunID: string) =>
      evidenceByGoalRun[goalRunID] as unknown as ReturnType<RequirementStatusDeps["findGoalRunEvidence"]>,
  }
}

beforeEach(() => {
  requirementsByID = {}
  goalsByTask = {}
  tipRunByGoal = {}
  evidenceByGoalRun = {}
})

afterEach(() => {
  requirementsByID = {}
  goalsByTask = {}
  tipRunByGoal = {}
  evidenceByGoalRun = {}
})

function makeAcceptanceSpec(input: {
  id: string
  goalID: string
  reqID: string
  severity?: AcceptanceSpec["severity"]
}): AcceptanceSpec {
  return {
    id: input.id,
    source_requirement_id: input.reqID,
    goal_id: input.goalID,
    title: input.id,
    severity: input.severity ?? "essential",
    scorers: [{ type: "heuristic", name: input.id, spec: { kind: "shell", cmd: "true" } }],
  }
}

describe("computeRequirementStatusSnapshot", () => {
  test("REQ-N is read from metadata.source_requirement_id, not the internal row id", () => {
    requirementsByID["spec1"] = [
      { id: "rq_internal_1", description: "Show stock dashboard", metadata: { source_requirement_id: "REQ-1" } },
    ]
    goalsByTask["task1"] = [
      {
        id: "goal_fe",
        title: "Frontend page",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-1"],
        acceptance_specs: [makeAcceptanceSpec({ id: "acc-fe-1", goalID: "goal_fe", reqID: "REQ-1" })],
      },
    ]
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    expect(snap).toHaveLength(1)
    expect(snap[0].reqID).toBe("REQ-1")
    expect(snap[0].claimingGoals).toHaveLength(1)
    expect(snap[0].claimingGoals[0].goalID).toBe("goal_fe")
  })

  test("REQ-N falls back to internal id when metadata.source_requirement_id is missing", () => {
    requirementsByID["spec1"] = [{ id: "rq_legacy_42", description: "Legacy REQ without metadata", metadata: null }]
    goalsByTask["task1"] = [
      {
        id: "goal_legacy",
        title: "Legacy goal",
        spec_snapshot_id: "spec1",
        requirement_ids: ["rq_legacy_42"],
        acceptance_specs: [],
      },
    ]
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    expect(snap[0].reqID).toBe("rq_legacy_42")
    expect(snap[0].claimingGoals[0].goalID).toBe("goal_legacy")
  })

  test("REQ unmatched by any goal has empty claimingGoals (uncovered surfaces via fidelity, not snapshot)", () => {
    requirementsByID["spec1"] = [{ id: "rq_a", description: "REQ-A", metadata: { source_requirement_id: "REQ-A" } }]
    goalsByTask["task1"] = [
      {
        id: "goal_other",
        title: "Other goal",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-OTHER"],
        acceptance_specs: [],
      },
    ]
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    expect(snap).toHaveLength(1)
    expect(snap[0].claimingGoals).toEqual([])
  })

  test("only goals on the same spec snapshot are joined", () => {
    requirementsByID["spec1"] = [{ id: "rq_a", description: "REQ-A", metadata: { source_requirement_id: "REQ-A" } }]
    goalsByTask["task1"] = [
      {
        id: "goal_other_snapshot",
        title: "Wrong snapshot",
        spec_snapshot_id: "spec_other",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [],
      },
      {
        id: "goal_correct",
        title: "Correct snapshot",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [],
      },
    ]
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    expect(snap[0].claimingGoals.map((g) => g.goalID)).toEqual(["goal_correct"])
  })

  test("runStatus comes from goal_run row, not from evidence; missing tip run yields 'unstarted'", () => {
    requirementsByID["spec1"] = [{ id: "rq_a", description: "REQ-A", metadata: { source_requirement_id: "REQ-A" } }]
    goalsByTask["task1"] = [
      {
        id: "goal_running",
        title: "running goal",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [],
      },
      {
        id: "goal_idle",
        title: "idle goal",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [],
      },
    ]
    tipRunByGoal["goal_running"] = { id: "run_running", status: "running" }
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    const byGoal = Object.fromEntries(snap[0].claimingGoals.map((g) => [g.goalID, g.runStatus]))
    expect(byGoal["goal_running"]).toBe("running")
    expect(byGoal["goal_idle"]).toBe("unstarted")
  })

  test("two-step spec join: only acceptance_specs whose source_requirement_id matches the REQ surface, then their evidence is looked up by spec_id", () => {
    requirementsByID["spec1"] = [{ id: "rq_a", description: "REQ-A", metadata: { source_requirement_id: "REQ-A" } }]
    goalsByTask["task1"] = [
      {
        id: "goal_be",
        title: "backend",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [
          makeAcceptanceSpec({ id: "acc-be-1", goalID: "goal_be", reqID: "REQ-A", severity: "essential" }),
          makeAcceptanceSpec({ id: "acc-be-2", goalID: "goal_be", reqID: "REQ-OTHER", severity: "essential" }),
          makeAcceptanceSpec({ id: "acc-be-3", goalID: "goal_be", reqID: "REQ-A", severity: "important" }),
        ],
      },
    ]
    tipRunByGoal["goal_be"] = { id: "run_be", status: "completed" }
    evidenceByGoalRun["run_be"] = {
      checks: [
        { spec_id: "acc-be-1", status: "passed", evidence: "ok" },
        { spec_id: "acc-be-2", status: "failed", evidence: "should not appear (different REQ)" },
        { spec_id: "acc-be-3", status: "failed", evidence: "smoke test failed" },
        { spec_id: "acc-other", status: "passed" },
      ],
    }
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    const outcomes = snap[0].claimingGoals[0].specOutcomes
    expect(outcomes.map((s) => s.specID).sort()).toEqual(["acc-be-1", "acc-be-3"])
    const byID = Object.fromEntries(outcomes.map((s) => [s.specID, s]))
    expect(byID["acc-be-1"].passed).toBe(true)
    expect(byID["acc-be-3"].passed).toBe(false)
    expect(byID["acc-be-3"].summary).toBe("smoke test failed")
  })

  test("evidence join uses tip goal_run, NOT a stale superseded run; passed=undefined when no checks for the spec", () => {
    requirementsByID["spec1"] = [{ id: "rq_a", description: "REQ-A", metadata: { source_requirement_id: "REQ-A" } }]
    goalsByTask["task1"] = [
      {
        id: "goal_retry",
        title: "retried goal",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [
          makeAcceptanceSpec({ id: "acc-retry-1", goalID: "goal_retry", reqID: "REQ-A", severity: "essential" }),
        ],
      },
    ]
    tipRunByGoal["goal_retry"] = { id: "run_fresh", status: "running" }
    evidenceByGoalRun["run_fresh"] = undefined
    evidenceByGoalRun["run_legacy_stale"] = {
      checks: [{ spec_id: "acc-retry-1", status: "passed" }],
    }
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    const outcome = snap[0].claimingGoals[0].specOutcomes[0]
    expect(outcome.passed).toBeUndefined()
    expect(snap[0].claimingGoals[0].runStatus).toBe("running")
  })

  test("multi-claim REQ: snapshot lists all claiming goals, each with its own runStatus + specOutcomes (host does not aggregate)", () => {
    requirementsByID["spec1"] = [{ id: "rq_a", description: "REQ-A", metadata: { source_requirement_id: "REQ-A" } }]
    goalsByTask["task1"] = [
      {
        id: "goal_fe",
        title: "fe",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [makeAcceptanceSpec({ id: "acc-fe", goalID: "goal_fe", reqID: "REQ-A" })],
      },
      {
        id: "goal_be",
        title: "be",
        spec_snapshot_id: "spec1",
        requirement_ids: ["REQ-A"],
        acceptance_specs: [makeAcceptanceSpec({ id: "acc-be", goalID: "goal_be", reqID: "REQ-A" })],
      },
    ]
    tipRunByGoal["goal_fe"] = { id: "run_fe", status: "completed" }
    tipRunByGoal["goal_be"] = { id: "run_be", status: "failed" }
    evidenceByGoalRun["run_fe"] = { checks: [{ spec_id: "acc-fe", status: "passed" }] }
    evidenceByGoalRun["run_be"] = { checks: [{ spec_id: "acc-be", status: "failed" }] }
    const snap = computeRequirementStatusSnapshot({ taskID: "task1", specSnapshotID: "spec1" }, makeDeps())
    expect(snap[0].claimingGoals).toHaveLength(2)
    const byGoal = Object.fromEntries(snap[0].claimingGoals.map((g) => [g.goalID, g]))
    expect(byGoal["goal_fe"].runStatus).toBe("completed")
    expect(byGoal["goal_fe"].specOutcomes[0].passed).toBe(true)
    expect(byGoal["goal_be"].runStatus).toBe("failed")
    expect(byGoal["goal_be"].specOutcomes[0].passed).toBe(false)
  })

  test("returns empty array when no requirements exist (pre-build path)", () => {
    const snap = computeRequirementStatusSnapshot({ taskID: "task_empty", specSnapshotID: "spec_empty" }, makeDeps())
    expect(snap).toEqual([])
  })
})
