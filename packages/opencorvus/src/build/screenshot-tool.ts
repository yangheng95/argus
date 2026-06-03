import fs from "node:fs/promises"
import path from "node:path"
import { tool } from "ai"
import sharp from "sharp"
import z from "zod"
import { captureRuntimePage, type RuntimeCaptureSuccess } from "@/runtime/page-capture"
import { buildMultimodalToolResult } from "@/tool/multimodal-result"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Log } from "@/util/log"

const log = Log.create({ service: "build-screenshot-tool" })
// LLM means large language model; this limit applies to the image attached
// for model vision input, not to the browser capture viewport.
const LLM_SCREENSHOT_MAX = { width: 1440, height: 900 } as const

export async function resizeScreenshotForLLM(input: { path: string }): Promise<{
  path: string
  width: number
  height: number
  resized: boolean
}> {
  const image = sharp(input.path)
  const metadata = await image.metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) {
    throw new Error(`resizeScreenshotForLLM: cannot read image dimensions for ${input.path}`)
  }
  if (width <= LLM_SCREENSHOT_MAX.width && height <= LLM_SCREENSHOT_MAX.height) {
    return { path: input.path, width, height, resized: false }
  }

  const parsed = path.parse(input.path)
  const outputPath = path.join(
    parsed.dir,
    `${parsed.name}.llm-${LLM_SCREENSHOT_MAX.width}x${LLM_SCREENSHOT_MAX.height}.png`,
  )
  const info = await image
    .resize({
      width: LLM_SCREENSHOT_MAX.width,
      height: LLM_SCREENSHOT_MAX.height,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toFile(outputPath)
  return { path: outputPath, width: info.width, height: info.height, resized: true }
}

export async function buildScreenshotToolOutput(projectID: string, capture: RuntimeCaptureSuccess) {
  const variance = capture.layers.pixel.variance
  const llmImage = await resizeScreenshotForLLM({ path: capture.path })
  return await buildMultimodalToolResult({
    projectID,
    text: JSON.stringify(
      {
        ok: true,
        path: capture.path,
        sha: capture.sha,
        bytes: capture.bytes,
        width: capture.size.width,
        height: capture.size.height,
        requested_viewport: capture.requested_viewport,
        viewport: capture.viewport,
        viewport_capped: capture.viewport.capped,
        llm_image: {
          path: llmImage.path,
          width: llmImage.width,
          height: llmImage.height,
          resized: llmImage.resized,
          max_width: LLM_SCREENSHOT_MAX.width,
          max_height: LLM_SCREENSHOT_MAX.height,
        },
        pixel_variance: Number(variance.toFixed(2)),
        degenerate: variance < 25,
        note:
          variance < 25
            ? "Pixel variance < 25 - the screenshot is near-uniform (blank page, JSON error body, or unhydrated shell). Do NOT count as a passed visual check."
            : undefined,
      },
      null,
      2,
    ),
    images: [{ path: llmImage.path, mime: "image/png", filename: path.basename(llmImage.path) }],
  })
}

export function createBuildScreenshotTool(input: { projectID: string; projectDir: string; taskID: string }) {
  return tool({
    description:
      "Capture a PNG screenshot of an already running app URL for build-agent visual verification. " +
      "The original capture is saved under the task build screenshot directory; the image attached back to the next LLM turn is resized proportionally to fit within 1440x900 without cropping or enlargement.",
    inputSchema: z.object({
      url: z
        .string()
        .describe(
          "Absolute http(s) URL for an already running app. Start the dev server yourself via bash or run_command first; this tool never starts servers or serves static files.",
        ),
      viewport_width: z.number().int().min(100).max(4096).default(1440).describe("Viewport width in CSS pixels."),
      viewport_height: z.number().int().min(100).max(4096).default(1080).describe("Viewport height in CSS pixels."),
      label: z
        .string()
        .optional()
        .describe("Short label used in the output filename, e.g. 'after-fix-1' or 'chart-area'. Alphanum / dash only."),
    }),
    execute: async ({ url, viewport_width, viewport_height, label }) => {
      const safeLabel = (label ?? "shot").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40) || "shot"
      const outDir = ProjectRuntimePaths.taskAbsolute(input.projectDir, input.taskID, "build", "screenshots")
      await fs.mkdir(outDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const captureDir = path.join(outDir, `${stamp}-${safeLabel}`)
      try {
        const capture = await captureRuntimePage({
          url,
          outDir: captureDir,
          viewport_width,
          viewport_height,
          fileLabel: safeLabel,
        })
        if (!capture.captured) {
          return JSON.stringify(capture, null, 2)
        }
        return await buildScreenshotToolOutput(input.projectID, capture)
      } catch (err) {
        log.warn("build screenshot failed", { url, err })
        return `screenshot failed: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
