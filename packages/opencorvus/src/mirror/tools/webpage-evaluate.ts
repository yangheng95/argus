/**
 * `webpage_evaluate` tool — wraps `mirror/visual/evaluate::evaluateVisual`.
 *
 * Compares a reference screenshot to a rendered screenshot and emits a numeric
 * score (SSIM × 50 + pixel-similarity × 50). No diff heatmap — that proxy
 * channeled the agent into pixel-mask whack-a-mole instead of looking at the
 * reference and rendered PNGs directly. Acceptance is now driven by
 * `webpage_vision_judge` (LLM reads the two PNGs); this tool is a coarse score
 * only.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { evaluateVisual } from "../visual/evaluate"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const WebpageEvaluateTool = Tool.define("webpage_evaluate", {
  description: `Score visual similarity between a reference and a rendered screenshot.

Formula: \`round(ssim * 50 + (100 - pixelDiff%) * 0.5)\`.
  - SSIM: structural similarity on ITU-R BT.709 luminance (captures layout + edges)
  - pixelmatch: pixel-level diff at threshold 0.1 (captures colour precision)
  - dimension-mismatch penalty proportional to area ratio when the two images differ in size

Returns score, SSIM, and pixelDiff%. Use it to track progress between iterations and as a regression check. Acceptance is decided by \`webpage_vision_judge\`, which reads \`reference.png\` and \`rendered.png\` directly — the score alone cannot tell you whether structural elements are correct.`,
  parameters: z.object({
    reference: z
      .string()
      .describe(
        "Path to the reference PNG (e.g. reference.png from webpage_extract). Can be an absolute path or relative to the worktree.",
      ),
    rendered: z
      .string()
      .describe("Path to the rendered PNG (e.g. rendered.png from webpage_render)."),
    outputDir: z
      .string()
      .describe(`Directory used to resolve relative paths and to write \`eval-result.json\`. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_extract's default).`)
      .optional(),
  }),
  async execute(params) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)

    const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(outputDir, p))
    const referencePath = resolve(params.reference)
    const renderedPath = resolve(params.rendered)

    const report = await evaluateVisual({
      originalImage: referencePath,
      renderedImage: renderedPath,
    })

    const evalResultPath = path.join(outputDir, "eval-result.json")
    const evalResult = {
      generatedAt: new Date().toISOString(),
      referencePath,
      renderedPath,
      overallScore: report.overallScore,
      ssimScore: report.ssimScore,
      pixelDiffPercent: report.pixelDiffPercent,
      dimensionsMatch: report.dimensionsMatch,
      mismatchedPixels: report.mismatchedPixels,
      totalPixels: report.totalPixels,
      comparisonDimensions: report.comparisonDimensions,
    }
    await fs.writeFile(evalResultPath, JSON.stringify(evalResult, null, 2), "utf8")

    return {
      title: `Score ${report.overallScore}/100 (ssim=${report.ssimScore.toFixed(3)} pixelDiff=${report.pixelDiffPercent.toFixed(2)}%)`,
      output: [
        `# Visual evaluation`,
        "",
        `- Reference: \`${referencePath}\``,
        `- Rendered:  \`${renderedPath}\``,
        `- Result:    \`${evalResultPath}\``,
        "",
        `## Score: **${report.overallScore}/100**`,
        `- SSIM structural: ${report.ssimScore.toFixed(4)}`,
        `- Pixel diff: ${report.pixelDiffPercent.toFixed(2)}% (${report.mismatchedPixels} / ${report.totalPixels} px)`,
        `- Dimensions match: ${report.dimensionsMatch} (compared at ${report.comparisonDimensions.width}×${report.comparisonDimensions.height})`,
        "",
        "This score is a coarse signal only. For acceptance call `webpage_vision_judge` — it reads the two PNGs and returns a structured diff list. Do not loop on this number.",
      ].join("\n"),
      metadata: {
        overallScore: report.overallScore,
        ssimScore: report.ssimScore,
        pixelDiffPercent: report.pixelDiffPercent,
        dimensionsMatch: report.dimensionsMatch,
        mismatchedPixels: report.mismatchedPixels,
        totalPixels: report.totalPixels,
        evalResultPath,
      },
    }
  },
})
