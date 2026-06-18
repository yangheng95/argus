import path from "node:path"
import z from "zod"
import {
  bindLocalModuleToSourceRegion,
  type LocalModuleSourceBindingResult,
} from "@/browser-preview/local-module-source-binding"
import { BrowserPreviewRegionLocator } from "@/browser-preview/region-comparison"
import { BrowserPreviewViewportID } from "@/browser-preview/viewport"
import { Instance } from "@/project/instance"
import { buildMultimodalToolResult } from "./multimodal-result"
import { BrowserPreviewBindLocalModuleToolID } from "./browser-preview-tool-ids"
import { Tool } from "./tool"

export const BrowserPreviewBindLocalModuleToolParameters = z
  .object({
    targetID: z.string().min(1).describe("Persisted browser_preview_target artifact ID for the current task."),
    viewportID: BrowserPreviewViewportID.default("desktop").describe("Viewport ID used to capture the local module."),
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
      .string()
      .min(1)
      .default("web-clone-source/reference.png")
      .describe(
        "Source reference screenshot artifact. Defaults to the task frontend-design source package reference.png.",
      ),
    textAnchors: z
      .array(z.string().min(1))
      .default([])
      .describe(
        "Optional extra visible labels from the module, such as section headings, table headers, tabs, or card titles.",
      ),
    sourcePadding: z.number().int().nonnegative().default(24).describe("Pixels to expand the selected source bbox."),
    localPadding: z.number().int().nonnegative().default(12).describe("Pixels to expand the captured local bbox."),
  })
  .strict()
export type BrowserPreviewBindLocalModuleToolParameters = z.infer<typeof BrowserPreviewBindLocalModuleToolParameters>

export const BrowserPreviewBindLocalModuleTool = Tool.define(BrowserPreviewBindLocalModuleToolID, {
  description:
    "Bind the local module currently being edited to the corresponding source webpage module. " +
    "Captures the local module by locator, extracts visible anchors, searches task frontend-design source evidence for a source region that fully contains the corresponding module, materializes source/local crops plus a puzzle image, and returns that puzzle as an image attachment directly in this tool result. " +
    "Use this before browser_preview_compare_regions when the source bbox is missing or questionable.",
  parameters: BrowserPreviewBindLocalModuleToolParameters,
  async execute(params: BrowserPreviewBindLocalModuleToolParameters, ctx: Tool.Context) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID.trim() : ""
    if (!taskID) {
      throw new Error("browser_preview_bind_local_module requires a task context.")
    }
    const result = await bindLocalModuleToSourceRegion({
      projectRoot: Instance.directory,
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
    const multimodal = await buildMultimodalToolResult({
      projectID: Instance.project.id,
      text: JSON.stringify(renderPublicResult(result), null, 2),
      images: [
        {
          path: result.artifacts.binding_puzzle,
          mime: "image/png",
          filename: `${params.viewportID}-${safeFilename(params.regionID)}-binding-puzzle.png`,
        },
      ],
    })
    return {
      title: "Local module source binding completed",
      output: multimodal.text,
      attachments: multimodal.attachments,
      metadata: {
        status: result.status,
        taskID,
        targetID: params.targetID,
        viewportID: params.viewportID,
        regionID: params.regionID,
        evidenceID: result.evidenceID,
        manifestPath: result.manifestPath,
        binding: result.binding,
        sourceCandidate: result.sourceCandidate,
        artifacts: result.artifacts,
        attachmentCount: multimodal.attachments.length,
      },
    }
  },
})

function renderPublicResult(result: LocalModuleSourceBindingResult): Record<string, unknown> {
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
    nextStep:
      "Read the attached binding puzzle. If the source crop fully contains the corresponding source module and the local crop is the same module, pass metadata.binding to browser_preview_compare_regions for repair-loop comparison. If the source crop is wrong, call this tool again with better textAnchors or a more precise local locator.",
  }
}

function safeFilename(input: string): string {
  return path.basename(
    input
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "region",
  )
}
