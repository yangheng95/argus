import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  EngineIterationTable,
  EngineMetricSpecTable,
} from "../../src/metrics/metrics.sql"
import {
  MAX_CHALLENGE_PER_ITER,
  MAX_CHALLENGE_PER_TASK,
  MetricWriteError,
  addChallengeMetric,
  readResultsForIteration,
  readSpecsForTask,
  registerBaselineSpec,
  upsertCounterexample,
  writeIterationSnapshot,
  writeMetricResult,
} from "../../src/metrics/store"
import { computeIterationSnapshot } from "../../src/metrics/score"
import { eq } from "drizzle-orm"
import { resetDatabase } from "../fixture/db"

let projectID = ""
let taskID = ""

function seedProjectAndTask() {
  const now = Date.now()
  projectID = "prj_" + Math.random().toString(36).slice(2, 10)
  taskID = Identifier.ascending("task")
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        vcs: "git",
        name: "metrics-store-test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "metrics-store-test",
        request: "metrics store test",
        status: "active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function baselineInput(over: Partial<Parameters<typeof registerBaselineSpec>[0]> = {}) {
  return {
    task_id: taskID,
    scope: "global" as const,
    goal_id: null,
    name: "user_intent_fidelity",
    description: "Do deliverables honor the original user intent?",
    unit: "ratio",
    direction: "higher_better" as const,
    target: 0.9,
    floor: 0.6,
    weight: 1.0,
    gate_class: "blocking" as const,
    evaluator_kind: "judge" as const,
    evaluator_config: { criteria: "match request intent" },
    source_requirement_ids: ["REQ-1"],
    ...over,
  }
}

function challengeInput(
  iteration: number,
  over: Partial<Parameters<typeof addChallengeMetric>[0]> = {},
) {
  return {
    task_id: taskID,
    scope: "global" as const,
    goal_id: null,
    name: `challenge_${iteration}_${Math.random().toString(36).slice(2, 6)}`,
    description: "probe",
    unit: "ratio",
    direction: "higher_better" as const,
    target: 0.8,
    floor: 0.5,
    weight: 0.5,
    evaluator_kind: "judge" as const,
    evaluator_config: {},
    source_requirement_ids: [],
    iteration,
    ...over,
  }
}

beforeEach(async () => {
  await resetDatabase()
  seedProjectAndTask()
})

afterEach(async () => {
  await resetDatabase()
})

describe("registerBaselineSpec", () => {
  test("inserts a baseline spec with frozen_at set", () => {
    const row = registerBaselineSpec(baselineInput())
    expect(row.source).toBe("baseline")
    expect(row.created_by).toBe("architect")
    expect(row.frozen_at).toBeGreaterThan(0)
    expect(readSpecsForTask(taskID)).toHaveLength(1)
  })

  test("rejects scope='goal' with null goal_id", () => {
    expect(() =>
      registerBaselineSpec(baselineInput({ scope: "goal", goal_id: null })),
    ).toThrow()
  })

  test("rejects scope='global' with a goal_id", () => {
    expect(() =>
      registerBaselineSpec(baselineInput({ scope: "global", goal_id: "gol_x" })),
    ).toThrow()
  })

  test("refuses to insert once any iteration row exists", () => {
    // First insert is fine.
    registerBaselineSpec(baselineInput())
    // Simulate "modeling window closed" by writing an iteration row directly.
    writeIterationSnapshot({
      task_id: taskID,
      iteration: 0,
      aggregate_score: 0,
      per_goal_score: {},
      global_score: 0,
      delta_vs_prev: 0,
      novelty_score: 0,
      blocking_unmet_count: 1,
      open_counterexamples: 0,
      regressed_blocking: 0,
      arbiter_verdict: "continue",
    })
    try {
      registerBaselineSpec(baselineInput({ name: "another" }))
      throw new Error("should not reach")
    } catch (err) {
      expect(err).toBeInstanceOf(MetricWriteError)
      if (err instanceof MetricWriteError) {
        expect(err.data.code).toBe("modeling_window_closed")
      }
    }
  })
})

describe("baseline frozen-ruler — DB-level trigger", () => {
  test("UPDATE on a baseline row raises", () => {
    const row = registerBaselineSpec(baselineInput())
    // The drizzle update would normally succeed; the trigger must abort it.
    expect(() =>
      Database.use((db) =>
        db
          .update(EngineMetricSpecTable)
          .set({ weight: 99 })
          .where(eq(EngineMetricSpecTable.id, row.id))
          .run(),
      ),
    ).toThrow(/baseline row is frozen/)
  })

  test("UPDATE on a challenge row is allowed", () => {
    const challenge = addChallengeMetric(challengeInput(0))
    Database.use((db) =>
      db
        .update(EngineMetricSpecTable)
        .set({ weight: 0.25 })
        .where(eq(EngineMetricSpecTable.id, challenge.id))
        .run(),
    )
    const refreshed = Database.use((db) =>
      db
        .select()
        .from(EngineMetricSpecTable)
        .where(eq(EngineMetricSpecTable.id, challenge.id))
        .get(),
    )
    expect(refreshed?.weight).toBe(0.25)
  })
})

