/**
 * `webpage_image_analyze` tool — wraps `mirror/image/analyze::analyzeImage`
 * + the shared scaffold-helpers emitters.
 *
 * Image2code's analogue of `webpage_analyze`. Reads `image-analysis.json`,
 * synthesises a `ProjectScaffold`, and writes the same mirror facts and
 * generated React source the URL flow's `webpage_analyze` writes. The build agent's downstream codegen
 * prompt + skill text reference these exact filenames; rule 22 keeps every
 * source on one downstream contract.
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
  description: `Analyze an ImageAnalysis into a deterministic ProjectScaffold (sections, file contracts, design-token system). Zero LLM — the vision-LLM call already ran in webpage_image_extract; this stage folds its structured output into the same cross-source ProjectScaffold contract that webpage_analyze (URL) and figma_analyze produce.

Reads \`<outputDir>/image-analysis.json\` (from webpage_image_extract). Writes the same mirror facts and generated React source the URL analyze step writes:
  - scaffold.json           full ProjectScaffold
  - shared-context.md       compact token + section summary for prompts
  - src/**                  React source files from the scaffold contract

Returns a summary: section list, token counts. The agent should \`read\` scaffold.json for full detail when needed.

This tool is artifact-dependent: do NOT call it until \`webpage_image_extract\` has completed and written \`image-analysis.json\`. Never batch it in the same assistant turn as \`webpage_image_extract\`.

Use as step 3 of the image-generate workflow. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing image-analysis.json. Writes scaffold.json and shared-context.md here, and generated React source under the worktree source layout. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_image_extract's default).`,
      )
      .optional(),
  }),
  async execute(params) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)
    const analysisPath = path.join(outputDir, "image-analysis.json")

    let analysisText: string
    try {
      analysisText = await fs.readFile(analysisPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${analysisPath}. \`webpage_image_analyze\` depends on \`webpage_image_extract\` output. ` +
            `Run \`webpage_image_extract\` first and wait for it to finish before calling \`webpage_image_analyze\`.`,
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
    const sourcePaths = await writeGeneratedSourceFiles(sourceFiles)

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
        `- React source files: ${sourcePaths.length}`,
        "",
        "Next: run the generated React source and iterate it with `webpage_render` + `webpage_vision_judge` + `webpage_evaluate`.",
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
