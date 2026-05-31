/**
 * `webpage_image_compile` tool — wraps `mirror/image/compile::compileImageAnalysisToXML`.
 *
 * Image2code analogue of `webpage_compile`. Reads a previously-written
 * `image-analysis.json` and emits the same compact XML IR dialect used by
 * the URL flow. Writes to `<outputDir>/page-ir.xml` (same filename so
 * frontend-design consumes one artifact contract).
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

Same XML dialect that \`webpage_compile\` (URL) produces — frontend-design consumes one artifact contract across sources. Containers, text leaves, image leaves, and repeated children all serialise identically.

Reads \`<outputDir>/image-analysis.json\` (from webpage_image_extract). Writes \`<outputDir>/page-ir.xml\`. Returns a preview of the first 2KB and total byte size.

This tool is artifact-dependent: do NOT call it until \`image-analysis.json\` exists in the output directory. Never batch it with the image extraction call that creates that file.

Use this only when the compact image-derived page IR is missing. Do not rerun it once \`page-ir.xml\` exists for the current evidence package. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing image-analysis.json. Writes page-ir.xml here. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_image_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
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
          `Missing ${analysisPath}. \`webpage_image_compile\` depends on \`webpage_image_extract\` output. ` +
            `Create the image evidence package first and retry only after \`image-analysis.json\` exists.`,
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
        "Compact page IR written. Do not rerun compilation for this evidence package unless the source extraction changed.",
      ].join("\n"),
      metadata: {
        irPath,
        bytes: ir.bytes,
        estimatedTokens: ir.estimatedTokens,
      },
    }
  },
})
