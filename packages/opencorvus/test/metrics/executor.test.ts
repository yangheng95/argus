import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { executeMetrics, normalize, type JudgeRunner } from "../../src/metrics/executor"
import { Shell } from "../../src/shell/shell"
import { DEFAULT_BASH_TIMEOUT_MS } from "../../src/shell/timeout"
import { readResultsForIteration, registerBaselineSpec, writeMetricResult } from "../../src/metrics/store"
import { resetDatabase } from "../fixture/db"
import type { VisualEvidenceBundle } from "../../src/acceptance/visual-evidence"

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
        name: "metrics-executor-test",
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
        title: "metrics-executor",
        request: "metrics executor tests",
        status: "active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function visualBundle(overrides: Partial<VisualEvidenceBundle> = {}): VisualEvidenceBundle {
  const bundle: VisualEvidenceBundle = {
    id: "veb_desktop",
    taskID,
    source: "integrity",
    reference: {
      path: "webpage-evidence/reference.png",
      sha256: "sha_reference",
      width: 1440,
      height: 900,
    },
    rendered: {
      path: "webpage-evidence/rendered.png",
      sha256: "sha_rendered",
      width: 1440,
      height: 900,
      capturedAt: "2026-06-08T00:00:00.000Z",
      viewport: { width: 1440, height: 900 },
      appURL: "http://127.0.0.1:4173",
      projectDirectory: os.tmpdir(),
      commitRef: "abc123",
    },
    evaluation: {
      path: "webpage-evidence/eval-result.json",
      overallScore: 98,
      passThreshold: 96,
      passed: true,
      ssimScore: 0.99,
      pixelDiffPercent: 0.2,
      dimensionsMatch: true,
    },
    vision: {
      path: "webpage-evidence/vision-judge.json",
      accepted: true,
      differenceCount: 0,
      criticalCount: 0,
      majorCount: 0,
      minorCount: 0,
    },
    regions: [
      {
        id: "region_header",
        label: "Header",
        requirementIDs: ["REQ-visual"],
        acceptanceSpecIDs: ["acc-final-visual"],
        sourceRefs: ["webpage-evidence/reference.png"],
        viewport: "desktop-primary",
        required: true,
        status: "passing",
        evidenceRefs: ["webpage-evidence/rendered.png", "webpage-evidence/eval-result.json"],
        notes: "Header matches the reference.",
      },
    ],
  }
  return { ...bundle, ...overrides }
}

beforeEach(async () => {
  await resetDatabase()
  seedProjectAndTask()
})

afterEach(async () => {
  await resetDatabase()
})

describe("normalize", () => {
  test("higher_better: linear between floor and target, clipped", () => {
    const spec = {
      target: 1.0,
      floor: 0.5,
      direction: "higher_better" as const,
    } as any
    expect(normalize(0.5, spec)).toBe(0)
    expect(normalize(0.75, spec)).toBeCloseTo(0.5, 5)
    expect(normalize(1.0, spec)).toBe(1)
    expect(normalize(1.5, spec)).toBe(1) // clipped
    expect(normalize(0.2, spec)).toBe(0) // clipped
  })

  test("lower_better: linear between floor (high bad) and target (low good)", () => {
    const spec = {
      target: 0,
      floor: 10,
      direction: "lower_better" as const,
    } as any
    expect(normalize(0, spec)).toBe(1)
    expect(normalize(5, spec)).toBeCloseTo(0.5, 5)
    expect(normalize(10, spec)).toBe(0)
    expect(normalize(20, spec)).toBe(0) // worse than floor, clipped
  })

  test("target==floor degenerates to binary gate", () => {
    const hiSpec = { target: 1, floor: 1, direction: "higher_better" as const } as any
    expect(normalize(0.99, hiSpec)).toBe(0)
    expect(normalize(1.0, hiSpec)).toBe(1)
    const loSpec = { target: 0, floor: 0, direction: "lower_better" as const } as any
    expect(normalize(0.01, loSpec)).toBe(0)
    expect(normalize(0, loSpec)).toBe(1)
  })
})

