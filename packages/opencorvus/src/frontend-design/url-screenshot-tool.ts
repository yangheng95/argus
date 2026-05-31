import { tool } from "ai"
import path from "node:path"
import os from "node:os"
import z from "zod"

import {
  captureReferenceManifest,
  enforceCaptureGate,
  summarizeCaptureViolations,
} from "./capture-gate"

function screenshotFilename(inputUrl: string): string {
  try {
    const url = new URL(inputUrl)
    const host = url.hostname.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "webpage"
    return `${host}-reference.png`
  } catch {
    return "webpage-reference.png"
  }
}

/**
 * url_screenshot 工具：走唯一采集入口 captureReferenceManifest + enforceCaptureGate
 * （P0-A）。伪造/空白 PNG 直接 throw——LLM 会在 tool result 上看到 error 并终止分析，
 * 禁止"gate 未过但仍作为 visual_reference 继续"的退路（rule 1）。
 */
export function createUrlScreenshotTool() {
  return {
    url_screenshot: tool({
      description:
        "Capture a live http(s) webpage as a PNG visual reference. " +
        "Runs the P0-A reference-authenticity gate automatically — fake / blank / sub-threshold " +
        "screenshots are rejected with an error and MUST NOT be retried as a non-visual spec. " +
        "This is the only live-URL capture tool available to frontend-design; do NOT use webfetch for visual work.",
      inputSchema: z.object({
        url: z.string().describe("Live webpage URL to capture. Must start with http:// or https://."),
        viewport_width: z.number().int().positive().optional().describe("Viewport width in logical pixels. Default 1440."),
        viewport_height: z.number().int().positive().optional().describe("Viewport height in logical pixels. Default 900."),
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
        const gate = enforceCaptureGate(result.manifest)
        if (!gate.ok) {
          throw new Error(
            `capture-gate rejected reference for ${url}: ${summarizeCaptureViolations(gate.violations)}. ` +
              `Bytes=${result.manifest.screenshot_byte_size} non_white=${result.manifest.non_white_pixel_ratio} colors=${result.manifest.unique_color_count}. ` +
              `Do NOT fall back to a text-only visual contract.`,
          )
        }

        const designContext = [
          `# URL reference (gate passed)`,
          `- URL: ${result.manifest.url}`,
          `- Viewport: ${result.manifest.viewport.width}×${result.manifest.viewport.height}`,
          `- Screenshot bytes: ${result.manifest.screenshot_byte_size}`,
          `- Non-white pixel ratio: ${result.manifest.non_white_pixel_ratio}`,
          `- Unique color buckets: ${result.manifest.unique_color_count}`,
          `- Text length: ${result.manifest.text_length}`,
          `- Manifest on disk: ${result.artifactPaths.manifestJson}`,
        ].join("\n")

        return {
          text: [
            "URL screenshot captured and gated. Analyze the attached PNG as your visual reference.",
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
