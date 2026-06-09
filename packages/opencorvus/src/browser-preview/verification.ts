import path from "node:path"
import z from "zod"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import type { RuntimeCaptureInput, RuntimeCaptureResult } from "@/runtime/page-capture"
import { Identifier } from "@/id/id"
import { runBrowserPreviewEvidenceJob, type BrowserEvidenceManifestSummary } from "./evidence-runner"
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
  manifest: z.unknown().optional(),
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
  taskID: string
  targetID: string
  signal?: AbortSignal
  outDir?: string
  captureForTest?: CaptureRuntimePage
}): Promise<BrowserPreviewVerification> {
  const projectRoot = path.resolve(input.projectRoot)
  const viewport = browserPreviewViewportByID(input.viewportID)
  if (!input.taskID || !input.targetID) {
    return {
      status: "failed",
      projectRoot,
      target: input.target,
      viewport,
      diagnostics: [
        "Preview verification requires a task ID and persisted browser preview target ID.",
        ...input.target.diagnostics,
      ],
    }
  }
  if (!input.target.url) {
    return {
      status: "failed",
      projectRoot,
      target: input.target,
      viewport,
      diagnostics: ["Preview verification requires a resolved http(s) URL.", ...input.target.diagnostics],
    }
  }

  const captureID = Identifier.ascending("artifact")
  const outDir =
    input.outDir ??
    ProjectRuntimePaths.taskAbsolute(projectRoot, input.taskID, "browser-preview", captureID, viewport.id)
  const { result, manifest } = input.captureForTest
    ? {
        result: await input.captureForTest({
          url: input.target.url,
          outDir,
          viewport_width: viewport.width,
          viewport_height: viewport.height,
          fileLabel: viewport.id,
          signal: input.signal,
        }),
        manifest: undefined,
      }
    : await captureWithBrowserEvidenceRunner({
        taskID: input.taskID,
        targetID: input.targetID,
        url: input.target.url,
        outDir,
        viewportID: viewport.id,
        signal: input.signal,
      })
  const status = result.captured && result.passed ? "passed" : "failed"
  const diagnostics = [result.summary]
  const evidenceID = persistBrowserPreviewEvidence({
    taskID: input.taskID,
    targetID: input.targetID,
    viewportID: viewport.id,
    status,
    summary: result.summary,
    capture: manifest ? { ...result, manifest } : result,
    diagnostics,
  })

  return {
    status,
    projectRoot,
    target: { ...input.target, latestEvidenceID: evidenceID },
    viewport,
    capture: manifest ? { ...result, manifest } : result,
    diagnostics,
  }
}

async function captureWithBrowserEvidenceRunner(input: {
  taskID: string
  targetID: string
  url: string
  outDir: string
  viewportID: BrowserPreviewViewportID
  signal?: AbortSignal
}): Promise<{ result: RuntimeCaptureResult; manifest?: BrowserEvidenceManifestSummary }> {
  const job = await runBrowserPreviewEvidenceJob({
    jobID: Identifier.ascending("artifact"),
    taskID: input.taskID,
    targetID: input.targetID,
    url: input.url,
    outDir: input.outDir,
    viewportIDs: [input.viewportID],
    signal: input.signal,
  })
  const result = job.captures[input.viewportID]
  if (!result) {
    throw new Error(`Browser preview evidence runner did not return viewport ${input.viewportID}`)
  }
  return { result, manifest: job.manifest }
}
