/**
 * `webpage_render` tool — wraps `mirror/visual/render::renderFiles`.
 *
 * Serves the worktree over a loopback HTTP server, loads `index.html` in
 * headless Chrome, and captures a PNG screenshot. Output is written to
 * `<outputDir>/rendered.png` (or a user-supplied name).
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Instance } from "../../project/instance"
import { renderFiles } from "../visual/render"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const WebpageRenderTool = Tool.define("webpage_render", {
  description: `Render a local \`index.html\` via headless Chrome and write a PNG screenshot.

Serves the output directory over a loopback server, loads \`index.html\`, waits for fonts + images + a 3s settle, then captures a PNG at the chosen viewport. Returns the screenshot path + render time.

Use as step 5 of the webpage-clone workflow (after your agent wrote index.html). Follow it with \`webpage_evaluate\` to score against reference.png. Requires a local browser — no external network is strictly needed.`,
  parameters: z.object({
    inputDir: z
      .string()
      .describe(
        "Directory containing the `index.html` to render (served over a loopback server). Defaults to the current worktree — where the executor writes the clone's deliverable.",
      )
      .optional(),
    outputDir: z
      .string()
      .describe(
        `Directory to write the screenshot into. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree so artifacts stay out of the project source tree. Override with an absolute path or a worktree-relative path.`,
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
    const inputDir = params.inputDir
      ? path.resolve(Instance.directory, params.inputDir)
      : Instance.directory
    const outputDir = await resolveMirrorOutputDir(params.outputDir)

    await ctx.ask({
      permission: "webpage_render",
      patterns: [inputDir],
      always: ["*"],
      metadata: { inputDir, outputDir },
    })

    const viewport = {
      width: params.viewport_width ?? 1440,
      height: params.viewport_height ?? 900,
    }
    const outputName = params.output_name ?? "rendered.png"

    const render = await renderFiles({
      outputDir: inputDir,
      viewport,
      fullPage: params.full_page ?? false,
      timeout: params.timeout_ms ?? 30_000,
    })

    const pngPath = path.join(outputDir, outputName)
    await fs.writeFile(pngPath, render.screenshotBuffer)

    return {
      title: `Rendered ${outputName} (${render.renderTimeMs}ms)`,
      output: [
        `# Rendered screenshot`,
        "",
        `- Input: \`${inputDir}/index.html\``,
        `- Output: \`${pngPath}\``,
        `- Viewport: ${viewport.width}×${viewport.height}${params.full_page ? " (full page)" : ""}`,
        `- Render time: ${render.renderTimeMs}ms`,
        render.consoleErrors && render.consoleErrors.length > 0
          ? `- Console errors (${render.consoleErrors.length}): ${render.consoleErrors.slice(0, 3).join(" | ")}`
          : "",
        "",
        "Next: call `webpage_evaluate` with `referencePath=reference.png` and `renderedPath` pointing at the screenshot above.",
      ].filter(Boolean).join("\n"),
      metadata: {
        renderedPath: pngPath,
        renderTimeMs: render.renderTimeMs,
        viewport,
        consoleErrors: render.consoleErrors,
      },
    }
  },
})
