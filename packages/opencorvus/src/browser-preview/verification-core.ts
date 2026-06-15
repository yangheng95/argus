import path from "node:path"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import type { RuntimeCaptureResult } from "@/runtime/capture-contract"
import { Identifier } from "@/id/id"
import z from "zod"
import type { BrowserEvidenceManifestSummary } from "./evidence-runner"
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
export type BrowserPreviewCaptureSummary = z.infer<typeof BrowserPreviewCaptureSummary>

export const BrowserPreviewVerification = z.object({
  status: z.enum(["passed", "failed"]),
  projectRoot: z.string(),
  target: BrowserPreviewTarget,
  viewports: BrowserPreviewViewport.array(),
  captures: z.record(z.string(), BrowserPreviewCaptureSummary),
  evidenceIDs: z.record(z.string(), z.string()),
  diagnostics: z.string().array(),
})
export type BrowserPreviewVerification = z.infer<typeof BrowserPreviewVerification>

export type BrowserPreviewVerificationInput = {
  projectRoot: string
  target: BrowserPreviewTarget
  viewportIDs: BrowserPreviewViewportID[]
  taskID: string
  targetID: string
  signal?: AbortSignal
  outDir?: string
}

export type BrowserPreviewVerificationCaptureJobInput = {
  taskID: string
  targetID: string
  url: string
  outDir: string
  viewports: BrowserPreviewViewport[]
  viewportIDs: BrowserPreviewViewportID[]
  signal?: AbortSignal
}

export type BrowserPreviewVerificationCaptureJobResult = {
  captures: Record<string, RuntimeCaptureResult>
  manifest: BrowserEvidenceManifestSummary
}

export type BrowserPreviewVerificationCaptureJob = (
  input: BrowserPreviewVerificationCaptureJobInput,
) => Promise<BrowserPreviewVerificationCaptureJobResult>

export async function runBrowserPreviewVerification(
  input: BrowserPreviewVerificationInput,
  captureJob: BrowserPreviewVerificationCaptureJob,
): Promise<BrowserPreviewVerification> {
  const projectRoot = path.resolve(input.projectRoot)
  const viewportIDs = dedupeViewportIDs(input.viewportIDs)
  const viewports = viewportIDs.map((id) => browserPreviewViewportByID(id))
  if (viewports.length === 0) {
    return {
      status: "failed",
      projectRoot,
      target: input.target,
      viewports,
      captures: {},
      evidenceIDs: {},
      diagnostics: [
        "Preview verification requires at least one browser preview viewport.",
        ...input.target.diagnostics,
      ],
    }
  }
  if (!input.taskID || !input.targetID) {
    return {
      status: "failed",
      projectRoot,
      target: input.target,
      viewports,
      captures: {},
      evidenceIDs: {},
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
      viewports,
      captures: {},
      evidenceIDs: {},
      diagnostics: ["Preview verification requires a resolved http(s) URL.", ...input.target.diagnostics],
    }
  }

  const captureID = Identifier.ascending("artifact")
  const outDir =
    input.outDir ?? ProjectRuntimePaths.taskAbsolute(projectRoot, input.taskID, "browser-preview", captureID)
  const { captures, manifest } = await captureJob({
    taskID: input.taskID,
    targetID: input.targetID,
    url: input.target.url,
    outDir,
    viewports,
    viewportIDs,
    signal: input.signal,
  })
  const diagnostics = viewports.map(
    (viewport) => captures[viewport.id]?.summary ?? `missing capture for ${viewport.id}`,
  )
  const evidenceIDs: Record<string, string> = {}
  const responseCaptures: Record<string, BrowserPreviewCaptureSummary> = {}
  for (const viewport of viewports) {
    const result = captures[viewport.id]
    if (!result) continue
    responseCaptures[viewport.id] = { ...result, manifest }
    const status = result.captured && result.passed ? "passed" : "failed"
    evidenceIDs[viewport.id] = persistBrowserPreviewEvidence({
      taskID: input.taskID,
      targetID: input.targetID,
      viewportID: viewport.id,
      status,
      summary: result.summary,
      capture: responseCaptures[viewport.id],
      diagnostics: [result.summary],
    })
  }
  const status = viewports.every((viewport) => {
    const result = captures[viewport.id]
    return result?.captured && result.passed
  })
    ? "passed"
    : "failed"

  return {
    status,
    projectRoot,
    target: { ...input.target, latestEvidenceIDs: evidenceIDs },
    viewports,
    captures: responseCaptures,
    evidenceIDs,
    diagnostics,
  }
}

function dedupeViewportIDs(ids: BrowserPreviewViewportID[]): BrowserPreviewViewportID[] {
  const out: BrowserPreviewViewportID[] = []
  for (const id of ids) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}
