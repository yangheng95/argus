/**
 * `webpage_image_compile` tool — wraps `mirror/image/compile::compileImageAnalysisToXML`.
 *
 * Image2code analogue of `webpage_compile`. Reads a previously-written
 * `image-analysis.json` and emits the same compact XML IR dialect used by
 * the URL and Figma flows. Writes to `<outputDir>/page-ir.xml` (same
 * filename — downstream codegen never branches per source).
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { compileImageAnalysisToXML } from "../image/compile"
import { ImageAnalysisSchema } from "../ir/image-analysis"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const WebpageImageCompileTool = Tool.define("webpage_image_compile", {
  description: `Compile an ImageAnalysis JSON into a compact XML IR (zero LLM, deterministic).

Same XML dialect that \`webpage_compile\` (URL) and \`figma_compile\` produce — downstream codegen does not branch per source. Containers, text leaves, image leaves, and repeated children all serialise identically across the three sources.

Reads \`<outputDir>/image-analysis.json\` (from webpage_image_extract). Writes \`<outputDir>/page-ir.xml\`. Returns a preview of the first 2KB and total byte size.

This tool is artifact-dependent: do NOT call it until \`webpage_image_extract\` has completed and written \`image-analysis.json\`. Never batch it in the same assistant turn as \`webpage_image_extract\`.

Use as step 2 of the image-generate workflow. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing image-analysis.json. Writes page-ir.xml here. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_image_extract's default).`,
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
          `Missing ${analysisPath}. \`webpage_image_compile\` depends on \`webpage_image_extract\` output. ` +
            `Run \`webpage_image_extract\` first and wait for it to finish before calling \`webpage_image_compile\`.`,
        )
      }
      throw error
    }

    const raw = JSON.parse(analysisText)
    const analysis = ImageAnalysisSchema.parse(raw)
    const ir = compileImageAnalysisToXML(analysis)

    const irPath = path.join(outputDir, "page-ir.xml")
    await fs.writeFile(irPath, ir.xml, "utf8")

    const preview = ir.xml.slice(0, 2048)
    return {
      title: `Compiled image IR — ${ir.bytes} bytes, ~${ir.estimatedTokens} tokens`,
      output: [
        `# Compiled XML IR (image2code)`,
        "",
        `- Source: ${analysisPath}`,
        `- Output: ${irPath}`,
        `- Size: ${ir.bytes} bytes (~${ir.estimatedTokens} tokens)`,
        "",
        `## First 2KB preview`,
        "",
        "```xml",
        preview,
        ir.xml.length > preview.length ? "<!-- truncated -->" : "",
        "```",
        "",
        "Next: implement the page (any tech stack), then iterate via `webpage_render` + `webpage_vision_judge` + `webpage_evaluate`.",
      ].join("\n"),
      metadata: {
        irPath,
        bytes: ir.bytes,
        estimatedTokens: ir.estimatedTokens,
      },
    }
  },
})
