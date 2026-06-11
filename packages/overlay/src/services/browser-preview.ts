import { ApiError, apiJson, apiRequest } from "./api"
import { bytesToArrayBuffer } from "../utils/binary"

export interface BrowserPreviewViewport {
  id: "desktop" | "tablet" | "mobile"
  labelKey: string
  width: number
  height: number
}

export interface BrowserPreviewCandidate {
  id: string
  url: string
  source: "task-artifact"
  selected: boolean
  timeUpdated: number
}

export interface BrowserPreviewTarget {
  id?: string
  taskID?: string
  latestEvidenceID?: string
  kind: "task-url" | "missing" | "failed"
  status: "ready" | "missing" | "failed"
  projectRoot: string
  /**
   * URL means Uniform Resource Locator. The backend supplies it explicitly;
   * the overlay never infers ports or server paths.
   */
  url?: string
  viewports: BrowserPreviewViewport[]
  diagnostics: string[]
  candidates: BrowserPreviewCandidate[]
  source: "task-artifact" | "none"
}

export interface BrowserPreviewVerification {
  status: "passed" | "failed"
  projectRoot: string
  target: BrowserPreviewTarget
  viewports: BrowserPreviewViewport[]
  captures: Partial<Record<BrowserPreviewViewportID, {
    captured: boolean
    passed: boolean
    url: string
    summary: string
    path?: string
  }>>
  evidenceIDs: Partial<Record<BrowserPreviewViewportID, string>>
  diagnostics: string[]
}

export interface BrowserPreviewEvidence {
  id: string
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  status: "passed" | "failed"
  summary: string
  capture?: {
    captured?: boolean
    passed?: boolean
    url?: string
    summary?: string
    path?: string
    sha?: string
    bytes?: number
  }
  diagnostics: string[]
  timeCompleted: number
  timeCreated: number
}

export type BrowserPreviewViewportID = BrowserPreviewViewport["id"]

export type BrowserPreviewLiveInput =
  | { kind: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "key"; key: string }

export async function loadTaskBrowserPreviewTarget(
  taskID: string,
  signal?: AbortSignal,
): Promise<BrowserPreviewTarget> {
  return (await apiJson(`task/${encodeURIComponent(taskID)}/browser-preview`, { signal })) as BrowserPreviewTarget
}

export async function selectTaskBrowserPreviewTarget(input: {
  taskID: string
  targetID: string
  signal?: AbortSignal
}): Promise<BrowserPreviewTarget> {
  return (await apiJson(`task/${encodeURIComponent(input.taskID)}/browser-preview/target`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetID: input.targetID }),
    signal: input.signal,
  })) as BrowserPreviewTarget
}

export async function captureTaskBrowserPreviewEvidence(input: {
  taskID: string
  targetID: string
  viewportIDs: BrowserPreviewViewportID[]
  signal?: AbortSignal
}): Promise<BrowserPreviewVerification> {
  return (await apiJson(`task/${encodeURIComponent(input.taskID)}/browser-preview/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetID: input.targetID,
      viewportIDs: input.viewportIDs,
    }),
    signal: input.signal,
  })) as BrowserPreviewVerification
}

export async function loadTaskBrowserPreviewEvidence(input: {
  taskID: string
  evidenceID: string
  signal?: AbortSignal
}): Promise<BrowserPreviewEvidence> {
  return (await apiJson(
    `task/${encodeURIComponent(input.taskID)}/browser-preview/evidence/${encodeURIComponent(input.evidenceID)}`,
    { signal: input.signal },
  )) as BrowserPreviewEvidence
}

export async function loadTaskBrowserPreviewEvidenceCaptureObjectUrl(input: {
  taskID: string
  evidenceID: string
  signal?: AbortSignal
}): Promise<string> {
  const path = `task/${encodeURIComponent(input.taskID)}/browser-preview/evidence/${encodeURIComponent(input.evidenceID)}/capture.png`
  const response = await apiRequest<Uint8Array>(path, {
    responseKind: "binary",
    signal: input.signal,
  })
  if (!response.ok) throw new ApiError(response.status, path, response.body)
  const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "image/png"
  return URL.createObjectURL(new Blob([bytesToArrayBuffer(response.body)], { type: contentType }))
}

export async function loadTaskBrowserPreviewLiveSnapshotObjectUrl(input: {
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  signal?: AbortSignal
}): Promise<string> {
  return browserPreviewLiveFrameObjectUrl(
    `task/${encodeURIComponent(input.taskID)}/browser-preview/live/snapshot`,
    {
      targetID: input.targetID,
      viewportID: input.viewportID,
    },
    input.signal,
  )
}

export async function sendTaskBrowserPreviewLiveInputObjectUrl(input: {
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  input: BrowserPreviewLiveInput
  signal?: AbortSignal
}): Promise<string> {
  return browserPreviewLiveFrameObjectUrl(
    `task/${encodeURIComponent(input.taskID)}/browser-preview/live/input`,
    {
      targetID: input.targetID,
      viewportID: input.viewportID,
      input: input.input,
    },
    input.signal,
  )
}

async function browserPreviewLiveFrameObjectUrl(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const response = await apiRequest<Uint8Array>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    responseKind: "binary",
    signal,
  })
  if (!response.ok) throw new ApiError(response.status, path, response.body)
  const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "image/png"
  return URL.createObjectURL(new Blob([bytesToArrayBuffer(response.body)], { type: contentType }))
}
