/**
 * Design Analyst Agent — layout and style analysis from visual references.
 *
 * Position: Before Requirements, after Clarify. Orchestrator invokes when:
 * ① Image attachments are present AND the request is frontend/design-related
 * ② A URL is provided for a design reference or existing page to replicate
 * ③ The request explicitly mentions layout analysis, design replication, or UI specs
 *
 * The agent:
 * - Accepts images (screenshots, mockups) and/or URLs
 * - Analyzes layout structure, style tokens, components, interactions, responsive behavior
 * - Produces a structured DesignAnalysis that is handed to the Requirements agent
 *   as a separate `designSpec` input. The user's original task.request is NOT
 *   mutated — the spec travels through task.metadata.design_spec so downstream
 *   sub-agents (architect / deliver / refine / per-goal runner) don't pick it
 *   up unless they explicitly opt in.
 *
 * Architecture constraints:
 * ✗ Cannot modify files or execute code
 * ✗ Cannot call other agents
 * ✓ Reads codebase to discover existing design patterns/component libraries
 * ✓ Fetches URLs to analyze live pages
 * ✓ Produces DesignAnalysis via structured tool calls
 */
import { stepCountIs, tool } from "ai"
import z from "zod"
import TurndownService from "turndown"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AttachmentStore } from "@/storage/attachment-store"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine/config"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import type { DesignAnalysis } from "./types"
import { createDesignOutputTools, collectorToAnalysis } from "./output-tools"

import DESIGN_ANALYST_CORE from "@/prompt/core/design-analyst-core.txt"

