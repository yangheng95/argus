import z from "zod"
import { generateObject } from "ai"
import { Tool } from "./tool"
import { Capture } from "../opencorvus/perception/capture"
import { CVCandidate } from "../opencorvus/perception/cv-candidate"
import { MonitorManager } from "../opencorvus/perception/monitor"
import { WindowManager } from "../opencorvus/perception/window"
import { Overlay } from "../opencorvus/perception/overlay"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { createHash } from "crypto"
import { GuiState } from "./gui-state"
import { DesktopState } from "./desktop-state"
import { applyVisionCandidates, visionCandidatePrompt } from "./vision-candidate"

import VISION_PROMPT from "./prompt/vision-analyze.txt"

const log = Log.create({ service: "vision-analyze" })
const envInt = (key: string, fallback: number) => {
  const raw = Number(process.env[key] ?? "")
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.floor(raw)
}
const envBool = (key: string, fallback: boolean) => {
  const raw = (process.env[key] ?? "").trim().toLowerCase()
  if (!raw) return fallback
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}
const cvPromptLimit = envInt("OPENCORVUS_VISION_CANDIDATE_PROMPT_LIMIT", 40)
const cvOverlayLimit = envInt("OPENCORVUS_VISION_CANDIDATE_OVERLAY_LIMIT", 24)
const cvOverlay = envBool("OPENCORVUS_VISION_CANDIDATE_OVERLAY", false)

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
  context: z.string().describe("What you're looking for or trying to do — guides the analysis focus"),
  previous_summary: z
    .string()
    .optional()
    .describe("Summary from a previous vision_analyze call, for tracking state across analyses"),
})

// ── Structured output schema ──────────────────────────────────

function normalizeElementType(value: string) {
  const key = value.trim().toLowerCase()
  if (key === "button" || key === "input" || key === "link" || key === "menu" || key === "tab") return key
  if (key === "checkbox" || key === "dropdown") return key
  if (key === "icon" || key === "icon_button") return "icon"
  if (key === "label" || key === "status_group") return "text"
  return "other"
}

const Point = z
  .union([
    z.object({
      x: z.number().int(),
      y: z.number().int(),
    }),
    z.tuple([z.number().int(), z.number().int()]),
  ])
  .transform((value) => {
    if (Array.isArray(value)) {
      return {
        x: value[0],
        y: value[1],
      }
    }
    return value
  })

const UIElement = z.object({
  id: z
    .string()
    .optional()
    .describe("Stable element id for tool calls, e.g. send_button, input_search, menu_file"),
  description: z.string().optional().describe("Human-readable description of the element"),
  type: z.string().transform(normalizeElementType).describe("Type of UI element"),
  candidate_id: z.string().optional().describe("Optional OpenCV candidate id (e.g. cv_001) if matched"),
  coordinates: Point.describe("Element center in pixels"),
  bbox: z
    .object({
      x: z.number().int().describe("Top-left X coordinate"),
      y: z.number().int().describe("Top-left Y coordinate"),
      width: z.number().int().min(1).describe("Element width"),
      height: z.number().int().min(1).describe("Element height"),
    })
    .optional()
    .describe("Element bounding box in image pixel space"),
  confidence: z.number().min(0).max(1).optional().describe("Confidence score for this element detection (0-1)"),
  state: z.string().optional().describe("Current state of the element"),
})

const SuggestedActionObject = z.object({
  type: z.enum(["click", "type", "key", "scroll", "double_click", "right_click", "drag", "wait"]),
  target: z.string().describe("Description of the target element"),
  coordinates: Point.optional(),
  text: z.string().optional().describe("Text to type (for 'type' actions)"),
  key: z.string().optional().describe("Key or key combination (for 'key' actions)"),
  reason: z.string().describe("Why this action is suggested"),
})

const SuggestedAction = z
  .union([
    SuggestedActionObject,
    z.object({
      action: z.enum(["click", "type", "key", "scroll", "double_click", "right_click", "drag", "wait"]),
      target_id: z.string().optional(),
      reason: z.string().optional(),
    }),
    z.string(),
  ])
  .transform((value) => {
    if (typeof value === "string") return null
    if ("type" in value) return value
    return {
      type: value.action,
      target: value.target_id ?? "unknown",
      coordinates: undefined,
      text: undefined,
      key: undefined,
      reason: value.reason ?? "",
    }
  })

const AnalysisResult = z
  .union([
    z.object({
      description: z.string().describe("Description of what's visible on screen"),
      elements: z.array(UIElement).describe("Interactive UI elements with coordinates"),
      suggestedAction: SuggestedAction.optional().describe("Suggested next action based on context"),
      runningSummary: z.string().describe("Persistent summary tracking screen state across analyses"),
      errors: z.array(z.string()).optional().describe("Any error messages or warnings visible on screen"),
    }),
    z.object({
      description: z.string(),
      interactive_elements: z.array(UIElement),
      suggested_action: SuggestedAction.optional(),
      running_summary: z.string(),
      errors: z.array(z.string()).optional(),
    }),
  ])
  .transform((item) => {
    if ("elements" in item) return item
    return {
      description: item.description,
      elements: item.interactive_elements,
      suggestedAction: item.suggested_action,
      runningSummary: item.running_summary,
      errors: item.errors,
    }
  })

interface VisionMetadata {
  width: number
  height: number
  screenshotHash: string
  elementsFound: number
  targetsRegistered: number
  cvCandidatesDetected: number
  cvCandidatesUsed: number
  cvCandidateSource: string
  targets?: Array<{ id: string; x: number; y: number; confidence: number | null }>
  coordinateOverlaySource: string
  runningSummary: string
  error?: boolean
}

function normalizeID(value: string | undefined, index: number) {
  const base = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (base) return base
  return `el_${index + 1}`
}

