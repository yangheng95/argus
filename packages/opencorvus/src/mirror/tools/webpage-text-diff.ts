/**
 * `webpage_text_diff` tool — re-extracts the agent's current `index.html`
 * via puppeteer, compares its text catalog to the reference, and returns a
 * specific list of missing phrases. This is the feedback signal that
 * usually closes the final 1-2 points of the visual-similarity gap.
 *
 * Why not fold this into `webpage_evaluate`? Evaluate only reads PNGs and
 * has no DOM access. Text comparison requires re-extracting the rendered
 * HTML's DOM, which is a separate concern.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Instance } from "../../project/instance"
import { extractPage } from "../url/extract"
import { compareText, extractTextFromTree } from "../shared/content-compare"
import { ExtractedPageSchema } from "../ir/extracted-page"

function pathToFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/")
  return abs.startsWith("/") ? `file://${abs}` : `file:///${abs}`
}

export const WebpageTextDiffTool = Tool.define("webpage_text_diff", {
  description: `Diff the text content between a reference ExtractedPage and the agent's current \`index.html\`.

Re-extracts the rendered HTML via puppeteer on a \`file://\` URL and tokenises both catalogues. Returns a concrete list of reference tokens that the current clone is missing — feed this list back to the agent so it can add the specific phrases rather than guess from the diff heatmap.

Use this tool AFTER \`webpage_evaluate\` returns a score below target. It pinpoints *which strings* are missing, where SSIM+pixel diff only says *where*.

Requires \`extracted-page.json\` (from \`webpage_extract\`) and \`index.html\` in the output directory.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        "Directory containing extracted-page.json and index.html. Defaults to the current worktree.",
      )
      .optional(),
    limit: z
      .number()
      .int()
      .positive()
      .describe("Max number of missing tokens to return. Default 30.")
      .optional(),
  }),
  async execute(params) {
    const outputDir = params.outputDir
      ? path.resolve(Instance.directory, params.outputDir)
      : Instance.directory
    const extractedPath = path.join(outputDir, "extracted-page.json")
    const indexPath = path.join(outputDir, "index.html")

    const raw = JSON.parse(await fs.readFile(extractedPath, "utf8"))
    const refPage = ExtractedPageSchema.parse(raw)
    const referenceText = extractTextFromTree(
      refPage.tree as unknown as Parameters<typeof extractTextFromTree>[0],
    )

    await fs.access(indexPath)

    const rendered = await extractPage({
      url: pathToFileUrl(indexPath),
      viewport: refPage.viewport,
      waitMs: 3000,
      noScreenshots: true,
    })
    const renderedText = extractTextFromTree(
      rendered.tree as unknown as Parameters<typeof extractTextFromTree>[0],
    )

    const limit = params.limit ?? 30

    if (renderedText.length === 0) {
      return {
        title: "Text diff: rendered page has no visible text",
        output: [
          "# Text diff result",
          "",
          "⚠️  The rendered `index.html` produced no visible text nodes after a 3s wait.",
          "This usually means the HTML relies on client-side JavaScript to render content (React, Vue, etc.) — the webpage-clone skill forbids JS frameworks. Rewrite `index.html` as fully static HTML and try again.",
        ].join("\n"),
        metadata: {
          referenceChars: referenceText.length,
          renderedChars: 0,
          coverageRate: 0,
          jaccardSimilarity: 0,
          missingTokens: [] as string[],
        },
      }
    }

    const result = compareText(referenceText, renderedText)
    const missing = result.missingTokens.slice(0, limit)

    return {
      title: `Text diff: coverage=${(result.coverageRate * 100).toFixed(1)}%, ${missing.length} missing`,
      output: [
        "# Text diff result",
        "",
        `- Reference text: ${referenceText.length} chars`,
        `- Rendered text:  ${renderedText.length} chars`,
        `- Coverage: ${(result.coverageRate * 100).toFixed(1)}% (tokens in reference also in your render)`,
        `- Jaccard similarity: ${result.jaccardSimilarity.toFixed(3)}`,
        `- Tokens in reference not in your render: ${missing.length}`,
        "",
        missing.length > 0
          ? [
              "## Missing strings (add these to index.html — keep wording verbatim)",
              "",
              ...missing.map((t) => `- \`${t}\``),
              "",
              "Locate the right parent section for each using `page-ir.xml`'s `Section Text` catalog, then `edit` index.html to insert them. Re-run `webpage_render` + `webpage_evaluate` after.",
            ].join("\n")
          : "✅ All reference tokens are present in your render. Remaining score gap is pure visual (colour, spacing, layout).",
      ].join("\n"),
      metadata: {
        referenceChars: referenceText.length,
        renderedChars: renderedText.length,
        coverageRate: result.coverageRate,
        jaccardSimilarity: result.jaccardSimilarity,
        missingTokens: missing,
      },
    }
  },
})