describe("executeMetrics — shell evaluator", () => {
  test("uses the shared five minute command timeout when timeout_ms is omitted", async () => {
    const originalRun = Shell.run
    const calls: Array<{ command: string; timeoutMs?: number }> = []
    Shell.run = async (command, opts = {}) => {
      calls.push({ command, timeoutMs: opts.timeoutMs })
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        idleTimedOut: false,
        aborted: false,
        pid: 12345,
      }
    }
    try {
      registerBaselineSpec({
        task_id: taskID,
        scope: "global",
        goal_id: null,
        name: "m_default_timeout",
        description: "default shell timeout",
        unit: "ratio",
        direction: "higher_better",
        target: 1,
        floor: 0.5,
        weight: 1,
        gate_class: "blocking",
        evaluator_kind: "shell",
        evaluator_config: { cmd: "printf ok" },
        source_requirement_ids: [],
      })

      await executeMetrics({ task_id: taskID, iteration: 0 }, { workDir: os.tmpdir() })
    } finally {
      Shell.run = originalRun
    }

    expect(calls).toEqual([{ command: "printf ok", timeoutMs: DEFAULT_BASH_TIMEOUT_MS }])
    expect(DEFAULT_BASH_TIMEOUT_MS).toBe(300_000)
  })

  test("exit_code parse: exit 0 → 1, exit != 0 → 0", async () => {
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "m_pass",
      description: "passing shell",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd: "exit 0" },
      source_requirement_ids: [],
    })
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "m_fail",
      description: "failing shell",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd: "exit 1" },
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 }, { workDir: os.tmpdir() })
    expect(outcome.results).toHaveLength(2)
    const byName = new Map(outcome.results.map((r, i) => [`r${i}`, r] as const))
    void byName
    const fresh = outcome.results.filter((r) => r.evidence_fresh)
    expect(fresh.length).toBe(2)
    const raws = outcome.results.map((r) => r.raw_value).sort()
    expect(raws).toEqual([0, 1])
    const norms = outcome.results.map((r) => r.normalized_value).sort()
    expect(norms).toEqual([0, 1])
  })

  test("stdout_number parse extracts first number from stdout", async () => {
    // Shell.run always runs via bash (git-bash on Windows) so printf is portable.
    const cmd = "printf 0.73"
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "m_num",
      description: "extracts number",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd, parse: "stdout_number" },
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 }, { workDir: os.tmpdir() })
    expect(outcome.results).toHaveLength(1)
    const r = outcome.results[0]
    expect(r.evidence_fresh).toBe(true)
    expect(r.raw_value).toBeCloseTo(0.73, 2)
    expect(r.normalized_value).toBeCloseTo(0.46, 2)
  })

  test("freshness stays true each iteration — no cache across iterations", async () => {
    const countFile = path.join(os.tmpdir(), "exec-count-" + Math.random().toString(36).slice(2))
    const cmd = `echo ran >> "${countFile}"`
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "m_cachecheck",
      description: "confirms re-run",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd },
      source_requirement_ids: [],
    })
    await executeMetrics({ task_id: taskID, iteration: 0 }, { workDir: os.tmpdir() })
    await executeMetrics({ task_id: taskID, iteration: 1 }, { workDir: os.tmpdir() })
    const i0 = readResultsForIteration(taskID, 0)
    const i1 = readResultsForIteration(taskID, 1)
    expect(i0).toHaveLength(1)
    expect(i1).toHaveLength(1)
    expect(i0[0].id).not.toBe(i1[0].id)
    expect(i0[0].evidence_fresh).toBe(true)
    expect(i1[0].evidence_fresh).toBe(true)
  })
})