describe("addChallengeMetric — budgets and gate-class lock", () => {
  test("gate_class is always diagnostic regardless of caller", () => {
    const row = addChallengeMetric(challengeInput(0))
    expect(row.gate_class).toBe("diagnostic")
    expect(row.source).toBe("challenge")
    expect(row.created_by).toBe("prosecutor")
  })

  test("K=1 per iteration: second challenge in same iter rejected", () => {
    addChallengeMetric(challengeInput(0, { name: "c0a" }))
    try {
      addChallengeMetric(challengeInput(0, { name: "c0b" }))
      throw new Error("should not reach")
    } catch (err) {
      expect(err).toBeInstanceOf(MetricWriteError)
      if (err instanceof MetricWriteError) {
        expect(err.data.code).toBe("challenge_budget_iteration")
      }
    }
  })

  test("≤3 per task total across iterations", () => {
    addChallengeMetric(challengeInput(0))
    addChallengeMetric(challengeInput(1))
    addChallengeMetric(challengeInput(2))
    try {
      addChallengeMetric(challengeInput(3))
      throw new Error("should not reach")
    } catch (err) {
      expect(err).toBeInstanceOf(MetricWriteError)
      if (err instanceof MetricWriteError) {
        expect(err.data.code).toBe("challenge_budget_task")
      }
    }
  })

  test("constants are the documented values", () => {
    expect(MAX_CHALLENGE_PER_ITER).toBe(1)
    expect(MAX_CHALLENGE_PER_TASK).toBe(3)
  })

  test("MetricWriteError carries the violation code", () => {
    addChallengeMetric(challengeInput(0))
    try {
      addChallengeMetric(challengeInput(0))
      throw new Error("should not reach")
    } catch (err) {
      expect(err).toBeInstanceOf(MetricWriteError)
      if (err instanceof MetricWriteError) {
        expect(err.data.code).toBe("challenge_budget_iteration")
      }
    }
  })
})

describe("upsertCounterexample — novelty dedup", () => {
  test("same novelty_hash on same task returns the existing row without new insert", () => {
    const a = upsertCounterexample({
      task_id: taskID,
      iteration_found: 0,
      novelty_hash: "dup-hash",
      target_scope: "global",
      target_ref: "intent",
      claim: "first",
      reproducer: "curl /foo",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    const b = upsertCounterexample({
      task_id: taskID,
      iteration_found: 5,
      novelty_hash: "dup-hash",
      target_scope: "global",
      target_ref: "intent",
      claim: "second",
      reproducer: "curl /bar",
      severity: "diagnostic",
      linked_metric_spec_id: null,
    })
    expect(b.id).toBe(a.id)
    expect(b.iteration_found).toBe(0)
    expect(b.claim).toBe("first")
  })
})

describe("computeIterationSnapshot + writeIterationSnapshot — integration", () => {
  test("baseline blocking unmet contributes to blocking_unmet_count; fresh-only contributes to score", () => {
    const spec = registerBaselineSpec(baselineInput({ weight: 1.0, target: 0.9 }))
    writeMetricResult({
      metric_spec_id: spec.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.4,
      normalized_value: 0.4,
      met_target: false,
      met_floor: false,
      evidence_ref: "evidence://iter0/run",
      evidence_fresh: true,
    })
    const snapshot = computeIterationSnapshot({
      task_id: taskID,
      iteration: 0,
      specs: readSpecsForTask(taskID),
      currentResults: readResultsForIteration(taskID, 0),
      previousResults: [],
      counterexamples: [],
      previousAggregateScore: 0,
    })
    // alpha=beta=0.5 defaults; only global scope contributes; per-goal=0.
    expect(snapshot.blocking_unmet_count).toBe(1)
    expect(snapshot.global_score).toBeCloseTo(0.4, 5)
    expect(snapshot.aggregate_score).toBeCloseTo(0.2, 5)
    // Writer round-trips.
    writeIterationSnapshot({ ...snapshot, arbiter_verdict: "continue" })
    const roundtrip = Database.use((db) =>
      db
        .select({
          iteration: EngineIterationTable.iteration,
          aggregate_score: EngineIterationTable.aggregate_score,
          blocking_unmet_count: EngineIterationTable.blocking_unmet_count,
        })
        .from(EngineIterationTable)
        .where(eq(EngineIterationTable.task_id, taskID))
        .all(),
    )
    expect(roundtrip).toHaveLength(1)
    expect(roundtrip[0].blocking_unmet_count).toBe(1)
  })

  test("evidence_fresh=false drops a result from the score", () => {
    const spec = registerBaselineSpec(baselineInput({ weight: 1.0 }))
    writeMetricResult({
      metric_spec_id: spec.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.95,
      normalized_value: 0.95,
      met_target: true,
      met_floor: true,
      evidence_ref: "cached",
      evidence_fresh: false,
    })
    const snapshot = computeIterationSnapshot({
      task_id: taskID,
      iteration: 0,
      specs: readSpecsForTask(taskID),
      currentResults: readResultsForIteration(taskID, 0),
      previousResults: [],
      counterexamples: [],
      previousAggregateScore: 0,
    })
    // Stale evidence means the metric doesn't contribute AND still counts
    // as blocking unmet.
    expect(snapshot.global_score).toBe(0)
    expect(snapshot.blocking_unmet_count).toBe(1)
  })
})