const log = Log.create({ service: "design-analyst" })

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace DesignAnalystAgent {
  /**
   * Analyze visual references and produce a structured design specification.
   *
   * Accepts image attachments, a URL, or both. The analysis result is a
   * DesignAnalysis object suitable for injection into the requirements prompt.
   */
  export async function analyze(input: {
    /** Task title — for context */
    title: string
    /** Original task request text */
    request: string
    /** Visual references already materialized into the task's attachment store
     *  (user uploads, Figma-rendered frames, URL screenshots — any source). */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
    /** URL to fetch and analyze (live page or design reference). Note:
     *  Figma URLs are materialized into `attachments` upstream by the
     *  design_analysis tool — design-analyst itself does not re-fetch them. */
    url?: string
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<DesignAnalysis> {
    return run(input)
  }

  /**
   * Render a DesignAnalysis into a text section suitable for injection
   * into the requirements agent's prompt.
   *
   * Budgeting: the fully structured analysis for a rich UI can reach
   * 30-50K chars across hundreds of layout / token / component lines.
   * Each subsection is capped below so the aggregate stays within
   * {@link PROMPT_SECTION_CAP}. Overruns surface as "(+N more, see
   * artifact)" trailers — never a silent drop — and the full analysis
   * object remains persisted in its artifact row for downstream agents
   * that want to drill in.
   */
  export const PROMPT_SECTION_CAP = 12_000
  const PER_SUBSECTION_ITEM_CAP = 40
  const PER_LINE_CAP = 220

  export function toPromptSection(analysis: DesignAnalysis): string {
    const sections: string[] = []

    sections.push(`# Design Analysis\n`)
    sections.push(`**Summary:** ${clipLine(analysis.summary)}`)
    sections.push(`**Source:** ${analysis.sourceType}${analysis.sourceUrl ? ` (${analysis.sourceUrl})` : ""}`)
    sections.push(`**Design System:** ${analysis.designSystem}`)
    sections.push(`**Recommended Stack:** ${analysis.techStack.join(", ")}`)

    // Layout tree
    if (analysis.layout.length > 0) {
      sections.push("\n## Layout Structure")
      const shown = analysis.layout.slice(0, PER_SUBSECTION_ITEM_CAP)
      for (const s of shown) {
        const children = s.children.length > 0 ? ` → [${s.children.join(", ")}]` : ""
        sections.push(
          clipLine(
            `- **${s.id}** (${s.type}, ${s.layoutMethod}): ${s.position}, ${s.dimensions}${children}` +
            (s.notes ? ` — ${s.notes}` : ""),
          ),
        )
      }
      const more = analysis.layout.length - shown.length
      if (more > 0) sections.push(`- (+${more} more layout sections; see design analysis artifact)`)
    }

    // Style tokens
    if (analysis.tokens.length > 0) {
      sections.push("\n## Design Tokens")
      const shown = analysis.tokens.slice(0, PER_SUBSECTION_ITEM_CAP)
      const grouped = new Map<string, DesignAnalysis["tokens"]>()
      for (const t of shown) {
        const group = t.category.split("-")[0]
        if (!grouped.has(group)) grouped.set(group, [])
        grouped.get(group)!.push(t)
      }
      for (const [group, tokens] of grouped) {
        sections.push(`\n### ${group}`)
        for (const t of tokens) {
          sections.push(clipLine(`- **${t.name}** (${t.category}): \`${t.value}\` — ${t.usage}`))
        }
      }
      const more = analysis.tokens.length - shown.length
      if (more > 0) sections.push(`- (+${more} more tokens; see design analysis artifact)`)
    }

    // Components
    if (analysis.components.length > 0) {
      sections.push("\n## UI Components")
      const shown = analysis.components.slice(0, PER_SUBSECTION_ITEM_CAP)
      for (const c of shown) {
        sections.push(
          clipLine(
            `- **${c.id}** (${c.type}, ${c.variant}) in ${c.sectionId}: ${c.props}` +
            (c.notes ? ` — ${c.notes}` : ""),
          ),
        )
      }
      const more = analysis.components.length - shown.length
      if (more > 0) sections.push(`- (+${more} more components; see design analysis artifact)`)
    }

    // Interactions
    if (analysis.interactions.length > 0) {
      sections.push("\n## Interaction Patterns")
      const shown = analysis.interactions.slice(0, PER_SUBSECTION_ITEM_CAP)
      for (const i of shown) {
        sections.push(
          clipLine(
            `- **${i.trigger}** → ${i.effect} on [${i.targetComponentIds.join(", ")}]: ${i.description}`,
          ),
        )
      }
      const more = analysis.interactions.length - shown.length
      if (more > 0) sections.push(`- (+${more} more interactions; see design analysis artifact)`)
    }

    // Responsive
    if (analysis.responsive.length > 0) {
      sections.push("\n## Responsive Rules")
      const shown = analysis.responsive.slice(0, PER_SUBSECTION_ITEM_CAP)
      for (const r of shown) {
        sections.push(
          clipLine(
            `- **${r.breakpoint}**: ${r.layoutChanges} (affects: ${r.affectedSectionIds.join(", ")})`,
          ),
        )
      }
      const more = analysis.responsive.length - shown.length
      if (more > 0) sections.push(`- (+${more} more responsive rules; see design analysis artifact)`)
    }

    const rendered = sections.join("\n")
    if (rendered.length <= PROMPT_SECTION_CAP) return rendered
    const omitted = rendered.length - PROMPT_SECTION_CAP
    return `${rendered.slice(0, PROMPT_SECTION_CAP)}\n\n… [+${omitted} chars truncated; full design analysis in task.metadata.design_spec]`
  }

  function clipLine(s: string): string {
    if (s.length <= PER_LINE_CAP) return s
    return s.slice(0, PER_LINE_CAP) + "…"
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function run(input: {
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
  url?: string
  taskID?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}): Promise<DesignAnalysis> {
  if (input.signal?.aborted) throw new Error("design analyst aborted before start")

  const orchCfg = await EngineConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.design_analyst

  // Resolve model — per-agent model from Agent.Info (config: agent."design-analyst".model),
  // falling back to the user's most recent in-session model pick when no per-agent
  // override is configured.
  const model = await resolveAgentModel("design-analyst", { taskID: input.taskID }).catch(() => undefined)
  if (!model) throw new Error("no LLM model available for design analyst agent")

  if (input.signal?.aborted) throw new Error("design analyst aborted after model resolution")

  // Merge planner tools (codebase exploration) + webfetch + design output tools
  const plannerTools = await filterAgentTools(createPlannerTools(), "design-analyst")
  const outputToolKit = createDesignOutputTools()
  const guard = toolGuard({ ...plannerTools, ...createWebfetchTool(), ...outputToolKit.tools })

  if (input.signal?.aborted) throw new Error("design analyst aborted before LLM call")

  await input.onStatus?.("Design analyst: analyzing visual references")

  const systemPrompt = await designAnalystSystem()
  const userPrompt = buildUserPrompt(input)
  const userContent = await buildMultimodalContent(userPrompt, input.attachments)

  log.info("design analyst starting", {
    title: input.title,
    model: model.id,
    hasAttachments: !!input.attachments?.length,
    hasUrl: !!input.url,
  })

  const abortSignals: AbortSignal[] = [guard.signal]
  if (input.signal) abortSignals.push(input.signal)

  const passthroughHooks = {
    onChunk: input.stream?.onChunk,
    onError: input.stream?.onError,
    flush: async () => {},
    failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
  } as any
  const runResult = await AgentRuntime.run({
    agent: "design-analyst",
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: input.taskID ? `task-${input.taskID}-design-analyst` : undefined,
    sessionID: input.sessionID ?? "",
    taskID: input.taskID,
    stage: "design-analyst",
    signal: AbortSignal.any(abortSignals),
    onStepFinish: guard.onStepFinish as any,
    hooks: passthroughHooks,
    policies: {
      progressTimeoutMs: TIMEOUT_MS,
      failurePolicy: "collect",
    },
  })
  const resultText = runResult.text
  const resultSteps = runResult.steps
  const resultFinishReason = runResult.finishReason
  const toolCallCount = runResult.toolCallCount

  log.info("design analyst finished", {
    steps: resultSteps.length,
    finishReason: resultFinishReason,
    toolCalls: toolCallCount,
  })

  // Structured tool-call output is the only path. No text-parsing fallback.
  const collector = outputToolKit.getCollector()
  if (collector.layout.length === 0 && collector.components.length === 0) {
    log.warn("design analyst: no structured output registered", {
      taskID: input.taskID,
      toolCalls: toolCallCount,
      finishReason: resultFinishReason,
    })
    throw new Error(
      "Design analyst agent did not register any layout sections or components — " +
      "no text-parsing fallback available. Check the model's tool-calling behavior.",
    )
  }

  return collectorToAnalysis(collector)
}

// ---------------------------------------------------------------------------
// Multimodal content builder (same pattern as requirements agent)
// ---------------------------------------------------------------------------

async function buildMultimodalContent(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
  const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
  const fileParts = await AttachmentStore.loadFileParts(multimodal)
  if (fileParts.length === 0) return enrichedText
  return [{ type: "text" as const, text: enrichedText }, ...fileParts]
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(input: {
  title: string
  request: string
  url?: string
}): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  if (input.url) {
    sections.push(
      `# URL Reference\n\nFetch and analyze this URL: ${input.url}\n` +
      "Use webfetch to retrieve the page HTML. Analyze the DOM structure, CSS, " +
      "and visual layout. Cross-reference with any attached images.",
    )
  }

  sections.push(
    "Analyze the visual references thoroughly. Register every layout section, " +
    "style token, UI component, interaction pattern, and responsive rule using " +
    "the structured registration tools. Then call finalize_design_analysis.",
  )

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt resolution
// ---------------------------------------------------------------------------

async function designAnalystSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.design_analyst_system === "string") return systemOverride.design_analyst_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.design_analyst?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : DESIGN_ANALYST_CORE
  const orchCfg = await EngineConfig.get()
  const skills = await loadStageSkills(orchCfg.design_analyst.skills, "design-analyst")
  return core + skills
}

// ---------------------------------------------------------------------------
// Webfetch tool — AI SDK wrapper for URL fetching
// ---------------------------------------------------------------------------

const WEBFETCH_MAX_SIZE = 5 * 1024 * 1024
const WEBFETCH_TIMEOUT = 30_000

function createWebfetchTool() {
  return {
    webfetch: tool({
      description:
        "Fetch a URL and return its content as HTML or markdown. " +
        "Use this to retrieve live web pages for layout/style analysis. " +
        "For image URLs, returns the image as a base64 data URL.",
      inputSchema: z.object({
        url: z.string().describe("The URL to fetch"),
        format: z
          .enum(["html", "markdown"])
          .default("html")
          .describe("Return format: 'html' for raw HTML (best for CSS analysis), 'markdown' for readable text"),
      }),
      execute: async ({ url, format }) => {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          return "Error: URL must start with http:// or https://"
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), WEBFETCH_TIMEOUT)

        try {
          const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          }
          const initial = await fetch(url, { signal: controller.signal, headers })
          // Retry with honest UA if blocked by Cloudflare
          const response =
            initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge"
              ? await fetch(url, { signal: controller.signal, headers: { ...headers, "User-Agent": "opencorvus" } })
              : initial

          if (!response.ok) return `Error: HTTP ${response.status}`

          const contentLength = response.headers.get("content-length")
          if (contentLength && parseInt(contentLength) > WEBFETCH_MAX_SIZE) {
            return "Error: Response too large (> 5MB)"
          }

          const arrayBuffer = await response.arrayBuffer()
          if (arrayBuffer.byteLength > WEBFETCH_MAX_SIZE) {
            return "Error: Response too large (> 5MB)"
          }

          const contentType = response.headers.get("content-type") || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""

          // Image responses → base64 data URL
          if (mime.startsWith("image/") && mime !== "image/svg+xml") {
            const b64 = Buffer.from(arrayBuffer).toString("base64")
            return `Image fetched: data:${mime};base64,${b64.slice(0, 200)}... (${arrayBuffer.byteLength} bytes). Full image available in context.`
          }

          const content = new TextDecoder().decode(arrayBuffer)

          if (format === "markdown" && contentType.includes("text/html")) {
            const td = new TurndownService({
              headingStyle: "atx", hr: "---", bulletListMarker: "-",
              codeBlockStyle: "fenced", emDelimiter: "*",
            })
            td.remove(["script", "style", "meta", "link"])
            return td.turndown(content)
          }

          return content
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return `Error fetching URL: ${msg}`
        } finally {
          clearTimeout(timer)
        }
      },
    }),
  }
}
