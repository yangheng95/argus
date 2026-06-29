import path from "node:path"
import z from "zod"
import {
  bindLocalModuleToSourceRegion,
  type LocalModuleSourceBindingResult,
} from "@/browser-preview/local-module-source-binding"
import { resolveRuntimeRelativePath } from "@/browser-preview/persist"
import {
  BrowserPreviewRegionBinding,
  BrowserPreviewRegionLocator,
  BrowserPreviewSourceReferenceArtifactID,
} from "@/browser-preview/region-schema"
import {
  compareBrowserPreviewRegions,
  type BrowserPreviewRegionComparisonResult,
} from "@/browser-preview/region-comparison"
import { browserPreviewTaskEvidenceRoot } from "@/browser-preview/task-evidence-root"
import { BrowserPreviewViewportID } from "@/browser-preview/viewport"
import { Instance } from "@/project/instance"
import { buildMultimodalToolResult } from "./multimodal-result"
import { BrowserPreviewReferenceRegionsToolID } from "./browser-preview-tool-ids"
import { Tool } from "./tool"

const BrowserPreviewBindAndCompareLocalModuleParameters = z
  .object({
    operation: z.literal("bind_and_compare_local_module"),
    targetID: z.string().min(1).describe("Persisted browser_preview_target artifact ID for the current task."),
    viewportID: BrowserPreviewViewportID.default("desktop").describe("Viewport ID used for binding and comparison."),
    regionID: z.string().min(1).describe("Stable semantic ID for the local module being edited."),
    route: z.string().min(1).default("/").describe("Local route that renders the module."),
    implementationLocator: BrowserPreviewRegionLocator.describe(
      "Locator for the local module currently being edited. Prefer data-oc-region, test-id, or a declared selector owned by component_files.",
    ),
    componentFiles: z
      .array(z.string().min(1))
      .default([])
      .describe("Project source files that implement the local module."),
    sourceReferenceArtifactID: z
      .enum(BrowserPreviewSourceReferenceArtifactID.options)
      .default("web-clone-source/reference.png")
      .describe("Source reference screenshot artifact."),
    textAnchors: z
      .array(z.string().min(1))
      .default([])
      .describe("Visible labels from the module, such as section headings, table headers, tabs, or card titles."),
    sourcePadding: z.number().int().nonnegative().default(24).describe("Pixels to expand the selected source bbox."),
    localPadding: z.number().int().nonnegative().default(12).describe("Pixels to expand the captured local bbox."),
    includeDiff: z.boolean().default(false).describe("Whether to also generate per-region difference PNGs."),
    includeFullpageOverview: z
      .boolean()
      .default(false)
      .describe("Whether to retain full-page overview capture metadata."),
  })
  .strict()

const BrowserPreviewCompareBoundRegionsParameters = z
  .object({
    operation: z.literal("compare_bound_regions"),
    targetID: z.string().min(1).describe("Persisted browser_preview_target artifact ID for the current task."),
    viewportIDs: BrowserPreviewViewportID.array().min(1).describe("Viewport IDs to compare."),
    inlineBindings: BrowserPreviewRegionBinding.array()
      .min(1)
      .describe("Task-scoped source/local region bindings produced from source visual evidence and local components."),
    includeDiff: z.boolean().default(false).describe("Whether to also generate per-region difference PNGs."),
    includeFullpageOverview: z
      .boolean()
      .default(false)
      .describe("Whether to retain full-page overview capture metadata."),
  })
  .strict()

export const BrowserPreviewReferenceRegionsToolParameters = z.discriminatedUnion("operation", [
  BrowserPreviewBindAndCompareLocalModuleParameters,
  BrowserPreviewCompareBoundRegionsParameters,
])
export type BrowserPreviewReferenceRegionsToolParameters = z.infer<typeof BrowserPreviewReferenceRegionsToolParameters>

type ReferenceRegionsToolResult = {
  operation: BrowserPreviewReferenceRegionsToolParameters["operation"]
  status: "passed" | "failed"
  sourceBinding?: ReturnType<typeof renderSourceBindingResult>
  referenceComparison: BrowserPreviewRegionComparisonResult
  evidenceSemantics: string
}

