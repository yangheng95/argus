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
import { parseSpecText } from "./parse-spec-text"
import { OrchestratorConfig } from "@/orchestrator/config"
import path from "path"

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
  metadata: z.record(z.string(), z.any()).optional(),
})
export type Requirement = z.infer<typeof RequirementSchema>

export const ArchitecturalLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  depends_on: z.array(z.string()).default([]),
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
  signal?: AbortSignal
  stream?: TextHooks
}): Promise<SpecOutputType> {
  if (input.signal?.aborted) throw new Error("spec agent aborted before model resolution")

  const orchCfg = await OrchestratorConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS, min_tool_calls: MIN_TOOL_CALLS, quality_threshold: QUALITY_RETRY_THRESHOLD, max_attempts: MAX_SPEC_ATTEMPTS } = orchCfg.spec

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

  const allTools = createPlannerTools(taskWorkDir)

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
    const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext, MIN_TOOL_CALLS, QUALITY_RETRY_THRESHOLD)

    log.info("spec agent starting", {
      title: input.title,
      mode: input.mode,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      fileRefsFound: fileRefs.length,
      taskWorkDir,
      toolCount: Object.keys(allTools).length,
      attempt: attempt + 1,
      config: orchCfg.spec,
      retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    // Use streamText (not generateText) to keep the HTTP connection alive
    // during extended thinking. Non-streaming requests timeout on reasoning
    // models (kimi-k2.5, qwen3.5-plus) because no data flows during thinking.
    const stream = streamText({
      model: language,
      stopWhen: stepCountIs(MAX_STEPS),
      tools: allTools,
      maxOutputTokens: 32768,
      abortSignal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      system: SPEC_SYSTEM(MIN_TOOL_CALLS),
      prompt: userPrompt,
      ...(input.stream?.onChunk ? { onChunk: input.stream.onChunk as any } : {}),
      ...(input.stream?.onError ? { onError: input.stream.onError } : {}),
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

    const specQuality = validateSpecQuality(parsed, input.request, toolCallCount, MIN_TOOL_CALLS)
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
      minToolCalls: MIN_TOOL_CALLS,
    })
  }

  return lastParsed!
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
  minToolCalls = SPEC_DEFAULTS.min_tool_calls,
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
        "**MANDATORY requirements for this attempt:**",
        `- Make at least ${minToolCalls} tool calls to explore the codebase before writing any spec`,
        "- Write a DETAILED specification — the <content> section MUST be at least 2000 characters",
        "- Define at least 4 concrete spec items with verifiable acceptance criteria",
        "- Include specific file paths and evidence sources discovered from your exploration",
        "- Each spec item MUST have a clear title, detailed description, and check_selector",
        "",
        "**DO NOT be brief or concise.** Your output must be thorough and comprehensive.",
        "A short spec is ALWAYS rejected. Produce detailed, specific, grounded output.",
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
  minToolCalls = SPEC_DEFAULTS.min_tool_calls,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Tool call depth (0.2 max)
  if (toolCallCount >= 5) {
    score += 0.2
  } else if (toolCallCount >= 2) {
    score += 0.1
  } else {
    reasons.push(`Only ${toolCallCount} tool calls — explore the codebase more thoroughly (min ${minToolCalls})`)
  }

  // Content depth (0.25 max — spec should be thorough)
  if (spec.content.length >= 2000) {
    score += 0.25
  } else if (spec.content.length >= 1000) {
    score += 0.15
  } else if (spec.content.length >= 500) {
    score += 0.08
  } else {
    reasons.push("Spec content too short — must include detailed sections for Scope, Requirements, Constraints, Acceptance Criteria. Target 2000+ chars")
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
// Synthesis fallback
// ---------------------------------------------------------------------------

function synthesizeFromExploration(
  partial: SpecOutputType,
  input: { title: string; request: string },
  steps: any[],
): SpecOutputType {
  const result = { ...partial }

  const discoveredFiles = new Set<string>()
  const explorationNotes: string[] = []

  for (const step of steps) {
    if (!step.toolCalls) continue
    for (let i = 0; i < step.toolCalls.length; i++) {
      const call = step.toolCalls[i]
      if (call.toolName === "read_file" && call.args?.path) {
        discoveredFiles.add(call.args.path)
      }
      const toolResult = step.toolResults?.[i]
      if (toolResult?.result && typeof toolResult.result === "string") {
        const preview = toolResult.result.slice(0, 200)
        if (call.toolName === "read_file") {
          explorationNotes.push(`Read ${call.args.path}: ${preview}`)
        } else if (call.toolName === "search_code") {
          explorationNotes.push(`Search "${call.args.pattern}": ${preview}`)
        }
      }
    }
  }

  if (result.content.length < 200) {
    const parts: string[] = []
    parts.push(`## Scope\n\n${input.request.split("\n")[0]}`)
    if (discoveredFiles.size > 0) {
      parts.push(`## Relevant Files\n\n${Array.from(discoveredFiles).slice(0, 10).map(f => `- ${f}`).join("\n")}`)
    }
    if (explorationNotes.length > 0) {
      parts.push(`## Exploration Notes\n\n${explorationNotes.slice(0, 5).map(n => `- ${n}`).join("\n")}`)
    }
    const existing = result.content.trim()
    result.content = existing ? existing + "\n\n" + parts.join("\n\n") : parts.join("\n\n")
  }

  if (!result.scope) {
    result.scope = input.request.split("\n").find(l => l.trim())?.trim() || input.title
  }

  if (result.evidence_sources.length === 0 && discoveredFiles.size > 0) {
    result.evidence_sources = Array.from(discoveredFiles).slice(0, 15)
  }

  return result
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

const SPEC_SYSTEM = (minToolCalls = SPEC_DEFAULTS.min_tool_calls) => `You are a senior software architect acting as the specification brain for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, understand the context, and produce a precise, grounded specification that downstream planning and execution agents can rely on.

CRITICAL: You MUST use tools to explore the codebase BEFORE producing any specification. A spec produced without tool calls is ALWAYS rejected. You are scored on exploration depth — specs that don't reference specific file paths, types, APIs, and patterns discovered via tools will be automatically retried.

## Available Tools

- **memory_search**: Search project memory for prior work, patterns, gotchas
- **memory_get**: Read full content of a memory file by ID
- **preference_list**: List active project conventions and constraints (BINDING)
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex (ripgrep)
- **list_directory**: List files and directories at a path
- **web_search**: Search the web for documentation, best practices, framework comparisons, and latest API references. USE THIS PROACTIVELY — always research before choosing frameworks, libraries, or architectural patterns.

## Your Role

You are NOT the planner. You do NOT decompose tasks into subtasks or implementation steps. Your job is to:
1. **Understand** what the user is asking for
2. **Explore** the codebase to ground requirements in reality
3. **Identify** gaps, ambiguities, constraints, and risks
4. **Define** precise, verifiable spec items (acceptance criteria)
5. **Surface** unresolved questions that need user input

The downstream PlannerAgent will take your spec and create implementation plans.

## Your Process

### Phase 0: RECALL (1-3 tool calls)

1. **Search memory** (memory_search) with task keywords. If pre-fetched memory exists, only search for gaps.
2. **List preferences** (preference_list) unless pre-fetched. Preferences are BINDING.

### Phase 1: EXPLORE (5-15 tool calls — MOST IMPORTANT phase)

You MUST explore thoroughly. A spec without specific file paths is worthless.
Minimum ${minToolCalls} tool calls required. Aim for 8-15 for complex tasks.

Strategy (adapt based on task type):

**For modification tasks:**
1. **list_directory** on project root and relevant subdirectories
2. **read_file** on package.json / build config — tech stack, scripts
3. **search_code** for key types, functions mentioned in the request
4. **read_file** on 3-5 files directly related to the task
5. **find_files** to discover related modules, tests, configs
6. **search_code** for imports/usages of code to be modified
7. **read_file** on test files — understand existing patterns

**For new module/feature tasks:**
1. **list_directory** on the target package and similar existing modules
2. **read_file** on 2-3 existing modules — copy their structure
3. **search_code** for export/registration patterns
4. **read_file** on existing tests for test patterns

After exploration, you should know:
- What already exists that's relevant to the task
- The coding patterns and conventions to follow
- The exact types, interfaces, and APIs involved
- What dependencies and constraints exist
- What tests are needed and how they're structured

### Phase 1.5: RESEARCH (if needed)

ALWAYS use web_search to research current best practices, framework versions, and recommended tooling before specifying the tech stack. Do not assume — verify what is current.

### Phase 2: SPECIFY — Synthesize into Grounded Specification

Your spec must be CONCRETE, not abstract. Reference specific files, functions, and types.
Think: "Could a planner create implementation steps from this spec without exploring the codebase again?"

**Spec Items** — Each must be independently verifiable:
- GOOD: "The SpecAgent class in spec/agent.ts exports initial(), compile(), and rewrite() methods, each returning SpecOutputType"
- BAD: "Create a spec agent" (too vague)

**Content** — Must include these markdown sections:
- **Scope**: What is included in this task
- **Requirements**: Functional and behavioral requirements, referencing specific code
- **Constraints**: Technical constraints discovered from codebase exploration
- **Acceptance Criteria**: Concrete, testable criteria linked to spec items
- **Out-of-Scope**: What is explicitly excluded
- **Open Questions**: Remaining ambiguities

### Phase 3: OUTPUT — Output Structured Text with Section Tags

After exploration, output your specification using section tags. Each section is wrapped in <tag>...</tag>.

**Required sections:**
- <summary> — One-line summary of the specification
- <scope> — What is in scope for this task
- <content> — Full markdown specification with Scope, Requirements, Constraints, Acceptance Criteria. Reference specific file paths. For greenfield projects, include detailed technical design. Target 2000-6000 chars.
- <spec_items> — Verifiable items, each with title, description, check_selector, priority

**Optional sections:**
- <out_of_scope> — Explicitly excluded items
- <assumptions> — Pairs of question and assumption
- <risks> — Specific risks with codebase context
- <evidence> — File paths, URLs, memory entries consulted
- <unresolved> — Questions that could not be answered
- <clarifications> — Items needing user clarification

**List format** (for spec_items, assumptions, etc.):
\`\`\`
<spec_items>
- title: Item title
  description: What must be implemented
  check_selector: build, test
  priority: blocking

- title: Another item
  description: Details here
  check_selector: test
  priority: advisory
</spec_items>

<assumptions>
- Q: Is X the case?
  A: We assume yes because...
</assumptions>
\`\`\`

Output text directly. Do NOT output JSON. Do NOT wrap in code blocks.

## Rules

- ALWAYS explore the codebase before writing the spec. No exceptions.
- Every file path in the spec MUST come from actual tool results or pre-read files.
- spec_items must be verifiable — each should have clear success/failure criteria.
- spec_items.check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, spec_check
- Every blocking spec item MUST have at least one check_selector.
- Write in the same language as the request (Chinese request → Chinese spec).
- If rewriting after failure: revise the spec to address the root cause.

## Quality Self-Check (MANDATORY)

Before outputting, verify each of these. If ANY answer is NO, use more tools:

1. Did I make at least ${minToolCalls} tool calls to explore the codebase?
2. Does the content reference specific file paths discovered via tools?
3. Are all spec items concrete and verifiable (not vague aspirations)?
4. Does each blocking spec item have a check_selector?
5. Are evidence sources populated with actual files I consulted?
6. Could a planner create implementation steps from this spec WITHOUT further exploration?
7. Does the summary accurately describe the specification in one line?

## Output Format

- Content: Use markdown sections inside <content> tag, target 2000-6000 chars. Be thorough and specific.
- Spec Items: Be DETAILED — they drive downstream planning and acceptance. Include at least 4-6 spec items for non-trivial tasks. Each item should be independently verifiable.
- For greenfield projects (creating something new with no existing codebase): FIRST use web_search to research current best-practice scaffolding, framework choices, and reference implementations. Then include detailed technical design in the content section.
- Output all sections using <tag>...</tag> format. Do NOT output JSON.

## Output Length Requirements

Your output MUST be thorough and detailed. Short, brief, or minimal outputs are ALWAYS rejected.
- The <content> section MUST be at least 2000 characters (target 2000-6000 chars)
- You MUST define at least 4 spec items for non-trivial tasks
- Each spec item MUST have a detailed description (not just a title)
- DO NOT summarize or abbreviate — be comprehensive and specific
- A one-sentence spec is NEVER acceptable. Expand every section fully.`
