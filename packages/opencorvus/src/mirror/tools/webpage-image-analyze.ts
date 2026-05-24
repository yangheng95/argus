/**
 * `webpage_image_analyze` tool — wraps `mirror/image/analyze::analyzeImage`
 * + the shared scaffold-helpers emitters.
 *
 * Image2code's analogue of `webpage_analyze`. Reads `image-analysis.json`,
 * synthesises a `ProjectScaffold`, and writes the same mirror facts and
 * scaffold artifacts the URL flow's `webpage_analyze` writes. Design-analysis
 * reads those artifacts and persists one downstream PRD/SPEC contract.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { analyzeImage } from "../image/analyze"
import { ImageAnalysisSchema } from "../ir/image-analysis"
import {
  buildSharedContext,
  generateReactSourceFiles,
  materializeScaffoldForReactSource,
} from "../shared/scaffold-helpers"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"
import { writeGeneratedSourceFiles } from "./generated-source"

export const WebpageImageAnalyzeTool = Tool.define("webpage_image_analyze", {
  description: `Analyze an ImageAnalysis into a deterministic ProjectScaffold (sections, file contracts, design-token system). Zero LLM — the vision-LLM call already ran in webpage_image_extract; this stage folds its structured output into the same cross-source ProjectScaffold contract that webpage_analyze (URL) produces.

Reads \`<outputDir>/image-analysis.json\` (from webpage_image_extract). Writes the same mirror facts and scaffold artifacts the URL analyze step writes:
  - scaffold.json           full ProjectScaffold
  - shared-context.md       compact token + section summary for prompts
  - generated-source/*      scaffold-generated source artifacts for analysis only

Returns a summary: section list and token counts. Once these artifacts exist, use \`shared-context.md\` and \`page-ir.xml\` for PRD/SPEC synthesis; bounded targeted \`scaffold.json\` reads are only for specific gaps.

This tool is artifact-dependent: do NOT call it until \`image-analysis.json\` exists in the output directory. Never batch it with the image extraction call that creates that file.

Use this only when scaffold artifacts are missing. Do not rerun it once \`shared-context.md\` exists for the current evidence package. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing image-analysis.json. Writes scaffold.json and shared-context.md here, plus scaffold-generated source artifacts under generated-source/. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_image_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
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
    const sourceFiles = generateReactSourceFiles(scaffold)
    const sharedContext = buildSharedContext(scaffold, {
      title: analysis.description.slice(0, 80) || "Image clone",
      viewport: analysis.viewport,
    })

    const scaffoldPath = path.join(outputDir, "scaffold.json")
    const contextPath = path.join(outputDir, "shared-context.md")
    const sourcePaths = await writeGeneratedSourceFiles(outputDir, sourceFiles)

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(contextPath, sharedContext, "utf8"),
    ])

    const sectionList = scaffold.sections
      .map((s) => `  - ${s.name} (${s.elementCount} el, ${s.bounds.w}×${s.bounds.h}px)`)
      .join("\n")

    return {
      title: `Scaffold (image2code) — ${scaffold.sections.length} sections, ${scaffold.tokens.colors.length} colors`,
      output: [
        `# ProjectScaffold (image2code)`,
        "",
        `- Source: ${analysisPath}`,
        `- Sections: ${scaffold.sections.length}`,
        `- Tokens: ${scaffold.tokens.colors.length} colors, ${scaffold.tokens.fonts.length} fonts, ${scaffold.tokens.spacing.length} spacings, ${scaffold.tokens.radii.length} radii`,
        `- Pattern catalog: empty (image flow skips fingerprint detection — see analyze.ts header).`,
        "",
        "## Sections",
        sectionList || "  (none)",
        "",
        `**Artifacts written:**`,
        `- \`${scaffoldPath}\` — full ProjectScaffold`,
        `- \`${contextPath}\` — compact prompt-ready summary`,
        `- Generated source artifacts: ${sourcePaths.length}`,
        "",
        "Image scaffold artifacts written. Do not rerun analysis for this evidence package unless the source extraction changed. Use compact artifacts for PRD/SPEC synthesis; generated source artifacts are not the deliverable.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        contextPath,
        sourcePaths,
        sectionCount: scaffold.sections.length,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})
