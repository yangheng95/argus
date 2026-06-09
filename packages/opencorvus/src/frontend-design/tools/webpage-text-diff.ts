/**
 * `webpage_text_diff` tool — re-extracts the agent's current rendered URL
 * via Browser Runtime, compares its text catalog to the reference, and returns a
 * specific list of missing phrases. This is a diagnostic feedback signal for
 * text coverage, not an acceptance source.
 *
 * Why not fold this into `webpage_evaluate`? Evaluate only reads PNGs and
 * has no DOM access. Text comparison requires re-extracting the rendered
 * HTML's DOM, which is a separate concern.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { extractPage } from "@/browser/webpage/extract"
import { compareText, extractTextFromTree } from "./text-compare"
import { ExtractedPageSchema } from "@/browser/webpage/extracted-page"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"

export const WebpageTextDiffTool = Tool.define("webpage_text_diff", {
  description: `Diff the text content between a reference ExtractedPage and the agent's current rendered URL.

Re-extracts the rendered page via Browser Runtime and tokenises both catalogues. Returns a concrete list of reference tokens that the current clone is missing — feed this list back to the agent so it can add the specific phrases rather than guess from the diff heatmap.

Use this tool when \`webpage_vision_judge\` flags missing or incorrect text. It pinpoints *which strings* are missing, where SSIM+pixel diff only says *where*.

Reads extracted-page.json (from webpage_extract) and the explicit current render URL.`,
  parameters: z.object({
    url: z
      .string()
      .url()
      .describe("Exact browser URL for the current clone, usually the already-started dev-server HTTP route."),
    referenceDir: z
      .string()
      .describe(
        `Directory containing \`extracted-page.json\` (webpage_extract's output). Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`. Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
    limit: z.number().int().positive().describe("Max number of missing tokens to return. Default 30.").optional(),
  }),
  async execute(params, ctx) {
    const referenceDir = await resolveWebpageEvidenceOutputDir({
      override: params.referenceDir,
      sessionID: ctx.sessionID,
    })
    const extractedPath = path.join(referenceDir, "extracted-page.json")

    const raw = JSON.parse(await fs.readFile(extractedPath, "utf8"))
    const refPage = ExtractedPageSchema.parse(raw)
    const referenceText = extractTextFromTree(refPage.tree as unknown as Parameters<typeof extractTextFromTree>[0])

    const rendered = await extractPage({
      url: params.url,
      viewport: refPage.viewport,
      waitMs: 3000,
      noScreenshots: true,
    })
    const renderedText = extractTextFromTree(rendered.tree as unknown as Parameters<typeof extractTextFromTree>[0])

    const limit = params.limit ?? 30

    if (renderedText.length === 0) {
      return {
        title: "Text diff: rendered page has no visible text",
        output: [
          "# Text diff result",
          "",
          "The rendered URL produced no visible text nodes after a 3s wait.",
          "Fix the generated source or dev-server route, then re-run this tool against the same explicit URL.",
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
              "## Missing strings (add these to the maintainable project source — keep wording verbatim)",
              "",
              ...missing.map((t) => `- \`${t}\``),
              "",
              "Locate the right parent section for each using the source IR / page-ir text catalog, then update the target app's semantic components or data arrays. Re-run `webpage_render url=<explicit URL>` + `webpage_vision_judge` after.",
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
