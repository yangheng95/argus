import path from "node:path"
import z from "zod"
import { findBrowserPreviewTargetByID, resolveRuntimeRelativePath } from "@/browser-preview/persist"
import {
  BrowserPreviewRegionBinding,
  BrowserPreviewRegionComparisonResult,
  compareBrowserPreviewRegions,
} from "@/browser-preview/region-comparison"
import { BrowserPreviewViewportID } from "@/browser-preview/viewport"
import { Instance } from "@/project/instance"
import { buildMultimodalToolResult } from "./multimodal-result"
import { Tool } from "./tool"

export const BrowserPreviewCompareRegionsToolParameters = z.object({
  targetID: z.string().min(1).describe("Persisted browser_preview_target artifact ID for the current task."),
  viewportIDs: BrowserPreviewViewportID.array().min(1).describe("Viewport IDs to compare."),
  inlineBindings: BrowserPreviewRegionBinding.array()
    .min(1)
    .describe("Task-scoped source/local region bindings produced from source visual evidence and local components."),
  includeDiff: z.boolean().default(false).describe("Whether to also generate per-region difference PNGs."),
  includeFullpageOverview: z.boolean().default(false).describe("Whether to retain full-page overview capture metadata."),
})
export type BrowserPreviewCompareRegionsToolParameters = z.infer<typeof BrowserPreviewCompareRegionsToolParameters>

export const BrowserPreviewCompareRegionsTool = Tool.define("browser_preview_compare_regions", {
  description:
    "Preferred frontend visual repair-loop tool when source/reference evidence and a persisted browser_preview_target both exist. Capture local implementation regions, crop matching source reference regions, persist comparison evidence, and return source/local side-by-side PNG attachments directly in the build agent message. Use before standalone screenshot review for reference-parity regions with bindings.",
  parameters: BrowserPreviewCompareRegionsToolParameters,
  async execute(params: BrowserPreviewCompareRegionsToolParameters, ctx: Tool.Context) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID.trim() : ""
    if (!taskID) {
      throw new Error("browser_preview_compare_regions requires a task context.")
    }
    const target = findBrowserPreviewTargetByID({ taskID, targetID: params.targetID })
    if (!target) {
      throw new Error(`Browser preview target not found: ${params.targetID}`)
    }
    const result = await compareBrowserPreviewRegions({
      projectRoot: Instance.directory,
      taskID,
      targetID: params.targetID,
      url: target.url,
      viewportIDs: params.viewportIDs,
      bindings: params.inlineBindings,
      includeDiff: params.includeDiff,
      includeFullpageOverview: params.includeFullpageOverview,
      signal: ctx.abort,
    })
    const visibleImages = result.regions
      .filter((region) => region.status === "completed" && region.artifacts?.side_by_side)
      .slice(0, 6)
      .map((region) => ({
        path: resolveRuntimeRelativePath(Instance.directory, region.artifacts!.side_by_side),
        mime: "image/png",
        filename: `${region.viewport_id}-${path.basename(region.artifacts!.side_by_side)}`,
      }))
    const multimodal = await buildMultimodalToolResult({
      projectID: Instance.project.id,
      text: JSON.stringify(result, null, 2),
      images: visibleImages,
    })
    return {
      title: result.status === "passed" ? "Region comparison completed" : "Region comparison failed",
      output: multimodal.text,
      attachments: multimodal.attachments,
      metadata: {
        status: result.status satisfies BrowserPreviewRegionComparisonResult["status"],
        taskID,
        targetID: params.targetID,
        jobID: result.jobID,
        manifestPath: result.manifestPath,
        evidenceIDs: result.evidenceIDs,
        attachmentCount: multimodal.attachments.length,
      },
    }
  },
})
