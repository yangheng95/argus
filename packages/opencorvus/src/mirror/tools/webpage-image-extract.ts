/**
 * `webpage_image_extract` tool — wraps `mirror/image/extract::extractImage`.
 *
 * Image2code analogue of `webpage_extract` (URL extraction). Reads one or
 * more screenshot images from disk, calls a vision-LLM to infer the page's
 * structural / token / typography snapshot, and writes the result to
 * `<outputDir>/image-analysis.json`. The downstream `webpage_image_compile`
 * tool consumes that JSON exactly the way `webpage_compile` consumes
 * `extracted-page.json`.
 *
 * Tool wrapper only — input parsing, model resolution, artifact persistence.
 * The algorithm itself is `mirror/image/extract.ts`.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Provider } from "../../provider/provider"
import { ProviderLLM } from "../../provider/llm"
import { resolveConfiguredModelRef } from "../../agent/model"
import { EffectiveConfig } from "../../config/effective"
import { Log } from "../../util/log"
import { Instance } from "../../project/instance"
import { extractImage } from "../image/extract"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

const log = Log.create({ service: "mirror.tool.webpage_image_extract" })

export const WebpageImageExtractTool = Tool.define("webpage_image_extract", {
  description: `Vision-LLM analysis of one or more reference screenshots into ImageAnalysis JSON. Use this for cases where the user provides a screenshot/mockup instead of a live URL.

Reads each image from disk, sends it to a vision-capable model, and infers the page's structure (recursive element tree with bounds + roles), tokens (palette / fonts / text styles), and overall description. Multiple images are analyzed in parallel and merged into a single ImageAnalysis (palettes union, trees stacked under per-image wrapper containers).

Writes \`<outputDir>/image-analysis.json\` (the full ImageAnalysis) and a copy of the first reference image as \`<outputDir>/reference.png\` so design-analysis has the same artifact path layout url2code uses. \`image-analysis.json\` is the raw source artifact for compile/analyze and the evidence manifest; use the compiled IR and shared context as the prompt-facing evidence.

Use this only when image-reference evidence is missing for the requested output directory. Do not rerun it for the same image set/outputDir once \`reference.png\` and \`image-analysis.json\` exist. Requires a vision-capable model — fails loudly if the configured model has \`capabilities.input.image=false\`.`,
  parameters: z.object({
    images: z
      .array(z.string())
      .min(1)
      .describe(
        "Image filesystem paths (PNG / JPG / WebP / GIF / BMP). Resolved against the worktree when relative.",
      ),
    outputDir: z
      .string()
      .describe(
        `Directory to write artifacts. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_extract). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
      )
      .optional(),
    page_hint: z
      .string()
      .describe("Optional one-line context (e.g. 'homepage of e-commerce site').")
      .optional(),
    component_library: z
      .string()
      .describe(
        "Optional UI library name (e.g. 'antd', 'tailwind'). When set, the model tags matched components via \`componentHint\`.",
      )
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveMirrorOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })

    // Single configured-model resolver (spec §13.2): session overlay > base.
    const config = await EffectiveConfig.effective({ sessionID: ctx.sessionID })
    const parsed = await resolveConfiguredModelRef({ sessionID: ctx.sessionID })
    const model = await Provider.getModel(parsed.providerID, parsed.modelID, { config })
    if (!model.capabilities.input.image) {
      throw new Error(
        `webpage_image_extract requires a vision-capable model. ` +
          `Configured model ${parsed.providerID}/${parsed.modelID} has capabilities.input.image=false. ` +
          `Switch to a vision-capable model (e.g. alibaba-coding-plan-cn/kimi-k2.5, claude-sonnet-4) ` +
          `via Config.model or pass an explicit override.`,
      )
    }
    const language = ProviderLLM.wrapModel(
      await Provider.getLanguage(model, { config }),
      model,
      {},
    )

    log.info("extracting from images", {
      providerID: parsed.providerID,
      modelID: parsed.modelID,
      imageCount: params.images.length,
      outputDir,
    })

    const worktree = Instance.directory
    const analysis = await extractImage({
      images: params.images.map((p) => ({ path: p })),
      model: language,
      pageHint: params.page_hint,
      componentLibrary: params.component_library,
      worktree,
      signal: ctx.abort,
      onProgress: (msg) => log.info(msg),
    })

    const analysisPath = path.join(outputDir, "image-analysis.json")
    await fs.writeFile(analysisPath, JSON.stringify(analysis, null, 2), "utf8")

    // Copy the FIRST reference image to `<outputDir>/reference.png` so design-analysis
    // sees the same artifact layout the URL flow produces. Only the first image
    // becomes the canonical reference — multi-image inputs still merge in
    // analysis but visual evaluation needs one ground-truth pixel target.
    const firstImage = params.images[0]
    const firstAbs = path.resolve(worktree, firstImage)
    const referencePath = path.join(outputDir, "reference.png")
    await fs.copyFile(firstAbs, referencePath)

    const elementCount = countElements(analysis.tree)
    const summary = {
      analysisPath,
      referencePath,
      viewport: analysis.viewport,
      confidence: analysis.confidence,
      stats: {
        elements: elementCount,
        topLevelSections: analysis.tree.length,
      },
      tokens: {
        colors: Object.keys(analysis.tokens.colors).length,
        fonts: analysis.tokens.fonts.length,
        textStyles: analysis.tokens.textStyles.length,
      },
    }

    return {
      title: `Image-extracted (${elementCount} elements, ${(analysis.confidence * 100).toFixed(0)}% confidence)`,
      output: [
        `# Image analysis`,
        "",
        `- Inputs: ${params.images.length} image(s)`,
        `- Viewport: ${analysis.viewport.width} × ${analysis.viewport.height}`,
        `- Elements: ${elementCount} (${analysis.tree.length} top-level)`,
        `- Tokens: ${summary.tokens.colors} colors, ${summary.tokens.fonts} fonts, ${summary.tokens.textStyles} text styles`,
        `- Confidence: ${(analysis.confidence * 100).toFixed(0)}%`,
        "",
        `**Analysis JSON:** \`${analysisPath}\``,
        `**Reference image:** \`${referencePath}\``,
        "",
        "Image evidence acquired. Do not rerun extraction for this image set/outputDir unless the source changed. Use compact mirror artifacts for PRD/SPEC synthesis; do not read `image-analysis.json` wholesale.",
      ].join("\n"),
      metadata: summary,
    }
  },
})

function countElements(tree: Array<{ children?: Array<unknown> }>): number {
  let count = 0
  for (const el of tree) {
    count++
    if (el.children && Array.isArray(el.children)) {
      count += countElements(el.children as Array<{ children?: Array<unknown> }>)
    }
  }
  return count
}
