import z from "zod"
import fs from "fs"
import path from "path"
import { type ExecutorNameInfo } from "@/executor/compat"
import { GoalInput, type EvaluationProvider, type PlanningProvider, type StageRouting } from "@/orchestrator/model"
import { suppressClarifications, unattendedProject } from "@/orchestrator/unattended"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { ExecutorPlanner } from "./executor"
import { PlannerAgent, type PlannerOutputType, type ReplanContext } from "./agent"
import { type ClarificationResult, type SpecDraft } from "@/spec/agent"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { normalizePlanWaves, waveMilestones, type WaveContractType } from "@/orchestrator/wave"

const log = Log.create({ service: "planner" })

/** Max time to wait for PlannerAgent before surfacing a planner failure.
 *  Must be >= the agent's internal timeout to avoid killing the agent
 *  mid-exploration. Override via OPENCORVUS_PLANNER_TIMEOUT_MS env var. */
function plannerTimeoutMs(timeoutMs?: number) {
  if (timeoutMs && timeoutMs > 0) return timeoutMs
  return Number(Env.get("OPENCORVUS_PLANNER_TIMEOUT_MS")) || 120_000
}

type StageInfo = {
  requested: z.infer<typeof PlanningProvider> | z.infer<typeof EvaluationProvider>
  resolved: "opencorvus" | "executor"
  executor?: ExecutorNameInfo
  fallback_reason?: string
  warning?: string
}

type StageSet = {
  spec: StageInfo
  plan: StageInfo
  evaluation: StageInfo
}

// ---------------------------------------------------------------------------
// Spec analysis schema — output of LLM-based spec expansion
// ---------------------------------------------------------------------------

const SpecAnalysis = z.object({
  expanded_spec: z.string(),
  goals: GoalInput.array().default([]),
  ambiguities: z.array(z.string()),
  questions: z.array(
    z.object({
      question: z.string(),
      context: z.string(),
      default_assumption: z.string(),
    }),
  ),
  risk_areas: z.array(z.string()),
  assumptions: z.array(
    z.object({
      question: z.string(),
      assumption: z.string(),
    }),
  ).default([]),
  confidence: z.number().transform((v) => Math.max(0, Math.min(1, v))),
})
type SpecAnalysisResult = z.infer<typeof SpecAnalysis>

type PlannerSpec = SpecDraft & {
  spec_items?: Array<{
    check_selector?: string[]
  }>
}

export type PlanDraft = {
  summary: string
  prompt: string
  metadata: {
    strategy?: "initial" | "replan"
    steps: string[]
    failure_summary?: string
    previous_plan_id?: string
    waves?: WaveContractType[]
    milestones?: Array<{ title: string; description?: string; goal_indices: number[] }>
    risks?: string[]
    spec?: {
      summary?: string
      source?: Record<string, unknown>
      file?: string
      created_at?: number
    }
    stage_sources?: Record<string, unknown>
    planner?: ReturnType<typeof plannerMeta>
    clarification?: ClarificationResult
    spec_analysis?: SpecAnalysisResult
    [key: string]: unknown
  }
}

function plannerMeta(input: {
  quality: "compiled"
  source: "planner_agent" | "executor_native" | "spec_stage"
  clarificationSource: "model" | "heuristic" | "suppressed" | "none"
}) {
  return {
    role: "headless_compiler" as const,
    quality: input.quality,
    source: input.source,
    clarification_source: input.clarificationSource,
  }
}

export class PlannerFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PlannerFailureError"
  }
}

/**
 * HeadlessPlannerService — orchestrator-facing planning stage.
 *
 * Generates execution prompts with LLM-powered spec analysis.
 *
 * New flow:
 *   1. Consume the approved spec and its authoritative goals
 *   2. Generate execution structure, milestones, risks, and prompt fragments
 *   3. Surface execution-strategy clarifications only when planning is blocked
 *   4. Build a detailed execution prompt incorporating the expanded spec
 *
 * Planning is mandatory. If the planner agent fails, surface the error.
 */
