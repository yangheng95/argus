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
  description: `Render a webpage via headless Chrome and write a PNG screenshot.

Two modes:
  1. **Static mode (default):** serves \`inputDir\` over a built-in loopback server and loads \`index.html\`. Fast, no setup; appropriate when your project produces a self-contained \`index.html\` with all data inlined.
  2. **Live-server mode:** when \`url\` is provided, navigates puppeteer directly to that URL — no built-in server. Use this when your project needs a backend (Express/Fastify/Hono/etc.) that you have already started yourself (e.g. \`bun run dev\` on a known port). Pass \`url=http://127.0.0.1:<port>/<route>\`.

Hard-fails (so you don't iterate on a degraded screenshot) when, in static mode, the rendered page logs 404 / fetch / network errors — that means your page expected a live backend; switch to live-server mode or inline the data.

Returns the screenshot path + render time. Use as step 5 of the webpage-generate workflow. Follow with \`webpage_evaluate\` and \`webpage_vision_judge\`.`,
  parameters: z.object({
    inputDir: z
      .string()
      .describe(
        "Directory containing the project to render. In static mode this directory is served over a loopback server (must contain `index.html`). In live-server mode this is informational only. Defaults to the current worktree.",
      )
      .optional(),
    url: z
      .string()
      .url()
      .describe(
        "If your project needs a backend, start it yourself and pass the live URL here (e.g. `http://127.0.0.1:3000/`). When set, the built-in static server is skipped and puppeteer navigates directly to this URL.",
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
      url: params.url,
    })

    const pngPath = path.join(outputDir, outputName)
    await fs.writeFile(pngPath, render.screenshotBuffer)

    const inputDescription = params.url
      ? `live URL \`${params.url}\``
      : `\`${inputDir}/index.html\` (static mode)`

    return {
      title: `Rendered ${outputName} (${render.renderTimeMs}ms)`,
      output: [
        `# Rendered screenshot`,
        "",
        `- Input: ${inputDescription}`,
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
        liveUrl: params.url,
      },
    }
  },
})
