/**
 * DeliveryService — orchestrator-facing delivery verification stage.
 *
 * Wraps the DeliveryAgent with timeout handling and integration
 * with the orchestrator lifecycle.
 *
 * Entry point:
 *   - verify() — Verify the delivery works end-to-end before publishing
 */
import { DeliveryAgent, type DeliveryVerdictType } from "./agent"
import type { GoalJudgmentType, GoalInfo, DeliveryInfo } from "@/types/evaluator"
import { Log } from "@/util/log"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { mergeTextHooks } from "@/llm/tool-hooks"
import { createInactivityGuard } from "@/util/inactivity-guard"

const log = Log.create({ service: "delivery-service" })

function deliveryTimeoutMs(timeoutMs?: number) {
  if (timeoutMs && timeoutMs > 0) return timeoutMs
  return Number(Env.get("OPENCORVUS_DELIVERY_TIMEOUT_MS")) || 600_000
}

export class DeliveryFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "DeliveryFailureError"
  }
}

export namespace DeliveryService {
  export async function verify(input: {
    task: { title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults?: Array<{ name: string; status: string; evidence?: string }>
    analysis?: GoalJudgmentType
    timeoutMs?: number
    signal?: AbortSignal
    stream?: TextHooks
  }): Promise<DeliveryVerdictType> {
    const timeoutMs = deliveryTimeoutMs(input.timeoutMs)
    const controller = new AbortController()
    let timedOut = false
    const guard = createInactivityGuard(timeoutMs, () => {
      timedOut = true
      controller.abort(new DeliveryFailureError(`delivery agent stalled after ${timeoutMs}ms without activity`))
    })
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal
    const stream = mergeTextHooks(input.stream, {
      onChunk: async () => {
        guard.bump()
      },
      onStepFinish: async () => {
        guard.bump()
      },
      onFinish: async () => {
        guard.bump()
      },
      onError: async () => {
        guard.bump()
      },
    })

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
        stream,
        signal,
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
      if (timedOut) throw new DeliveryFailureError(`delivery agent stalled after ${timeoutMs}ms without activity`)
      if (error instanceof DeliveryFailureError) throw error
      throw new DeliveryFailureError("delivery agent failed", { cause: error })
    } finally {
      guard.clear()
      controller.abort()
    }
  }
}

