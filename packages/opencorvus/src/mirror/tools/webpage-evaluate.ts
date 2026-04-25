/**
 * `webpage_evaluate` tool — wraps `mirror/visual/evaluate::evaluateVisual`.
 *
 * Compares a reference screenshot to a rendered screenshot and produces:
 *   - an overall score in 0-100 (SSIM structural × 50 + pixel-similarity × 50)
 *   - a diff heatmap PNG written to `<outputDir>/diff.png` by default
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

Writes a diff-heatmap PNG (red where pixels differ). Returns score, SSIM, pixelDiff%, and paths.

Use as step 6 of the webpage-generate workflow. Feed the diff image path back to the agent as context for the next edit round.`,
  parameters: z.object({
    reference: z
      .string()
      .describe(
        "Path to the reference PNG (e.g. reference.png from webpage_extract). Can be an absolute path or relative to the worktree.",
      ),
    rendered: z
      .string()
      .describe("Path to the rendered PNG (e.g. rendered.png from webpage_render)."),
    diff_output: z
      .string()
      .describe("Path for the diff heatmap PNG. Default <outputDir>/diff.png.")
      .optional(),
    outputDir: z
      .string()
      .describe(`Directory used to resolve relative paths and for default diff output. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_extract's default).`)
      .optional(),
  }),
  async execute(params) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)

    const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(outputDir, p))
    const referencePath = resolve(params.reference)
    const renderedPath = resolve(params.rendered)
    const diffPath = params.diff_output ? resolve(params.diff_output) : path.join(outputDir, "diff.png")

    const report = await evaluateVisual({
      originalImage: referencePath,
      renderedImage: renderedPath,
    })

    const diffBase64 = report.diffImageDataUrl.replace(/^data:image\/png;base64,/, "")
    await fs.writeFile(diffPath, Buffer.from(diffBase64, "base64"))

    const evalResultPath = path.join(outputDir, "eval-result.json")
    const evalResult = {
      generatedAt: new Date().toISOString(),
      referencePath,
      renderedPath,
      diffPath,
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
        `- Diff:      \`${diffPath}\``,
        `- Result:    \`${evalResultPath}\``,
        "",
        `## Score: **${report.overallScore}/100**`,
        `- SSIM structural: ${report.ssimScore.toFixed(4)}`,
        `- Pixel diff: ${report.pixelDiffPercent.toFixed(2)}% (${report.mismatchedPixels} / ${report.totalPixels} px)`,
        `- Dimensions match: ${report.dimensionsMatch} (compared at ${report.comparisonDimensions.width}×${report.comparisonDimensions.height})`,
        "",
        report.overallScore >= 95
          ? "✅ Target score reached."
          : "The diff PNG shows red pixels where rendered differs from reference — focus your next edits on the largest red regions first. Re-render after edits and re-evaluate.",
      ].join("\n"),
      metadata: {
        overallScore: report.overallScore,
        ssimScore: report.ssimScore,
        pixelDiffPercent: report.pixelDiffPercent,
        dimensionsMatch: report.dimensionsMatch,
        mismatchedPixels: report.mismatchedPixels,
        totalPixels: report.totalPixels,
        diffPath,
        evalResultPath,
      },
    }
  },
})
