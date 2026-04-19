/**
 * `webpage_compile` tool — wraps `mirror/url/compile::compilePageToXML`.
 *
 * Reads a previously-extracted `extracted-page.json` and emits a compact XML
 * IR that codegen agents can read directly. Writes to `<outputDir>/page-ir.xml`.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Instance } from "../../project/instance"
import { compilePageToXML } from "../url/compile"
import { ExtractedPageSchema } from "../ir/extracted-page"

export const WebpageCompileTool = Tool.define("webpage_compile", {
  description: `Compile an ExtractedPage JSON into a compact XML IR (zero LLM, byte-identical deterministic).

The XML IR captures every DOM section as <Container>, <Text>, <Image>, <Icon> tags with inlined layout and style attributes. Repeated siblings are collapsed into <Repeat count=N>. Fits ~5-15KB for typical pages versus ~50-200KB raw DOM.

Reads \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes \`<outputDir>/page-ir.xml\`. Returns a preview of the first 2KB and total byte size.

Use as step 2 of the webpage-clone workflow. Pure function, no network or browser.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        "Directory containing extracted-page.json. Writes page-ir.xml here. Defaults to the current worktree.",
      )
      .optional(),
    max_depth: z
      .number()
      .int()
      .positive()
      .describe("Max compile depth — deeper subtrees get summarised as comments. Default 4.")
      .optional(),
  }),
  async execute(params) {
    const outputDir = params.outputDir
      ? path.resolve(Instance.directory, params.outputDir)
      : Instance.directory
    const extractedPath = path.join(outputDir, "extracted-page.json")

    const raw = JSON.parse(await fs.readFile(extractedPath, "utf8"))
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
        "Next: call `webpage_analyze` to get the ProjectScaffold, or just use this IR directly in codegen prompts.",
      ].join("\n"),
      metadata: {
        irPath,
        bytes: ir.bytes,
        estimatedTokens: ir.estimatedTokens,
      },
    }
  },
})
