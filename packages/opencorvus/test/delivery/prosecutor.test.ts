import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "os"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createProsecutorTools,
  noveltyHash,
} from "../../src/delivery/prosecutor"
import {
  readCounterexamplesForTask,
  readSpecsForTask,
  registerBaselineSpec,
  writeIterationSnapshot,
  writeMetricResult,
} from "../../src/metrics/store"
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
        worktree: os.tmpdir(),
        name: "prosecutor-test",
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
        title: "prosecutor-test",
        request: "prosecutor tools",
        status: "active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

async function callTool(tool: any, input: unknown): Promise<string> {
  return String(await tool.execute(input as any))
}

beforeEach(async () => {
  await resetDatabase()
  seedProjectAndTask()
})

afterEach(async () => {
  await resetDatabase()
})

describe("propose_challenge_metric — budget + diagnostic lock", () => {
  test("K=1 per iteration: second challenge in same iter rejected by store layer", async () => {
    const kit = createProsecutorTools({ task_id: taskID, iteration: 0 })
    const ok = await callTool(kit.tools.propose_challenge_metric, {
      scope: "global",
      goal_id: null,
      name: "probe_a",
      description: "probing surface",
      unit: "ratio",
      direction: "higher_better",
      target: 0.8,
      floor: 0.3,
      weight: 0.5,
      evaluator_kind: "judge",
      evaluator_config: { criteria: "probe" },
      source_requirement_ids: [],
    })
    expect(ok).toContain("OK")
    const rejected = await callTool(kit.tools.propose_challenge_metric, {
      scope: "global",
      goal_id: null,
      name: "probe_b",
      description: "second probe",
      unit: "ratio",
      direction: "higher_better",
      target: 0.8,
      floor: 0.3,
      weight: 0.5,
      evaluator_kind: "judge",
      evaluator_config: { criteria: "other" },
      source_requirement_ids: [],
    })
    expect(rejected).toContain("Error")
    expect(rejected).toMatch(/challenge_budget_iteration|iteration 0/)
  })

  test("total task budget of 3 honored across iterations", async () => {
    for (let i = 0; i < 3; i++) {
      const kit = createProsecutorTools({ task_id: taskID, iteration: i })
      const msg = await callTool(kit.tools.propose_challenge_metric, {
        scope: "global",
        goal_id: null,
        name: `probe_${i}`,
        description: `iter ${i}`,
        unit: "ratio",
        direction: "higher_better",
        target: 0.8,
        floor: 0.3,
        weight: 0.5,
        evaluator_kind: "judge",
        evaluator_config: {},
        source_requirement_ids: [],
      })
      expect(msg).toContain("OK")
    }
    const kit4 = createProsecutorTools({ task_id: taskID, iteration: 3 })
    const blocked = await callTool(kit4.tools.propose_challenge_metric, {
      scope: "global",
      goal_id: null,
      name: "probe_3",
      description: "over budget",
      unit: "ratio",
      direction: "higher_better",
      target: 0.8,
      floor: 0.3,
      weight: 0.5,
      evaluator_kind: "judge",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    expect(blocked).toContain("Error")
    expect(blocked).toMatch(/challenge_budget_task/)
  })

  test("challenge gate_class is forced to diagnostic — never blocking", async () => {
    const kit = createProsecutorTools({ task_id: taskID, iteration: 0 })
    await callTool(kit.tools.propose_challenge_metric, {
      scope: "global",
      goal_id: null,
      name: "probe",
      description: "x",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      evaluator_kind: "judge",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    const specs = readSpecsForTask(taskID)
    expect(specs).toHaveLength(1)
    expect(specs[0].source).toBe("challenge")
    expect(specs[0].gate_class).toBe("diagnostic")
    expect(specs[0].created_by).toBe("prosecutor")
  })

  test("baseline rows cannot be written via this tool (source=challenge is forced)", async () => {
    // Belt + suspenders: the store layer already refuses UPDATEs on baseline
    // rows via SQL trigger; propose_challenge_metric has no way to construct
    // a baseline row. Confirm the write produces only challenge rows.
    const kit = createProsecutorTools({ task_id: taskID, iteration: 0 })
    await callTool(kit.tools.propose_challenge_metric, {
      scope: "global",
      goal_id: null,
      name: "p",
      description: "x",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      evaluator_kind: "judge",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    const baselines = readSpecsForTask(taskID).filter((s) => s.source === "baseline")
    expect(baselines).toHaveLength(0)
  })
})

describe("mark_counterexample — novelty dedup", () => {
  test("same reproducer + target re-filed on later iteration is a no-op", async () => {
    const k0 = createProsecutorTools({ task_id: taskID, iteration: 0 })
    const first = await callTool(k0.tools.mark_counterexample, {
      target_scope: "global",
      target_ref: "cross_goal_contract_consistency",
      claim: "Goal X and Goal Y disagree on Stock.price type",
      reproducer: "curl /api/stock/1 then check type",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    expect(first).toContain("OK")
    const k5 = createProsecutorTools({ task_id: taskID, iteration: 5 })
    const dupe = await callTool(k5.tools.mark_counterexample, {
      target_scope: "global",
      target_ref: "cross_goal_contract_consistency",
      claim: "same issue, different wording",
      reproducer: "curl /api/stock/1 then check type",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    expect(dupe).toContain("existing row from iter=0")
    const all = readCounterexamplesForTask(taskID)
    expect(all).toHaveLength(1)
    expect(all[0].iteration_found).toBe(0)
  })

  test("different reproducer = different novelty hash = new row", async () => {
    const kit = createProsecutorTools({ task_id: taskID, iteration: 2 })
    await callTool(kit.tools.mark_counterexample, {
      target_scope: "global",
      target_ref: "x",
      claim: "A",
      reproducer: "step 1",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    await callTool(kit.tools.mark_counterexample, {
      target_scope: "global",
      target_ref: "x",
      claim: "B",
      reproducer: "step 2 (different)",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    expect(readCounterexamplesForTask(taskID)).toHaveLength(2)
  })

  test("noveltyHash: whitespace-only reproducer differences do NOT create novelty", () => {
    const a = noveltyHash("goal", "g1", "  step one\nstep two  ")
    const b = noveltyHash("goal", "g1", "step one\nstep two")
    expect(a).toBe(b)
  })
})

describe("resolve_counterexample", () => {
  test("closes an open counterexample on the current iteration", async () => {
    const k0 = createProsecutorTools({ task_id: taskID, iteration: 0 })
    const markMsg = await callTool(k0.tools.mark_counterexample, {
      target_scope: "global",
      target_ref: "x",
      claim: "bug",
      reproducer: "crash on load",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    const id = k0.getCollector().counterexamples[0].id
    expect(markMsg).toContain("OK")
    const k3 = createProsecutorTools({ task_id: taskID, iteration: 3 })
    const resolveMsg = await callTool(k3.tools.resolve_counterexample, { id })
    expect(resolveMsg).toContain("resolved at iteration 3")
    const all = readCounterexamplesForTask(taskID)
    expect(all[0].iteration_resolved).toBe(3)
  })

  test("resolving an already-resolved counterexample is idempotent", async () => {
    const k0 = createProsecutorTools({ task_id: taskID, iteration: 0 })
    await callTool(k0.tools.mark_counterexample, {
      target_scope: "global",
      target_ref: "x",
      claim: "bug",
      reproducer: "crash",
      severity: "blocking",
      linked_metric_spec_id: null,
    })
    const id = k0.getCollector().counterexamples[0].id
    const k3 = createProsecutorTools({ task_id: taskID, iteration: 3 })
    await callTool(k3.tools.resolve_counterexample, { id })
    const again = await callTool(k3.tools.resolve_counterexample, { id })
    expect(again).toContain("Already resolved")
  })
})

describe("query_metric_trajectory", () => {
  test("returns iteration rows + current-iteration results", async () => {
    // Seed an iteration snapshot + a metric result for iter 0.
    const spec = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "user_intent_fidelity",
      description: "x",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "judge",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    writeMetricResult({
      metric_spec_id: spec.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.6,
      normalized_value: 0.2,
      met_target: false,
      met_floor: true,
      evidence_ref: "seed",
      evidence_fresh: true,
    })
    writeIterationSnapshot({
      task_id: taskID,
      iteration: 0,
      aggregate_score: 0.2,
      per_goal_score: {},
      global_score: 0.2,
      delta_vs_prev: 0,
      novelty_score: 0,
      blocking_unmet_count: 1,
      open_counterexamples: 0,
      regressed_blocking: 0,
      arbiter_verdict: "continue",
    })
    const kit = createProsecutorTools({ task_id: taskID, iteration: 0 })
    const out = await callTool(kit.tools.query_metric_trajectory, { window: 5 })
    expect(out).toContain("Iteration trajectory")
    expect(out).toContain("verdict=continue")
    expect(out).toContain("user_intent_fidelity")
    expect(out).toContain("norm=0.200")
  })
})