export const BrowserPreviewReferenceRegionsTool = Tool.define(BrowserPreviewReferenceRegionsToolID, {
  description:
    "Bind source/reference regions and run formal true-size reference comparison through one task-scoped tool. " +
    "Use operation=bind_and_compare_local_module when the local module needs a source binding; use operation=compare_bound_regions only when reliable BrowserPreviewRegionBinding objects already exist. " +
    "This is the agent-facing reference-region proof tool: it can produce source-binding evidence and persisted reference-comparison evidence. It never accepts raw source URLs.",
  parameters: BrowserPreviewReferenceRegionsToolParameters,
  async execute(params: BrowserPreviewReferenceRegionsToolParameters, ctx: Tool.Context) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID.trim() : ""
    if (!taskID) {
      throw new Error("browser_preview_reference_regions requires a task context.")
    }
    const projectRoot = browserPreviewTaskEvidenceRoot(taskID)
    if (params.operation === "bind_and_compare_local_module") {
      const sourceBinding = await bindLocalModuleToSourceRegion({
        projectRoot,
        taskID,
        targetID: params.targetID,
        viewportID: params.viewportID,
        regionID: params.regionID,
        route: params.route,
        implementationLocator: params.implementationLocator,
        componentFiles: params.componentFiles,
        sourceReferenceArtifactID: params.sourceReferenceArtifactID,
        textAnchors: params.textAnchors,
        sourcePadding: params.sourcePadding,
        localPadding: params.localPadding,
        signal: ctx.abort,
      })
      const referenceComparison = await compareBrowserPreviewRegions({
        projectRoot,
        taskID,
        targetID: params.targetID,
        viewportIDs: [params.viewportID],
        bindings: [sourceBinding.binding],
        includeDiff: params.includeDiff,
        includeFullpageOverview: params.includeFullpageOverview,
        signal: ctx.abort,
      })
      return renderToolResult({
        projectRoot,
        taskID,
        targetID: params.targetID,
        operation: params.operation,
        sourceBinding,
        referenceComparison,
      })
    }
    const referenceComparison = await compareBrowserPreviewRegions({
      projectRoot,
      taskID,
      targetID: params.targetID,
      viewportIDs: params.viewportIDs,
      bindings: params.inlineBindings,
      includeDiff: params.includeDiff,
      includeFullpageOverview: params.includeFullpageOverview,
      signal: ctx.abort,
    })
    return renderToolResult({
      projectRoot,
      taskID,
      targetID: params.targetID,
      operation: params.operation,
      referenceComparison,
    })
  },
})

async function renderToolResult(input: {
  projectRoot: string
  taskID: string
  targetID: string
  operation: BrowserPreviewReferenceRegionsToolParameters["operation"]
  sourceBinding?: LocalModuleSourceBindingResult
  referenceComparison: BrowserPreviewRegionComparisonResult
}) {
  const status = input.referenceComparison.status
  const publicResult: ReferenceRegionsToolResult = {
    operation: input.operation,
    status,
    sourceBinding: input.sourceBinding ? renderSourceBindingResult(input.sourceBinding) : undefined,
    referenceComparison: input.referenceComparison,
    evidenceSemantics:
      "The referenceComparison field is formal reference-comparison evidence. Source-binding evidence is only the binding stage and does not by itself prove parity.",
  }
  const images = [
    ...sourceBindingAttachmentImages(input.sourceBinding),
    ...referenceComparisonAttachmentImages({
      projectRoot: input.projectRoot,
      result: input.referenceComparison,
    }),
  ]
  const multimodal = await buildMultimodalToolResult({
    projectID: Instance.project.id,
    text: JSON.stringify(publicResult, null, 2),
    images,
  })
  return {
    title:
      status === "passed"
        ? "Reference regions comparison completed"
        : "Reference regions comparison failed",
    output: multimodal.text,
    attachments: multimodal.attachments,
    metadata: {
      status,
      taskID: input.taskID,
      targetID: input.targetID,
      operation: input.operation,
      bindingEvidenceID: input.sourceBinding?.evidenceID,
      comparisonEvidenceIDs: input.referenceComparison.evidenceIDs,
      manifestPath: input.referenceComparison.manifestPath,
      jobID: input.referenceComparison.jobID,
      attachmentCount: multimodal.attachments.length,
      sourceBindingProduced: Boolean(input.sourceBinding),
      referenceComparisonProof: status === "passed",
    },
  }
}

function renderSourceBindingResult(result: LocalModuleSourceBindingResult): Record<string, unknown> {
  return {
    status: result.status,
    manifestPath: result.manifestPath,
    evidenceID: result.evidenceID,
    regionID: result.regionID,
    viewportID: result.viewportID,
    sourceCandidate: result.sourceCandidate,
    localBBox: result.localCapture.bbox,
    localTextAnchors: result.localCapture.textAnchors,
    binding: result.binding,
    artifacts: result.artifacts,
    diagnostics: result.diagnostics,
  }
}

function sourceBindingAttachmentImages(
  result: LocalModuleSourceBindingResult | undefined,
): Array<{ path: string; mime: "image/png"; filename: string }> {
  if (!result) return []
  return [
    {
      path: result.artifacts.binding_puzzle,
      mime: "image/png",
      filename: `${result.viewportID}-${safeFilename(result.regionID)}-binding-puzzle.png`,
    },
  ]
}

export function referenceComparisonAttachmentImages(input: {
  projectRoot: string
  result: BrowserPreviewRegionComparisonResult
  limit?: number
}): Array<{ path: string; mime: "image/png"; filename: string }> {
  const images: Array<{ path: string; mime: "image/png"; filename: string }> = []
  const regions = [...input.result.regions].sort((left, right) => {
    if (left.status === right.status) return 0
    return left.status === "failed" ? -1 : 1
  })
  const limit = input.limit ?? 8
  for (const region of regions) {
    if (!region.artifacts?.side_by_side) continue
    images.push({
      path: resolveRuntimeRelativePath(input.projectRoot, region.artifacts.side_by_side),
      mime: "image/png",
      filename: `${region.viewport_id}-${region.status}-${safeFilename(region.region_id)}-side-by-side.png`,
    })
    if (region.artifacts.diff) {
      images.push({
        path: resolveRuntimeRelativePath(input.projectRoot, region.artifacts.diff),
        mime: "image/png",
        filename: `${region.viewport_id}-${region.status}-${safeFilename(region.region_id)}-diff.png`,
      })
    }
    if (images.length >= limit) return images.slice(0, limit)
  }
  return images
}

function safeFilename(input: string): string {
  return path.basename(
    input
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "region",
  )
}
