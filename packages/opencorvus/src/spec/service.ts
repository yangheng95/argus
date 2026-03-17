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

function goalLimit(output: SpecOutputType, metadata?: Record<string, unknown>) {
  const env = Number.parseInt(Env.get("OPENCORVUS_MAX_EXECUTION_GOALS") ?? "", 10)
  if (Number.isFinite(env) && env > 0) return env
  if (output.spec_items.length <= 4) return 0
  const budget =
    metadata?.orchestrator_budget &&
    typeof metadata.orchestrator_budget === "object" &&
    !Array.isArray(metadata.orchestrator_budget)
      ? metadata.orchestrator_budget as Record<string, unknown>
      : undefined
  const wall = typeof budget?.max_wall_time_ms === "number"
    ? budget.max_wall_time_ms
    : typeof budget?.maxWallTimeMs === "number"
      ? budget.maxWallTimeMs
      : 0
  const tight = wall > 0 && wall <= 4 * 60 * 60 * 1000
  const large = output.spec_items.length >= 8 || (output.spec_items.length >= 6 && output.content.length >= 6000)
  if (!tight && !large) return 0
  return tight ? 4 : 6
}

function normalizeSelectors(item: SpecOutputType["spec_items"][number]) {
  if (!item.check_selector?.includes("ui_review")) return item
  const text = `${item.title} ${item.description}`.toLowerCase()
  const architecture = /(architecture|bootstrap|scaffold|initialize|initialization|setup|config|project structure|module structure|directory|技术栈|架构|初始化|配置|目录结构|脚手架|工程结构)/.test(text)
  const ui = /(screen|screens|page|pages|view|views|layout|timeline|calendar|editor|form|首页|页面|界面|视图|交互|时间轴|日历|编辑器)/.test(text)
  if (!architecture || ui) return item
  return {
    ...item,
    check_selector: item.check_selector.filter((value) => value !== "ui_review"),
  }
}

function normalizeOutput(output: SpecOutputType) {
  return {
    ...output,
    spec_items: output.spec_items.map(normalizeSelectors),
  }
}

function trimOutput(output: SpecOutputType, metadata?: Record<string, unknown>) {
  const limit = goalLimit(output, metadata)
  if (limit < 1 || output.spec_items.length <= limit) return output
  const keep = output.spec_items.slice(0, limit)
  const defer = output.spec_items.slice(limit)
  const deferred = defer.map((item) => item.title)
  const scope = `${output.scope}\n当前执行批次仅覆盖前 ${keep.length} 个可交付目标，以保证在预算内完成并验收。`
  const out = [
    output.out_of_scope?.trim(),
    `Deferred for later iterations: ${deferred.join("；")}`,
  ].filter(Boolean).join("\n")
  const content = [
    output.content.trim(),
    "## Execution Tranche",
    `This batch executes the first ${keep.length} spec items only.`,
    ...keep.map((item, index) => `${index + 1}. ${item.title} — ${item.description}`),
    "## Deferred For Later Iterations",
    ...defer.map((item, index) => `${index + 1}. ${item.title} — ${item.description}`),
  ].join("\n\n")
  return {
    ...output,
    content,
    scope,
    out_of_scope: out || undefined,
    spec_items: keep,
  }
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
      const trimmed = trimOutput(normalizeOutput(output), input.metadata)

      log.info("spec service initial completed", {
        title: input.title,
        specItems: trimmed.spec_items.length,
        contentLength: trimmed.content.length,
        evidenceSources: trimmed.evidence_sources.length,
        hasClarifications: (trimmed.clarifications?.length ?? 0) > 0,
      })
      const spec = toSpecDraft(trimmed, input.goals)
      if (spec.derived) {
        log.info("spec service derived execution goals from spec items", {
          title: input.title,
          specItems: trimmed.spec_items.length,
          derivedGoals: spec.draft.goals.length,
        })
      }
      if (trimmed.spec_items.length !== output.spec_items.length) {
        log.info("spec service trimmed execution tranche", {
          title: input.title,
          originalSpecItems: output.spec_items.length,
          keptSpecItems: trimmed.spec_items.length,
        })
      }

      return {
        ...spec.draft,
        scope: trimmed.scope,
        out_of_scope: trimmed.out_of_scope,
        spec_items: trimmed.spec_items,
        evidence_sources: trimmed.evidence_sources,
        unresolved_questions: trimmed.unresolved_questions,
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
      const trimmed = trimOutput(normalizeOutput(output), input.metadata)

      log.info("spec service rewrite completed", {
        title: input.title,
        specItems: trimmed.spec_items.length,
      })
      const spec = toSpecDraft(trimmed, input.goals)
      if (spec.derived) {
        log.info("spec service derived execution goals from spec items", {
          title: input.title,
          specItems: trimmed.spec_items.length,
          derivedGoals: spec.draft.goals.length,
        })
      }
      if (trimmed.spec_items.length !== output.spec_items.length) {
        log.info("spec service trimmed execution tranche", {
          title: input.title,
          originalSpecItems: output.spec_items.length,
          keptSpecItems: trimmed.spec_items.length,
        })
      }

      return {
        ...spec.draft,
        scope: trimmed.scope,
        out_of_scope: trimmed.out_of_scope,
        spec_items: trimmed.spec_items,
        evidence_sources: trimmed.evidence_sources,
        unresolved_questions: trimmed.unresolved_questions,
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



