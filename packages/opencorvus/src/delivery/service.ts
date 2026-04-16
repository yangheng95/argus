/**
 * DeliveryService — orchestrator-facing delivery verification stage.
 *
 * Thin wrapper around DeliveryAgent.verify that:
 *   - Adds entry/exit/error logging at the service boundary
 *   - Wraps any thrown error in `DeliveryFailureError` so callers can type-
 *     check the delivery failure mode without sniffing message strings.
 *
 * Progress / alive / absolute timeouts and abort-signal composition are owned
 * by AgentRuntime (which DeliveryAgent dispatches through). This file used
 * to wrap a redundant second progress-guard around the same agent — that
 * three-layer guard stack was collapsed when delivery was migrated onto
 * AgentRuntime.
 */
import { DeliveryAgent, type DeliveryVerdictType } from "./agent"
import type { GoalJudgmentType, GoalInfo, DeliveryInfo } from "@/delivery/checks/types"
import { Log } from "@/util/log"
import { type TextHooks } from "@/llm/api"

const log = Log.create({ service: "delivery-service" })

export class DeliveryFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "DeliveryFailureError"
  }
}

export namespace DeliveryService {
  export async function verify(input: {
    task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults?: Array<{ name: string; status: string; evidence?: string }>
    analysis?: GoalJudgmentType
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
    signal?: AbortSignal
    stream?: TextHooks
  }): Promise<DeliveryVerdictType> {
    log.info("delivery service verify starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
    })

    try {
      const result = await DeliveryAgent.verify({
        task: input.task,
        goals: input.goals,
        delivery: input.delivery,
        checkResults: input.checkResults,
        analysis: input.analysis,
        attachments: input.attachments,
        stream: input.stream,
        signal: input.signal,
      })
      log.info("delivery service verify completed", {
        title: input.task.title,
        verdict: result.verdict,
        issuesFound: result.issues_found.length,
        startupSuccess: result.startup_verification.success,
      })
      return result
    } catch (error) {
      log.error("delivery service verify failed", {
        title: input.task.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (error instanceof DeliveryFailureError) throw error
      throw new DeliveryFailureError("delivery agent failed", { cause: error })
    }
  }
}
