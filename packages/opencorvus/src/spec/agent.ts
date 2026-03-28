/**
 * HeadlessSpecAgent — the orchestrator-owned specification stage that expands a
 * task request into a precise, grounded implementation specification.
 *
 * Positioned as a first-class agent alongside the PlannerAgent:
 * 1. Memory recall — searches project memory for prior work, patterns, gotchas
 * 2. Preference awareness — respects project conventions and constraints
 * 3. Codebase exploration — reads files, searches code, lists directories
 * 4. Web research — searches external documentation when needed
 * 5. Structured output — scope, requirements, acceptance criteria, spec items
 * 6. Rewrite — receives failure analysis and revises spec for replan
 */
import { streamText, stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { parseSpecText } from "./parse-spec-text"
import { OrchestratorConfig } from "@/orchestrator/config"
import { loadStageSkills } from "@/orchestrator/skill-inject"
import path from "path"
import SPEC_CORE from "@/prompt/core/spec-core.txt"
import { Config } from "@/config/config"

const log = Log.create({ service: "spec-agent" })

// ---------------------------------------------------------------------------
// Shared types — canonical spec types used across planner/orchestrator
// ---------------------------------------------------------------------------

export const Clarification = z.object({
  reason: z.string(),
  questions: z.array(
    z.object({
      header: z.string(),
      question: z.string(),
      context: z.string().optional(),
      default_assumption: z.string().optional(),
    }),
  ),
})
export type ClarificationResult = z.infer<typeof Clarification>

export const RequirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptance: z.array(z.string()).default([]),
  evidence_refs: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).optional(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  check_selector: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})
export type Requirement = z.infer<typeof RequirementSchema>

export const ArchitecturalLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  depends_on: z.array(z.string()).default([]),
  kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]).optional(),
  is_verification: z.boolean().optional(),
})
export type ArchitecturalLayer = z.infer<typeof ArchitecturalLayerSchema>

export const SpecDraftSchema = z.object({
  summary: z.string(),
  content: z.string(),
  assumptions: z.array(
    z.object({
      question: z.string(),
      assumption: z.string(),
    }),
  ).default([]),
  risks: z.array(z.string()).default([]),
  evidence_sources: z.array(z.string()).default([]),
  unresolved_questions: z.array(z.string()).default([]),
  requirements: z.array(RequirementSchema).optional(),
  architectural_layers: z.array(ArchitecturalLayerSchema).optional(),
  clarifications: Clarification.shape.questions.optional(),
})
export type SpecDraft = z.infer<typeof SpecDraftSchema>

// ---------------------------------------------------------------------------
// Output schema — what the spec agent produces
// ---------------------------------------------------------------------------

export const SpecItemSchema = z.object({
  title: z.string().describe("Short title of the spec item"),
  description: z.string().describe("Detailed description of what must be implemented"),
  check_selector: z.array(z.string()).optional().describe("Which checks validate this item (build, test, lint, spec_check, etc.)"),
  priority: z.enum(["blocking", "advisory"]).default("blocking"),
})
export type SpecItem = z.infer<typeof SpecItemSchema>

export const SpecOutput = z.object({
  summary: z.string().describe("One-line summary of the specification"),
  content: z.string().describe("Full markdown specification with Scope, Requirements, Constraints, Acceptance Criteria, Out-of-Scope, Open Questions"),
  scope: z.string().describe("What is in scope for this task"),
  out_of_scope: z.string().optional().describe("Explicitly excluded items"),
  spec_items: z.array(SpecItemSchema).describe("Required spec items — each must be verifiably implemented"),
  assumptions: z.array(
    z.object({
      question: z.string(),
      assumption: z.string(),
    }),
  ).default([]),
  risks: z.array(z.string()).default([]),
  evidence_sources: z.array(z.string()).default([]).describe("Files, URLs, or memory entries consulted during spec creation"),
  unresolved_questions: z.array(z.string()).default([]).describe("Questions that could not be answered by codebase exploration"),
  clarifications: z
    .array(
      z.object({
        header: z.string(),
        question: z.string(),
        context: z.string().optional(),
        default_assumption: z.string().optional(),
      }),
    )
    .optional(),
})
export type SpecOutputType = z.infer<typeof SpecOutput>

// ---------------------------------------------------------------------------
// Rewrite context — structured failure information for spec revision
// ---------------------------------------------------------------------------

export interface SpecRewriteContext {
  previousSpec: string
  failureAnalysis: {
    classification: string
    summary: string
    rootCause: string
    suggestedStrategy: string
    avoidApproaches: string[]
  }
  previousGoalStatuses: Array<{
    description: string
    status: string
    evidence: string
  }>
}

// ---------------------------------------------------------------------------
// HeadlessSpecAgent
// ---------------------------------------------------------------------------

