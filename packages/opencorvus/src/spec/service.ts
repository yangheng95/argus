/**
 * HeadlessSpecService — orchestrator-facing specification stage.
 *
 * Wraps the SpecAgent with timeout handling, persistence, and integration
 * with the orchestrator lifecycle.
 *
 * Three entry points matching the design document:
 *   - initial()  — Generate initial spec when task is created
 *   - compile()  — Fill gaps during spec compilation phase
 *   - rewrite()  — Revise spec based on failure analysis (replan)
 */
import z from "zod"
import { SpecAgent, type SpecOutputType, type SpecRewriteContext, type SpecDraft } from "./agent"
import { Log } from "@/util/log"

const log = Log.create({ service: "spec-service" })

function specTimeoutMs() {
  return Number(process.env.OPENCORVUS_SPEC_TIMEOUT_MS) || 300_000
}

export class SpecFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SpecFailureError"
  }
}

/**
 * Convert SpecAgent output to the SpecDraft format expected by PlannerService.
 * This bridges the new agent output to the existing planner interface.
 */
function toSpecDraft(output: SpecOutputType): SpecDraft {
  return {
    summary: output.summary,
    content: output.content,
    assumptions: output.assumptions,
    risks: output.risks,
    clarifications: output.clarifications,
    evidence_sources: output.evidence_sources,
    unresolved_questions: output.unresolved_questions,
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
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    signal?: AbortSignal
    stream?: import("@/llm/api").TextHooks
  }): Promise<SpecDraft & { spec_items: SpecOutputType["spec_items"]; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = input.signal ?? controller.signal

    log.info("spec service initial starting", {
      title: input.title,
      goals: input.goals?.length ?? 0,
    })

    try {
      const output = await Promise.race([
        SpecAgent.initial({
          title: input.title,
          request: input.request,
          goals: input.goals?.map(g => ({
            description: g.description,
            criteria: g.criteria,
            priority: g.priority,
          })),
          signal,
          stream: input.stream,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new SpecFailureError(`spec agent timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ])

      log.info("spec service initial completed", {
        title: input.title,
        specItems: output.spec_items.length,
        contentLength: output.content.length,
        evidenceSources: output.evidence_sources.length,
        hasClarifications: (output.clarifications?.length ?? 0) > 0,
      })

      return {
        ...toSpecDraft(output),
        spec_items: output.spec_items,
        evidence_sources: output.evidence_sources,
        unresolved_questions: output.unresolved_questions,
      }
    } catch (error) {
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent failed", { cause: error })
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  /**
   * Compile/fill gaps in a spec during the spec compilation phase.
   */
  export async function compile(input: {
    title: string
    request: string
    previousSpec?: string
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    signal?: AbortSignal
  }): Promise<SpecDraft & { spec_items: SpecOutputType["spec_items"]; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = input.signal ?? controller.signal

    log.info("spec service compile starting", { title: input.title })

    try {
      const output = await Promise.race([
        SpecAgent.compile({
          title: input.title,
          request: input.request,
          previousSpec: input.previousSpec,
          goals: input.goals?.map(g => ({
            description: g.description,
            criteria: g.criteria,
            priority: g.priority,
          })),
          signal,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new SpecFailureError(`spec agent compile timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ])

      log.info("spec service compile completed", {
        title: input.title,
        specItems: output.spec_items.length,
      })

      return {
        ...toSpecDraft(output),
        spec_items: output.spec_items,
        evidence_sources: output.evidence_sources,
        unresolved_questions: output.unresolved_questions,
      }
    } catch (error) {
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent compile failed", { cause: error })
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
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    signal?: AbortSignal
  }): Promise<SpecDraft & { spec_items: SpecOutputType["spec_items"]; evidence_sources: string[]; unresolved_questions: string[] }> {
    const timeoutMs = specTimeoutMs()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = input.signal ?? controller.signal

    log.info("spec service rewrite starting", {
      title: input.title,
      failureClassification: input.rewriteContext.failureAnalysis.classification,
    })

    try {
      const output = await Promise.race([
        SpecAgent.rewrite({
          title: input.title,
          request: input.request,
          rewriteContext: input.rewriteContext,
          goals: input.goals?.map(g => ({
            description: g.description,
            criteria: g.criteria,
            priority: g.priority,
          })),
          signal,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new SpecFailureError(`spec agent rewrite timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ])

      log.info("spec service rewrite completed", {
        title: input.title,
        specItems: output.spec_items.length,
      })

      return {
        ...toSpecDraft(output),
        spec_items: output.spec_items,
        evidence_sources: output.evidence_sources,
        unresolved_questions: output.unresolved_questions,
      }
    } catch (error) {
      if (error instanceof SpecFailureError) throw error
      throw new SpecFailureError("spec agent rewrite failed", { cause: error })
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
}

export { HeadlessSpecService as SpecService }
