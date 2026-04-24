import { tool } from "ai"
import z from "zod"

import { fetchUrlScreenshot } from "./url-screenshot"

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
        "Use this when the task brief contains a live webpage URL and you need pixels for design analysis. " +
        "This is the only live-URL capture tool available to design-analyst; do NOT use webfetch for visual work.",
      inputSchema: z.object({
        url: z.string().describe("Live webpage URL to capture. Must start with http:// or https://."),
        viewport_width: z.number().int().positive().optional().describe("Viewport width in logical pixels. Default 1440."),
        viewport_height: z.number().int().positive().optional().describe("Viewport height in logical pixels. Default 900."),
        full_page: z.boolean().optional().describe("Capture the full scrollable page instead of the viewport. Default false."),
      }),
      execute: async ({ url, viewport_width, viewport_height, full_page }) => {
        const shot = await fetchUrlScreenshot({
          url,
          viewport: {
            width: viewport_width ?? 1440,
            height: viewport_height ?? 900,
          },
          fullPage: full_page ?? false,
        })

        return {
          text: [
            "URL screenshot captured. Analyze the attached PNG as your visual reference.",
            "",
            shot.designContext,
            "",
            "Continue the design analysis from the attached image. Do NOT use webfetch.",
          ].join("\n"),
          attachments: [{
            type: "file" as const,
            mime: shot.mime,
            url: `data:${shot.mime};base64,${shot.png.toString("base64")}`,
            filename: screenshotFilename(shot.finalUrl || shot.url),
          }],
        }
      },
    }),
  }
}