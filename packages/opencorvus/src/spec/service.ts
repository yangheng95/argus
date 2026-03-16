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
 * Derive execution goals (iterative stages) from spec output.
 *
 * Priority order:
 * 1. Explicit goals passed by caller (e.g. user-supplied goals on replan)
 * 2. spec_items from the spec agent — each item maps to one iterative stage
 */
function deriveGoals(output: SpecOutputType, explicitGoals?: Array<z.infer<typeof SpecDraftGoal>>): { goals: z.infer<typeof SpecDraftGoal>[]; derived: boolean } {
  if ((explicitGoals?.length ?? 0) > 0) {
    return {
      goals: explicitGoals!,
      derived: false,
    }
  }
  if (output.spec_items.length < 1) {
    return { goals: [], derived: false }
  }
  return {
    goals: output.spec_items.map((item) => ({
      description: item.title,
      criteria: item.description,
      priority: item.priority,
      metadata: item.check_selector?.length
        ? { check_selector: item.check_selector }
        : undefined,
    })),
    derived: true,
  }
}

/**
 * Convert SpecAgent output to the shared spec draft used by the orchestrator.
 */
function toSpecDraft(output: SpecOutputType, explicitGoals?: z.infer<typeof SpecDraftGoal>[]) {
  const next = deriveGoals(output, explicitGoals)
  return {
    draft: {
      summary: output.summary,
      content: output.content,
      goals: next.goals,
      assumptions: output.assumptions,
      risks: output.risks,
      clarifications: output.clarifications,
    } satisfies SpecDraft,
    derived: next.derived,
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
  }): Promise<SpecDraft & { spec_items: SpecOutputType["spec_items"]; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs(input.timeoutMs)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = input.signal ?? controller.signal

    log.info("spec service initial starting", {
      title: input.title,
      goals: input.goals?.length ?? 0,
    })

    try {
      let specTimer: ReturnType<typeof setTimeout>
      const output = await Promise.race([
        SpecAgent.initial({
          title: input.title,
          request: input.request,
          goals: input.goals,
          sessionID: input.sessionID,
          metadata: input.metadata,
          signal,
          stream: input.stream,
          onStatus: input.onStatus,
        }).finally(() => clearTimeout(specTimer)),
        new Promise<never>((_, reject) => {
          specTimer = setTimeout(() => reject(new SpecFailureError(`spec agent timed out after ${timeoutMs}ms`)), timeoutMs)
        }),
      ])

      log.info("spec service initial completed", {
        title: input.title,
        specItems: output.spec_items.length,
        contentLength: output.content.length,
        evidenceSources: output.evidence_sources.length,
        hasClarifications: (output.clarifications?.length ?? 0) > 0,
      })
      const spec = toSpecDraft(output, input.goals)
      if (spec.derived) {
        log.info("spec service derived execution goals from spec items", {
          title: input.title,
          specItems: output.spec_items.length,
          derivedGoals: spec.draft.goals.length,
        })
      }

      return {
        ...spec.draft,
        spec_items: output.spec_items,
        evidence_sources: output.evidence_sources,
        unresolved_questions: output.unresolved_questions,
      }
    } catch (error) {
      log.error("spec service initial failed", {
        title: input.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent failed", { cause: error })
    } finally {
      clearTimeout(timer)
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
  }): Promise<SpecDraft & { spec_items: SpecOutputType["spec_items"]; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs(input.timeoutMs)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = input.signal ?? controller.signal

    log.info("spec service rewrite starting", {
      title: input.title,
      failureClassification: input.rewriteContext.failureAnalysis.classification,
    })

    try {
      let rewriteTimer: ReturnType<typeof setTimeout>
      const output = await Promise.race([
        SpecAgent.rewrite({
          title: input.title,
          request: input.request,
          rewriteContext: input.rewriteContext,
          goals: input.goals,
          sessionID: input.sessionID,
          metadata: input.metadata,
          signal,
          stream: input.stream,
          onStatus: input.onStatus,
        }).finally(() => clearTimeout(rewriteTimer)),
        new Promise<never>((_, reject) => {
          rewriteTimer = setTimeout(() => reject(new SpecFailureError(`spec agent rewrite timed out after ${timeoutMs}ms`)), timeoutMs)
        }),
      ])

      log.info("spec service rewrite completed", {
        title: input.title,
        specItems: output.spec_items.length,
      })
      const spec = toSpecDraft(output, input.goals)
      if (spec.derived) {
        log.info("spec service derived execution goals from spec items", {
          title: input.title,
          specItems: output.spec_items.length,
          derivedGoals: spec.draft.goals.length,
        })
      }

      return {
        ...spec.draft,
        spec_items: output.spec_items,
        evidence_sources: output.evidence_sources,
        unresolved_questions: output.unresolved_questions,
      }
    } catch (error) {
      log.error("spec service rewrite failed", {
        title: input.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent rewrite failed", { cause: error })
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

export { HeadlessSpecService as SpecService }





