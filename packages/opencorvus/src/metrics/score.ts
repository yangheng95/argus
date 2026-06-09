/**
 * Pure score / snapshot computation for the adversarial metric loop.
 *
 * Given typed input data (specs, results, counterexamples, prior state), emit
 * the IterationSnapshot row the Arbiter consumes. No DB access — the store
 * layer fetches the inputs, feeds them in, and persists the output.
 *
 * Score composition rules — anchored in docs/spec-dynamic-adversarial-metrics.md:
 *   - Only baseline & challenge specs with gate_class != 'efficiency' contribute.
 *   - Results with evidence_fresh=false are dropped (not partial-credited).
 *   - Per-goal contribution: for each goal, weighted mean of its metrics'
 *     normalized values. Goals with no live result this iteration contribute
 *     0 (treated as unmeasured ⇒ not credited).
 *   - Global contribution: weighted mean over all global metrics.
 *   - S_k = α * per_goal_overall + β * global_overall, with α=β=0.5 default.
 */
import type { Counterexample, IterationSnapshot, MetricResult, MetricSpec } from "./types"

export interface ScoreWeights {
  /** Weight of per-goal aggregate in S_k. Default 0.5. */
  alpha: number
  /** Weight of global aggregate in S_k. Default 0.5. */
  beta: number
}

export const SCORE_WEIGHT_DEFAULTS: ScoreWeights = { alpha: 0.5, beta: 0.5 }

export interface SnapshotInput {
  task_id: string
  iteration: number
  specs: readonly MetricSpec[]
  /** Results for the CURRENT iteration only. */
  currentResults: readonly MetricResult[]
  /** Results for the PREVIOUS iteration only — used for regression detection. */
  previousResults: readonly MetricResult[]
  /** All counterexamples for the task (open and closed). */
  counterexamples: readonly Counterexample[]
  /** S_{k-1}, or 0 when this is iteration 0. */
  previousAggregateScore: number
  weights?: ScoreWeights
}

/**
 * Materialise an IterationSnapshot. The returned row has arbiter_verdict set
 * to a placeholder "continue"; the caller projects the acceptance review's own
 * verdict (accepted → "accept", otherwise "continue") onto this column before
 * persisting. The deterministic `arbitrate()` function that used to re-derive
 * this value was retired — verdict ownership moved to integrity acceptance review
 * (CLAUDE.md rule 23: no coded state machines).
 */
export function computeIterationSnapshot(input: SnapshotInput): IterationSnapshot {
  const weights = input.weights ?? SCORE_WEIGHT_DEFAULTS
  const specByID = new Map(input.specs.map((s) => [s.id, s]))
  const currentBySpec = indexBySpec(input.currentResults)
  const previousBySpec = indexBySpec(input.previousResults)

  // Per-goal contribution: weighted mean over each goal's own specs, then
  // uniform average across goals. Goals with no fresh result contribute 0.
  const perGoalScore: Record<string, number> = {}
  const goalIDs = uniqueGoalIDs(input.specs)
  for (const goalID of goalIDs) {
    const goalSpecs = input.specs.filter(
      (s) => s.scope === "goal" && s.goal_id === goalID && s.gate_class !== "efficiency",
    )
    perGoalScore[goalID] = weightedMean(goalSpecs, currentBySpec)
  }
  const perGoalOverall =
    goalIDs.length === 0 ? 0 : goalIDs.reduce((sum, g) => sum + perGoalScore[g], 0) / goalIDs.length

  // Global contribution: weighted mean over global specs.
  const globalSpecs = input.specs.filter((s) => s.scope === "global" && s.gate_class !== "efficiency")
  const globalOverall = weightedMean(globalSpecs, currentBySpec)

  const aggregate = weights.alpha * perGoalOverall + weights.beta * globalOverall
  const delta = input.iteration === 0 ? 0 : aggregate - input.previousAggregateScore

  // Blocking unmet: baseline BLOCKING specs whose latest fresh result either
  // failed target OR is missing/stale. "challenge" specs are always diagnostic
  // so they cannot contribute here.
  let blockingUnmet = 0
  let regressedBlocking = 0
  for (const spec of input.specs) {
    if (spec.source !== "baseline" || spec.gate_class !== "blocking") continue
    const curr = currentBySpec.get(spec.id)
    const prev = previousBySpec.get(spec.id)
    const currLive = curr !== undefined && curr.evidence_fresh
    if (!currLive || !curr.met_target || !curr.met_floor) blockingUnmet++
    const prevLive = prev !== undefined && prev.evidence_fresh
    const regressed = prevLive && prev.met_target && currLive && !curr.met_target
    if (regressed) regressedBlocking++
  }

  // Counterexamples: open count + novelty_score (new this iteration).
  let openCounterexamples = 0
  let noveltyScore = 0
  for (const c of input.counterexamples) {
    if (c.iteration_resolved === null) openCounterexamples++
    if (c.iteration_found === input.iteration) noveltyScore++
  }

  // Unused for correctness but kept to silence "specByID unused" — when we
  // later want to group by scope we will need it.
  void specByID

  return {
    task_id: input.task_id,
    iteration: input.iteration,
    aggregate_score: aggregate,
    per_goal_score: perGoalScore,
    global_score: globalOverall,
    delta_vs_prev: delta,
    novelty_score: noveltyScore,
    blocking_unmet_count: blockingUnmet,
    open_counterexamples: openCounterexamples,
    regressed_blocking: regressedBlocking,
    arbiter_verdict: "continue",
  }
}

function indexBySpec(results: readonly MetricResult[]): Map<string, MetricResult> {
  const m = new Map<string, MetricResult>()
  for (const r of results) m.set(r.metric_spec_id, r)
  return m
}

function uniqueGoalIDs(specs: readonly MetricSpec[]): string[] {
  const set = new Set<string>()
  for (const s of specs) {
    if (s.scope === "goal" && s.goal_id !== null) set.add(s.goal_id)
  }
  return [...set]
}

function weightedMean(specs: readonly MetricSpec[], results: Map<string, MetricResult>): number {
  if (specs.length === 0) return 0
  let weightSum = 0
  let weightedSum = 0
  for (const spec of specs) {
    const result = results.get(spec.id)
    if (!result || !result.evidence_fresh) continue
    weightSum += spec.weight
    weightedSum += spec.weight * result.normalized_value
  }
  if (weightSum === 0) return 0
  return weightedSum / weightSum
}
