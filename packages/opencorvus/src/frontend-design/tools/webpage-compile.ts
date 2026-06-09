import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { materializeInlineExtractedPageAssets } from "@/browser/webpage/extract"
import { ExtractedPageSchema } from "@/browser/webpage/extracted-page"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"
import { extractArchiveHtml, mergeExtractedLayoutIntoPageIr, writeWebCloneArchiveExtraction } from "../../web-clone"

export const WebpageCompileTool = Tool.define("webpage_compile", {
  description: `Compile captured webpage evidence into canonical structure IR + asset graph (zero LLM).

The canonical outputs are \`page.ir.json\` and \`assets/manifest.json\`. Dense CSS, SVG path data, data URIs, scripts, and long attribute/text values are preserved as content-addressed sidecar assets instead of being inlined into prompt context.

Reads \`<outputDir>/singlefile.html\` when present, otherwise \`<outputDir>/capture.html\`, plus \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes \`<outputDir>/page.ir.json\`, \`<outputDir>/assets/manifest.json\`, and sidecar assets. Returns compact artifact stats.

This tool is artifact-dependent: do NOT call it until \`extracted-page.json\` exists in the output directory. Never batch it with the URL extraction call that creates that file.

Use this only when the canonical structure IR or asset graph is missing. Do not rerun it once \`page.ir.json\` and \`assets/manifest.json\` exist for the current evidence package. Pure function, no network or browser.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing singlefile.html or capture.html plus extracted-page.json. Writes page.ir.json, assets/manifest.json, and sidecar assets here. Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\` (matching webpage_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveWebpageEvidenceOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })
    const extractedPath = path.join(outputDir, "extracted-page.json")
    const captureHtmlPath = path.join(outputDir, "capture.html")
    const singleFileHtmlPath = path.join(outputDir, "singlefile.html")

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

    const archiveHtmlPath = await existingArchiveHtmlPath(singleFileHtmlPath, captureHtmlPath)
    if (!archiveHtmlPath) {
      throw new Error(
        `Missing ${singleFileHtmlPath} and ${captureHtmlPath}. \`webpage_compile\` compiles canonical webpage evidence IR from ` +
          `the HTML archive produced by \`webpage_extract\`. Re-run extraction for this evidence package first.`,
      )
    }
    const archiveHtml = await fs.readFile(archiveHtmlPath, "utf8")

    const raw = JSON.parse(extractedText)
    const page = materializeInlineExtractedPageAssets(ExtractedPageSchema.parse(raw), outputDir)
    await fs.writeFile(extractedPath, JSON.stringify(page, null, 2), "utf8")

    const structure = extractArchiveHtml({
      html: archiveHtml,
      url: page.url,
      title: page.title,
    })
    structure.pageIr = mergeExtractedLayoutIntoPageIr(structure.pageIr, page)
    await writeWebCloneArchiveExtraction(outputDir, structure)

    return {
      title: `Compiled web-clone source IR — ${structure.pageIr.stats.nodes} nodes, ${structure.assetGraph.assets.length} sidecar assets`,
      output: [
        `# Compiled Web Clone Source IR`,
        "",
        `- Source: ${extractedPath}`,
        `- HTML archive: ${archiveHtmlPath}`,
        `- Canonical structure IR: ${path.join(outputDir, "page.ir.json")}`,
        `- Browser layout/style merge: ${structure.pageIr.stats.layoutMatchedElements ?? 0}/${structure.pageIr.stats.layoutElements ?? 0} elements`,
        `- Asset graph: ${path.join(outputDir, "assets", "manifest.json")}`,
        `- Sidecar assets: ${structure.assetGraph.assets.length}`,
        "",
        "Canonical webpage evidence structure IR and asset graph written. Treat `page.ir.json` + `assets/manifest.json` as the source of truth.",
      ].join("\n"),
      metadata: {
        pageIrPath: path.join(outputDir, "page.ir.json"),
        assetManifestPath: path.join(outputDir, "assets", "manifest.json"),
        sidecarAssetCount: structure.assetGraph.assets.length,
        nodes: structure.pageIr.stats.nodes,
      },
    }
  },
})

async function existingArchiveHtmlPath(
  singleFileHtmlPath: string,
  captureHtmlPath: string,
): Promise<string | undefined> {
  if (await exists(singleFileHtmlPath)) return singleFileHtmlPath
  if (await exists(captureHtmlPath)) return captureHtmlPath
  return undefined
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
