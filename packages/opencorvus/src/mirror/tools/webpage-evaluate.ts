/**
 * `webpage_evaluate` tool — wraps `mirror/visual/evaluate::evaluateVisual`.
 *
 * Compares a reference screenshot to a rendered screenshot and emits a numeric
 * score (SSIM × 50 + pixel-similarity × 50). No diff heatmap — that proxy
 * channeled the agent into pixel-mask whack-a-mole instead of looking at the
 * reference and rendered PNGs directly. The numeric visual threshold is owned
 * by `evaluate.ts`; `webpage_vision_judge` remains the qualitative diff review.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { WEBPAGE_EVALUATE_PASS_SCORE, evaluateVisual, isEvaluationReportPassing } from "../visual/evaluate"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const WebpageEvaluateTool = Tool.define("webpage_evaluate", {
  description: `Score visual similarity between a reference and a rendered screenshot.

Formula: \`round(ssim * 50 + (100 - pixelDiff%) * 0.5)\`.
  - SSIM: structural similarity on ITU-R BT.709 luminance (captures layout + edges)
  - pixelmatch: pixel-level diff at threshold 0.1 (captures colour precision)
  - dimension-mismatch penalty proportional to area ratio when the two images differ in size

Returns score, SSIM, pixelDiff%, and whether the numeric visual threshold passed. The configured threshold is 85/100. Do not invent a higher target. Use \`webpage_vision_judge\` for qualitative differences because the score alone cannot tell you whether structural elements are correct.`,
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
      .describe(`Directory used to resolve relative paths and to write \`eval-result.json\`. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`)
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveMirrorOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })

    const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(outputDir, p))
    const referencePath = resolve(params.reference)
    const renderedPath = resolve(params.rendered)

    const report = await evaluateVisual({
      originalImage: referencePath,
      renderedImage: renderedPath,
    })
    const passed = isEvaluationReportPassing(report)

    const evalResultPath = path.join(outputDir, "eval-result.json")
    const evalResult = {
      generatedAt: new Date().toISOString(),
      referencePath,
      renderedPath,
      overallScore: report.overallScore,
      passThreshold: WEBPAGE_EVALUATE_PASS_SCORE,
      passed,
      ssimScore: report.ssimScore,
      pixelDiffPercent: report.pixelDiffPercent,
      dimensionsMatch: report.dimensionsMatch,
      mismatchedPixels: report.mismatchedPixels,
      totalPixels: report.totalPixels,
      comparisonDimensions: report.comparisonDimensions,
    }
    await fs.writeFile(evalResultPath, JSON.stringify(evalResult, null, 2), "utf8")

    return {
      title: `Score ${report.overallScore}/100 ${passed ? "passed" : "below"} threshold ${WEBPAGE_EVALUATE_PASS_SCORE}/100 (ssim=${report.ssimScore.toFixed(3)} pixelDiff=${report.pixelDiffPercent.toFixed(2)}%)`,
      output: [
        `# Visual evaluation`,
        "",
        `- Reference: \`${referencePath}\``,
        `- Rendered:  \`${renderedPath}\``,
        `- Result:    \`${evalResultPath}\``,
        "",
        `## Score: **${report.overallScore}/100**`,
        `- Numeric threshold: ${WEBPAGE_EVALUATE_PASS_SCORE}/100`,
        `- Numeric result: ${passed ? "passed" : "failed"}`,
        `- SSIM structural: ${report.ssimScore.toFixed(4)}`,
        `- Pixel diff: ${report.pixelDiffPercent.toFixed(2)}% (${report.mismatchedPixels} / ${report.totalPixels} px)`,
        `- Dimensions match: ${report.dimensionsMatch} (compared at ${report.comparisonDimensions.width}×${report.comparisonDimensions.height})`,
        "",
        "The numeric visual threshold is 85/100. Do not invent a higher score target. For qualitative differences, call `webpage_vision_judge` — it reads the two PNGs and returns a structured diff list.",
      ].join("\n"),
      metadata: {
        overallScore: report.overallScore,
        passThreshold: WEBPAGE_EVALUATE_PASS_SCORE,
        passed,
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