describe("executeMetrics — judge evaluator (pluggable runner)", () => {
  test("injected judge runner feeds rubric score", async () => {
    const spec = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "user_intent_fidelity",
      description: "judge stub",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.3,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "judge",
      evaluator_config: {
        criteria: "Does the acceptance honor the user intent?",
        rubric: [
          { score: 0, label: "off-intent", anchor: "ignores user ask", passes: false },
          { score: 1, label: "on-intent", anchor: "honors user ask", passes: true },
        ],
        inputs: ["acceptance_summary"],
      },
      source_requirement_ids: [],
    })
    const calls: string[] = []
    const judge: JudgeRunner = async (req) => {
      calls.push(req.spec.id)
      return { score: 1, rationale: "looks good" }
    }
    const outcome = await executeMetrics(
      {
        task_id: taskID,
        iteration: 0,
        acceptance: { summary: "Built the login page as requested." },
      },
      { judge },
    )
    expect(calls).toEqual([spec.id])
    expect(outcome.results).toHaveLength(1)
    const r = outcome.results[0]
    expect(r.raw_value).toBe(1)
    expect(r.normalized_value).toBe(1)
    expect(r.met_target).toBe(true)
    expect(r.evidence_fresh).toBe(true)
  })

  test("no ctx.judge injected → judge metric is marked non-fresh (unknown, not failing)", async () => {
    // A judge-typed blocking metric without an injected judge runner is
    // "unknown", not "failing". If we credited met_target=false, every
    // judge-blocking metric would be counted against accept forever —
    // see CLAUDE.md rule #1 (no fallback) and docs/spec-dynamic-adversarial-metrics.md
    // "evidence_fresh invalidates the result".
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "judge_unwired",
      description: "stub",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "judge",
      evaluator_config: { criteria: "noop" },
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].evidence_fresh).toBe(false)
    expect(outcome.results[0].raw_value).toBe(0)
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0].reason).toContain("no runner injected")
  })

  test("visual judge requiring visual evidence but omitting visual_evidence input is non-fresh", async () => {
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "visual_text_only",
      description: "visual judge must declare visual evidence input",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "judge",
      evaluator_config: {
        criteria: "Judge final rendered-vs-reference visual fidelity.",
        requires_visual_evidence: true,
        inputs: ["acceptance_summary"],
      },
      source_requirement_ids: ["REQ-visual"],
    })
    const calls: string[] = []
    const judge: JudgeRunner = async (req) => {
      calls.push(req.spec.id)
      return { score: 1, rationale: "text-only pass" }
    }

    const outcome = await executeMetrics(
      {
        task_id: taskID,
        iteration: 0,
        acceptance: { summary: "visual verification passed" },
      },
      { judge },
    )

    expect(calls).toEqual([])
    expect(outcome.results[0].evidence_fresh).toBe(false)
    expect(outcome.results[0].evidence_ref).toContain("visual_evidence input required")
    expect(outcome.skipped[0].reason).toContain("visual_evidence input required")
  })

  test("visual judge with visual_evidence input receives structured bundle artifacts", async () => {
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "visual_with_bundle",
      description: "visual judge consumes bundle artifacts",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0.5,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "judge",
      evaluator_config: {
        criteria: "Judge final rendered-vs-reference visual fidelity.",
        requires_visual_evidence: true,
        inputs: ["visual_evidence", "requirement_text"],
      },
      source_requirement_ids: ["REQ-visual"],
    })
    const calls: Array<VisualEvidenceBundle[] | undefined> = []
    const judge: JudgeRunner = async (req) => {
      calls.push(req.inputs.visual_evidence)
      return { score: 1, rationale: "bundle supports pass" }
    }
    const bundle = visualBundle()

    const outcome = await executeMetrics(
      {
        task_id: taskID,
        iteration: 0,
        acceptance: {
          requirement_text: "Match the reference screenshot.",
          visual_evidence: [bundle],
        },
      },
      { judge },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]?.id).toBe(bundle.id)
    expect(outcome.results[0].evidence_fresh).toBe(true)
    expect(outcome.results[0].evidence_ref).toContain("visual_evidence_bundle=veb_desktop")
    expect(outcome.results[0].evidence_ref).toContain("reference=webpage-evidence/reference.png")
  })
})

describe("executeMetrics — query evaluator", () => {
  test("runs SQL and reads first row's value column", async () => {
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "m_query",
      description: "literal query",
      unit: "count",
      direction: "lower_better",
      target: 0,
      floor: 10,
      weight: 1,
      gate_class: "blocking",
      evaluator_kind: "query",
      evaluator_config: { sql: "SELECT 3 AS value" },
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 })
    const r = outcome.results[0]
    expect(r.raw_value).toBe(3)
    expect(r.normalized_value).toBeCloseTo(0.7, 5) // (10-3)/(10-0) = 0.7
    expect(r.met_target).toBe(false)
    expect(r.met_floor).toBe(true)
    expect(r.evidence_fresh).toBe(true)
  })
})

