/**
 * Heuristic scorer executor.
 *
 * Runs each heuristic scorer through an injected `env.exec(cmd)` and decides
 * pass/fail purely from the exit code. `env` is an interface — production
 * wiring passes a child_process-backed executor; tests pass a stub that maps
 * cmd → fixture exit code. Mode (soft/strict) aggregation stays with the
 * per-goal evaluator; this runner is concerned only with the deterministic
 * command→verdict contract required by §Translation and the AEP benchmark.
 */
import type { HeuristicScorer } from "./types"
import { buildHeuristicCommand } from "./translator"

export interface HeuristicExecEnv {
  exec(cmd: string): Promise<number>
}

export interface HeuristicScorerResult {
  name: string
  command: string
  status: "passed" | "failed"
  exitCode: number
  expectedExitCode: number
}

export async function runHeuristicScorers(
  scorers: readonly HeuristicScorer[],
  env: HeuristicExecEnv,
): Promise<HeuristicScorerResult[]> {
  const results: HeuristicScorerResult[] = []
  for (const scorer of scorers) {
    const command = buildHeuristicCommand(scorer)
    const exitCode = await env.exec(command)
    const expected = scorer.expect?.exit_code ?? 0
    results.push({
      name: scorer.name,
      command,
      status: exitCode === expected ? "passed" : "failed",
      exitCode,
      expectedExitCode: expected,
    })
  }
  return results
}
