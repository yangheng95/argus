/**
 * `webpage_analyze` tool — wraps `mirror/url/pattern::analyzePage` +
 * deterministic file generators.
 *
 * Reads `extracted-page.json`, runs pattern detection + token extraction, and
 * writes mirror facts plus deterministic scaffold artifacts that design-analysis consumes:
 *   - `<outputDir>/scaffold.json`         full ProjectScaffold
 *   - `<outputDir>/shared-context.md`     compact token + pattern summary
 *   - `<outputDir>/generated-source/*`    scaffold source artifacts for analysis only
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
import type { ProjectScaffold } from "../ir/scaffold"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"
import { writeGeneratedSourceFiles } from "./generated-source"

function renderPrdEvidenceSummary(input: {
  page: { url: string; title: string; viewport: { width: number; height: number } }
  scaffold: ProjectScaffold
  scaffoldPath: string
  contextPath: string
  irPath: string
  referencePath: string
}): string {
  const { page, scaffold } = input
  const colors = scaffold.tokens.colors
    .slice(0, 12)
    .map((c) => `- ${c.value}${c.semantic ? ` (${c.semantic})` : ""}, frequency=${c.frequency}`)
    .join("\n")
  const fonts = scaffold.tokens.fonts
    .map((f) => `- ${f.family}: weights=${f.weights.join("/")}, sizes=${f.sizes.join("/")}px`)
    .join("\n")
  const spacing = scaffold.tokens.spacing
    .slice(0, 8)
    .map((s) => `${s.px}px`)
    .join(", ")
  const sections = scaffold.sections
    .map((s) => `- ${s.name}: role=${s.role ?? "unknown"}, bounds=${s.bounds.x},${s.bounds.y},${s.bounds.w}x${s.bounds.h}, elements=${s.elementCount}, file=${s.file.filePath}`)
    .join("\n")
  const patterns = scaffold.catalog.patterns
    .slice(0, 12)
    .map((p) => {
      const props = p.props.length > 0 ? `, props=${p.props.map((prop) => `${prop.name}:${prop.type}`).join("/")}` : ""
      return `- ${p.name}: instances=${p.instanceCount}, similarity=${Math.round(p.structuralSimilarity * 100)}%${props}`
    })
    .join("\n")

  return [
    "# Mirror PRD/SPEC Evidence Summary",
    "",
    `Source URL: ${page.url}`,
    `Title: ${page.title}`,
    `Viewport: ${page.viewport.width}x${page.viewport.height}`,
    "",
    "## Canonical Evidence Files",
    `- Pixel reference: ${input.referencePath}`,
    `- Page hierarchy and text IR: ${input.irPath}`,
    `- Compact token/pattern summary: ${input.contextPath}`,
    `- Full scaffold source for bounded targeted reads: ${input.scaffoldPath}`,
    "",
    "## PRD/SPEC Draft Surface",
    "Use this as the first draft surface, then perform the PRD/SPEC review pass(es) required by assistant.auto_iteration before submit_design_prd_spec.",
    "",
    "### Page Inventory",
    sections || "- No sections detected; mark inventory gaps explicitly.",
    "",
    "### Visual Tokens",
    "Colors:",
    colors || "- unknown",
    "",
    "Fonts:",
    fonts || "- unknown",
    "",
    `Spacing: ${spacing || "unknown"}`,
    "",
    "### Reusable Component Patterns",
    patterns || "- No repeated patterns detected; describe visible unique components from pixels.",
    "",
    "### Visual Consistency Emphasis",
    "- Preserve the reference viewport geometry and major region proportions before decorative detail.",
    "- Bind charts, tables, toolbars, sidebars, overlays, and repeated data surfaces as grouped components.",
    "- Backend/API details must be marked unknown unless observable from text, controls, or data surfaces.",
    "",
    "### Required Review Passes",
    "- Pass 1 inventory: confirm each visible region/text/control/chart/table/media surface is represented or marked unknown.",
    "- Pass 2 implementation handoff: confirm frontend/backend specs are implementable without mirror tools.",
  ].join("\n")
}

export const WebpageAnalyzeTool = Tool.define("webpage_analyze", {
  description: `Analyze an ExtractedPage into a deterministic ProjectScaffold (section list, component-pattern catalog, design-token system, file contracts). Zero LLM.

Reads \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes mirror facts plus scaffold artifacts:
  - scaffold.json           full ProjectScaffold
  - shared-context.md       compact token + pattern summary for prompts
  - prd-evidence-summary.md direct PRD/SPEC drafting surface
  - generated-source/*      scaffold-generated source artifacts for analysis only

Returns a summary: section list, pattern list, token counts, and the PRD/SPEC evidence summary path. Once these artifacts exist, use them for PRD/SPEC synthesis; bounded targeted \`scaffold.json\` reads are only for specific gaps.

This tool is artifact-dependent: do NOT call it until \`extracted-page.json\` exists in the output directory. Never batch it with the URL extraction call that creates that file.

Use this only when scaffold and PRD evidence artifacts are missing. Do not rerun it once \`shared-context.md\` and \`prd-evidence-summary.md\` exist for the current evidence package. Pure function, no network.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing extracted-page.json. Writes scaffold.json and shared-context.md here, plus scaffold-generated source artifacts under generated-source/. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
      )
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
          `Missing ${extractedPath}. \`webpage_analyze\` depends on \`webpage_extract\` output. ` +
          `Create the URL evidence package first and retry only after \`extracted-page.json\` exists.`,
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
    const prdEvidencePath = path.join(outputDir, "prd-evidence-summary.md")
    const irPath = path.join(outputDir, "page-ir.xml")
    const referencePath = path.join(outputDir, "reference.png")
    const sourcePaths = await writeGeneratedSourceFiles(outputDir, sourceFiles)
    const prdEvidenceSummary = renderPrdEvidenceSummary({
      page,
      scaffold,
      scaffoldPath,
      contextPath,
      irPath,
      referencePath,
    })

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(contextPath, sharedContext, "utf8"),
      fs.writeFile(prdEvidencePath, prdEvidenceSummary, "utf8"),
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
        `- \`${prdEvidencePath}\` — direct PRD/SPEC evidence summary`,
        `- Generated source artifacts: ${sourcePaths.length}`,
        "",
        "PRD/SPEC evidence artifacts written. Do not rerun analysis for this evidence package unless the source extraction changed. Use `prd-evidence-summary.md`, `shared-context.md`, and `page-ir.xml` as the working surface; generated source artifacts are not the deliverable.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        contextPath,
        prdEvidencePath,
        sourcePaths,
        sectionCount: scaffold.sections.length,
        patternCount: scaffold.catalog.patterns.length,
        patternCoverage: coverage,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})
