import { describe, expect, test } from "bun:test"
import {
  ARBITER_DEFAULTS,
  arbitrate,
  type ArbiterConfig,
} from "../../src/metrics/arbiter"
import type { IterationSnapshot } from "../../src/metrics/types"

function snap(i: number, over: Partial<IterationSnapshot> = {}): IterationSnapshot {
  return {
    task_id: "tsk_test",
    iteration: i,
    aggregate_score: 0,
    per_goal_score: {},
    global_score: 0,
    delta_vs_prev: 0,
    novelty_score: 0,
    blocking_unmet_count: 0,
    open_counterexamples: 0,
    regressed_blocking: 0,
    arbiter_verdict: "continue",
    ...over,
  }
}

const loose: ArbiterConfig = { ...ARBITER_DEFAULTS, maxIterations: 100 }

describe("arbitrate — four verdicts", () => {
  test("accept: all blocking met, no counterexamples, no regression", () => {
    const decision = arbitrate(
      [snap(0, { blocking_unmet_count: 0, open_counterexamples: 0 })],
      loose,
    )
    expect(decision.verdict).toBe("accept")
  })

  test("continue: blocking unmet but signal still flowing", () => {
    const decision = arbitrate(
      [
        snap(0, { aggregate_score: 0.2, blocking_unmet_count: 3 }),
        snap(1, {
          aggregate_score: 0.5,
          delta_vs_prev: 0.3,
          blocking_unmet_count: 2,
        }),
      ],
      loose,
    )
    expect(decision.verdict).toBe("continue")
  })

  test("continue when counterexamples are open (drives next driver to address them)", () => {
    const decision = arbitrate(
      [snap(0, { blocking_unmet_count: 0, open_counterexamples: 2 })],
      loose,
    )
    expect(decision.verdict).toBe("continue")
    expect(decision.reason).toContain("counterexamples open")
  })

  test("stalled: N flat iterations + no novelty + blocking unmet", () => {
    const history: IterationSnapshot[] = [
      snap(0, { aggregate_score: 0.6, blocking_unmet_count: 1 }),
      snap(1, {
        aggregate_score: 0.601,
        delta_vs_prev: 0.001,
        blocking_unmet_count: 1,
      }),
      snap(2, {
        aggregate_score: 0.6015,
        delta_vs_prev: 0.0005,
        blocking_unmet_count: 1,
      }),
      snap(3, {
        aggregate_score: 0.601,
        delta_vs_prev: -0.0005,
        blocking_unmet_count: 1,
      }),
    ]
    expect(arbitrate(history, loose).verdict).toBe("stalled")
  })

  test("stalled does NOT fire when novelty appears in the window", () => {
    const history: IterationSnapshot[] = [
      snap(0, { blocking_unmet_count: 1 }),
      snap(1, { delta_vs_prev: 0.001, blocking_unmet_count: 1 }),
      snap(2, {
        delta_vs_prev: 0.002,
        blocking_unmet_count: 1,
        novelty_score: 1,
      }),
    ]
    expect(arbitrate(history, loose).verdict).toBe("continue")
  })

  test("accept trumps stalled when blocking is met", () => {
    const history: IterationSnapshot[] = [
      snap(0, { blocking_unmet_count: 0 }),
      snap(1, { delta_vs_prev: 0, blocking_unmet_count: 0 }),
      snap(2, { delta_vs_prev: 0, blocking_unmet_count: 0 }),
    ]
    expect(arbitrate(history, loose).verdict).toBe("accept")
  })

  test("abort: two consecutive iterations with blocking regression", () => {
    const history: IterationSnapshot[] = [
      snap(0, { blocking_unmet_count: 1 }),
      snap(1, { regressed_blocking: 1, blocking_unmet_count: 2 }),
      snap(2, { regressed_blocking: 1, blocking_unmet_count: 3 }),
    ]
    expect(arbitrate(history, loose).verdict).toBe("abort")
  })

  test("abort: max_iterations ceiling", () => {
    const strict: ArbiterConfig = { ...ARBITER_DEFAULTS, maxIterations: 10 }
    expect(arbitrate([snap(10, { blocking_unmet_count: 1 })], strict).verdict).toBe(
      "abort",
    )
  })

  test("single regression followed by recovery is NOT abort", () => {
    const history: IterationSnapshot[] = [
      snap(0, { blocking_unmet_count: 1 }),
      snap(1, { regressed_blocking: 1, blocking_unmet_count: 2 }),
      snap(2, {
        regressed_blocking: 0,
        blocking_unmet_count: 1,
        delta_vs_prev: 0.2,
      }),
    ]
    expect(arbitrate(history, loose).verdict).toBe("continue")
  })

  test("empty history throws", () => {
    expect(() => arbitrate([], loose)).toThrow()
  })

  test("accept requires regressed_blocking=0 even if everything else clears", () => {
    const decision = arbitrate(
      [
        snap(0, {
          blocking_unmet_count: 0,
          open_counterexamples: 0,
          regressed_blocking: 1,
        }),
      ],
      loose,
    )
    expect(decision.verdict).toBe("continue")
  })
})