function normalizeElements(input: z.infer<typeof UIElement>[]) {
  const seen = new Set<string>()
  return input.map((item, index) => {
    const raw = normalizeID(item.id, index)
    const suffix = seen.has(raw) ? `_${index + 1}` : ""
    const id = `${raw}${suffix}`
    seen.add(id)
    return {
      ...item,
      id,
      description: item.description?.trim() ?? id,
      candidate_id: item.candidate_id?.trim().toLowerCase() ?? null,
      confidence: item.confidence ?? null,
      bbox: item.bbox ?? null,
    }
  })
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
    let cvDetected = 0
    let cvSource = "none"

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
            targetsRegistered: 0,
            cvCandidatesDetected: 0,
            cvCandidatesUsed: 0,
            cvCandidateSource: "none",
            coordinateOverlaySource: "none",
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
            targetsRegistered: 0,
            cvCandidatesDetected: 0,
            cvCandidatesUsed: 0,
            cvCandidateSource: "none",
            coordinateOverlaySource: "none",
            runningSummary: "",
            error: true,
          },
        }
      }

      const cvCandidates = await CVCandidate.detect(capture.buffer, { max: 80 })
      cvDetected = cvCandidates.length
      cvSource = cvCandidates.length > 0 ? "tool.cv_candidate.python-opencv" : "none"
      const cvPrompt = visionCandidatePrompt(cvCandidates, cvPromptLimit)

      // Add coordinate overlay + optional candidate overlay
      const overlaidGrid = await Overlay.add(capture.buffer)
      const overlaid =
        cvOverlay && cvCandidates.length > 0
          ? await Overlay.addCandidates(overlaidGrid, cvCandidates, { limit: cvOverlayLimit }).catch(() => overlaidGrid)
          : overlaidGrid
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
        parts.push(`## Window Info\nTitle: ${binding.info.title}\nSize: ${binding.info.width}x${binding.info.height}`)
      } else if (monitorBinding) {
        parts.push(
          `## Monitor Info\nName: ${monitorBinding.info.name}\nSize: ${monitorBinding.info.width}x${monitorBinding.info.height}`,
        )
      }
      if (cvPrompt) {
        parts.push(cvPrompt)
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
      const normalized = normalizeElements(analysis.elements)
      const snapped = applyVisionCandidates(normalized, cvCandidates)
      const elements = snapped.items
      const targets = GuiState.recordVisionTargets(
        hash,
        elements.map((item) => ({
          id: item.id,
          description: item.description,
          type: item.type,
          x: item.coordinates.x,
          y: item.coordinates.y,
          confidence: item.confidence,
          bbox: item.bbox,
        })),
      )

      log.info("vision analysis complete", {
        hash: hash.slice(0, 8),
        elements: elements.length,
        cvCandidates: cvCandidates.length,
        cvCandidatesUsed: snapped.used.length,
        hasSuggestion: !!analysis.suggestedAction,
      })

      // Compact output — essential coordinates and actions only
      const lines: string[] = []

      if (analysis.errors && analysis.errors.length > 0) {
        lines.push(`Errors: ${analysis.errors.join("; ")}`)
      }

      if (elements.length > 0) {
        for (const el of elements) {
          const state = el.state ? `[${el.state}]` : ""
          const candidate = el.candidate_id ? ` candidate=${el.candidate_id}` : ""
          lines.push(
            `${el.id} ${el.type}(${el.coordinates.x},${el.coordinates.y})${state}${candidate} conf=${el.confidence === null ? "n/a" : el.confidence.toFixed(2)} ${el.description}`,
          )
        }
      }

      if (analysis.suggestedAction) {
        const a = analysis.suggestedAction
        const coords = a.coordinates ? `(${a.coordinates.x},${a.coordinates.y})` : ""
        const extra = a.text ? ` "${a.text}"` : a.key ? ` key=${a.key}` : ""
        lines.push(`Next: ${a.type}${coords}${extra}`)
      }

      lines.push(analysis.runningSummary)
      if (cvCandidates.length > 0) {
        lines.push(
          `OpenCV candidates detected: ${cvCandidates.length}, used: ${snapped.used.length}. Candidate snapping is tool-driven (nearest/explicit with gate), not only LLM-selected candidate_id.`,
        )
      }
      lines.push(
        `Use input.click with target_id for precision, e.g. {"action":"click","target_id":"<element_id>","screenshot_hash":"${hash}"}.`,
      )
      lines.push("Coordinate grid overlay is rendered by tool.vision_analyze (not by the LLM).")
      if (cvOverlay && cvCandidates.length > 0) {
        lines.push("Candidate box overlay is rendered by tool.cv_candidate + tool.vision_analyze (not by the LLM).")
      }
      if (!cvOverlay && cvCandidates.length > 0) {
        lines.push("Candidate boxes are not rendered on image by default to reduce visual clutter for the vision model.")
      }

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
          elementsFound: elements.length,
          targetsRegistered: targets.length,
          cvCandidatesDetected: cvDetected,
          cvCandidatesUsed: snapped.used.length,
          cvCandidateSource: cvSource,
          targets: targets.map((item) => ({
            id: item.id,
            x: item.x,
            y: item.y,
            confidence: item.confidence,
          })),
          coordinateOverlaySource:
            cvOverlay && cvCandidates.length > 0
              ? "tool.vision_analyze.Overlay.add+Overlay.addCandidates"
              : "tool.vision_analyze.Overlay.add",
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
          targetsRegistered: 0,
          cvCandidatesDetected: cvDetected,
          cvCandidatesUsed: 0,
          cvCandidateSource: cvSource,
          coordinateOverlaySource: "none",
          runningSummary: "",
          error: true,
        },
      }
    } finally {
      timer.stop()
    }
  },
})
