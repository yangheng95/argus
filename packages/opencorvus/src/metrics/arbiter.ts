/**
 * Arbiter — pure decision function over iteration trajectory.
 *
 * Reads structured iteration rows only; no DB access, no I/O, no judgement
 * about what to DO next — just what state the task is in. The assistant
 * driving the next iteration sees `continue` + the full trajectory + open
 * counterexamples + Defender/Prosecutor rationale and self-directs: maybe
 * it patches code, maybe it reshapes goals, maybe it adds tests. That
 * decision does not belong in the Arbiter.
 *
 * Four verdicts:
 *  - accept   ⇔ all baseline blocking metrics met_floor=1 AND met_target=1
 *               with fresh evidence, AND no open counterexamples AND no
 *               blocking regression this iteration.
 *  - continue ⇔ blocking still unmet, and the loop is still producing
 *               signal. The Orchestrator hands the trajectory to the next
 *               iteration's driver.
 *  - stalled  ⇔ last N iterations flat, no novelty, blocking unmet.
 *               Terminal but not failure — the assistant can't find new
 *               signal on the current task as scoped.
 *  - abort    ⇔ two consecutive iters with regressed_blocking > 0, OR
 *               iteration ≥ maxIterations hard ceiling.
 */
import type { IterationSnapshot, ArbiterVerdict } from "./types"

export interface ArbiterConfig {
  /** Stalled: minimal |Δ| considered "progress". Default 0.015. */
  epsilon: number
  /** Stalled: consecutive flat iterations required. Default 3. */
  stalledN: number
  /** Abort: hard ceiling on iteration count. */
  maxIterations: number
}

export const ARBITER_DEFAULTS: ArbiterConfig = {
  epsilon: 0.015,
  stalledN: 3,
  maxIterations: 16,
}

export interface ArbiterDecision {
  verdict: ArbiterVerdict
  reason: string
}

export function arbitrate(
  history: readonly IterationSnapshot[],
  config: ArbiterConfig = ARBITER_DEFAULTS,
): ArbiterDecision {
  if (history.length === 0) {
    throw new Error("arbitrate: history must include at least the current iteration")
  }
  const current = history[history.length - 1]
  const prev = history.length >= 2 ? history[history.length - 2] : undefined

  // Hard ceiling — takes precedence so a runaway loop always terminates.
  if (current.iteration >= config.maxIterations) {
    return {
      verdict: "abort",
      reason: `iteration ${current.iteration} reached max_iterations ${config.maxIterations}`,
    }
  }

  // Two consecutive iterations with blocking regression ⇒ roll back.
  if (current.regressed_blocking > 0 && prev && prev.regressed_blocking > 0) {
    return {
      verdict: "abort",
      reason:
        `blocking metrics regressed in 2 consecutive iterations ` +
        `(prev=${prev.regressed_blocking}, curr=${current.regressed_blocking})`,
    }
  }

  // Acceptance — all blocking baselines satisfied, no open counterexamples,
  // no fresh regression. S_k does not gate acceptance.
  if (
    current.blocking_unmet_count === 0 &&
    current.open_counterexamples === 0 &&
    current.regressed_blocking === 0
  ) {
    return {
      verdict: "accept",
      reason: `all baseline blocking metrics met, open_counterexamples=0, no blocking regression`,
    }
  }

  // Stalled — N flat iterations with no novelty, blocking still unmet.
  if (history.length >= config.stalledN && current.blocking_unmet_count > 0) {
    const tail = history.slice(-config.stalledN)
    const allFlat = tail.every((it) => Math.abs(it.delta_vs_prev) < config.epsilon)
    const noNewNovelty = tail.every((it) => it.novelty_score === 0)
    if (allFlat && noNewNovelty) {
      return {
        verdict: "stalled",
        reason: `last ${config.stalledN} iterations flat (|Δ|<${config.epsilon}), no novelty, ${current.blocking_unmet_count} blocking metrics still unmet`,
      }
    }
  }

  return {
    verdict: "continue",
    reason:
      current.open_counterexamples > 0
        ? `${current.open_counterexamples} counterexamples open`
        : `${current.blocking_unmet_count} blocking metrics unmet, still producing signal`,
  }
}
