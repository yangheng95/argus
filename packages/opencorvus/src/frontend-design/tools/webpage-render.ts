/**
 * `webpage_render` tool — renders app files into a screenshot.
 *
 * Loads an explicit URL in a visible browser and captures a PNG screenshot.
 * Output is written to
 * `<outputDir>/rendered.png` (or a user-supplied name).
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { renderFiles } from "@/browser/webpage/render"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"

export const WebpageRenderTool = Tool.define("webpage_render", {
  description: `Render an explicit webpage URL in a visible browser and write a PNG screenshot.

Returns the screenshot path + render time. This is a Build/Integrity runtime evidence tool for already-running apps; frontend_design should not use it for frontend template drafting. For webpage replicas, compare the rendered target against the reference viewport matrix and report the measured visual-fidelity evidence required by the active handoff.`,
  parameters: z.object({
    url: z
      .string()
      .url()
      .describe(
        "The exact browser URL to capture. Use http:// or https:// for the already running app.",
      ),
    outputDir: z
      .string()
      .describe(
        `Directory to write the screenshot into. Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`. Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
    viewport_width: z.number().int().positive().describe("Viewport width. Default 1440.").optional(),
    viewport_height: z.number().int().positive().describe("Viewport height. Default 900.").optional(),
    full_page: z.boolean().describe("Capture full scrollable page. Default false (viewport only).").optional(),
    output_name: z
      .string()
      .describe("Filename for the screenshot (relative to outputDir). Default rendered.png.")
      .optional(),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .describe("Max time for launch + navigation + screenshot. Default 30000.")
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveWebpageEvidenceOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })

    await ctx.ask({
      permission: "webpage_render",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, outputDir },
    })

    const viewport = {
      width: params.viewport_width ?? 1440,
      height: params.viewport_height ?? 900,
    }
    const outputName = params.output_name ?? "rendered.png"

    const render = await renderFiles({
      url: params.url,
      viewport,
      fullPage: params.full_page ?? false,
      timeout: params.timeout_ms ?? 30_000,
    })

    const pngPath = path.join(outputDir, outputName)
    await fs.writeFile(pngPath, render.screenshotBuffer)
    const renderResultPath = path.join(outputDir, "render-result.json")
    await fs.writeFile(
      renderResultPath,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        url: params.url,
        renderedPath: pngPath,
        viewport,
        fullPage: params.full_page ?? false,
        renderTimeMs: render.renderTimeMs,
        projectDirectory: process.cwd(),
        consoleErrors: render.consoleErrors,
      }, null, 2),
      "utf8",
    )

    return {
      title: `Rendered ${outputName} (${render.renderTimeMs}ms)`,
      output: [
        `# Rendered screenshot`,
        "",
        `- Input: \`${params.url}\``,
        `- Output: \`${pngPath}\``,
        `- Render metadata: \`${renderResultPath}\``,
        `- Viewport: ${viewport.width}×${viewport.height}${params.full_page ? " (full page)" : ""}`,
        `- Render time: ${render.renderTimeMs}ms`,
        render.consoleErrors && render.consoleErrors.length > 0
          ? `- Console errors (${render.consoleErrors.length}): ${render.consoleErrors.slice(0, 3).join(" | ")}`
          : "",
        "",
        "Next: call `webpage_evaluate` with `rendered` pointing at the screenshot above, then call `webpage_vision_judge` for qualitative differences.",
      ].filter(Boolean).join("\n"),
      metadata: {
        renderedPath: pngPath,
        renderResultPath,
        renderTimeMs: render.renderTimeMs,
        viewport,
        consoleErrors: render.consoleErrors,
        url: params.url,
      },
    }
  },
})
