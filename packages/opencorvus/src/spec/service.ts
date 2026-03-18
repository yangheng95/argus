/**
 * HeadlessSpecService â€” orchestrator-facing specification stage.
 *
 * Wraps the SpecAgent with timeout handling, persistence, and integration
 * with the orchestrator lifecycle.
 *
 * Two entry points matching the current orchestrator lifecycle:
 *   - initial()  â€” Generate initial spec when task is created
 *   - rewrite()  â€” Revise spec based on failure analysis (replan)
 */
import z from "zod"
import { SpecAgent, type SpecOutputType, type SpecRewriteContext, type SpecDraft, SpecDraftGoal } from "./agent"
import { Log } from "@/util/log"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { mergeTextHooks } from "@/llm/tool-hooks"
import { createInactivityGuard } from "@/util/inactivity-guard"

const log = Log.create({ service: "spec-service" })

function specTimeoutMs(timeoutMs?: number) {
  if (timeoutMs && timeoutMs > 0) return timeoutMs
  return Number(Env.get("OPENCORVUS_SPEC_TIMEOUT_MS")) || 120_000
}

export class SpecFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SpecFailureError"
  }
}


/**
 * Convert SpecAgent output to the shared spec draft used by the orchestrator.
 */
function toSpecDraft(output: SpecOutputType, explicitGoals?: z.infer<typeof SpecDraftGoal>[]) {
  void explicitGoals
  return {
    draft: {
      summary: output.summary,
      content: output.content,
      requirements: output.requirements,
      assumptions: output.assumptions,
      risks: output.risks,
      clarifications: output.clarifications,
    } satisfies SpecDraft,
    derived: (explicitGoals?.length ?? 0) > 0,
  }
}

export namespace HeadlessSpecService {
  /**
   * Generate initial spec from task request using the SpecAgent.
   * The agent explores the codebase and produces a grounded specification.
   */
  export async function initial(input: {
    title: string
    request: string
    goals?: z.infer<typeof SpecDraftGoal>[]
    sessionID?: string
    metadata?: Record<string, unknown>
    timeoutMs?: number
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<SpecDraft & { scope: string; out_of_scope?: string; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs(input.timeoutMs)
    const controller = new AbortController()
    let timedOut = false
    const guard = createInactivityGuard(timeoutMs, () => {
      timedOut = true
      controller.abort(new SpecFailureError(`spec agent stalled after ${timeoutMs}ms without activity`))
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
    const onStatus = async (summary: string) => {
      guard.bump()
      await input.onStatus?.(summary)
    }

    log.info("spec service initial starting", {
      title: input.title,
      goals: input.goals?.length ?? 0,
    })

    try {
      const formulated = await SpecAgent.initial({
        title: input.title,
        request: input.request,
        goals: input.goals,
        sessionID: input.sessionID,
        metadata: input.metadata,
        signal,
        stream,
        onStatus,
      })
      log.info("spec service initial completed", {
        title: input.title,
        requirements: formulated.requirements.length,
        contentLength: formulated.content.length,
        evidenceSources: formulated.evidence_sources.length,
        hasClarifications: (formulated.clarifications?.length ?? 0) > 0,
      })
      const spec = toSpecDraft(formulated, input.goals)

      return {
        ...spec.draft,
        scope: formulated.scope,
        out_of_scope: formulated.out_of_scope,
        evidence_sources: formulated.evidence_sources,
        unresolved_questions: formulated.unresolved_questions,
      }
    } catch (error) {
      log.error("spec service initial failed", {
        title: input.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (timedOut) throw new SpecFailureError(`spec agent stalled after ${timeoutMs}ms without activity`)
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent failed", { cause: error })
    } finally {
      guard.clear()
      controller.abort()
    }
  }

  /**
   * Rewrite a spec based on failure analysis from the evaluator.
   */
  export async function rewrite(input: {
    title: string
    request: string
    rewriteContext: SpecRewriteContext
    goals?: z.infer<typeof SpecDraftGoal>[]
    sessionID?: string
    metadata?: Record<string, unknown>
    timeoutMs?: number
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<SpecDraft & { scope: string; out_of_scope?: string; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs(input.timeoutMs)
    const controller = new AbortController()
    let timedOut = false
    const guard = createInactivityGuard(timeoutMs, () => {
      timedOut = true
      controller.abort(new SpecFailureError(`spec agent rewrite stalled after ${timeoutMs}ms without activity`))
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
    const onStatus = async (summary: string) => {
      guard.bump()
      await input.onStatus?.(summary)
    }

    log.info("spec service rewrite starting", {
      title: input.title,
      failureClassification: input.rewriteContext.failureAnalysis.classification,
    })

    try {
      const formulated = await SpecAgent.rewrite({
        title: input.title,
        request: input.request,
        rewriteContext: input.rewriteContext,
        goals: input.goals,
        sessionID: input.sessionID,
        metadata: input.metadata,
        signal,
        stream,
        onStatus,
      })
      log.info("spec service rewrite completed", {
        title: input.title,
        requirements: formulated.requirements.length,
      })
      const spec = toSpecDraft(formulated, input.goals)

      return {
        ...spec.draft,
        scope: formulated.scope,
        out_of_scope: formulated.out_of_scope,
        evidence_sources: formulated.evidence_sources,
        unresolved_questions: formulated.unresolved_questions,
      }
    } catch (error) {
      log.error("spec service rewrite failed", {
        title: input.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (timedOut) throw new SpecFailureError(`spec agent rewrite stalled after ${timeoutMs}ms without activity`)
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent rewrite failed", { cause: error })
    } finally {
      guard.clear()
      controller.abort()
    }
  }
}

export { HeadlessSpecService as SpecService }
