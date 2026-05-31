/**
 * `webpage_image_analyze` tool — wraps `mirror/image/analyze::analyzeImage`
 * + the shared scaffold-helpers emitters.
 *
 * Image2code's analogue of `webpage_analyze`. Reads `image-analysis.json`,
 * synthesises a `ProjectScaffold`, and writes prompt-readable mirror facts.
 * Any generated-view-source files are legacy visual evidence only; Build must
 * write maintainable project source from the frontend design/replica contract.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { analyzeImage } from "../image/analyze"
import { ImageAnalysisSchema } from "../ir/image-analysis"
import {
  buildSharedContext,
  generateViewSourceFiles,
  materializeScaffoldForReactSource,
} from "../shared/scaffold-helpers"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"
import { writeGeneratedSourceFiles } from "./generated-source"

export const WebpageImageAnalyzeTool = Tool.define("webpage_image_analyze", {
  description: `Analyze an ImageAnalysis into a deterministic semantic ProjectScaffold (visual surfaces, View file contracts, design-token system). Zero LLM — the vision-LLM call already ran in webpage_image_extract; this stage folds its structured output into the same cross-source ProjectScaffold contract that webpage_analyze (URL) produces.

Reads \`<outputDir>/image-analysis.json\` (from webpage_image_extract). Writes the same mirror facts and scaffold artifacts the URL analyze step writes:
  - visual-surface-scaffold.json semantic ProjectScaffold
  - shared-context.md       compact token + surface summary for prompts
  - generated-view-source/* legacy slot-based visual evidence only, not project source

Returns a summary: surface list and token counts. Once these artifacts exist, use \`shared-context.md\` and \`page-ir.xml\` for frontend design/replica frontend template synthesis; bounded targeted scaffold reads are only for specific gaps.

This tool is artifact-dependent: do NOT call it until \`image-analysis.json\` exists in the output directory. Never batch it with the image extraction call that creates that file.

Use this only when scaffold artifacts are missing. Do not rerun it once \`shared-context.md\` exists for the current evidence package. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing image-analysis.json. Writes visual-surface-scaffold.json and shared-context.md here, plus View artifacts under generated-view-source/. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_image_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
      )
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveMirrorOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })
    const analysisPath = path.join(outputDir, "image-analysis.json")

    let analysisText: string
    try {
      analysisText = await fs.readFile(analysisPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${analysisPath}. \`webpage_image_analyze\` depends on \`webpage_image_extract\` output. ` +
            `Create the image evidence package first and retry only after \`image-analysis.json\` exists.`,
        )
      }
      throw error
    }

    const raw = JSON.parse(analysisText)
    const analysis = ImageAnalysisSchema.parse(raw)
    const scaffold = materializeScaffoldForReactSource(analyzeImage(analysis))
    const sourceFiles = generateViewSourceFiles(scaffold)
    const sharedContext = buildSharedContext(scaffold, {
      title: analysis.description.slice(0, 80) || "Image clone",
      viewport: analysis.viewport,
    })

    const scaffoldPath = path.join(outputDir, "visual-surface-scaffold.json")
    const contextPath = path.join(outputDir, "shared-context.md")
    const viewSourcePaths = await writeGeneratedSourceFiles(outputDir, sourceFiles)

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(contextPath, sharedContext, "utf8"),
    ])

    const surfaceList = scaffold.surfaces
      .map((s) => `  - ${s.name} (${s.kind}, ${s.bounds.w}×${s.bounds.h}px, view ${s.view.filePath})`)
      .join("\n")

    return {
      title: `Scaffold (image2code) — ${scaffold.surfaces.length} surfaces, ${scaffold.tokens.colors.length} colors`,
      output: [
        `# ProjectScaffold (image2code)`,
        "",
        `- Source: ${analysisPath}`,
        `- Surfaces: ${scaffold.surfaces.length}`,
        `- Tokens: ${scaffold.tokens.colors.length} colors, ${scaffold.tokens.fonts.length} fonts, ${scaffold.tokens.spacing.length} spacings, ${scaffold.tokens.radii.length} radii`,
        `- Pattern catalog: empty (image flow skips fingerprint detection — see analyze.ts header).`,
        "",
        "## Visual surfaces",
        surfaceList || "  (none)",
        "",
        `**Artifacts written:**`,
        `- \`${scaffoldPath}\` — semantic visual surface ProjectScaffold`,
        `- \`${contextPath}\` — compact prompt-ready summary`,
        `- Legacy generated-view-source evidence artifacts: ${viewSourcePaths.length}`,
        "",
        "Image scaffold artifacts written. Do not rerun analysis for this evidence package unless the source extraction changed. Use compact artifacts for frontend design/replica frontend template synthesis; generated View artifacts are visual evidence, not business implementation source.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        contextPath,
        viewSourcePaths,
        surfaceCount: scaffold.surfaces.length,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})
