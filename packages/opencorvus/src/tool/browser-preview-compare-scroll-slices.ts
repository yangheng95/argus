import path from "node:path"
import z from "zod"
import {
  BrowserPreviewScrollSliceComparisonRequest,
  BrowserPreviewScrollSliceComparisonResult,
  compareBrowserPreviewScrollSlice,
} from "@/browser-preview/scroll-slice-comparison"
import { browserPreviewTaskEvidenceRoot } from "@/browser-preview/task-evidence-root"
import { resolveRuntimeRelativePath } from "@/browser-preview/persist"
import { Instance } from "@/project/instance"
import { buildMultimodalToolResult } from "./multimodal-result"
import { BrowserPreviewCompareScrollSlicesToolID } from "./browser-preview-tool-ids"
import { Tool } from "./tool"

export const BrowserPreviewCompareScrollSlicesToolParameters =
  BrowserPreviewScrollSliceComparisonRequest.extend({
    includeDiff: z.boolean().default(false).describe("Whether to also generate a diagnostic diff PNG."),
  }).strict()
export type BrowserPreviewCompareScrollSlicesToolParameters = z.infer<
  typeof BrowserPreviewCompareScrollSlicesToolParameters
>

export const BrowserPreviewCompareScrollSlicesTool = Tool.define(BrowserPreviewCompareScrollSlicesToolID, {
  description:
    "Visual QA only: compare a finished implementation page slice against the already captured source reference screenshot at the same absolute scrollY. Uses a persisted browser_preview target and web-clone-source/reference.png or reference-mobile.png; never accepts source URLs and never satisfies formal browser_preview_compare_regions reference-comparison proof. Returns a side-by-side PNG attachment for direct inspection.",
  parameters: BrowserPreviewCompareScrollSlicesToolParameters,
  async execute(params: BrowserPreviewCompareScrollSlicesToolParameters, ctx: Tool.Context) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID.trim() : ""
    if (!taskID) {
      throw new Error("browser_preview_compare_scroll_slices requires a task context.")
    }
    const projectRoot = browserPreviewTaskEvidenceRoot(taskID)
    const result = await compareBrowserPreviewScrollSlice({
      projectRoot,
      taskID,
      targetID: params.targetID,
      viewportID: params.viewportID,
      sourceReferenceArtifactID: params.sourceReferenceArtifactID,
      route: params.route,
      scrollY: params.scrollY,
      sliceHeight: params.sliceHeight,
      includeDiff: params.includeDiff,
      signal: ctx.abort,
    })
    const sideBySidePath = resolveRuntimeRelativePath(projectRoot, result.artifacts.side_by_side)
    const multimodal = await buildMultimodalToolResult({
      projectID: Instance.project.id,
      text: JSON.stringify(renderPublicResult(result), null, 2),
      images: [
        {
          path: sideBySidePath,
          mime: "image/png",
          filename: `${params.viewportID}-scroll-${params.scrollY}-${path.basename(sideBySidePath)}`,
        },
      ],
    })
    return {
      title: "Scroll-slice comparison completed",
      output: multimodal.text,
      attachments: multimodal.attachments,
      metadata: {
        status: result.status satisfies BrowserPreviewScrollSliceComparisonResult["status"],
        taskID,
        targetID: params.targetID,
        viewportID: params.viewportID,
        jobID: result.jobID,
        manifestPath: result.manifestPath,
        artifacts: result.artifacts,
        attachmentCount: multimodal.attachments.length,
        referenceComparisonProof: false,
      },
    }
  },
})

function renderPublicResult(result: BrowserPreviewScrollSliceComparisonResult): Record<string, unknown> {
  return {
    ...result,
    evidenceSemantics:
      "Supporting visual_diff evidence only. This is not browser_preview_compare_regions reference-comparison proof.",
  }
}