export namespace HeadlessPlannerService {
  /**
   * Generate an initial plan from a completed spec.
   *
   * The spec is produced BEFORE calling this function — the orchestrator
   * runs the spec agent first, persists the result, then passes it here.
   * This decoupling matches the design document's 7-phase lifecycle.
   */
  export async function initial(input: {
    title: string
    request: string
    spec?: PlannerSpec
    goals?: z.infer<typeof GoalInput>[]
    allowClarification?: boolean
    executor?: ExecutorNameInfo
    routing?: z.infer<typeof StageRouting>
    timeoutMs?: number
    stream?: TextHooks
  }): Promise<PlanDraft> {
    const unattended = await unattendedProject()
    const stages = resolveStages(input.executor, input.routing)
    const spec = unattended && input.spec ? suppressClarifications(input.spec) : input.spec
    const goals = resolveGoals(input.request, spec, input.goals)
    const timeoutMs = plannerTimeoutMs(input.timeoutMs)
    const clarification = specClarification(spec)
    if (clarification) {
      return blockedPlanDraft({
        strategy: "initial",
        title: input.title,
        request: input.request,
        spec,
        goals,
        clarification,
        stages,
      })
    }
    if (stages.plan.resolved === "executor" && stages.plan.executor) {
      if (!spec) throw new PlannerFailureError("executor-native planner requires a specification")
      const output = await ExecutorPlanner.plan({
        executor: stages.plan.executor,
        title: input.title,
        request: input.request,
        spec,
        goals,
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((error) => {
        throw new PlannerFailureError("executor-native planner failed", { cause: error })
      })
      return agentOutputToDraft(
        input.title,
        input.request,
        output,
        "initial",
        undefined,
        undefined,
        input.allowClarification !== false && !unattended,
        goals,
        {
          spec,
          stages,
          source: "executor_native",
        },
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let planTimeout: ReturnType<typeof setTimeout>
    const agentResult = await Promise.race([
      PlannerAgent.plan({
        title: input.title,
        request: input.request,
        userGoals: goals.map((g) => ({
          description: g.description,
          criteria: g.criteria,
          priority: g.priority,
        })),
        spec: spec ? { summary: spec.summary, content: spec.content } : undefined,
        timeoutMs,
        signal: controller.signal,
        stream: input.stream,
      }).catch((error) => {
        throw new PlannerFailureError("planner agent failed", { cause: error })
      }).finally(() => clearTimeout(planTimeout)),
      new Promise<never>((_, reject) => {
        planTimeout = setTimeout(() => reject(new PlannerFailureError(`planner timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ]).finally(() => {
      clearTimeout(timer)
      controller.abort()
    })

    return agentOutputToDraft(
      input.title,
      input.request,
      agentResult,
      "initial",
      undefined,
      undefined,
      input.allowClarification !== false && !unattended,
      goals,
      {
        spec,
        stages,
        source: "planner_agent",
      },
    )
  }

  /**
   * Generate a replan from a revised spec after a failed execution.
   *
   * Like initial(), the spec is produced BEFORE calling this function.
   */
  export async function replan(input: {
    title: string
    request: string
    spec?: PlannerSpec
    goals?: z.infer<typeof GoalInput>[]
    previousPrompt: string
    previousPlanID: string
    failureSummary: string
    replanContext?: ReplanContext
    allowClarification?: boolean
    executor?: ExecutorNameInfo
    routing?: z.infer<typeof StageRouting>
    timeoutMs?: number
    stream?: TextHooks
  }): Promise<PlanDraft> {
    const unattended = await unattendedProject()
    const stages = resolveStages(input.executor, input.routing)
    const spec = unattended && input.spec ? suppressClarifications(input.spec) : input.spec
    const goals = resolveGoals(input.request, spec, input.goals)
    const timeoutMs = plannerTimeoutMs(input.timeoutMs)
    const clarification = specClarification(spec)
    if (clarification) {
      return blockedPlanDraft({
        strategy: "replan",
        title: input.title,
        request: input.request,
        spec,
        goals,
        clarification,
        stages,
        previousPlanID: input.previousPlanID,
        failureSummary: input.failureSummary,
      })
    }
    // Build replan context (use structured analysis if available, otherwise infer from summary)
    const replanCtx: ReplanContext = input.replanContext ?? {
      previousSummary: summarize(input.previousPrompt),
      failureAnalysis: {
        classification: "unknown",
        summary: input.failureSummary,
        rootCause: input.failureSummary,
        suggestedStrategy: "Analyze the failure and try a different approach",
        avoidApproaches: [],
      },
      previousGoalStatuses: goals.map((g) => ({
        description: g.description,
        status: "failed",
        evidence: input.failureSummary,
        })),
    }

    if (stages.plan.resolved === "executor" && stages.plan.executor) {
      if (!spec) throw new PlannerFailureError("executor-native planner requires a specification")
      const output = await ExecutorPlanner.plan({
        executor: stages.plan.executor,
        title: input.title,
        request: input.request,
        spec,
        goals,
        replanContext: replanCtx,
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((error) => {
        throw new PlannerFailureError("executor-native planner replan failed", { cause: error })
      })
      return agentOutputToDraft(
        input.title,
        input.request,
        output,
        "replan",
        input.previousPlanID,
        input.failureSummary,
        input.allowClarification !== false && !unattended,
        goals,
        {
          spec,
          stages,
          source: "executor_native",
        },
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let replanTimeout: ReturnType<typeof setTimeout>
    const agentResult = await Promise.race([
      PlannerAgent.plan({
        title: input.title,
        request: input.request,
        replanContext: replanCtx,
        spec: spec ? { summary: spec.summary, content: spec.content } : undefined,
        timeoutMs,
        signal: controller.signal,
        stream: input.stream,
      }).catch((error) => {
        throw new PlannerFailureError("planner agent replan failed", { cause: error })
      }).finally(() => clearTimeout(replanTimeout)),
      new Promise<never>((_, reject) => {
        replanTimeout = setTimeout(() => reject(new PlannerFailureError(`planner timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ]).finally(() => {
      clearTimeout(timer)
      controller.abort()
    })
    return agentOutputToDraft(
      input.title,
      input.request,
      agentResult,
      "replan",
      input.previousPlanID,
      input.failureSummary,
      input.allowClarification !== false && !unattended,
      goals,
      {
        spec,
        stages,
        source: "planner_agent",
      },
    )
  }
}

export { HeadlessPlannerService as PlannerService }

function resolveStages(executor: ExecutorNameInfo | undefined, routing?: z.infer<typeof StageRouting>): StageSet {
  const requestedEvaluation = routing?.evaluation ?? "opencorvus"
  return {
    spec: resolvePlanningStage("spec", routing?.spec ?? "opencorvus", executor),
    plan: resolvePlanningStage("plan", routing?.plan ?? "opencorvus", executor),
    evaluation: requestedEvaluation === "hybrid"
      ? {
          requested: requestedEvaluation,
          resolved: "opencorvus",
          fallback_reason: "hybrid evaluation is not implemented yet",
        }
      : {
          requested: requestedEvaluation,
          resolved: "opencorvus",
        },
  }
}

function resolvePlanningStage(
  stage: "spec" | "plan",
  requested: z.infer<typeof PlanningProvider>,
  executor?: ExecutorNameInfo,
): StageInfo {
  if (requested !== "executor") {
    return {
      requested,
      resolved: "opencorvus",
    }
  }
  if (!executor || executor === "opencode") {
    return {
      requested,
      resolved: "opencorvus",
      fallback_reason: "executor-native planning requires an external executor",
    }
  }
  if (!ExecutorPlanner.supports(executor, stage)) {
    return {
      requested,
      resolved: "opencorvus",
      executor,
      fallback_reason: `executor ${executor} does not support ${stage} generation`,
    }
  }
  return {
    requested,
    resolved: "executor",
    executor,
    warning: executorPlanningWarning(stage, executor),
  }
}

function specClarification(spec?: PlannerSpec): ClarificationResult | undefined {
  const questions = (Array.isArray(spec?.clarifications) ? spec.clarifications : []).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    if (typeof item.question !== "string" || !item.question.trim()) return []
    return [{
      header: typeof item.header === "string" && item.header.trim() ? item.header : "Clarification",
      question: item.question,
      context: typeof item.context === "string" && item.context.trim() ? item.context : undefined,
      default_assumption:
        typeof item.default_assumption === "string" && item.default_assumption.trim() ? item.default_assumption : undefined,
    }]
  })
  if (questions.length === 0) return
  return {
    reason: questions[0]?.context ?? "Specification requires clarification before planning.",
    questions,
  }
}

function planSpecMeta(spec?: PlannerSpec, stages?: StageSet) {
  if (!spec) return
  return {
    summary: spec.summary,
    source: stages?.spec,
    ...("spec_items" in spec ? { spec_items: (spec as Record<string, unknown>).spec_items } : {}),
    ...("evidence_sources" in spec ? { evidence_sources: (spec as Record<string, unknown>).evidence_sources } : {}),
    ...("unresolved_questions" in spec ? { unresolved_questions: (spec as Record<string, unknown>).unresolved_questions } : {}),
    ...("scope" in spec && (spec as Record<string, unknown>).scope ? { scope: (spec as Record<string, unknown>).scope } : {}),
    ...("out_of_scope" in spec && (spec as Record<string, unknown>).out_of_scope ? { out_of_scope: (spec as Record<string, unknown>).out_of_scope } : {}),
  }
}

function blockedPlanDraft(input: {
  strategy: "initial" | "replan"
  title: string
  request: string
  spec?: PlannerSpec
  goals: z.infer<typeof GoalInput>[]
  clarification: ClarificationResult
  stages: StageSet
  previousPlanID?: string
  failureSummary?: string
}): PlanDraft {
  const risks = Array.isArray(input.spec?.risks) ? [...new Set(input.spec.risks)] : []
  const assumptions = Array.isArray(input.spec?.assumptions) ? input.spec.assumptions : []
  return {
    summary: "Clarification required before planning",
    prompt: [
      "Planning is blocked pending specification clarification.",
      `Task: ${input.title}`,
      `Original request:\n${input.request.trim()}`,
      input.spec?.content ? `Current specification:\n${input.spec.content.trim()}` : "",
    ].filter(Boolean).join("\n\n"),
    metadata: {
      strategy: input.strategy,
      steps: ["Clarify the specification before generating a plan"],
      failure_summary: input.failureSummary,
      previous_plan_id: input.previousPlanID,
      risks,
      planner: plannerMeta({
        quality: "compiled",
        source: "spec_stage",
        clarificationSource: "model",
      }),
      spec: planSpecMeta(input.spec, input.stages),
      stage_sources: input.stages,
      clarification: input.clarification,
      spec_analysis: {
        expanded_spec: input.spec?.content ?? "",
        goals: input.goals,
        ambiguities: input.clarification.questions.map((item) => item.question),
        questions: input.clarification.questions.map((item) => ({
          question: item.question,
          context: item.context ?? input.clarification.reason,
          default_assumption: item.default_assumption ?? "",
        })),
        risk_areas: risks,
        assumptions,
        confidence: 0.35,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Agent output → PlanDraft conversion
// ---------------------------------------------------------------------------

function agentOutputToDraft(
  title: string,
  request: string,
  output: PlannerOutputType,
  strategy: "initial" | "replan",
  previousPlanID?: string,
  failureSummary?: string,
  allowClarification = true,
  goals: z.infer<typeof GoalInput>[] = [],
  stage?: {
    spec?: PlannerSpec
    stages?: StageSet
    source: "planner_agent" | "executor_native"
  },
): PlanDraft {
  // Normalize output arrays — tool-call args may lack Zod defaults for optional fields
  output = {
    ...output,
    subtasks: Array.isArray(output.subtasks) ? output.subtasks : [],
    risks: Array.isArray(output.risks) ? output.risks : [],
    assumptions: Array.isArray(output.assumptions) ? output.assumptions : undefined,
    waves: Array.isArray(output.waves) ? output.waves : undefined,
    clarifications: Array.isArray(output.clarifications) ? output.clarifications : undefined,
  }
  // Authoritative goals come from the spec (or user goals when no spec exists).
  // The planner output is only execution structure and analysis.
  const spec = stage?.spec
  const assumptions = mergeAssumptions(stage?.spec?.assumptions, output.assumptions)
  const risks = mergeStrings(stage?.spec?.risks ?? [], output.risks)
  const waves = normalizePlanWaves({ waves: output.waves, goals })
  const milestones = waveMilestones(waves)

  // Planner agent's PRD is grounded in codebase exploration and takes priority.
  // Spec content provides the requirements context; planner output provides
  // implementation-level detail.
  const prompt = renderAgentPrompt({
    title,
    request,
    prd: output.prd || stage?.spec?.content || "",
    goals,
    subtasks: output.subtasks,
    risks,
    assumptions,
    strategy,
    waves: waves.map((wave) => ({ title: wave.title, objective: wave.objective })),
  })

  const steps = output.subtasks
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s, i) => `${s.order ?? i + 1}. ${s.title}: ${s.description}`)
  const clarification = allowClarification ? deriveClarification(output, request) : undefined
  const clarificationSource =
    !allowClarification
      ? "suppressed"
      : hasModelClarification(output)
        ? "model"
        : clarification
          ? "heuristic"
        : "none"

  return {
    summary: output.summary,
    prompt,
    metadata: {
      strategy: strategy as "initial" | "replan",
      steps,
      failure_summary: failureSummary,
      previous_plan_id: previousPlanID,
      waves,
      milestones,
      risks,
      planner: plannerMeta({
        quality: "compiled",
        source: stage?.source ?? "planner_agent",
        clarificationSource,
      }),
      spec: planSpecMeta(stage?.spec, stage?.stages),
      stage_sources: stage?.stages,
      clarification,
      spec_analysis: {
        expanded_spec: output.prd || stage?.spec?.content || "",
        goals,
        ambiguities: clarification?.questions.map((item) => item.question) ?? [],
        questions:
          clarification?.questions.map((item) => ({
            question: item.question,
            context: item.context ?? clarification.reason,
            default_assumption: item.default_assumption ?? "",
          })) ?? [],
        risk_areas: risks,
        assumptions,
        confidence: clarification ? 0.45 : 0.9,
      },
    },
  }
}

function renderAgentPrompt(input: {
  title: string
  request: string
  prd: string
  goals: Array<{ description: string; criteria: string; priority?: string; metadata?: { check_selector?: string[] } }>
  subtasks: Array<{ title: string; description: string; order?: number }>
  risks: string[]
  assumptions?: Array<{ question: string; assumption: string }>
  strategy?: "initial" | "replan"
  waves?: Array<{ title: string; objective?: string }>
}) {
  const sections = [
    `You are executing a headless coding task inside OpenCorvus.

Task: ${input.title}

## Specification

### Original Request
${input.request.trim()}

### Expanded Specification (from codebase analysis)
${input.prd.trim()}`,
  ]

  if (input.assumptions && input.assumptions.length > 0) {
    sections.push(
      `### Assumptions\n${input.assumptions
        .map((a, i) => `${i + 1}. **${a.question}**\n   → ${a.assumption}`)
        .join("\n\n")}`,
    )
  }

  // Goals with check selectors for self-verification
  sections.push(
    `## Goals\n${input.goals
      .map((g, i) => {
        const checks = g.metadata?.check_selector
        const checksLine = checks?.length ? `\n   Checks: ${checks.join(", ")}` : ""
        return `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}${checksLine}`
      })
      .join("\n\n")}\n\nAfter completing all subtasks, verify EVERY blocking goal by running its listed checks. A goal without evidence of passing is a goal not met.`,
  )

  sections.push(
    `## Subtasks (execute in order)\n${input.subtasks
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s, i) => `${s.order ?? i + 1}. **${s.title}**\n   ${s.description}`)
      .join("\n\n")}`,
  )

  if (input.risks.length > 0) {
    sections.push(
      `## Risk Areas\n${input.risks.map((r) => `- ${r}`).join("\n")}`,
    )
  }

  sections.push(buildWorkflowSection({
    taskType: input.strategy ?? "initial",
    hasRelevantMemory: false,
    hasPriorFailure: input.strategy === "replan",
    waves: input.waves,
  }))

  return sections.join("\n\n")
}

function mergeStrings(...items: Array<string[] | undefined>) {
  const seen = new Set<string>()
  return items.flatMap((list) =>
    (Array.isArray(list) ? list : []).flatMap((item) => {
      if (typeof item !== "string") return []
      const value = item.trim()
      if (!value || seen.has(value)) return []
      seen.add(value)
      return [value]
    })
  )
}

function mergeAssumptions(...items: Array<Array<{ question: string; assumption: string }> | undefined>) {
  const seen = new Set<string>()
  return items.flatMap((list) =>
    (Array.isArray(list) ? list : []).flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const question = (typeof item.question === "string" ? item.question : "").trim()
      const assumption = (typeof item.assumption === "string" ? item.assumption : "").trim()
      const key = `${question}\u0000${assumption}`
      if (!question || !assumption || seen.has(key)) return []
      seen.add(key)
      return [{ question, assumption }]
    })
  )
}

function executorPlanningWarning(stage: "spec" | "plan", executor: ExecutorNameInfo) {
  return `${executor} ${stage} generation runs in a read-only planning session, but tool usage is still prompt-constrained. The executor is explicitly warned not to modify files, apply patches, or run side-effecting commands.`
}

// ---------------------------------------------------------------------------
// Pre-analysis — deterministic extraction before LLM call
// ---------------------------------------------------------------------------

interface RequestAnalysis {
  /** Files mentioned in the request, resolved and pre-read */
  files: Array<{ ref: string; absPath: string; content: string }>
  /** Structured requirements extracted from bullet/numbered lists */
  requirements: string[]
  /** Code entities (type/class/function names) mentioned */
  entities: string[]
  /** Working directory extracted from the request */
  workDir?: string
}

function preAnalyzeRequest(request: string): RequestAnalysis {
  const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"

  // 1. Extract working directory
  let workDir: string | undefined
  const cwdMatch =
    request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  if (cwdMatch) workDir = cwdMatch[1].replace(/[/\\]+$/, "")

  // 2. Extract file references
  const refs = new Set<string>()
  let match: RegExpExecArray | null

  // @file:path or @path
  const atPat = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  while ((match = atPat.exec(request)) !== null) refs.add(match[1])

  // Backtick-wrapped: `src/router.ts`
  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPat.exec(request)) !== null) refs.add(match[1])

  // Bare relative paths with at least one slash: src/router.ts
  const barePat = new RegExp(
    "(?:^|[\\s,;，；（(])(\\.?(?:[\\w@-]+[/\\\\])+[\\w.-]+\\.(?:" + FILE_EXTS + "))(?=[\\s,;，；）)。:：]|$)",
    "gm",
  )
  while ((match = barePat.exec(request)) !== null) refs.add(match[1].trim())

  // Resolve and read files
  const baseDirs: string[] = []
  if (workDir) baseDirs.push(workDir)
  try { baseDirs.push(Instance.directory) } catch { /* may not be initialized */ }
  try { if (!baseDirs.includes(Instance.worktree)) baseDirs.push(Instance.worktree) } catch { /* ok */ }

  const files: RequestAnalysis["files"] = []
  for (const ref of refs) {
    if (path.isAbsolute(ref)) {
      const content = readFileSafe(ref)
      if (content) files.push({ ref, absPath: ref, content })
      continue
    }
    for (const base of baseDirs) {
      const abs = path.resolve(base, ref)
      const content = readFileSafe(abs)
      if (content) {
        files.push({ ref, absPath: abs, content })
        break
      }
    }
  }

  // 3. Extract structured requirements (bullet points, numbered items, action-verb lines)
  const requirements: string[] = []
  // Chinese action verbs don't need a trailing space (Chinese has no word spacing)
  const CN_ACTION_PAT = /^(?:添加|修改|删除|创建|导出|导入|确保|实现|重构|优化|移除|更新|替换|支持|使用|配置|设置|检查|启用|禁用)/
  // English action verbs require a trailing space to avoid matching mid-sentence words
  const EN_ACTION_PAT = /^(?:add|create|modify|delete|remove|implement|ensure|replace|fix|refactor|export|import|enable|disable|configure|check|support)\s/i
  for (const line of request.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 4) continue
    if (/^[-*•]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^[-*•]\s+/, ""))
    } else if (/^\d+[.、)）]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^\d+[.、)）]\s+/, ""))
    } else if (CN_ACTION_PAT.test(trimmed) || EN_ACTION_PAT.test(trimmed)) {
      requirements.push(trimmed)
    }
  }

  // 4. Extract code entities (backtick-wrapped names, type/class/function keywords)
  const entitySet = new Set<string>()
  // English order: keyword Name (e.g., "class Router", "type Middleware")
  const entPat = /`(\w+)`|(?:class|type|interface|function|method)\s+(\w+)/gi
  while ((match = entPat.exec(request)) !== null) {
    const name = match[1] || match[2]
    if (name && name.length > 1 && !/^(the|and|or|is|to|a|of|in)$/i.test(name)) entitySet.add(name)
  }
  // Chinese order: Name 类型/方法/函数/接口 (e.g., "Middleware 类型", "Router 类")
  const cnPat = /(\w{2,})\s*(?:类型|类|方法|函数|接口)/g
  while ((match = cnPat.exec(request)) !== null) {
    entitySet.add(match[1])
  }

  return { files, requirements, entities: [...entitySet], workDir }
}

