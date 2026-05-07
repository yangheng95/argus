/**
 * `webpage_analyze` tool — wraps `mirror/url/pattern::analyzePage` +
 * deterministic file generators.
 *
 * Reads `extracted-page.json`, runs pattern detection + token extraction, and
 * writes the three deterministic artifacts that a codegen agent then consumes:
 *   - `<outputDir>/scaffold.json`         full ProjectScaffold
 *   - `<outputDir>/design-tokens.ts`      COLORS / FONTS / SPACING / RADII consts
 *   - `<outputDir>/App.tsx`               pre-composed section layout
 *   - `<outputDir>/shared-context.md`     compact token + pattern summary
 *
 * Returns only the summary so the tool output stays small.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import {
  analyzePage,
  generateTokensFile,
  generateAppFile,
  buildSharedContext,
} from "../url/pattern"
import { ExtractedPageSchema } from "../ir/extracted-page"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const WebpageAnalyzeTool = Tool.define("webpage_analyze", {
  description: `Analyze an ExtractedPage into a deterministic ProjectScaffold (section list, component-pattern catalog, design-token system, file contracts). Zero LLM.

Reads \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes four artifacts:
  - scaffold.json           full ProjectScaffold
  - design-tokens.ts        COLORS, FONTS, SPACING, RADII constants (ready to import)
  - App.tsx                 auto-generated section composition (reference)
  - shared-context.md       compact token + pattern summary for prompts

Returns a summary: section list, pattern list, token counts. The agent should \`read\` scaffold.json for full detail when needed.

This tool is artifact-dependent: do NOT call it until \`webpage_extract\` has completed and written \`extracted-page.json\`. Never batch it in the same assistant turn as \`webpage_extract\`.

Use as step 3 of the webpage-generate workflow. Pure function, no network.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing extracted-page.json. Writes scaffold.json, design-tokens.ts, App.tsx, shared-context.md here. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_extract's default).`,
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

    const scaffold = analyzePage(page)
    const tokensFile = generateTokensFile(scaffold)
    const appFile = generateAppFile(scaffold)
    const sharedContext = buildSharedContext(scaffold, {
      url: page.url,
      title: page.title,
      viewport: page.viewport,
    })

    const scaffoldPath = path.join(outputDir, "scaffold.json")
    const tokensPath = path.join(outputDir, "design-tokens.ts")
    const appPath = path.join(outputDir, "App.tsx")
    const contextPath = path.join(outputDir, "shared-context.md")

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(tokensPath, tokensFile.code, "utf8"),
      fs.writeFile(appPath, appFile.code, "utf8"),
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
        `- \`${tokensPath}\` — design tokens (import COLORS/FONTS/SPACING from here)`,
        `- \`${appPath}\` — auto-generated App composition`,
        `- \`${contextPath}\` — compact prompt-ready summary`,
        "",
        "Next: write your clone as a single-file static \`index.html\` referencing design-tokens and page-ir.xml.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        tokensPath,
        appPath,
        contextPath,
        sectionCount: scaffold.sections.length,
        patternCount: scaffold.catalog.patterns.length,
        patternCoverage: coverage,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})
