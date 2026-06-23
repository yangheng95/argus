import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { materializeInlineExtractedPageAssets } from "@/browser/webpage/extract"
import { ExtractedPageSchema } from "@/browser/webpage/extracted-page"
import {
  buildWebCloneHandoff,
  WebCloneAssetGraphSchema,
  WebClonePageIrSchema,
  writeWebCloneHandoff,
  writeWebCloneSourceSkeleton,
  type WebCloneSegment,
  type WebCloneSegments,
} from "../../web-clone"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"

function renderPrdEvidenceSummary(input: {
  page: { url: string; title: string; viewport: { width: number; height: number } }
  segments: WebCloneSegment[]
  paths: {
    referencePath: string
    pageIrPath: string
    assetManifestPath: string
    segmentsPath: string
    codegenContextPath: string
    sourceSkeletonPath: string
    sourceIrPath: string
    visualSurfaceCandidatesPath: string
  }
  assetCount: number
}): string {
  const segmentRows = input.segments.slice(0, 32).map((segment) => {
    const bounds = segment.bounds
      ? `${segment.bounds.x},${segment.bounds.y},${segment.bounds.w}x${segment.bounds.h}`
      : "unknown"
    const text = segment.textPreview.slice(0, 4).join(" | ")
    return `- ${segment.name}: tag=${segment.tag}, strategy=${segment.strategy}, bounds=${bounds}${text ? `, text=${text}` : ""}`
  })

  return [
    "# Webpage Evidence PRD Summary",
    "",
    `Source URL: ${input.page.url}`,
    `Title: ${input.page.title}`,
    `Viewport: ${input.page.viewport.width}x${input.page.viewport.height}`,
    "",
    "## Canonical Evidence Files",
    `- Pixel reference: ${input.paths.referencePath}`,
    `- Structure IR: ${input.paths.pageIrPath}`,
    `- Asset graph: ${input.paths.assetManifestPath}`,
    `- Visual segments: ${input.paths.segmentsPath}`,
    `- Codegen context: ${input.paths.codegenContextPath}`,
    `- Source skeleton: ${input.paths.sourceSkeletonPath}`,
    `- Semantic source IR: ${input.paths.sourceIrPath}`,
    `- Visual surface candidates: ${input.paths.visualSurfaceCandidatesPath}`,
    "",
    "## Page Surface Inventory",
    segmentRows.length > 0
      ? segmentRows.join("\n")
      : "- No segments detected; inspect reference pixels and source skeleton manually.",
    "",
    "## Source Handoff Rules",
    "- Treat `web-clone-source/implementation-blueprint.md`, `source-ir/*`, `source-skeleton/critical.css`, and reusable assets as the downstream build source.",
    "- Use `source-skeleton/index.html` only for hierarchy/source ids and missing text; do not mechanically convert it into a single framework component.",
    "- Use `reference.png` as desktop visual truth and inspect target screenshots from task-scoped preview evidence.",
    `- Sidecar asset count: ${input.assetCount}`,
  ].join("\n")
}

function buildVisualSurfaceCandidates(segments: WebCloneSegments): unknown {
  return {
    version: 1,
    purpose: "web-clone-visual-surface-candidates",
    sourceIr: segments.sourceIr,
    assetManifest: segments.assetManifest,
    candidates: segments.segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      rootNodeId: segment.rootNodeId,
      tag: segment.tag,
      strategy: segment.strategy,
      bounds: segment.bounds,
      layout: segment.layout,
      textPreview: segment.textPreview,
      assetIds: segment.assetIds,
      sourceRefs: segment.nodeIds,
    })),
  }
}