function readFileSafe(absPath: string, maxLen = 6000): string | null {
  try {
    const content = fs.readFileSync(absPath, "utf-8")
    if (!content) return null
    return content.length > maxLen ? content.slice(0, maxLen) + "\n... (truncated)" : content
  } catch {
    return null
  }
}

function buildWorkflowSection(input: {
  taskType: "initial" | "replan" | "retry"
  hasRelevantMemory: boolean
  hasPriorFailure: boolean
  failureClassification?: string
  waves?: Array<{ title: string; objective?: string }>
}): string {
  const sections: string[] = ["## Execution Guide"]

  if (input.taskType === "retry") {
    sections.push(
      `This is a **retry** — focus on the specific failure, not broad exploration.`,
      `1. Read the failure details above. Identify the exact failing check and root cause.`,
      `2. Make targeted fixes — do not refactor or change unrelated code.`,
      `3. Re-run the failing checks to verify your fix.`,
    )
  } else if (input.taskType === "replan") {
    sections.push(
      `This is a **replan** after a failed attempt. Read the Replan Context below.`,
      `1. Understand what went wrong. Do NOT repeat the failed approach.`,
      `2. Try a different strategy as suggested in the failure analysis.`,
      `3. Verify each step before moving on.`,
    )
  } else {
    sections.push(
      `Execute the subtasks above in order. For each:`,
      `1. Use \`planner\` tool to track progress (add_task → in_progress → completed).`,
      `2. Implement the change, then immediately verify it (typecheck, test, etc.).`,
      `3. Record discoveries via \`memory\` tool — written memories survive across sessions.`,
      ``,
      `After all subtasks: run ALL checks listed in the Goals section and confirm every blocking goal is met.`,
    )
  }

  if (input.waves && input.waves.length > 0) {
    sections.push(
      `\n**Waves**: ${input.waves.map((wave, index) => `${index + 1}. ${wave.title}${wave.objective ? ` (${wave.objective})` : ""}`).join(" | ")}`,
    )
  }

  sections.push(
    `\n**Tools**: memory (search/write knowledge), preference (project conventions — binding), planner (task tracking), task (parallel sub-agents), websearch/webfetch (external docs).`,
  )

  return sections.join("\n")
}

