/**
 * DecomposeService — wraps DecomposeAgent with error handling,
 * fidelity review, Decision Log injection, and orchestrator lifecycle management.
 *
 * NO hard timeout — the DecomposeAgent has its own inactivity guard
 * (createInactivityGuard) that aborts on stall. A hard deadline is harmful
 * for complex PRDs where the agent is actively working (making tool calls)
 * but the total wall-clock time is long.
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
   * Wraps DecomposeAgent.decompose() with fidelity review and error handling.
   *
   * No hard timeout — the agent's own inactivity guard handles stalls.
   * The caller's AbortSignal is the only cancellation mechanism.
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
    /** @deprecated — ignored. Inactivity timeout is inside the agent. */
    timeoutMs?: number
  }): Promise<DecomposeResult> {
    log.info("decompose service starting", {
      taskID: input.taskID,
      title: input.title,
    })

    const start = Date.now()
    try {
      const result = await DecomposeAgent.decompose({
        title: input.title,
        request: input.request,
        taskID: input.taskID,
        sessionID: input.sessionID,
        signal: input.signal,
        stream: input.stream,
        onStatus: input.onStatus,
        decisionLog: input.decisionLog,
      })

      if (result.goals.length === 0) {
        throw new DecomposeFailureError("decompose produced no goals")
      }

      // Fidelity Review — LLM verifies goals cover the original user request
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
    /** @deprecated — ignored. Inactivity timeout is inside the agent. */
    timeoutMs?: number
  }): Promise<DecomposeResult> {
    log.info("redecompose service starting", {
      taskID: input.taskID,
      title: input.title,
    })

    const start = Date.now()
    try {
      const result = await DecomposeAgent.decompose({
        title: input.title,
        request: input.request,
        taskID: input.taskID,
        sessionID: input.sessionID,
        signal: input.signal,
        stream: input.stream,
        onStatus: input.onStatus,
        decisionLog: input.decisionLog,
        redecomposeContext: input.redecomposeContext,
      })

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
