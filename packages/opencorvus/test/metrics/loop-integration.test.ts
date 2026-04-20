/**
 * End-to-end smoke test for the DAM iteration loop.
 *
 * Exercises the full data path each deliver call walks: executeMetrics →
 * readIterationHistory → computeIterationSnapshot → arbitrate →
 * writeIterationSnapshot. No orchestrator tool wiring (that's manually
 * inspectable), but every piece of persistence + pure logic is exercised
 * through real DB with real tables.
 *
 * Covers three trajectories:
 *   - convergent → accept at iter N
 *   - flat → stalled at iter stalledN
 *   - regression cascade → abort
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "os"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable, EngineGoalTable } from "../../src/engine/engine.sql"
import {
  executeMetrics,
  type JudgeRunner,
} from "../../src/metrics/executor"
import { ARBITER_DEFAULTS, arbitrate } from "../../src/metrics/arbiter"
import { computeIterationSnapshot } from "../../src/metrics/score"
import {
  readCounterexamplesForTask,
  readIterationHistory,
  readPreviousAggregateScore,
  readResultsForIteration,
  readSpecsForTask,
  registerBaselineSpec,
  upsertCounterexample,
  writeIterationSnapshot,
} from "../../src/metrics/store"
import { resetDatabase } from "../fixture/db"

let projectID = ""
let taskID = ""
let goalID = ""

function seed() {
  const now = Date.now()
  projectID = "prj_" + Math.random().toString(36).slice(2, 10)
  taskID = Identifier.ascending("task")
  goalID = Identifier.ascending("goal")
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: os.tmpdir(),
        vcs: "git",
        name: "dam-integration",
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
        title: "dam-integration",
        request: "prove the DAM loop works end-to-end",
        status: "active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "primary goal",
        slug: "primary-goal",
        objective: "make the thing work",
        acceptance_specs: [],
        owned_paths: [],
        depends_on: [],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        status: "running",
        retry_count: 0,
        order_index: 0,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function registerMandatoryRuler() {
  // One per-goal blocking judge metric + one global blocking judge metric.
  // Judge because that's the default for user_intent_fidelity etc, and it
  // lets tests drive the scoreboard by swapping the judge runner.
  registerBaselineSpec({
    task_id: taskID,
    scope: "goal",
    goal_id: goalID,
    name: "functional_correctness",
    description: "does the goal work",
    unit: "ratio",
    direction: "higher_better",
    target: 1,
    floor: 0.8,
    weight: 1,
    gate_class: "blocking",
    evaluator_kind: "judge",
    evaluator_config: { criteria: "does goal meet its objective" },
    source_requirement_ids: [],
  })
  registerBaselineSpec({
    task_id: taskID,
    scope: "global",
    goal_id: null,
    name: "user_intent_fidelity",
    description: "does the whole delivery honor user intent",
    unit: "ratio",
    direction: "higher_better",
    target: 1,
    floor: 0.8,
    weight: 1,
    gate_class: "blocking",
    evaluator_kind: "judge",
    evaluator_config: { criteria: "delivery matches user intent" },
    source_requirement_ids: [],
  })
}

async function runIteration(opts: {
  iteration: number
  judge: JudgeRunner
}): Promise<{ verdict: string; aggregate: number }> {
  await executeMetrics(
    { task_id: taskID, iteration: opts.iteration },
    { judge: opts.judge, workDir: os.tmpdir() },
  )
  const specs = readSpecsForTask(taskID)
  const currentResults = readResultsForIteration(taskID, opts.iteration)
  const previousResults =
    opts.iteration > 0 ? readResultsForIteration(taskID, opts.iteration - 1) : []
  const counterexamples = readCounterexamplesForTask(taskID)
  const previousAggregateScore = readPreviousAggregateScore(taskID, opts.iteration)
  const history = readIterationHistory(taskID)
  const snapshot = computeIterationSnapshot({
    task_id: taskID,
    iteration: opts.iteration,
    specs,
    currentResults,
    previousResults,
    counterexamples,
    previousAggregateScore,
  })
  const decision = arbitrate([...history, snapshot], ARBITER_DEFAULTS)
  writeIterationSnapshot({ ...snapshot, arbiter_verdict: decision.verdict })
  return { verdict: decision.verdict, aggregate: snapshot.aggregate_score }
}

beforeEach(async () => {
  await resetDatabase()
  seed()
  registerMandatoryRuler()
})

afterEach(async () => {
  await resetDatabase()
})

describe("DAM iteration loop — end-to-end", () => {
  test("trajectory converges: judge improves → arbiter accepts", async () => {
    // judge scores 0.6 → 0.85 → 1.0 across 3 iterations.
    const scores = [0.6, 0.85, 1.0]
    const judgeFactory = (score: number): JudgeRunner => async () => ({
      score,
      rationale: `score=${score}`,
    })
    const results = []
    for (let i = 0; i < 3; i++) {
      results.push(await runIteration({ iteration: i, judge: judgeFactory(scores[i]) }))
    }
    expect(results[0].verdict).toBe("continue")
    // Iter 1: blocking_unmet > 0 still (0.85 < floor 0.8? no, 0.85 ≥ 0.8 → met_floor=true;
    // but target=1 → met_target=false). So still continue.
    expect(results[1].verdict).toBe("continue")
    expect(results[2].verdict).toBe("accept")
    // Score monotonically rises.
    expect(results[2].aggregate).toBeGreaterThan(results[0].aggregate)
  })

  test("trajectory stalls: flat scoreboard + no novelty → stalled", async () => {
    const judge: JudgeRunner = async () => ({
      score: 0.7,
      rationale: "stuck at 0.7",
    })
    const decisions = []
    for (let i = 0; i < 4; i++) {
      decisions.push(await runIteration({ iteration: i, judge }))
    }
    // Iter 0: continue (blocking_unmet=2, no history for stalled)
    // Iter 1-2: continue (only 2 iters, need 3 flat)
    // Iter 3: stalled (last 3 flat + novelty=0 + blocking still unmet)
    const verdicts = decisions.map((d) => d.verdict)
    expect(verdicts[0]).toBe("continue")
    expect(verdicts[verdicts.length - 1]).toBe("stalled")
  })

  test("continue when novelty appears: counterexample filed mid-loop keeps loop alive", async () => {
    const judge: JudgeRunner = async () => ({ score: 0.7, rationale: "flat" })
    await runIteration({ iteration: 0, judge })
    await runIteration({ iteration: 1, judge })
    // Prosecutor files a counterexample on iteration 2 — novelty_score becomes 1
    upsertCounterexample({
      task_id: taskID,
      iteration_found: 2,
      novelty_hash: "probe-1",
      target_scope: "global",
      target_ref: "user_intent_fidelity",
      claim: "login endpoint returns 500 on empty password",
      reproducer: "curl -X POST /login -d 'password='",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    const dec = await runIteration({ iteration: 2, judge })
    // Even though judge is flat, novelty != 0 breaks the stalled condition.
    expect(dec.verdict).toBe("continue")
  })

  test("abort on two consecutive regressions (different metrics regress in sequence)", async () => {
    // Two blocking metrics: functional_correctness (goal) + user_intent_fidelity (global).
    // Drive them such that EACH of iter 1 and iter 2 has at least one
    // target-met→target-unmet regression. regressed_blocking > 0 in two
    // consecutive iterations triggers abort.
    //
    //    iter:           0       1       2
    //    goal metric:    1.0     0.5     0.5   (regresses at iter 1)
    //    global metric:  0.5     1.0     0.5   (regresses at iter 2)
    //
    // iter 0: goal met_target=true, global met_target=false
    // iter 1: goal met_target=false (regression!), global met_target=true
    //   → regressed_blocking = 1
    // iter 2: goal met_target=false (prev also false → no regression),
    //         global met_target=false (prev was true → regression!)
    //   → regressed_blocking = 1
    // Two consecutive iters with regressed_blocking > 0 ⇒ abort.
    const scoreTable: Record<string, number[]> = {
      functional_correctness: [1.0, 0.5, 0.5],
      user_intent_fidelity: [0.5, 1.0, 0.5],
    }
    const results = []
    for (let i = 0; i < 3; i++) {
      const judge: JudgeRunner = async (req) => ({
        score: scoreTable[req.spec.name]?.[i] ?? 0,
        rationale: "",
      })
      results.push(await runIteration({ iteration: i, judge }))
    }
    expect(results[2].verdict).toBe("abort")
  })

  test("invalid evidence (no judge injected) never accepts blocking judge metric", async () => {
    // Simulate running executeMetrics without ctx.judge. evidence_fresh=false
    // on judge-typed blocking metrics ⇒ they count as blocking_unmet
    // regardless of "score".
    await executeMetrics({ task_id: taskID, iteration: 0 }) // no ctx.judge
    const specs = readSpecsForTask(taskID)
    const current = readResultsForIteration(taskID, 0)
    expect(current.length).toBe(2) // both judge metrics have result rows
    expect(current.every((r) => !r.evidence_fresh)).toBe(true) // all stale
    const snap = computeIterationSnapshot({
      task_id: taskID,
      iteration: 0,
      specs,
      currentResults: current,
      previousResults: [],
      counterexamples: [],
      previousAggregateScore: 0,
    })
    expect(snap.blocking_unmet_count).toBe(2)
    expect(snap.aggregate_score).toBe(0)
    const decision = arbitrate([snap])
    // continue: no data yet to stall
    expect(decision.verdict).toBe("continue")
  })
})
