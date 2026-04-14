/**
 * Design Analyst Agent — layout and style analysis from visual references.
 *
 * Position: Before Requirements, after Clarify. Task Agent invokes when:
 * ① Image attachments are present AND the request is frontend/design-related
 * ② A URL is provided for a design reference or existing page to replicate
 * ③ The request explicitly mentions layout analysis, design replication, or UI specs
 *
 * The agent:
 * - Accepts images (screenshots, mockups) and/or URLs
 * - Analyzes layout structure, style tokens, components, interactions, responsive behavior
 * - Produces a structured DesignAnalysis that enriches the task request for Requirements
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
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AttachmentStore } from "@/storage/attachment-store"
import { AgentRuntime } from "@/agent/runtime"
import { OrchestratorConfig } from "@/orchestrator/config"
import { loadStageSkills } from "@/orchestrator/skill-inject"
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
   * into the requirements/task-agent prompt.
   */
  export function toPromptSection(analysis: DesignAnalysis): string {
    const sections: string[] = []

    sections.push(`# Design Analysis\n`)
    sections.push(`**Summary:** ${analysis.summary}`)
    sections.push(`**Source:** ${analysis.sourceType}${analysis.sourceUrl ? ` (${analysis.sourceUrl})` : ""}`)
    sections.push(`**Design System:** ${analysis.designSystem}`)
    sections.push(`**Recommended Stack:** ${analysis.techStack.join(", ")}`)

    // Layout tree
    if (analysis.layout.length > 0) {
      sections.push("\n## Layout Structure")
      for (const s of analysis.layout) {
        const children = s.children.length > 0 ? ` → [${s.children.join(", ")}]` : ""
        sections.push(
          `- **${s.id}** (${s.type}, ${s.layoutMethod}): ${s.position}, ${s.dimensions}${children}` +
          (s.notes ? ` — ${s.notes}` : ""),
        )
      }
    }

    // Style tokens
    if (analysis.tokens.length > 0) {
      sections.push("\n## Design Tokens")
      const grouped = new Map<string, typeof analysis.tokens>()
      for (const t of analysis.tokens) {
        const group = t.category.split("-")[0]
        if (!grouped.has(group)) grouped.set(group, [])
        grouped.get(group)!.push(t)
      }
      for (const [group, tokens] of grouped) {
        sections.push(`\n### ${group}`)
        for (const t of tokens) {
          sections.push(`- **${t.name}** (${t.category}): \`${t.value}\` — ${t.usage}`)
        }
      }
    }

    // Components
    if (analysis.components.length > 0) {
      sections.push("\n## UI Components")
      for (const c of analysis.components) {
        sections.push(
          `- **${c.id}** (${c.type}, ${c.variant}) in ${c.sectionId}: ${c.props}` +
          (c.notes ? ` — ${c.notes}` : ""),
        )
      }
    }

    // Interactions
    if (analysis.interactions.length > 0) {
      sections.push("\n## Interaction Patterns")
      for (const i of analysis.interactions) {
        sections.push(`- **${i.trigger}** → ${i.effect} on [${i.targetComponentIds.join(", ")}]: ${i.description}`)
      }
    }

    // Responsive
    if (analysis.responsive.length > 0) {
      sections.push("\n## Responsive Rules")
      for (const r of analysis.responsive) {
        sections.push(`- **${r.breakpoint}**: ${r.layoutChanges} (affects: ${r.affectedSectionIds.join(", ")})`)
      }
    }

    return sections.join("\n")
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

  const orchCfg = await OrchestratorConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.design_analyst

  // Resolve model — use design_analyst-specific model if configured, else default
  const daModel = orchCfg.design_analyst.model
  let def: { providerID: string; modelID: string } | undefined
  if (daModel) {
    const [providerID, ...rest] = daModel.split("/")
    const modelID = rest.join("/")
    if (providerID && modelID) def = { providerID, modelID }
  }
  if (!def) def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for design analyst agent")
  const model = await Provider.getModel(def.providerID, def.modelID)

  if (input.signal?.aborted) throw new Error("design analyst aborted after model resolution")

  // Merge planner tools (codebase exploration) + webfetch + design output tools
  const plannerTools = createPlannerTools()
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
  if (!attachments?.length) return text
  const fileParts = await Promise.all(attachments.map(async (a) => {
    const located = AttachmentStore.nameFromUrl(a.url)
    if (!located) throw new Error(`attachment has no resolvable url: ${a.filename ?? a.sha}`)
    const bytes = await AttachmentStore.read(located.projectID, located.name)
    return {
      type: "file" as const,
      data: bytes,
      mediaType: a.mime,
      ...(a.filename ? { filename: a.filename } : {}),
    }
  }))
  return [{ type: "text" as const, text }, ...fileParts]
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
  const orchCfg = await OrchestratorConfig.get()
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
