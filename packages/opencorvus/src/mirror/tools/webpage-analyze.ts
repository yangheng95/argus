/**
 * `webpage_analyze` tool — wraps `mirror/url/pattern::analyzePage` +
 * deterministic file generators.
 *
 * Reads `extracted-page.json`, runs pattern detection + token extraction, and
 * writes mirror facts plus deterministic scaffold artifacts that frontend-design consumes:
 *   - `<outputDir>/visual-surface-scaffold.json` semantic ProjectScaffold
 *   - `<outputDir>/visual-surface-candidates.json` deterministic surface candidates
 *   - `<outputDir>/shared-context.md`     compact token + pattern summary
 *   - `<outputDir>/segments.json` canonical web-clone segment contract
 *   - `<outputDir>/codegen-context.json` prompt-facing framework codegen handoff
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
  detectPatterns,
  generateSurfaceCandidates,
} from "../url/pattern"
import { materializeScaffoldForReactSource } from "../shared/scaffold-helpers"
import { materializeInlineExtractedPageAssets } from "../url/extract"
import { ExtractedPageSchema } from "../ir/extracted-page"
import type { ProjectScaffold } from "../ir/scaffold"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"
import {
  buildWebCloneHandoff,
  WebCloneAssetGraphSchema,
  WebClonePageIrSchema,
  writeWebCloneHandoff,
  writeWebCloneSourceSkeleton,
} from "../../web-clone"

function renderPrdEvidenceSummary(input: {
  page: { url: string; title: string; viewport: { width: number; height: number } }
  scaffold: ProjectScaffold
  scaffoldPath: string
  candidatePath: string
  assetManifestPath: string
  segmentsPath: string
  codegenContextPath: string
  sourceSkeletonPath: string
  sourceSkeletonAuditPath: string
  sourceIrPath: string
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
  const surfaces = scaffold.surfaces
    .map((s) => `- ${s.name}: kind=${s.kind}, role=${s.role ?? "unknown"}, bounds=${s.bounds.x},${s.bounds.y},${s.bounds.w}x${s.bounds.h}`)
    .join("\n")
  const patterns = scaffold.catalog.patterns
    .slice(0, 12)
    .map((p) => {
      const props = p.props.length > 0 ? `, props=${p.props.map((prop) => `${prop.name}:${prop.type}`).join("/")}` : ""
      return `- ${p.name}: instances=${p.instanceCount}, similarity=${Math.round(p.structuralSimilarity * 100)}%${props}`
    })
    .join("\n")

  return [
    "# Mirror frontend template Evidence Summary",
    "",
    `Source URL: ${page.url}`,
    `Title: ${page.title}`,
    `Viewport: ${page.viewport.width}x${page.viewport.height}`,
    "",
    "## Canonical Evidence Files",
    `- Pixel reference: ${input.referencePath}`,
    `- Canonical structure IR: ${input.irPath}`,
    `- Asset graph: ${input.assetManifestPath}`,
    `- Visual reconstruction segments: ${input.segmentsPath}`,
    `- Source-package diagnostic context: ${input.codegenContextPath}`,
    `- Source skeleton hierarchy evidence: ${input.sourceSkeletonPath}`,
    `- Source skeleton audit: ${input.sourceSkeletonAuditPath}`,
    `- Semantic source IR: ${input.sourceIrPath}`,
    `- Compact token/pattern summary: ${input.contextPath}`,
    `- Visual surface candidates: ${input.candidatePath}`,
    `- Semantic visual surface scaffold: ${input.scaffoldPath}`,
    "",
    "## frontend template Draft Surface",
    "Use this as the first draft surface, then perform the frontend template review pass(es) required by assistant.auto_iteration before submit_frontend_template.",
    "",
    "### Page Inventory",
    surfaces || "- No visual surfaces detected; mark inventory gaps explicitly.",
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
    "- UI data/API details must be marked unknown unless observable from text, controls, or data surfaces.",
    "",
    "### Required Review Passes",
    "- Pass 1 inventory: confirm each visible region/text/control/chart/table/media surface is represented or marked unknown.",
    "- Pass 2 implementation handoff: confirm web-clone-source/implementation-blueprint.md, source-ir/*.json, source-skeleton/critical.css, source-skeleton/index.html, and source-skeleton/full-source.css provide enough evidence for downstream maintainable framework implementation.",
  ].join("\n")
}

export const WebpageAnalyzeTool = Tool.define("webpage_analyze", {
  description: `Analyze an ExtractedPage into deterministic surface candidates and semantic source evidence (visual surface list, component-pattern catalog, design-token system). Zero LLM.

Reads \`<outputDir>/extracted-page.json\` (from webpage_extract). Writes mirror facts plus scaffold artifacts:
  - visual-surface-candidates.json deterministic surface evidence for frontend-design review
  - visual-surface-scaffold.json   semantic ProjectScaffold with surfaces
  - shared-context.md       compact token + pattern summary for prompts
  - segments.json           canonical visual reconstruction segment evidence
  - codegen-context.json    diagnostic source-package context, not a project-source generator
  - source-skeleton/index.html raw semantic HTML evidence for hierarchy/source ids; not a direct code-generation template
  - source-skeleton/critical.css reachable CSS handoff plus computed-style fallback rules
  - source-skeleton/full-source.css complete CSS evidence sidecar
  - source-skeleton/used-selectors.json selector reachability evidence
  - source-skeleton/skeleton-manifest.json source coverage and component hints
  - source-skeleton/source-skeleton-audit.json source-only skeleton quality audit
  - source-ir/component-tree.json semantic component boundaries
  - source-ir/content-model.json tables/lists/cards/controls/repeated groups
  - source-ir/layout-map.json source-node bounds and key styles
  - source-ir/style-tokens.json visual token candidates
  - source-ir/interaction-hints.json interaction candidates
  - source-ir/source-quality-audit.json source/IR quality audit
  - prd-evidence-summary.md direct frontend template drafting surface

Returns a summary: visual surface list, web-clone segment list, pattern list, token counts, and the frontend template evidence summary path. Once these artifacts exist, use them for frontend template synthesis; bounded targeted scaffold reads are only for specific gaps.

This tool is artifact-dependent: do NOT call it until \`extracted-page.json\` exists in the output directory. Never batch it with the URL extraction call that creates that file.

Use this only when scaffold and template evidence artifacts are missing. Do not rerun it once \`shared-context.md\` and \`prd-evidence-summary.md\` exist for the current evidence package. Pure function, no network.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing extracted-page.json, page.ir.json, and assets/manifest.json. Writes segments.json, codegen-context.json, visual-surface-candidates.json, visual-surface-scaffold.json, source-skeleton/, source-ir/, shared-context.md, and prd-evidence-summary.md here. Defaults to task-scoped \`${DEFAULT_MIRROR_SUBDIR}\` (matching webpage_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_MIRROR_SUBDIR}\`.`,
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
    const page = materializeInlineExtractedPageAssets(ExtractedPageSchema.parse(raw), outputDir)
    await fs.writeFile(extractedPath, JSON.stringify(page, null, 2), "utf8")

    const pageIrPath = path.join(outputDir, "page.ir.json")
    const assetManifestPath = path.join(outputDir, "assets", "manifest.json")
    let pageIrText: string
    let assetManifestText: string
    try {
      ;[pageIrText, assetManifestText] = await Promise.all([
        fs.readFile(pageIrPath, "utf8"),
        fs.readFile(assetManifestPath, "utf8"),
      ])
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing canonical mirror IR artifacts. \`webpage_analyze\` requires \`${pageIrPath}\` and ` +
          `\`${assetManifestPath}\`; run \`webpage_compile\` after extraction before analysis.`,
        )
      }
      throw error
    }
    const webCloneHandoff = buildWebCloneHandoff(
      WebClonePageIrSchema.parse(JSON.parse(pageIrText)),
      WebCloneAssetGraphSchema.parse(JSON.parse(assetManifestText)),
    )
    await writeWebCloneHandoff(outputDir, webCloneHandoff)
    const pageIr = WebClonePageIrSchema.parse(JSON.parse(pageIrText))
    const assetGraph = WebCloneAssetGraphSchema.parse(JSON.parse(assetManifestText))
    const sourceSkeleton = await writeWebCloneSourceSkeleton({
      outputDir,
      pageIr,
      assetGraph,
      segments: webCloneHandoff.segments,
    })

    const scaffold = materializeScaffoldForReactSource(analyzePage(page))
    const candidates = generateSurfaceCandidates(page, detectPatterns(page))
    const sharedContext = buildSharedContext(scaffold, {
      url: page.url,
      title: page.title,
      viewport: page.viewport,
    })

    const scaffoldPath = path.join(outputDir, "visual-surface-scaffold.json")
    const candidatePath = path.join(outputDir, "visual-surface-candidates.json")
    const segmentsPath = path.join(outputDir, "segments.json")
    const codegenContextPath = path.join(outputDir, "codegen-context.json")
    const sourceSkeletonPath = path.join(outputDir, "source-skeleton")
    const sourceSkeletonAuditPath = path.join(outputDir, "source-skeleton", "source-skeleton-audit.json")
    const sourceIrPath = path.join(outputDir, "source-ir")
    const contextPath = path.join(outputDir, "shared-context.md")
    const prdEvidencePath = path.join(outputDir, "prd-evidence-summary.md")
    const irPath = pageIrPath
    const referencePath = path.join(outputDir, "reference.png")
    const prdEvidenceSummary = renderPrdEvidenceSummary({
      page,
      scaffold,
      scaffoldPath,
      candidatePath,
      assetManifestPath,
      segmentsPath,
      codegenContextPath,
      sourceSkeletonPath,
      sourceSkeletonAuditPath,
      sourceIrPath,
      contextPath,
      irPath,
      referencePath,
    })

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(candidatePath, JSON.stringify(candidates, null, 2), "utf8"),
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
    const surfaceList = scaffold.surfaces
      .map((s) => `  - ${s.name} (${s.kind}, ${s.bounds.w}×${s.bounds.h}px, view ${s.view.filePath})`)
      .join("\n")

    const coverage =
      scaffold.catalog.totalElements > 0
        ? Math.round((scaffold.catalog.coveredElements / scaffold.catalog.totalElements) * 100)
        : 0

    return {
      title: `Scaffold — ${scaffold.surfaces.length} surfaces, ${scaffold.catalog.patterns.length} patterns`,
      output: [
        `# ProjectScaffold`,
        "",
        `- Source: ${extractedPath}`,
        `- Surfaces: ${scaffold.surfaces.length}`,
        `- Shared views: ${scaffold.sharedViews.length}`,
        `- Patterns detected: ${scaffold.catalog.patterns.length} (covering ${coverage}% of elements)`,
        `- Tokens: ${scaffold.tokens.colors.length} colors, ${scaffold.tokens.fonts.length} fonts, ${scaffold.tokens.spacing.length} spacings`,
        "",
        "## Top visual surfaces",
        surfaceList || "  (none)",
        "",
        "## Top patterns",
        topPatterns || "  (none)",
        "",
        `**Artifacts written:**`,
        `- \`${candidatePath}\` - deterministic visual surface candidates`,
        `- \`${segmentsPath}\` - canonical web-clone segment contract`,
        `- \`${codegenContextPath}\` - prompt-facing framework codegen context`,
        `- \`${sourceSkeletonPath}\` - source-only HTML/CSS skeleton for downstream implementation`,
        `- \`${sourceSkeletonAuditPath}\` - source skeleton audit (${sourceSkeleton.audit.passed ? "passed" : "failed"})`,
        `- \`${sourceIrPath}\` - semantic source IR for component/data/style/interaction reconstruction`,
        `- \`${scaffoldPath}\` — semantic visual surface ProjectScaffold`,
        `- \`${contextPath}\` — compact prompt-ready summary`,
        `- \`${prdEvidencePath}\` — direct frontend template evidence summary`,
        `- Web-clone segments: ${webCloneHandoff.segments.segments.length}`,
        "",
        "frontend template evidence artifacts written. Do not rerun analysis for this evidence package unless the source extraction changed. Use `prd-evidence-summary.md`, `reference.png`, `source-skeleton/README.md`, `source-ir/component-tree.json`, `source-ir/content-model.json`, `source-ir/style-tokens.json`, `source-ir/interaction-hints.json`, `source-skeleton/critical.css`, `source-skeleton/index.html`, `source-skeleton/full-source.css`, `source-skeleton/used-selectors.json`, `source-skeleton/skeleton-manifest.json`, `page.ir.json`, `assets/manifest.json`, `segments.json`, `codegen-context.json`, `shared-context.md`, and `visual-surface-candidates.json` as the working surface. The source skeleton and semantic source IR are the development handoff.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        candidatePath,
        segmentsPath,
        codegenContextPath,
        sourceSkeletonPath,
        sourceSkeletonAuditPath,
        sourceIrPath,
        assetManifestPath,
        contextPath,
        prdEvidencePath,
        sourceSkeleton,
        webCloneSegments: webCloneHandoff.segments,
        webCloneCodegenContext: webCloneHandoff.codegenContext,
        surfaceCount: scaffold.surfaces.length,
        patternCount: scaffold.catalog.patterns.length,
        patternCoverage: coverage,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})
