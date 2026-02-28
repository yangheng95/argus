import z from "zod"
import { generateObject } from "ai"
import { Provider } from "../../provider/provider"
import { Log } from "../../util/log"
import { withRetry } from "../../util/retry"
import type { MonitorConfig, VisionAnalysis } from "../monitor/types"

import VISION_PROMPT from "./prompt/vision.txt"

const log = Log.create({ service: "monitor-vision" })

const VisionAnalysisSchema = z.object({
  description: z.string(),
  changeType: z.enum([
    "ui_update",
    "content_change",
    "error_appeared",
    "dialog",
    "notification",
    "navigation",
    "unknown",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  regions: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      label: z.string(),
    }),
  ),
})

export async function analyzeScreenshot(input: {
  screenshot: Buffer
  previousDescription?: string
  config: MonitorConfig
  /** Unix ms timestamp of when the screenshot was captured; defaults to now if omitted */
  timestamp?: number
}): Promise<VisionAnalysis> {
  const modelRef = input.config.visionModel ?? (await Provider.defaultModel())

  log.info("analyzing screenshot", {
    providerID: modelRef.providerID,
    modelID: modelRef.modelID,
  })

  const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
  const language = await Provider.getLanguage(model)

  const userContent: Array<
    | { type: "image"; image: Buffer }
    | { type: "text"; text: string }
  > = [
    { type: "image", image: input.screenshot },
    {
      type: "text",
      text: input.previousDescription
        ? `Previous state: ${input.previousDescription}\n\nDescribe what changed on screen.`
        : "Describe what is currently shown on screen and any notable elements.",
    },
  ]

  const result = await withRetry(
    () =>
      generateObject({
        model: language,
        messages: [
          { role: "system", content: VISION_PROMPT },
          { role: "user", content: userContent },
        ],
        schema: VisionAnalysisSchema,
        temperature: 0.2,
      }),
    { maxAttempts: 3, baseDelayMs: 1000, label: "vision.analyzeScreenshot" },
  )

  return {
    timestamp: input.timestamp ?? Date.now(), // when the screenshot was captured
    analyzedAt: Date.now(),                   // when the LLM analysis completed
    ...result.object,
    rawScreenshot: input.screenshot,
  }
}
