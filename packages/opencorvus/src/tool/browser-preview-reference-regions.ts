import path from "node:path"
import z from "zod"
import {
  bindLocalModuleToSourceRegion,
  type LocalModuleSourceBindingResult,
} from "@/browser-preview/local-module-source-binding"
import { normalizeRuntimePathRefs } from "@/browser-preview/persist"
import { browserPreviewTaskEvidenceRoot } from "@/browser-preview/task-evidence-root"
import { BrowserPreviewRegionLocator, BrowserPreviewSourceReferenceArtifactID } from "@/browser-preview/region-schema"
import { BrowserPreviewViewportID } from "@/browser-preview/viewport"
import { Instance } from "@/project/instance"
import { buildMultimodalToolResult } from "./multimodal-result"
import { BrowserPreviewReferenceRegionsToolID } from "./browser-preview-tool-ids"
import { Tool } from "./tool"

export const BrowserPreviewReferenceRegionsToolParameters = z
  .object({
    targetID: z.string().min(1).describe("Persisted browser_preview_target artifact ID for the current task."),
    viewportID: BrowserPreviewViewportID.default("desktop").describe("Viewport ID used for module binding."),
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
  })
  .strict()
export type BrowserPreviewReferenceRegionsToolParameters = z.infer<typeof BrowserPreviewReferenceRegionsToolParameters>

type ReferenceRegionsToolResult =
  | {
      operation: "bind_local_module"
      status: "passed"
      sourceBinding: ReturnType<typeof renderSourceBindingResult>
      evidenceSemantics: string
    }
  | {
      operation: "bind_local_module"
      status: "failed"
      reason: string
      evidenceSemantics: string
    }

type ReferenceRegionsToolMetadata =
  | {
      status: "passed"
      taskID: string
      targetID: string
      operation: "bind_local_module"
      bindingEvidenceID: string
      manifestPath: string
      jobID: string
      attachmentCount: number
      moduleBindingProof: true
    }
  | {
      status: "failed"
      taskID: string
      targetID: string
      operation: "bind_local_module"
      reason: string
      attachmentCount: number
      moduleBindingProof: false
    }

export const BrowserPreviewReferenceRegionsTool = Tool.define<
  typeof BrowserPreviewReferenceRegionsToolParameters,
  ReferenceRegionsToolMetadata
>(BrowserPreviewReferenceRegionsToolID, {
  description:
    "Bind one local implementation module to one source/reference region and return exactly one module comparison screenshot attachment. " +
    "This is module-level evidence only: it compares the selected source crop with the selected local module crop. " +
    "The returned comparison_guidance states that LEFT is the source/reference image and RIGHT is the rendered/local implementation, with a checklist for layout, icon/asset, color, spacing, typography, content, state, chart/table/map, and placeholder defects. " +
    "It does not run page-slice comparison, does not run a second reference-comparison pass, does not accept raw source URLs, and does not auto-call other tools on bind failure. " +
    "Use browser_preview_compare_scroll_slices for first-viewport or screen-by-screen page comparison, and Browser MCP screenshot/observe tools for ordinary browser screenshots when they are exposed in the current toolset.",
  parameters: BrowserPreviewReferenceRegionsToolParameters,
  async execute(params: BrowserPreviewReferenceRegionsToolParameters, ctx: Tool.Context) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID.trim() : ""
    if (!taskID) {
      throw new Error("browser_preview_reference_regions requires a task context.")
    }
    const projectRoot = browserPreviewTaskEvidenceRoot(taskID)
    try {
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
      return renderPassedToolResult({
        projectRoot,
        taskID,
        targetID: params.targetID,
        sourceBinding,
      })
    } catch (error) {
      return renderFailedToolResult({
        taskID,
        targetID: params.targetID,
        reason: errorMessage(error),
      })
    }
  },
})

async function renderPassedToolResult(input: {
  projectRoot: string
  taskID: string
  targetID: string
  sourceBinding: LocalModuleSourceBindingResult
}) {
  const publicResult: ReferenceRegionsToolResult = {
    operation: "bind_local_module",
    status: "passed",
    sourceBinding: renderSourceBindingResult(input.projectRoot, input.sourceBinding),
    evidenceSemantics:
      "This is one module source-binding comparison. It is not a first-viewport/page-slice screenshot and no internal fallback or second comparison was run.",
  }
  const multimodal = await buildMultimodalToolResult({
    projectID: Instance.project.id,
    text: JSON.stringify(publicResult, null, 2),
    images: [sourceBindingAttachmentImage(input.sourceBinding)],
  })
  const metadata: ReferenceRegionsToolMetadata = {
    status: "passed",
    taskID: input.taskID,
    targetID: input.targetID,
    operation: "bind_local_module",
    bindingEvidenceID: input.sourceBinding.evidenceID,
    manifestPath: input.sourceBinding.manifestPath,
    jobID: input.sourceBinding.jobID,
    attachmentCount: multimodal.attachments.length,
    moduleBindingProof: true,
  }
  return {
    title: "Reference module binding completed",
    output: multimodal.text,
    attachments: multimodal.attachments,
    metadata,
  }
}

async function renderFailedToolResult(input: { taskID: string; targetID: string; reason: string }) {
  const publicResult: ReferenceRegionsToolResult = {
    operation: "bind_local_module",
    status: "failed",
    reason: input.reason,
    evidenceSemantics:
      "Module binding failed before a source/local module comparison could be produced. This tool does not auto-call scroll-slice or screenshot tools; run those separately only for page-level diagnosis.",
  }
  const multimodal = await buildMultimodalToolResult({
    projectID: Instance.project.id,
    text: JSON.stringify(publicResult, null, 2),
    images: [],
  })
  const metadata: ReferenceRegionsToolMetadata = {
    status: "failed",
    taskID: input.taskID,
    targetID: input.targetID,
    operation: "bind_local_module",
    reason: input.reason,
    attachmentCount: multimodal.attachments.length,
    moduleBindingProof: false,
  }
  return {
    title: "Reference module binding failed",
    output: multimodal.text,
    attachments: multimodal.attachments,
    metadata,
  }
}

function renderSourceBindingResult(projectRoot: string, result: LocalModuleSourceBindingResult): Record<string, unknown> {
  return normalizeRuntimePathRefs(projectRoot, {
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
    comparison_guidance: result.comparison_guidance,
    diagnostics: result.diagnostics,
  }) as Record<string, unknown>
}

function sourceBindingAttachmentImage(result: LocalModuleSourceBindingResult): {
  path: string
  mime: "image/png"
  filename: string
} {
  return {
    path: result.artifacts.module_comparison,
    mime: "image/png",
    filename: `${result.viewportID}-${safeFilename(result.regionID)}-module-comparison.png`,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
