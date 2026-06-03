/**
 * Metric Executor — runs every baseline + challenge metric spec against the
 * current iteration's acceptance snapshot and writes engine_metric_result rows.
 *
 * Five evaluator kinds, one dispatcher. Each evaluator returns a raw_value
 * (direction-native) and the Executor normalizes it to [0,1] using the spec's
 * target / floor / direction. Evidence freshness is always TRUE — the
 * Executor never reuses a prior iteration's result; cached reuse is
 * explicitly forbidden by the spec.
 *
 * Evaluator contract (see evaluator_config schemas below):
 *   - shell:      { cmd, cwd?, parse: 'exit_code' | 'stdout_number' | 'stdout_pattern',
 *                   pattern?, timeout_ms?, expected_exit_code? }
 *   - judge:      { criteria, rubric?: RubricLevel[], inputs?: string[] }
 *   - query:      { sql, value_column? }
 *   - aggregator: { of: string[], op: 'mean' | 'min' | 'max' | 'sum' }
 *
 * Why no 'ast' evaluator_kind: the DAM MVP requires every evaluator to have
 * a concrete implementation. A static-analysis checker isn't built in because
 * its shape is language-specific — Architects needing structural checks
 * should use `shell` (invoke a language-specific tool) or `query` (join
 * against an on-disk import graph produced by a prior step).
 */
import { sql as rawSQL } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import {
  readResultsForIteration,
  readSpecsForTask,
  writeMetricResult,
} from "./store"
import type { MetricDirection, MetricResult, MetricSpec } from "./types"

const log = Log.create({ service: "metric-executor" })

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MetricExecutorContext {
  /** Optional LLM judge override — used by tests to stub out calls. */
  judge?: JudgeRunner
  /** Optional working directory override for shell evaluators. */
  workDir?: string
}

export interface ExecuteMetricsInput {
  task_id: string
  iteration: number
  /** Goal-run this iteration belongs to, if any. Attached to every result row. */
  goal_run_id?: string | null
  /** Acceptance context fed to the judge evaluator (summary, diff text, etc.). */
  acceptance?: AcceptanceContext
}

export interface AcceptanceContext {
  summary?: string
  changed_files?: string[]
  requirement_text?: string
}

export interface ExecuteMetricsOutcome {
  results: MetricResult[]
  skipped: Array<{ spec_id: string; reason: string }>
}

/**
 * Run every metric spec for (task_id, iteration). Writes results to DB.
 * Returns both the fresh results and the list of specs skipped with reason.
 * A skip produces a result row with evidence_fresh=false so S_k drops it.
 */
export async function executeMetrics(
  input: ExecuteMetricsInput,
  ctx: MetricExecutorContext = {},
): Promise<ExecuteMetricsOutcome> {
  const specs = readSpecsForTask(input.task_id)
  const results: MetricResult[] = []
  const skipped: Array<{ spec_id: string; reason: string }> = []

  for (const spec of specs) {
    try {
      const outcome = await evaluateSpec(spec, input, ctx)
      const row = writeMetricResult({
        metric_spec_id: spec.id,
        task_id: input.task_id,
        iteration: input.iteration,
        goal_run_id: input.goal_run_id ?? null,
        raw_value: outcome.raw_value,
        normalized_value: outcome.normalized_value,
        met_target: outcome.met_target,
        met_floor: outcome.met_floor,
        evidence_ref: outcome.evidence_ref,
        evidence_fresh: outcome.evidence_fresh,
      })
      if (!outcome.evidence_fresh) {
        skipped.push({ spec_id: spec.id, reason: outcome.evidence_ref })
      }
      results.push(row)
    } catch (err) {
      // Treat evaluator failures as unusable evidence — not as pass or fail.
      // Arbiter will see the result as blocking_unmet + stale, which is the
      // correct "we don't know" state.
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("metric evaluator threw", { spec_id: spec.id, name: spec.name, err: msg })
      const row = writeMetricResult({
        metric_spec_id: spec.id,
        task_id: input.task_id,
        iteration: input.iteration,
        goal_run_id: input.goal_run_id ?? null,
        raw_value: 0,
        normalized_value: 0,
        met_target: false,
        met_floor: false,
        evidence_ref: `evaluator_error:${msg}`,
        evidence_fresh: false,
      })
      skipped.push({ spec_id: spec.id, reason: `evaluator_error: ${msg}` })
      results.push(row)
    }
  }

  return { results, skipped }
}

// ---------------------------------------------------------------------------
// Per-spec evaluation
// ---------------------------------------------------------------------------

interface EvaluatorOutcome {
  raw_value: number
  normalized_value: number
  met_target: boolean
  met_floor: boolean
  evidence_ref: string
  evidence_fresh: boolean
}

