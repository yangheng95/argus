/**
 * `webpage_analyze` tool — wraps `mirror/url/pattern::analyzePage` +
 * deterministic file generators.
 *
 * Reads `extracted-page.json`, runs pattern detection + token extraction, and
 * writes mirror facts plus deterministic scaffold artifacts that design-analysis consumes:
 *   - `<outputDir>/scaffold.json`         full ProjectScaffold
 *   - `<outputDir>/shared-context.md`     compact token + pattern summary
 *   - source paths declared by the materialized scaffold for analysis only
 *
 * Returns only the summary so the tool output stays small.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import {
  analyzePage,
  buildSharedContext,
} from "../url/pattern"
import {
  generateReactSourceFiles,
  materializeScaffoldForReactSource,
} from "../shared/scaffold-helpers"
import { ExtractedPageSchema } from "../ir/extracted-page"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"
import { writeGeneratedSourceFiles } from "./generated-source"

export const WebpageAnalyzeTool = Tool.define("webpage_analyze", {
  description: `Analyze an ExtractedPage into a deterministic ProjectScaffold (section list, component-pattern catalog, design-token system, file contracts). Zero LLM.

Reads \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes mirror facts plus scaffold artifacts:
  - scaffold.json           full ProjectScaffold
  - shared-context.md       compact token + pattern summary for prompts
  - sourcePaths             scaffold-generated source files for analysis only

Returns a summary: section list, pattern list, token counts. The agent should read \`shared-context.md\` and \`page-ir.xml\` first, then use bounded targeted \`scaffold.json\` reads only for specific gaps.

This tool is artifact-dependent: do NOT call it until \`webpage_extract\` has completed and written \`extracted-page.json\`. Never batch it in the same assistant turn as \`webpage_extract\`.

Use as step 3 of the design-analysis webpage PRD/SPEC workflow. Pure function, no network.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing extracted-page.json. Writes scaffold.json and shared-context.md here, plus scaffold-generated source files for analysis only. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_extract's default).`,
      )
      .optional(),
  }),
  async execute(params) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)
    const extractedPath = path.join(outputDir, "extracted-page.json")

    let extractedText: string
    try {
      extractedText = await fs.readFile(extractedPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${extractedPath}. \`webpage_analyze\` depends on \`webpage_extract\` output. ` +
          `Run \`webpage_extract\` first and wait for it to finish before calling \`webpage_analyze\`.`,
        )
      }
      throw error
    }

    const raw = JSON.parse(extractedText)
    const page = ExtractedPageSchema.parse(raw)

    const scaffold = materializeScaffoldForReactSource(analyzePage(page))
    const sourceFiles = generateReactSourceFiles(scaffold)
    const sharedContext = buildSharedContext(scaffold, {
      url: page.url,
      title: page.title,
      viewport: page.viewport,
    })

    const scaffoldPath = path.join(outputDir, "scaffold.json")
    const contextPath = path.join(outputDir, "shared-context.md")
    const sourcePaths = await writeGeneratedSourceFiles(sourceFiles)

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(contextPath, sharedContext, "utf8"),
    ])

    const topPatterns = scaffold.catalog.patterns
      .slice(0, 8)
      .map(
        (p) =>
          `  - ${p.name} × ${p.instanceCount}` +
          (p.props.length > 0 ? ` (${p.props.map((pp) => `${pp.name}:${pp.type}`).join(", ")})` : ""),
      )
      .join("\n")
    const sectionList = scaffold.sections
      .map((s) => `  - ${s.name} (${s.elementCount} el, ${s.bounds.w}×${s.bounds.h}px)`)
      .join("\n")

    const coverage =
      scaffold.catalog.totalElements > 0
        ? Math.round((scaffold.catalog.coveredElements / scaffold.catalog.totalElements) * 100)
        : 0

    return {
      title: `Scaffold — ${scaffold.sections.length} sections, ${scaffold.catalog.patterns.length} patterns`,
      output: [
        `# ProjectScaffold`,
        "",
        `- Source: ${extractedPath}`,
        `- Sections: ${scaffold.sections.length}`,
        `- Shared components: ${scaffold.sharedComponents.length}`,
        `- Patterns detected: ${scaffold.catalog.patterns.length} (covering ${coverage}% of elements)`,
        `- Tokens: ${scaffold.tokens.colors.length} colors, ${scaffold.tokens.fonts.length} fonts, ${scaffold.tokens.spacing.length} spacings`,
        "",
        "## Top sections",
        sectionList || "  (none)",
        "",
        "## Top patterns",
        topPatterns || "  (none)",
        "",
        `**Artifacts written:**`,
        `- \`${scaffoldPath}\` — full ProjectScaffold`,
        `- \`${contextPath}\` — compact prompt-ready summary`,
        `- React source files: ${sourcePaths.length}`,
        "",
        "Next: read `shared-context.md` and `page-ir.xml`, then use bounded targeted `scaffold.json` reads only for missing details before writing the PRD/SPEC. Do not treat generated source as the deliverable.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        contextPath,
        sourcePaths,
        sectionCount: scaffold.sections.length,
        patternCount: scaffold.catalog.patterns.length,
        patternCoverage: coverage,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})
