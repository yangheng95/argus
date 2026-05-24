/**
 * `webpage_compile` tool — wraps `mirror/url/compile::compilePageToXML`.
 *
 * Reads a previously-extracted `extracted-page.json` and emits a compact XML
 * IR that design-analysis can read directly. Writes to `<outputDir>/page-ir.xml`.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { compilePageToXML } from "../url/compile"
import { ExtractedPageSchema } from "../ir/extracted-page"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const WebpageCompileTool = Tool.define("webpage_compile", {
  description: `Compile an ExtractedPage JSON into a compact XML IR (zero LLM, byte-identical deterministic).

The XML IR captures every DOM section as <Container>, <Text>, <Image>, <Icon> tags with inlined layout and style attributes. Repeated siblings are collapsed into <Repeat count=N>. Fits ~5-15KB for typical pages versus ~50-200KB raw DOM.

Reads \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes \`<outputDir>/page-ir.xml\`. Returns a preview of the first 2KB and total byte size.

This tool is artifact-dependent: do NOT call it until \`extracted-page.json\` exists in the output directory. Never batch it with the URL extraction call that creates that file.

Use this only when the compact page IR is missing. Do not rerun it once \`page-ir.xml\` exists for the current evidence package. Pure function, no network or browser.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing extracted-page.json. Writes page-ir.xml here. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
      )
      .optional(),
    max_depth: z
      .number()
      .int()
      .positive()
      .describe("Max compile depth — deeper subtrees get summarised as comments. Default 4.")
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveMirrorOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })
    const extractedPath = path.join(outputDir, "extracted-page.json")

    let extractedText: string
    try {
      extractedText = await fs.readFile(extractedPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${extractedPath}. \`webpage_compile\` depends on \`webpage_extract\` output. ` +
          `Create the URL evidence package first and retry only after \`extracted-page.json\` exists.`,
        )
      }
      throw error
    }

    const raw = JSON.parse(extractedText)
    const page = ExtractedPageSchema.parse(raw)

    const ir = compilePageToXML({ page, maxDepth: params.max_depth ?? 4 })

    const irPath = path.join(outputDir, "page-ir.xml")
    await fs.writeFile(irPath, ir.xml, "utf8")

    const preview = ir.xml.slice(0, 2048)
    return {
      title: `Compiled page IR — ${ir.bytes} bytes, ~${ir.estimatedTokens} tokens`,
      output: [
        `# Compiled XML IR`,
        "",
        `- Source: ${extractedPath}`,
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