// 默认值来自 OrchestratorConfig.defaults.spec，仅用于函数签名默认参数
const { spec: SPEC_DEFAULTS } = OrchestratorConfig.defaults

export namespace HeadlessSpecAgent {
  /**
   * Generate an initial spec from a task request.
   * Explores the codebase to ground the specification in reality.
   */
  export async function initial(input: {
    title: string
    request: string
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "initial" })
  }

  /**
   * Compile/fill a spec during the spec compilation phase.
   * Called when the spec is in "blocked" state and needs gap-filling.
   */
  export async function compile(input: {
    title: string
    request: string
    previousSpec?: string
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    signal?: AbortSignal
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "compile" })
  }

  /**
   * Rewrite a spec based on failure analysis from a previous execution.
   */
  export async function rewrite(input: {
    title: string
    request: string
    rewriteContext: SpecRewriteContext
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    signal?: AbortSignal
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "rewrite" })
  }
}

export { HeadlessSpecAgent as SpecAgent }

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function run(input: {
  title: string
  request: string
  mode: "initial" | "compile" | "rewrite"
  goals?: Array<{ description: string; criteria: string; priority?: string }>
  previousSpec?: string
  rewriteContext?: SpecRewriteContext
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
}): Promise<SpecOutputType> {
  if (input.signal?.aborted) throw new Error("spec agent aborted before model resolution")

  const orchCfg = await OrchestratorConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS, quality_threshold: QUALITY_RETRY_THRESHOLD, max_attempts: MAX_SPEC_ATTEMPTS } = orchCfg.spec

  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for spec agent")
  const model = await Provider.getModel(def.providerID, def.modelID)
  const language = await Provider.getLanguage(model)

  if (input.signal?.aborted) throw new Error("spec agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  const guard = toolGuard(createPlannerTools(taskWorkDir, input.sessionID))

  const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
  if (input.signal?.aborted) throw new Error("spec agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  let lastParsed: SpecOutputType | undefined
  let lastQuality: { score: number; reasons: string[] } | undefined

  for (let attempt = 0; attempt < MAX_SPEC_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("spec agent aborted before attempt " + (attempt + 1))

    const retryContext = attempt > 0 && lastQuality
      ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, attempt }
      : undefined
    const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext, QUALITY_RETRY_THRESHOLD)

    log.info("spec agent starting", {
      title: input.title,
      mode: input.mode,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      fileRefsFound: fileRefs.length,
      taskWorkDir,
      toolCount: Object.keys(guard.tools).length,
      attempt: attempt + 1,
      config: orchCfg.spec,
      retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    // Use streamText (not generateText) to keep the HTTP connection alive
    // during extended thinking. Non-streaming requests timeout on reasoning
    // models (kimi-k2.5, qwen3.5-plus) because no data flows during thinking.
    const baseSignal = input.signal ?? AbortSignal.timeout(TIMEOUT_MS)
    const stream = streamText({
      model: language,
      stopWhen: stepCountIs(MAX_STEPS),
      tools: guard.tools,
      maxOutputTokens: 32768,
      abortSignal: AbortSignal.any([baseSignal, guard.signal]),
      system: await specSystem(),
      prompt: userPrompt,
      ...(input.stream?.onChunk ? { onChunk: input.stream.onChunk as any } : {}),
      ...(input.stream?.onError ? { onError: input.stream.onError } : {}),
      onStepFinish: guard.onStepFinish as any,
    })

    const [resultText, resultSteps, resultFinishReason] = await Promise.all([
      stream.text,
      stream.steps,
      stream.finishReason,
    ])

    const toolCallCount = resultSteps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )

    // Collect all text output across steps (multi-step agents produce text per step)
    let allText = resultText?.trim() || ""
    if (!allText) {
      allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
    }

    log.info("spec agent finished", {
      steps: resultSteps.length,
      finishReason: resultFinishReason,
      textLength: allText.length,
      toolCalls: toolCallCount,
      attempt: attempt + 1,
    })

    // Parse structured sections from text output
    let parsed: SpecOutputType = parseSpecText(allText)

    // Log if output seems truncated — no fallback synthesis, force retry instead
    if (parsed.content.length < 100 || parsed.spec_items.length < 1) {
      log.warn("spec: output seems truncated or empty, will retry via quality gate", {
        contentLength: parsed.content.length,
        specItemsCount: parsed.spec_items.length,
      })
    }

    parsed.summary = ensureMeaningfulSummary(parsed.summary, input.title)

    const specQuality = validateSpecQuality(parsed, input.request, toolCallCount)
    log.info("spec agent output", {
      specItems: parsed.spec_items.length,
      contentLength: parsed.content.length,
      evidenceSources: parsed.evidence_sources.length,
      risks: parsed.risks.length,
      toolCalls: toolCallCount,
      quality: specQuality,
      attempt: attempt + 1,
    })

    lastParsed = parsed
    lastQuality = specQuality

    if (specQuality.score >= QUALITY_RETRY_THRESHOLD || attempt >= MAX_SPEC_ATTEMPTS - 1) {
      if (specQuality.score < 0.3) {
        log.warn("spec: final spec quality is very low", { ...specQuality, attempt: attempt + 1 })
      }
      return parsed
    }

    log.warn("spec: spec quality below threshold, retrying", {
      score: specQuality.score,
      threshold: QUALITY_RETRY_THRESHOLD,
      reasons: specQuality.reasons,
      toolCalls: toolCallCount,
    })
  }

  if (!lastParsed) throw new Error("Spec agent produced no output after all attempts")
  return lastParsed
}

