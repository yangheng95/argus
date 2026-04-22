/**
 * RequirementsService — wraps RequirementsAgent with error handling,
 * fidelity review, Decision Log injection, and orchestrator lifecycle management.
 *
 * Timeout policy lives in RequirementsAgent's AgentRuntime invocation: three
 * independent tiers (alive / progress / absolute) via createProgressGuard,
 * so delta-only loops do not defer the stall timer indefinitely.
 */
import type { TextHooks } from "@/llm/api"
import { Log } from "@/util/log"
import { RequirementsAgent, type RequirementsResult, type RequirementsRetryContext } from "./agent"
import { reviewFidelity, applyFidelityCorrections } from "@/architect/fidelity"
import type { DecisionLog } from "@/decision-log"

const log = Log.create({ service: "requirements-service" })

export class RequirementsFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "RequirementsFailureError"
  }
}

export namespace RequirementsService {
  /**
   * Analyze a task into goal contracts.
   * Wraps RequirementsAgent.run() with fidelity review and error handling.
   *
   * No hard timeout — the agent's own inactivity guard handles stalls.
   * The caller's AbortSignal is the only cancellation mechanism.
   */
  export async function run(input: {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    decisionLog?: DecisionLog
  }): Promise<RequirementsResult> {
    log.info("requirements service starting", {
      taskID: input.taskID,
      title: input.title,
    })

    const start = Date.now()
    try {
      const result = await RequirementsAgent.run({
        title: input.title,
        request: input.request,
        attachments: input.attachments,
        taskID: input.taskID,
        sessionID: input.sessionID,
        signal: input.signal,
        stream: input.stream,
        onStatus: input.onStatus,
        decisionLog: input.decisionLog,
      })

      if (result.goals.length === 0) {
        throw new RequirementsFailureError("requirements agent produced no goals")
      }

      // Fidelity Review — LLM verifies goals cover the original user request.
      // taskID propagates for hexin cache stickiness (avoids cold-cache cost
      // + 401 from missing x-user) and as the aggregate for the
      // FidelityReviewCompleted event. Stream is intentionally NOT passed:
      // the fidelity LLM emits a JSON contract, and piping those tokens into
      // the requirements card produced a raw-JSON reasoning block. The
      // parsed verdict is now delivered via event and rendered natively by
      // the overlay.
      const fidelity = await reviewFidelity({
        userRequest: input.request,
        taskTitle: input.title,
        goals: result.goals,
        signal: input.signal,
        taskID: input.taskID,
        sessionID: input.sessionID,
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

      log.info("requirements service completed", {
        taskID: input.taskID,
        goalCount: result.goals.length,
        decisionCount: result.decisions.length,
        fidelityVerdict: fidelity.verdict,
        durationMs: Date.now() - start,
      })

      return result
    } catch (err) {
      if (err instanceof RequirementsFailureError) throw err
      throw new RequirementsFailureError(
        `requirements failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  /**
   * Re-run requirements analysis after a failed execution.
   */
  export async function retry(input: {
    title: string
    request: string
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    taskID?: string
    sessionID?: string
    retryContext: RequirementsRetryContext
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    decisionLog?: DecisionLog
  }): Promise<RequirementsResult> {
    log.info("requirements retry starting", {
      taskID: input.taskID,
      title: input.title,
    })

    const start = Date.now()
    try {
      const result = await RequirementsAgent.run({
        title: input.title,
        request: input.request,
        attachments: input.attachments,
        taskID: input.taskID,
        sessionID: input.sessionID,
        signal: input.signal,
        stream: input.stream,
        onStatus: input.onStatus,
        decisionLog: input.decisionLog,
        retryContext: input.retryContext,
      })

      log.info("requirements retry completed", {
        taskID: input.taskID,
        goalCount: result.goals.length,
        durationMs: Date.now() - start,
      })

      return result
    } catch (err) {
      if (err instanceof RequirementsFailureError) throw err
      throw new RequirementsFailureError(
        `requirements retry failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }
}