function renderReplanPrompt(input: {
  title: string
  request: string
  goals: z.infer<typeof GoalInput>[]
  previousPrompt: string
  failureSummary: string
}) {
  const truncatedPrevious =
    input.previousPrompt.length > 3000
      ? input.previousPrompt.slice(0, 3000) + "\n...(truncated)"
      : input.previousPrompt

  return `You are executing a headless coding task inside OpenCorvus.

Task: ${input.title}

Request:
${input.request.trim()}

Goals:
${input.goals.map((goal, index) => `${index + 1}. [${goal.priority ?? "blocking"}] ${goal.description}\n   Criteria: ${goal.criteria}`).join("\n\n")}

## Replan Context

The previous attempt **failed**. You MUST use a DIFFERENT strategy.

### Failure Summary
${input.failureSummary}

### Previous Plan (for reference)
${truncatedPrevious}

## Instructions

1. Analyze the failure. Understand what went wrong and why.
2. Explore the codebase to verify your understanding — read the affected files.
3. Use the planner tool to create a NEW task decomposition that avoids the previous failure.
4. Execute the new plan. Verify each step immediately.
5. Run ALL acceptance checks. Confirm every blocking goal is met.

**Tools**: memory (search/write knowledge), preference (project conventions — binding), planner (task tracking), task (parallel sub-agents).`
}

