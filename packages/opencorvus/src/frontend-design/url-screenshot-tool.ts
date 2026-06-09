import { tool } from "ai"
import path from "node:path"
import os from "node:os"
import z from "zod"

import { assessCaptureDiagnostics, captureReferenceManifest, summarizeCaptureDiagnostics } from "./capture-gate"

function screenshotFilename(inputUrl: string): string {
  try {
    const url = new URL(inputUrl)
    const host = url.hostname.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "webpage"
    return `${host}-reference.png`
  } catch {
    return "webpage-reference.png"
  }
}

export function createUrlScreenshotTool() {
  return {
    url_screenshot: tool({
      description:
        "Capture a live http(s) webpage as a PNG visual reference. " +
        "Records capture diagnostics such as byte size, non-white density, and color count without rejecting the image. " +
        "This is the only live-URL capture tool available to frontend-design; do NOT use webfetch for visual work.",
      inputSchema: z.object({
        url: z.string().describe("Live webpage URL to capture. Must start with http:// or https://."),
        viewport_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Viewport width in logical pixels. Default 1440."),
        viewport_height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Viewport height in logical pixels. Default 900."),
      }),
      execute: async ({ url, viewport_width, viewport_height }) => {
        const outDir = path.join(
          os.tmpdir(),
          "opencorvus-capture",
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        )
        const result = await captureReferenceManifest({
          url,
          outDir,
          viewport: {
            width: viewport_width ?? 1440,
            height: viewport_height ?? 900,
          },
        })
        const diagnostics = assessCaptureDiagnostics(result.manifest)
        const diagnosticSummary = diagnostics.length > 0 ? summarizeCaptureDiagnostics(diagnostics) : "none"

        const designContext = [
          `# URL reference`,
          `- URL: ${result.manifest.url}`,
          `- Viewport: ${result.manifest.viewport.width}×${result.manifest.viewport.height}`,
          `- Screenshot bytes: ${result.manifest.screenshot_byte_size}`,
          `- Non-white pixel ratio: ${result.manifest.non_white_pixel_ratio}`,
          `- Unique color buckets: ${result.manifest.unique_color_count}`,
          `- Text length: ${result.manifest.text_length}`,
          `- Capture diagnostics: ${diagnosticSummary}`,
          `- Manifest on disk: ${result.artifactPaths.manifestJson}`,
        ].join("\n")

        return {
          text: [
            "URL screenshot captured. Analyze the attached PNG as your visual reference.",
            "",
            designContext,
            "",
            "Continue the frontend design from the attached image. Do NOT use webfetch.",
          ].join("\n"),
          attachments: [
            {
              type: "file" as const,
              mime: "image/png",
              url: `data:image/png;base64,${result.screenshotPng.toString("base64")}`,
              filename: screenshotFilename(result.manifest.url),
            },
          ],
        }
      },
    }),
  }
}
