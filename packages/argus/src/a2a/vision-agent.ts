import z from "zod"
import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { Overlay } from "@/argus/perception/overlay"
import { createHash } from "crypto"

import VISION_PROMPT from "./prompt/vision.txt"

/**
 * VisionAgent — Analyzes screenshots independently, keeping images out of the main conversation flow.
 *
 * This is NOT a session-based agent. It uses direct `generateObject()` calls
 * for single-turn analysis, so screenshots never enter any session's message history.
 * This is the key architectural decision for context isolation.
 */
export namespace VisionAgent {
  const log = Log.create({ service: "a2a.vision" })

  // ── Types ──────────────────────────────────────────────────

  export const UIElement = z.object({
    description: z.string().describe("Human-readable description of the element"),
    type: z
      .enum(["button", "input", "link", "menu", "tab", "text", "icon", "checkbox", "dropdown", "other"])
      .describe("Type of UI element"),
    coordinates: z.object({
      x: z.number().int().describe("X coordinate (center of element)"),
      y: z.number().int().describe("Y coordinate (center of element)"),
    }),
    state: z
      .enum(["enabled", "disabled", "focused", "selected", "checked", "unchecked"])
      .optional()
      .describe("Current state of the element"),
  })
  export type UIElement = z.infer<typeof UIElement>

  export const SuggestedAction = z.object({
    type: z.enum(["click", "type", "key", "scroll", "double_click", "right_click", "drag", "wait"]),
    target: z.string().describe("Description of the target element"),
    coordinates: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
      })
      .optional(),
    text: z.string().optional().describe("Text to type (for 'type' actions)"),
    key: z.string().optional().describe("Key or key combination (for 'key' actions)"),
    reason: z.string().describe("Why this action is suggested"),
  })
  export type SuggestedAction = z.infer<typeof SuggestedAction>

  export const AnalysisResult = z.object({
    description: z.string().describe("Description of what's visible on screen"),
    elements: z.array(UIElement).describe("Interactive UI elements with coordinates"),
    suggestedAction: SuggestedAction.optional().describe("Suggested next action based on context"),
    runningSummary: z
      .string()
      .describe("Persistent summary tracking screen state across analyses"),
    errors: z
      .array(z.string())
      .optional()
      .describe("Any error messages or warnings visible on screen"),
  })
  export type AnalysisResult = z.infer<typeof AnalysisResult>

  export interface AnalysisRequest {
    screenshot: Buffer
    context: string
    previousSummary?: string
    boundWindow?: { title: string; width: number; height: number }
  }

  // ── Analysis ───────────────────────────────────────────────

  async function getModel() {
    const cfg = await Config.get()
    const a2a = cfg.a2a

    if (a2a?.vision_model) {
      const parsed = Provider.parseModel(a2a.vision_model)
      return Provider.getModel(parsed.providerID, parsed.modelID)
    }

    // Default: use the system default model
    const def = await Provider.defaultModel()
    return Provider.getModel(def.providerID, def.modelID)
  }

  export async function analyze(req: AnalysisRequest): Promise<AnalysisResult & { screenshotHash: string }> {
    const timer = log.time("vision analysis")

    try {
      // Add coordinate overlay to screenshot
      const overlaid = await Overlay.add(req.screenshot)
      const base64 = overlaid.toString("base64")
      const hash = createHash("md5").update(req.screenshot).digest("hex")

      // Build the user prompt
      const parts: string[] = []
      if (req.context) {
        parts.push(`## Current Context\n${req.context}`)
      }
      if (req.previousSummary) {
        parts.push(`## Previous State\n${req.previousSummary}`)
      }
      if (req.boundWindow) {
        parts.push(
          `## Window Info\nTitle: ${req.boundWindow.title}\nSize: ${req.boundWindow.width}x${req.boundWindow.height}`,
        )
      }
      parts.push("Analyze the screenshot above and provide the structured analysis.")

      const modelInfo = await getModel()
      const language = await Provider.getLanguage(modelInfo)

      const result = await generateObject({
        model: language,
        temperature: 0,
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image" as const,
                image: base64,
                mimeType: "image/png" as const,
              },
              {
                type: "text" as const,
                text: parts.join("\n\n"),
              },
            ],
          },
        ],
        schema: AnalysisResult,
      })

      log.info("vision analysis complete", {
        hash,
        elements: result.object.elements.length,
        hasSuggestion: !!result.object.suggestedAction,
      })

      return {
        ...result.object,
        screenshotHash: hash,
      }
    } finally {
      timer.stop()
    }
  }

  /**
   * Format the analysis result as text for injection into other agents' contexts.
   * This is how vision results enter the main flow — as text, not images.
   */
  export function toText(result: AnalysisResult & { screenshotHash: string }): string {
    const lines: string[] = []

    lines.push(`## Screen Analysis [${result.screenshotHash.slice(0, 8)}]`)
    lines.push("")
    lines.push(`**Description:** ${result.description}`)
    lines.push("")

    if (result.errors && result.errors.length > 0) {
      lines.push("**Errors/Warnings:**")
      for (const err of result.errors) {
        lines.push(`- ⚠ ${err}`)
      }
      lines.push("")
    }

    if (result.elements.length > 0) {
      lines.push("**Interactive Elements:**")
      for (const el of result.elements) {
        const state = el.state ? ` [${el.state}]` : ""
        lines.push(`- ${el.type}: "${el.description}" at (${el.coordinates.x}, ${el.coordinates.y})${state}`)
      }
      lines.push("")
    }

    if (result.suggestedAction) {
      const action = result.suggestedAction
      const coords = action.coordinates ? ` at (${action.coordinates.x}, ${action.coordinates.y})` : ""
      const extra = action.text ? ` text="${action.text}"` : action.key ? ` key="${action.key}"` : ""
      lines.push(`**Suggested Action:** ${action.type}${coords}${extra} — ${action.reason}`)
      lines.push("")
    }

    lines.push(`**Running Summary:** ${result.runningSummary}`)

    return lines.join("\n")
  }
}