// ---------------------------------------------------------------------------
// Goal helpers
// ---------------------------------------------------------------------------

function resolveGoals(request: string, spec?: PlannerSpec, goals?: z.infer<typeof GoalInput>[]) {
  const source =
    spec?.goals && spec.goals.length > 0
      ? spec.goals
      : Array.isArray(goals) && goals.length > 0
        ? goals
        : []
  const selectors = goalSelectors(request, spec)
  return source.map((goal) => {
    const check_selector = [...new Set([...(goal.metadata?.check_selector ?? []), ...selectors])]
    return {
      ...goal,
      metadata: check_selector.length > 0
        ? {
            ...goal.metadata,
            check_selector,
          }
        : goal.metadata,
    }
  })
}

function goalSelectors(request: string, spec?: PlannerSpec) {
  const selectors = inferSelectors(request).filter((item) =>
    !["build", "test", "lint", "verify_cmd"].includes(item)
  )
  if (!spec) return [...new Set(selectors)]
  selectors.push("spec_check")
  for (const item of spec.spec_items ?? []) {
    for (const sel of item.check_selector ?? []) {
      if (["build", "test", "lint", "verify_cmd"].includes(sel)) continue
      selectors.push(sel)
    }
  }
  return [...new Set(selectors)]
}

function deriveClarification(output: PlannerOutputType, request: string): ClarificationResult | undefined {
  const questions = (Array.isArray(output.clarifications) ? output.clarifications : []).filter((item) => item.question?.trim())
  if (questions.length > 0) {
    const deduped = questions.filter((item, index) =>
      questions.findIndex((next) => next.question.trim() === item.question.trim()) === index,
    )
    return {
      reason: deduped[0]?.context ?? "Critical ambiguities require user clarification before execution.",
      questions: deduped,
    }
  }
  return heuristicClarification(request)
}

