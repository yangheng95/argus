import z from "zod"
import { generateObject } from "ai"
import { Tool } from "./tool"
import { Capture } from "../opencorvus/perception/capture"
import { MonitorManager } from "../opencorvus/perception/monitor"
import { WindowManager } from "../opencorvus/perception/window"
import { Overlay } from "../opencorvus/perception/overlay"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { createHash } from "crypto"
import { GuiState } from "./gui-state"
import { DesktopState } from "./desktop-state"

import VISION_PROMPT from "./prompt/vision-analyze.txt"

const log = Log.create({ service: "vision-analyze" })

const DESCRIPTION = `Analyze the current screen WITHOUT putting the screenshot image into the conversation context.

Use this tool when you need to understand what's on screen but want to preserve context window space.
The screenshot is analyzed by a separate vision model and you receive a structured text summary —
the image never enters your message history.

This is ideal for:
- Long GUI automation sessions where many screenshots would bloat the context
- Quick checks where you just need to know what's visible
- Repeated screen monitoring where you don't need the raw image

For cases where you need to see the raw screenshot yourself (e.g., reading fine text, precise pixel
work), use screen.screenshot instead.`

const VisionAnalyzeParams = z.object({
  context: z
    .string()
    .describe("What you're looking for or trying to do — guides the analysis focus"),
  previous_summary: z
    .string()
    .optional()
    .describe("Summary from a previous vision_analyze call, for tracking state across analyses"),
})

// ── Structured output schema ──────────────────────────────────

