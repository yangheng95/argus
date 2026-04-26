/**
 * `figma_compile` tool — wraps `mirror/figma/compile::compileDesignToXML`.
 *
 * Figma2code's analogue of `webpage_compile` / `webpage_image_compile`.
 * Reads `figma-design.json` and emits the same compact XML dialect every
 * compile target produces. Output filename is `page-ir.xml` — identical to
 * URL and image flows so downstream codegen never branches per source.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { compileDesignToXML } from "../figma/compile"
import { CompressedDesignSchema } from "../ir/compressed-design"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const FigmaCompileTool = Tool.define("figma_compile", {
  description: `Compile a CompressedDesign JSON into a compact XML IR (zero LLM, deterministic).

Same XML dialect that webpage_compile (URL) and webpage_image_compile (image) produce — downstream codegen does not branch per source.

Reads \`<outputDir>/figma-design.json\` (from figma_extract). Writes \`<outputDir>/page-ir.xml\`. Returns a preview of the first 2KB and total byte size.

Artifact-dependent: do NOT call until \`figma_extract\` has finished and written \`figma-design.json\`. Never batch in the same assistant turn.

Step 2 of the figma2code workflow. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing figma-design.json. Writes page-ir.xml here. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree.`,
      )
      .optional(),
  }),
  async execute(params) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)
    const designPath = path.join(outputDir, "figma-design.json")

    let designText: string
    try {
      designText = await fs.readFile(designPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${designPath}. \`figma_compile\` depends on \`figma_extract\` output. ` +
            `Run \`figma_extract\` first and wait for it to finish before calling \`figma_compile\`.`,
        )
      }
      throw error
    }

    const raw = JSON.parse(designText)
    const design = CompressedDesignSchema.parse(raw)
    const ir = compileDesignToXML(design)

    const irPath = path.join(outputDir, "page-ir.xml")
    await fs.writeFile(irPath, ir.xml, "utf8")

    const preview = ir.xml.slice(0, 2048)
    return {
      title: `Compiled figma IR — ${ir.bytes} bytes, ~${ir.estimatedTokens} tokens`,
      output: [
        `# Compiled XML IR (figma2code)`,
        "",
        `- Source: ${designPath}`,
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
        "Next: call `figma_analyze` to get the ProjectScaffold (scaffold.json + design-tokens.ts + App.tsx + shared-context.md).",
      ].join("\n"),
      metadata: {
        irPath,
        bytes: ir.bytes,
        estimatedTokens: ir.estimatedTokens,
      },
    }
  },
})
