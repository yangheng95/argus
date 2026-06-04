import path from "node:path"
import z from "zod"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { captureRuntimePage, type RuntimeCaptureInput, type RuntimeCaptureResult } from "@/runtime/page-capture"
import { Identifier } from "@/id/id"
import { persistBrowserPreviewEvidence } from "./persist"
import { BrowserPreviewTarget } from "./target"
import { browserPreviewViewportByID, BrowserPreviewViewport, BrowserPreviewViewportID } from "./viewport"

export const BrowserPreviewCaptureSummary = z.object({
  captured: z.boolean(),
  passed: z.boolean(),
  url: z.string(),
  requested_viewport: z.object({
    width: z.number(),
    height: z.number(),
  }),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
    capped: z.boolean(),
  }),
  summary: z.string(),
  path: z.string().optional(),
  sha: z.string().optional(),
  bytes: z.number().optional(),
  layers: z.unknown().optional(),
  dom: z.unknown().optional(),
  capture_error: z.unknown().optional(),
})

export const BrowserPreviewVerification = z.object({
  status: z.enum(["passed", "failed"]),
  projectRoot: z.string(),
  target: BrowserPreviewTarget,
  viewport: BrowserPreviewViewport,
  capture: BrowserPreviewCaptureSummary.optional(),
  diagnostics: z.string().array(),
})
export type BrowserPreviewVerification = z.infer<typeof BrowserPreviewVerification>

type CaptureRuntimePage = (input: RuntimeCaptureInput) => Promise<RuntimeCaptureResult>

export async function verifyBrowserPreview(input: {
  projectRoot: string
  target: BrowserPreviewTarget
  viewportID: BrowserPreviewViewportID
  taskID?: string
  targetID?: string
  signal?: AbortSignal
  outDir?: string
  capture?: CaptureRuntimePage
}): Promise<BrowserPreviewVerification> {
  const projectRoot = path.resolve(input.projectRoot)
  const viewport = browserPreviewViewportByID(input.viewportID)
  if (!input.target.url) {
    return {
      status: "failed",
      projectRoot,
      target: input.target,
      viewport,
      diagnostics: [
        "Preview verification requires a resolved http(s) URL.",
        ...input.target.diagnostics,
      ],
    }
  }

  const capture = input.capture ?? captureRuntimePage
  const captureID = Identifier.ascending("artifact")
  const outDir = input.outDir ?? (
    input.taskID
      ? ProjectRuntimePaths.taskAbsolute(projectRoot, input.taskID, "browser-preview", captureID, viewport.id)
      : path.join(ProjectRuntimePaths.projectRuntimeRoot(projectRoot), "browser-preview", "no-task", captureID, viewport.id)
  )
  const result = await capture({
    url: input.target.url,
    outDir,
    viewport_width: viewport.width,
    viewport_height: viewport.height,
    fileLabel: viewport.id,
    signal: input.signal,
  })
  const status = result.captured && result.passed ? "passed" : "failed"
  const diagnostics = [result.summary]
  let evidenceID: string | undefined
  if (input.taskID) {
    evidenceID = persistBrowserPreviewEvidence({
      taskID: input.taskID,
      targetID: input.targetID ?? input.target.id,
      viewportID: viewport.id,
      status,
      summary: result.summary,
      capture: result,
      diagnostics,
    })
  }

  return {
    status,
    projectRoot,
    target: evidenceID ? { ...input.target, latestEvidenceID: evidenceID } : input.target,
    viewport,
    capture: result,
    diagnostics,
  }
}