export const WebpageAnalyzeTool = Tool.define("webpage_analyze", {
  description: `Prepare frontend-design source evidence from canonical web-clone IR. Zero LLM.

Reads \`<outputDir>/extracted-page.json\`, \`<outputDir>/page.ir.json\`, and \`<outputDir>/assets/manifest.json\`. Writes the source handoff files consumed by frontend-design and Build:
  - segments.json
  - codegen-context.json
  - visual-surface-candidates.json
  - source-skeleton/*
  - source-ir/*
  - prd-evidence-summary.md

Use this only after \`webpage_compile\` has produced \`page.ir.json\` and \`assets/manifest.json\`. Do not rerun it once \`prd-evidence-summary.md\` and \`source-ir/component-tree.json\` exist for the current evidence package.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing extracted-page.json, page.ir.json, and assets/manifest.json. Writes source handoff artifacts here. Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\` (matching webpage_extract's default). Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveWebpageEvidenceOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })
    const extractedPath = path.join(outputDir, "extracted-page.json")
    const pageIrPath = path.join(outputDir, "page.ir.json")
    const assetManifestPath = path.join(outputDir, "assets", "manifest.json")

    const rawPage = JSON.parse(await fs.readFile(extractedPath, "utf8"))
    const page = materializeInlineExtractedPageAssets(ExtractedPageSchema.parse(rawPage), outputDir)
    await fs.writeFile(extractedPath, JSON.stringify(page, null, 2), "utf8")

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
          `Missing web-clone IR artifacts. \`webpage_analyze\` requires \`${pageIrPath}\` and ` +
            `\`${assetManifestPath}\`; run \`webpage_compile\` after extraction before analysis.`,
        )
      }
      throw error
    }

    const pageIr = WebClonePageIrSchema.parse(JSON.parse(pageIrText))
    const assetGraph = WebCloneAssetGraphSchema.parse(JSON.parse(assetManifestText))
    const handoff = buildWebCloneHandoff(pageIr, assetGraph)
    await writeWebCloneHandoff(outputDir, handoff)
    const sourceSkeleton = await writeWebCloneSourceSkeleton({
      outputDir,
      pageIr,
      assetGraph,
      segments: handoff.segments,
    })

    const visualSurfaceCandidatesPath = path.join(outputDir, "visual-surface-candidates.json")
    const prdEvidencePath = path.join(outputDir, "prd-evidence-summary.md")
    await Promise.all([
      fs.writeFile(
        visualSurfaceCandidatesPath,
        `${JSON.stringify(buildVisualSurfaceCandidates(handoff.segments), null, 2)}\n`,
        "utf8",
      ),
      fs.writeFile(
        prdEvidencePath,
        renderPrdEvidenceSummary({
          page,
          segments: handoff.segments.segments,
          paths: {
            referencePath: path.join(outputDir, "reference.png"),
            pageIrPath,
            assetManifestPath,
            segmentsPath: path.join(outputDir, "segments.json"),
            codegenContextPath: path.join(outputDir, "codegen-context.json"),
            sourceSkeletonPath: path.join(outputDir, "source-skeleton"),
            sourceIrPath: path.join(outputDir, "source-ir"),
            visualSurfaceCandidatesPath,
          },
          assetCount: assetGraph.assets.length,
        }),
        "utf8",
      ),
    ])

    return {
      title: `Prepared web-clone source evidence — ${handoff.segments.segments.length} segments`,
      output: [
        "# Webpage source evidence prepared",
        "",
        `- Segments: ${path.join(outputDir, "segments.json")}`,
        `- Codegen context: ${path.join(outputDir, "codegen-context.json")}`,
        `- Visual surface candidates: ${visualSurfaceCandidatesPath}`,
        `- Source skeleton: ${sourceSkeleton.skeletonDir}`,
        `- Source IR: ${path.join(outputDir, "source-ir")}`,
        `- PRD evidence summary: ${prdEvidencePath}`,
        `- Skeleton audit passed: ${sourceSkeleton.audit.passed}`,
        "",
        "Use `prd-evidence-summary.md`, `source-skeleton/README.md`, `source-ir/*`, `source-skeleton/critical.css`, `page.ir.json`, `assets/manifest.json`, `segments.json`, and `codegen-context.json` as the working surface. The source skeleton and source IR are the development handoff.",
      ].join("\n"),
      metadata: {
        segmentCount: handoff.segments.segments.length,
        assetCount: assetGraph.assets.length,
        sourceSkeletonDir: sourceSkeleton.skeletonDir,
        sourceSkeletonAuditPassed: sourceSkeleton.audit.passed,
        prdEvidencePath,
        visualSurfaceCandidatesPath,
      },
    }
  },
})