const UIElement = z.object({
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

const SuggestedAction = z.object({
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

const AnalysisResult = z.object({
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

interface VisionMetadata {
  width: number
  height: number
  screenshotHash: string
  elementsFound: number
  runningSummary: string
  error?: boolean
}

export const VisionAnalyzeTool = Tool.define<typeof VisionAnalyzeParams, VisionMetadata>("vision_analyze", {
  description: DESCRIPTION,
  parameters: VisionAnalyzeParams,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "screen",
      patterns: ["vision_analyze"],
      always: ["*"],
      metadata: { action: "vision_analyze" },
    })
    GuiState.activate()
    DesktopState.markTask(GuiState.get().taskEpoch)
    await WindowManager.rebindForTask(GuiState.get().taskEpoch)

    const timer = log.time("vision analysis")

    try {
      const boundBeforeCapture = await WindowManager.getBinding()
      if (boundBeforeCapture?.info.isMinimized) {
        return {
          title: "Vision analysis blocked: bound window is minimized",
          output: `Bound window "${boundBeforeCapture.info.title}" is minimized. Restore and re-bind it, then run vision_analyze again.`,
          metadata: {
            width: 0,
            height: 0,
            screenshotHash: "",
            elementsFound: 0,
            runningSummary: "",
            error: true,
          },
        }
      }
      const capture = await Capture.take({ mode: "auto" })
      if (boundBeforeCapture && capture.scope !== "window") {
        return {
          title: "Vision analysis blocked: bound window capture drifted",
          output: `Bound window "${boundBeforeCapture.info.title}" could not be captured and capture drifted to ${capture.scope}. Re-bind with screen.bind_window and retry.`,
          metadata: {
            width: capture.width,
            height: capture.height,
            screenshotHash: "",
            elementsFound: 0,
            runningSummary: "",
            error: true,
          },
        }
      }

      // Add coordinate overlay
      const overlaid = await Overlay.add(capture.buffer)
      const base64 = overlaid.toString("base64")
      const hash = createHash("md5").update(capture.buffer).digest("hex")
      const capturedWindow = capture.scope === "window" ? capture.window : null
      DesktopState.recordCapture({
        scope: capture.scope,
        bounds: capture.windowBounds,
        window: capturedWindow ? { windowId: capturedWindow.id, title: capturedWindow.title } : null,
        monitor: capture.monitor ? { id: capture.monitor.id, name: capture.monitor.name } : null,
        screenshotHash: hash,
      })

      // Build user prompt with context
      const parts: string[] = []
      if (params.context) {
        parts.push(`## Current Context\n${params.context}`)
      }
      if (params.previous_summary) {
        parts.push(`## Previous State\n${params.previous_summary}`)
      }
      const binding = await WindowManager.getBinding()
      const monitorBinding = await MonitorManager.getBinding()
      if (binding) {
        parts.push(
          `## Window Info\nTitle: ${binding.info.title}\nSize: ${binding.info.width}x${binding.info.height}`,
        )
      } else if (monitorBinding) {
        parts.push(
          `## Monitor Info\nName: ${monitorBinding.info.name}\nSize: ${monitorBinding.info.width}x${monitorBinding.info.height}`,
        )
      }
      parts.push("Analyze the screenshot above and provide the structured analysis.")

      // Use default model for vision
      const def = await Provider.defaultModel()
      const modelInfo = await Provider.getModel(def.providerID, def.modelID)
      const language = await Provider.getLanguage(modelInfo)

      const result = await generateObject({
        model: language,
        temperature: 0,
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "image" as const, image: base64 },
              { type: "text" as const, text: parts.join("\n\n") },
            ],
          },
        ],
        schema: AnalysisResult,
      })

      const analysis = result.object

      log.info("vision analysis complete", {
        hash: hash.slice(0, 8),
        elements: analysis.elements.length,
        hasSuggestion: !!analysis.suggestedAction,
      })

      // Format as text — this is what the LLM sees, no image
      const lines: string[] = []
      lines.push(`## Screen Analysis [${hash.slice(0, 8)}]`)
      lines.push("")
      lines.push(`**Description:** ${analysis.description}`)
      lines.push("")

      if (analysis.errors && analysis.errors.length > 0) {
        lines.push("**Errors/Warnings:**")
        for (const err of analysis.errors) {
          lines.push(`- ${err}`)
        }
        lines.push("")
      }

      if (analysis.elements.length > 0) {
        lines.push("**Interactive Elements:**")
        for (const el of analysis.elements) {
          const state = el.state ? ` [${el.state}]` : ""
          lines.push(`- ${el.type}: "${el.description}" at (${el.coordinates.x}, ${el.coordinates.y})${state}`)
        }
        lines.push("")
      }

      if (analysis.suggestedAction) {
        const action = analysis.suggestedAction
        const coords = action.coordinates ? ` at (${action.coordinates.x}, ${action.coordinates.y})` : ""
        const extra = action.text ? ` text="${action.text}"` : action.key ? ` key="${action.key}"` : ""
        lines.push(`**Suggested Action:** ${action.type}${coords}${extra} — ${action.reason}`)
        lines.push("")
      }

      lines.push(`**Running Summary:** ${analysis.runningSummary}`)

      const coordInfo = binding
        ? `Coordinates are relative to bound window "${binding.info.title}" (${binding.info.width}x${binding.info.height}).`
        : capture.scope === "monitor" && capture.monitor
          ? `Coordinates are relative to monitor "${capture.monitor.name}" (${capture.monitor.width}x${capture.monitor.height}).`
          : "Coordinates are screen-absolute."

      return {
        title: `Screen analyzed (${capture.width}x${capture.height})`,
        output: `${lines.join("\n")}\n\n${coordInfo}`,
        metadata: {
          width: capture.width,
          height: capture.height,
          screenshotHash: hash,
          elementsFound: analysis.elements.length,
          runningSummary: analysis.runningSummary,
        },
        // NO attachments — image stays out of the conversation
      }
    } catch (err) {
      log.error("vision analysis failed", { err })
      return {
        title: "Vision analysis failed",
        output: `Vision analysis failed: ${(err as Error).message}. Use screen.screenshot as fallback.`,
        metadata: {
          width: 0,
          height: 0,
          screenshotHash: "",
          elementsFound: 0,
          runningSummary: "",
          error: true,
        },
      }
    } finally {
      timer.stop()
    }
  },
})