describe("executeMetrics — aggregator evaluator", () => {
  test("mean of named specs' normalized values", async () => {
    // Build two base specs + one aggregator referencing them.
    const a = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "base_a",
      description: "a",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "shell",
      evaluator_config: { cmd: "echo ok" },
      source_requirement_ids: [],
    })
    const b = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "base_b",
      description: "b",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "shell",
      evaluator_config: { cmd: "echo ok" },
      source_requirement_ids: [],
    })
    // Seed iteration 0 base results manually so we don't depend on shell exec.
    writeMetricResult({
      metric_spec_id: a.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.8,
      normalized_value: 0.8,
      met_target: false,
      met_floor: true,
      evidence_ref: "seed",
      evidence_fresh: true,
    })
    writeMetricResult({
      metric_spec_id: b.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.4,
      normalized_value: 0.4,
      met_target: false,
      met_floor: true,
      evidence_ref: "seed",
      evidence_fresh: true,
    })
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "agg_mean",
      description: "mean of a,b",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "aggregator",
      evaluator_config: { of: [a.id, b.id], op: "mean" },
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 })
    const agg = outcome.results.find((r) => r.evidence_ref.startsWith("aggregator://"))
    expect(agg).toBeDefined()
    expect(agg!.raw_value).toBeCloseTo(0.6, 5)
    expect(agg!.normalized_value).toBeCloseTo(0.6, 5)
    expect(agg!.evidence_fresh).toBe(true)
  })

  test("aggregator with a missing configured input yields evidence_fresh=false", async () => {
    const a = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "partial_a",
      description: "a",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "query",
      evaluator_config: { sql: "SELECT 1 AS value" },
      source_requirement_ids: [],
    })
    const b = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "partial_b",
      description: "b",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "query",
      evaluator_config: { sql: "SELECT 1 AS value" },
      source_requirement_ids: [],
    })
    writeMetricResult({
      metric_spec_id: a.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.8,
      normalized_value: 0.8,
      met_target: false,
      met_floor: true,
      evidence_ref: "seed",
      evidence_fresh: true,
    })
    const agg = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "agg_partial",
      description: "requires a and b",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "aggregator",
      evaluator_config: { of: [a.id, b.id], op: "mean", iteration_offset: -1 },
      source_requirement_ids: [],
    })

    const outcome = await executeMetrics({ task_id: taskID, iteration: 1 })
    const aggResult = outcome.results.find((r) => r.metric_spec_id === agg.id)

    expect(aggResult).toBeDefined()
    expect(aggResult!.raw_value).toBe(0)
    expect(aggResult!.normalized_value).toBe(0)
    expect(aggResult!.evidence_fresh).toBe(false)
    expect(aggResult!.evidence_ref).toContain("incomplete_inputs")
    expect(aggResult!.evidence_ref).toContain(b.id)
    expect(outcome.skipped).toContainEqual(
      expect.objectContaining({
        spec_id: agg.id,
      }),
    )
  })

  test("aggregator with a stale configured input yields evidence_fresh=false", async () => {
    const a = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "stale_a",
      description: "a",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "query",
      evaluator_config: { sql: "SELECT 1 AS value" },
      source_requirement_ids: [],
    })
    const b = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "stale_b",
      description: "b",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "query",
      evaluator_config: { sql: "SELECT 1 AS value" },
      source_requirement_ids: [],
    })
    writeMetricResult({
      metric_spec_id: a.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0.8,
      normalized_value: 0.8,
      met_target: false,
      met_floor: true,
      evidence_ref: "seed:fresh",
      evidence_fresh: true,
    })
    writeMetricResult({
      metric_spec_id: b.id,
      task_id: taskID,
      iteration: 0,
      goal_run_id: null,
      raw_value: 0,
      normalized_value: 0,
      met_target: false,
      met_floor: false,
      evidence_ref: "seed:stale",
      evidence_fresh: false,
    })
    const agg = registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "agg_stale",
      description: "requires fresh a and b",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "aggregator",
      evaluator_config: { of: [a.id, b.id], op: "mean", iteration_offset: -1 },
      source_requirement_ids: [],
    })

    const outcome = await executeMetrics({ task_id: taskID, iteration: 1 })
    const aggResult = outcome.results.find((r) => r.metric_spec_id === agg.id)

    expect(aggResult).toBeDefined()
    expect(aggResult!.raw_value).toBe(0)
    expect(aggResult!.normalized_value).toBe(0)
    expect(aggResult!.evidence_fresh).toBe(false)
    expect(aggResult!.evidence_ref).toContain("incomplete_inputs")
    expect(aggResult!.evidence_ref).toContain(`stale=${b.id}`)
    expect(outcome.skipped).toContainEqual(
      expect.objectContaining({
        spec_id: agg.id,
      }),
    )
  })

  test("aggregator with no fresh inputs yields evidence_fresh=false", async () => {
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "agg_empty",
      description: "empty agg",
      unit: "ratio",
      direction: "higher_better",
      target: 1,
      floor: 0,
      weight: 1,
      gate_class: "diagnostic",
      evaluator_kind: "aggregator",
      evaluator_config: { of: ["mts_nonexistent"], op: "mean" },
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].evidence_fresh).toBe(false)
    expect(outcome.skipped).toHaveLength(1)
  })
})

describe("executeMetrics — unknown evaluator_kind is rejected at dispatch", () => {
  test("ast kind was removed — dispatch throws, result is marked non-fresh", async () => {
    // Direct registration (bypassing the Architect's zod schema) still lets
    // a bad kind reach the DB; the dispatcher catches it at evaluate time.
    registerBaselineSpec({
      task_id: taskID,
      scope: "global",
      goal_id: null,
      name: "ast_removed",
      description: "no longer supported",
      unit: "count",
      direction: "lower_better",
      target: 0,
      floor: 5,
      weight: 1,
      gate_class: "blocking",
      // deliberately pass a kind the enum no longer accepts
      evaluator_kind: "ast" as any,
      evaluator_config: {},
      source_requirement_ids: [],
    })
    const outcome = await executeMetrics({ task_id: taskID, iteration: 0 })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].evidence_fresh).toBe(false)
    expect(outcome.skipped[0].reason).toContain("unknown evaluator_kind")
  })
})