async function evaluateSpec(
  spec: MetricSpec,
  input: ExecuteMetricsInput,
  ctx: MetricExecutorContext,
): Promise<EvaluatorOutcome> {
  const raw = await dispatchEvaluator(spec, input, ctx)
  if (raw.evidence_fresh === false) {
    return {
      raw_value: 0,
      normalized_value: 0,
      met_target: false,
      met_floor: false,
      evidence_ref: raw.evidence_ref,
      evidence_fresh: false,
    }
  }
  const normalized = normalize(raw.raw_value, spec)
  const met_target = meetsThreshold(raw.raw_value, spec.target, spec.direction)
  const met_floor = meetsThreshold(raw.raw_value, spec.floor, spec.direction)
  return {
    raw_value: raw.raw_value,
    normalized_value: normalized,
    met_target,
    met_floor,
    evidence_ref: raw.evidence_ref,
    evidence_fresh: true,
  }
}

interface RawEvaluation {
  raw_value: number
  evidence_ref: string
  evidence_fresh: boolean
}

async function dispatchEvaluator(
  spec: MetricSpec,
  input: ExecuteMetricsInput,
  ctx: MetricExecutorContext,
): Promise<RawEvaluation> {
  switch (spec.evaluator_kind) {
    case "shell":
      return runShell(spec, ctx)
    case "judge":
      return runJudge(spec, input, ctx)
    case "query":
      return runQuery(spec)
    case "aggregator":
      return runAggregator(spec, input)
    default:
      throw new Error(`unknown evaluator_kind: ${String(spec.evaluator_kind)}`)
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalize(rawValue: number, spec: MetricSpec): number {
  if (!Number.isFinite(rawValue)) return 0
  const { target, floor, direction } = spec
  if (direction === "higher_better") {
    if (target <= floor) {
      // Degenerate: treat as binary gate on target.
      return rawValue >= target ? 1 : 0
    }
    const t = (rawValue - floor) / (target - floor)
    return clip01(t)
  }
  // lower_better: target < floor expected.
  if (floor <= target) {
    return rawValue <= target ? 1 : 0
  }
  const t = (floor - rawValue) / (floor - target)
  return clip01(t)
}

function meetsThreshold(
  rawValue: number,
  threshold: number,
  direction: MetricDirection,
): boolean {
  if (direction === "higher_better") return rawValue >= threshold
  return rawValue <= threshold
}

function clip01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

// ---------------------------------------------------------------------------
// Shell evaluator
// ---------------------------------------------------------------------------

interface ShellConfig {
  cmd: string
  cwd?: string
  parse?: "exit_code" | "stdout_number" | "stdout_pattern"
  pattern?: string
  timeout_ms?: number
  expected_exit_code?: number
}

async function runShell(
  spec: MetricSpec,
  ctx: MetricExecutorContext,
): Promise<RawEvaluation> {
  const cfg = spec.evaluator_config as unknown as ShellConfig
  if (!cfg || typeof cfg.cmd !== "string" || cfg.cmd.length === 0) {
    throw new Error(`shell evaluator for ${spec.id} missing cmd`)
  }
  const projectDir = ctx.workDir ?? Filesystem.resolve(Instance.directory)
  const cwd = cfg.cwd ? Filesystem.resolve(cfg.cwd) : projectDir
  const timeoutMs = typeof cfg.timeout_ms === "number" ? cfg.timeout_ms : 120_000
  const result = await Shell.run(cfg.cmd, {
    cwd,
    env: process.env,
    timeoutMs,
  })
  const parse = cfg.parse ?? "exit_code"
  let raw: number
  switch (parse) {
    case "exit_code": {
      const expected = cfg.expected_exit_code ?? 0
      raw = result.exitCode === expected ? 1 : 0
      break
    }
    case "stdout_number": {
      const m = result.stdout.match(/-?\d+(?:\.\d+)?/)
      raw = m ? Number(m[0]) : 0
      break
    }
    case "stdout_pattern": {
      if (!cfg.pattern) throw new Error(`shell evaluator for ${spec.id} parse=stdout_pattern but no pattern`)
      const re = new RegExp(cfg.pattern)
      const m = result.stdout.match(re)
      raw = m && m[1] ? Number(m[1]) : 0
      break
    }
    default:
      throw new Error(`shell evaluator for ${spec.id} unknown parse=${String(parse)}`)
  }
  return {
    raw_value: Number.isFinite(raw) ? raw : 0,
    evidence_ref: `shell://exit=${result.exitCode};stdout=${truncate(result.stdout, 400)}`,
    evidence_fresh: true,
  }
}

// ---------------------------------------------------------------------------
// Judge evaluator — pluggable LLM runner
// ---------------------------------------------------------------------------

export interface JudgeRequest {
  spec: MetricSpec
  criteria: string
  rubric?: Array<{ score: number; label: string; anchor: string; passes: boolean }>
  inputs: {
    acceptance_summary?: string
    changed_files?: string[]
    requirement_text?: string
  }
}

export interface JudgeResponse {
  /** Raw ordinal score in the rubric range (or 0/1 for binary). */
  score: number
  rationale: string
}

export type JudgeRunner = (req: JudgeRequest) => Promise<JudgeResponse>

interface JudgeConfig {
  criteria: string
  rubric?: Array<{ score: number; label: string; anchor: string; passes: boolean }>
  inputs?: Array<"acceptance_summary" | "changed_files" | "requirement_text">
}

async function runJudge(
  spec: MetricSpec,
  input: ExecuteMetricsInput,
  ctx: MetricExecutorContext,
): Promise<RawEvaluation> {
  const cfg = spec.evaluator_config as unknown as JudgeConfig
  if (!cfg || typeof cfg.criteria !== "string" || cfg.criteria.length === 0) {
    throw new Error(`judge evaluator for ${spec.id} missing criteria`)
  }
  // No default runner: when the caller hasn't injected ctx.judge, the metric
  // is marked NOT fresh — it neither passes nor fails, it is simply unknown.
  // Treating a "default rationale" as a real score would credit a judge-typed
  // blocking metric with met_target=false on every iteration, making accept
  // impossible for tasks that legitimately require judge evaluation.
  if (!ctx.judge) {
    return {
      raw_value: 0,
      evidence_ref: `judge://no runner injected (pass ctx.judge to executeMetrics)`,
      evidence_fresh: false,
    }
  }
  const requested = new Set(cfg.inputs ?? ["acceptance_summary"])
  const acceptance = input.acceptance ?? {}
  const req: JudgeRequest = {
    spec,
    criteria: cfg.criteria,
    rubric: cfg.rubric,
    inputs: {
      acceptance_summary: requested.has("acceptance_summary") ? acceptance.summary : undefined,
      changed_files: requested.has("changed_files") ? acceptance.changed_files : undefined,
      requirement_text: requested.has("requirement_text") ? acceptance.requirement_text : undefined,
    },
  }
  const resp = await ctx.judge(req)
  return {
    raw_value: resp.score,
    evidence_ref: `judge://${truncate(resp.rationale, 400)}`,
    evidence_fresh: true,
  }
}

// ---------------------------------------------------------------------------
// Query evaluator — SQL against engine tables
// ---------------------------------------------------------------------------

interface QueryConfig {
  sql: string
  value_column?: string
}

async function runQuery(spec: MetricSpec): Promise<RawEvaluation> {
  const cfg = spec.evaluator_config as unknown as QueryConfig
  if (!cfg || typeof cfg.sql !== "string" || cfg.sql.length === 0) {
    throw new Error(`query evaluator for ${spec.id} missing sql`)
  }
  // No parameter substitution — Architect writes the SQL verbatim. SQL injection
  // is not a concern here because Architect output is trusted code authored by
  // the same operator running the task; this is not user-facing input.
  const rows = Database.use((db) => db.all(rawSQL.raw(cfg.sql))) as Array<Record<string, unknown>>
  if (!rows || rows.length === 0) {
    return { raw_value: 0, evidence_ref: "query://no_rows", evidence_fresh: true }
  }
  const col = cfg.value_column ?? "value"
  const firstRow = rows[0]
  const raw = Number(firstRow[col])
  return {
    raw_value: Number.isFinite(raw) ? raw : 0,
    evidence_ref: `query://rows=${rows.length};value=${raw}`,
    evidence_fresh: true,
  }
}

// ---------------------------------------------------------------------------
// Aggregator evaluator — composes prior metric_results
// ---------------------------------------------------------------------------

interface AggregatorConfig {
  of: string[]
  op: "mean" | "min" | "max" | "sum"
  /** Iteration offset: 0 = current (same iteration), -1 = previous. Default 0. */
  iteration_offset?: number
}

async function runAggregator(
  spec: MetricSpec,
  input: ExecuteMetricsInput,
): Promise<RawEvaluation> {
  const cfg = spec.evaluator_config as unknown as AggregatorConfig
  if (!cfg || !Array.isArray(cfg.of) || cfg.of.length === 0) {
    throw new Error(`aggregator evaluator for ${spec.id} missing 'of' list`)
  }
  const offset = typeof cfg.iteration_offset === "number" ? cfg.iteration_offset : 0
  const iteration = input.iteration + offset
  if (iteration < 0) {
    return {
      raw_value: 0,
      evidence_ref: `aggregator://offset=${offset} yields negative iteration`,
      evidence_fresh: false,
    }
  }
  const results = readResultsForIteration(input.task_id, iteration)
  const wanted = new Set(cfg.of)
  const values = results
    .filter((r) => wanted.has(r.metric_spec_id) && r.evidence_fresh)
    .map((r) => r.normalized_value)
  if (values.length === 0) {
    return {
      raw_value: 0,
      evidence_ref: `aggregator://no_fresh_inputs iter=${iteration}`,
      evidence_fresh: false,
    }
  }
  const op = cfg.op ?? "mean"
  let raw = 0
  switch (op) {
    case "mean":
      raw = values.reduce((s, v) => s + v, 0) / values.length
      break
    case "min":
      raw = Math.min(...values)
      break
    case "max":
      raw = Math.max(...values)
      break
    case "sum":
      raw = values.reduce((s, v) => s + v, 0)
      break
    default:
      throw new Error(`aggregator evaluator for ${spec.id} unknown op=${String(op)}`)
  }
  return {
    raw_value: raw,
    evidence_ref: `aggregator://op=${op};n=${values.length};iter=${iteration}`,
    evidence_fresh: true,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `…(${s.length - max} more)`
}
