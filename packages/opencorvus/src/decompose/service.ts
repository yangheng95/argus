/**
 * DecomposeService — wraps DecomposeAgent with timeout protection,
 * Decision Log injection, and orchestrator lifecycle management.
 *
 * Single entry point replaces old SpecService + GoalService pipeline.
 */
import type { TextHooks } from "@/llm/api"
import { Log } from "@/util/log"
import { DecomposeAgent, type DecomposeResult, type RedecomposeContext } from "./agent"
import { reviewFidelity, applyFidelityCorrections } from "./fidelity"
import type { DecisionLog } from "@/decision-log"

const log = Log.create({ service: "decompose-service" })

export class DecomposeFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "DecomposeFailureError"
  }
}

export namespace DecomposeService {
  /**
   * Decompose a task into goal contracts.
   * Wraps DecomposeAgent.decompose() with timeout and error handling.
   */
  export async function decompose(input: {
    title: string
    request: string
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    decisionLog?: DecisionLog
    timeoutMs?: number
  }): Promise<DecomposeResult> {
    const timeout = input.timeoutMs ?? 300_000

    log.info("decompose service starting", {
      taskID: input.taskID,
      title: input.title,
      timeout,
    })

    const start = Date.now()
    try {
      // Timeout protects only the decompose agent step, not fidelity review.
      // Fidelity review runs after decompose completes and has its own signal check.
      const result = await Promise.race([
        DecomposeAgent.decompose({
          title: input.title,
          request: input.request,
          taskID: input.taskID,
          sessionID: input.sessionID,
          signal: input.signal,
          stream: input.stream,
          onStatus: input.onStatus,
          decisionLog: input.decisionLog,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new DecomposeFailureError("decompose timeout")), timeout),
        ),
      ])

      if (result.goals.length === 0) {
        throw new DecomposeFailureError("decompose produced no goals")
      }

      // Fidelity Review runs outside the timeout race so complex PRDs don't
      // cause spurious timeouts after a slow but successful decompose agent run.
      const fidelity = await reviewFidelity({
        userRequest: input.request,
        taskTitle: input.title,
        goals: result.goals,
        signal: input.signal,
      })

      if (fidelity.verdict === "needs_correction") {
        log.info("fidelity review: applying corrections", {
          taskID: input.taskID,
          issues: fidelity.issues.length,
          corrections: fidelity.corrections.length,
          missingGoals: fidelity.missingGoals.length,
        })
        result.goals = applyFidelityCorrections(result.goals, fidelity)
      }

      log.info("decompose service completed", {
        taskID: input.taskID,
        goalCount: result.goals.length,
        decisionCount: result.decisions.length,
        fidelityVerdict: fidelity.verdict,
        durationMs: Date.now() - start,
      })

      return result
    } catch (err) {
      if (err instanceof DecomposeFailureError) throw err
      throw new DecomposeFailureError(
        `decompose failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  /**
   * Re-decompose after a failed execution.
   */
  export async function redecompose(input: {
    title: string
    request: string
    taskID?: string
    sessionID?: string
    redecomposeContext: RedecomposeContext
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    decisionLog?: DecisionLog
    timeoutMs?: number
  }): Promise<DecomposeResult> {
    const timeout = input.timeoutMs ?? 300_000

    log.info("redecompose service starting", {
      taskID: input.taskID,
      title: input.title,
    })

    const start = Date.now()
    try {
      const result = await Promise.race([
        DecomposeAgent.decompose({
          title: input.title,
          request: input.request,
          taskID: input.taskID,
          sessionID: input.sessionID,
          signal: input.signal,
          stream: input.stream,
          onStatus: input.onStatus,
          decisionLog: input.decisionLog,
          redecomposeContext: input.redecomposeContext,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new DecomposeFailureError("redecompose timeout")), timeout),
        ),
      ])

      log.info("redecompose service completed", {
        taskID: input.taskID,
        goalCount: result.goals.length,
        durationMs: Date.now() - start,
      })

      return result
    } catch (err) {
      if (err instanceof DecomposeFailureError) throw err
      throw new DecomposeFailureError(
        `redecompose failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }
}