// ---------------------------------------------------------------------------
// User prompt building
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    title: string
    request: string
    mode: "initial" | "compile" | "rewrite"
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    previousSpec?: string
    rewriteContext?: SpecRewriteContext
  },
  fileRefs: Array<{ ref: string; content: string }>,
  context: string,
  retryContext?: { previousScore: number; reasons: string[]; attempt: number },
  qualityThreshold = SPEC_DEFAULTS.quality_threshold,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  if (retryContext) {
    sections.push(
      [
        "# QUALITY RETRY - Previous Spec Was Insufficient",
        "",
        `Your previous spec scored ${retryContext.previousScore.toFixed(2)} / 1.0 (threshold: ${qualityThreshold}). Attempt ${retryContext.attempt + 1}.`,
        "",
        "**Issues found:**",
        ...retryContext.reasons.map((r) => `- ${r}`),
        "",
        "**Requirements for this attempt:**",
        "- Use tools to explore the codebase until you have enough context to write specific, grounded output",
        "- Every spec item MUST reference concrete file paths discovered from exploration",
        "- Each spec item MUST have a clear title, detailed description, and check_selector",
        "- Every blocking spec item MUST have verifiable success/failure criteria",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  if (input.goals && input.goals.length > 0) {
    sections.push(
      `# User-Provided Goals\n\nIncorporate these goals into the specification. Ensure each goal has corresponding spec items.\n\n${input.goals
        .map((g, i) => `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}`)
        .join("\n")}`,
    )
  }

  if (input.previousSpec) {
    sections.push(`# Previous Specification (for revision)\n\n${input.previousSpec}`)
  }

  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  if (fileRefs && fileRefs.length > 0) {
    const refSections = fileRefs.map((f) => `### ${f.ref}\n\`\`\`\n${f.content}\n\`\`\``)
    sections.push(
      `# Referenced Files (Pre-read)\n\n` +
        `Analyze these files to understand the existing codebase:\n` +
        `- Identify types, APIs, patterns, conventions\n` +
        `- Note constraints and dependencies\n` +
        `- You still MUST use tools to explore BEYOND these files\n\n` +
        refSections.join("\n\n"),
    )
  }

  if (input.rewriteContext) {
    const ctx = input.rewriteContext
    sections.push(
      [
        "# Rewrite Context",
        "",
        "The previous execution FAILED. You must revise the spec to address the failure.",
        "",
        `## Previous Specification`,
        ctx.previousSpec,
        "",
        `## Failure Analysis`,
        `Classification: ${ctx.failureAnalysis.classification}`,
        `Summary: ${ctx.failureAnalysis.summary}`,
        `Root Cause: ${ctx.failureAnalysis.rootCause}`,
        `Suggested Strategy: ${ctx.failureAnalysis.suggestedStrategy}`,
        "",
        `## Approaches to AVOID (these already failed)`,
        ...ctx.failureAnalysis.avoidApproaches.map((a) => `- ${a}`),
        "",
        `## Previous Goal Results`,
        ...ctx.previousGoalStatuses.map(
          (g) => `- ${g.description}: **${g.status}** — ${g.evidence}`,
        ),
      ].join("\n"),
    )
  }

  if (fileRefs && fileRefs.length > 0) {
    sections.push(
      "Pre-read files are provided above — analyze them before making tool calls. " +
        "Then use tools to explore related files, dependencies, and patterns. " +
        "Output your specification using section tags as described in your instructions.",
    )
  } else {
    sections.push(
      "Now recall memory, check preferences, explore the codebase thoroughly, " +
        "then output your specification using section tags as described in your instructions.",
    )
  }

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Quality validation
// ---------------------------------------------------------------------------

function validateSpecQuality(
  spec: SpecOutputType,
  request: string,
  toolCallCount: number,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Tool call depth (0.2 max)
  if (toolCallCount >= 5) {
    score += 0.2
  } else if (toolCallCount >= 2) {
    score += 0.1
  } else if (toolCallCount === 0) {
    reasons.push("No tool calls — spec is not grounded in codebase exploration")
  } else {
    score += 0.05
    reasons.push(`Only ${toolCallCount} tool call — exploration may be insufficient`)
  }

  // Content has required sections (0.25 max — structural completeness)
  const hasScope = /scope/i.test(spec.content)
  const hasRequirements = /requirements?/i.test(spec.content)
  const hasConstraints = /constraints?/i.test(spec.content)
  const hasCriteria = /acceptance|criteria/i.test(spec.content)
  const sectionCount = [hasScope, hasRequirements, hasConstraints, hasCriteria].filter(Boolean).length
  if (sectionCount >= 3) {
    score += 0.25
  } else if (sectionCount >= 2) {
    score += 0.15
  } else {
    reasons.push(`Spec content missing required sections (found ${sectionCount}/4: Scope, Requirements, Constraints, Acceptance Criteria)`)
  }

  // Spec items quality (0.3 max — most important dimension)
  if (spec.spec_items.length >= 4) {
    score += 0.3
  } else if (spec.spec_items.length >= 2) {
    score += 0.2
  } else if (spec.spec_items.length >= 1) {
    score += 0.1
  } else {
    reasons.push("No spec items — define at least 4 concrete, verifiable spec items for non-trivial tasks")
  }

  // Evidence sources (did the agent actually discover things?) (0.1 max)
  if (spec.evidence_sources.length >= 2) {
    score += 0.1
  } else if (spec.evidence_sources.length >= 1) {
    score += 0.05
  } else {
    reasons.push("No evidence sources — list the files and resources you consulted")
  }

  // File paths in content OR detailed technical design for greenfield (0.15 max)
  const pathPattern = /[\w/\\-]+\.\w+/g
  const pathCount = (spec.content.match(pathPattern) || []).length
  // For greenfield projects, technical keywords count as "grounding"
  const technicalKeywords = /\b(API|class|function|interface|module|component|state|event|handler|render|canvas|DOM|HTTP|WebSocket|database|schema|endpoint|route)\b/gi
  const techCount = (spec.content.match(technicalKeywords) || []).length
  if (pathCount >= 3 || techCount >= 10) {
    score += 0.15
  } else if (pathCount >= 1 || techCount >= 5) {
    score += 0.07
  } else {
    reasons.push("Spec content lacks specific file paths or detailed technical design keywords")
  }

  return { score: Math.min(score, 1), reasons }
}

function ensureMeaningfulSummary(summary: string, fallbackTitle: string): string {
  if (!summary) return fallbackTitle
  const trimmed = summary.trim()
  if (trimmed.length < 5) return fallbackTitle
  if (/^#+\s/.test(trimmed)) return fallbackTitle
  if (/^[./\\]/.test(trimmed) && !trimmed.includes(" ")) return fallbackTitle
  return trimmed
}

// ---------------------------------------------------------------------------
// File reference resolution (mirrors planner/agent.ts)
// ---------------------------------------------------------------------------

async function resolveFileReferences(
  request: string,
  taskWorkDir?: string,
): Promise<Array<{ ref: string; content: string }>> {
  const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"
  const refs = new Set<string>()

  const atPat = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  let match: RegExpExecArray | null
  while ((match = atPat.exec(request)) !== null) refs.add(match[1])

  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPat.exec(request)) !== null) refs.add(match[1])

  const baseDirs: string[] = []
  if (taskWorkDir) baseDirs.push(taskWorkDir)
  try { baseDirs.push(Instance.directory) } catch { /* ok */ }
  try { if (!baseDirs.includes(Instance.worktree)) baseDirs.push(Instance.worktree) } catch { /* ok */ }

  const results: Array<{ ref: string; content: string }> = []
  for (const ref of refs) {
    if (path.isAbsolute(ref)) {
      const content = readFileSafe(ref)
      if (content) results.push({ ref, content })
      continue
    }
    for (const base of baseDirs) {
      const abs = path.resolve(base, ref)
      const content = readFileSafe(abs)
      if (content) {
        results.push({ ref, content })
        break
      }
    }
  }
  return results
}

function readFileSafe(absPath: string, maxLen = 6000): string | null {
  try {
    const fs = require("fs")
    const content = fs.readFileSync(absPath, "utf-8")
    if (!content) return null
    return content.length > maxLen ? content.slice(0, maxLen) + "\n... (truncated)" : content
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/** Full default system prompt. Exported for tests and catalog. */
export const SPEC_SYSTEM = SPEC_CORE

/** Config-aware resolver: checks config.prompt.spec_system first, then config.agent.spec.prompt, otherwise the core prompt + skills. */
export async function specSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.spec_system === "string") return systemOverride.spec_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.spec?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : SPEC_CORE
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.spec.skills)
  return core + skills
}