function hasModelClarification(output: PlannerOutputType) {
  return (output.clarifications?.length ?? 0) > 0
}

function heuristicClarification(request: string): ClarificationResult | undefined {
  const trimmed = request.trim()
  if (!trimmed) return
  const analysis = preAnalyzeRequest(request)
  const grounded =
    trimmed.length > 40 ||
    trimmed.includes("\n") ||
    !!analysis.workDir ||
    analysis.files.length > 0 ||
    analysis.requirements.some((item) => item.length > 24) ||
    analysis.entities.length > 0
  if (grounded) return
  const generic = /(优化|修复|改进|重构|整理|升级|实现|支持|处理|性能|问题|bug|issue|fix|optimi[sz]e|improve|refactor|cleanup|performance|review)/i.test(trimmed)
  if (!generic) return
  if (/[\u3400-\u9fff]/.test(trimmed)) {
    return {
      reason: "当前请求过于宽泛，规划前需要明确具体目标范围。",
      questions: [{
        header: "范围",
        question: "这次要优先处理哪个模块、页面或流程？",
        context: "当前请求没有指出具体对象，无法生成可靠的执行计划。",
        default_assumption: "先聚焦当前项目里最直接相关的主路径。",
      }],
    }
  }
  return {
    reason: "The request is too broad to produce a reliable execution plan without a concrete target.",
    questions: [{
      header: "Scope",
      question: "Which module, page, or workflow should this focus on first?",
      context: "The request does not identify a concrete target, so planning would be guesswork.",
      default_assumption: "Focus on the primary user-facing path in the main package.",
    }],
  }
}

function inferSelectors(request: string) {
  const lower = request.toLowerCase()
  const selectors = new Set(["build", "test", "lint", "verify_cmd"])
  if (/(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/.test(lower)) selectors.add("ui_review")
  if (/(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/.test(lower)) selectors.add("code_quality")
  if (/\bcr\b|code review|审查|代码评审|review finding|review comment/.test(lower)) selectors.add("code_review")
  if (/(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/.test(lower))
    selectors.add("dead_code_review")
  if (/(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/.test(lower))
    selectors.add("startup")
  return [...selectors]
}

function summarize(input: string) {
  const line = input
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return "Untitled plan"
  if (line.length <= 120) return line
  return line.slice(0, 117) + "..."
}
