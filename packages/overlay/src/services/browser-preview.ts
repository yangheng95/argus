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
  latestEvidenceIDs?: Partial<Record<BrowserPreviewViewportID, string>>
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
  captures: Partial<
    Record<
      BrowserPreviewViewportID,
      {
        captured: boolean
        passed: boolean
        url: string
        summary: string
      }
    >
  >
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

type BrowserPreviewLiveFrameDecoder = (blob: Blob) => Promise<void>

let browserPreviewLiveFrameDecoder: BrowserPreviewLiveFrameDecoder = decodeBrowserPreviewLiveFrame

export function __setBrowserPreviewLiveFrameDecoderForTest(decoder: BrowserPreviewLiveFrameDecoder | undefined) {
  browserPreviewLiveFrameDecoder = decoder ?? decodeBrowserPreviewLiveFrame
}

function taskBrowserPreviewPath(taskID: string, directory: string, suffix = ""): string {
  const dir = directory.trim()
  if (!dir) throw new Error("browser preview service requires a task directory")
  const query = new URLSearchParams({ directory: dir })
  return `task/${encodeURIComponent(taskID)}/browser-preview${suffix}?${query.toString()}`
}

export async function loadTaskBrowserPreviewTarget(input: {
  taskID: string
  directory: string
  signal?: AbortSignal
}): Promise<BrowserPreviewTarget> {
  return (await apiJson(taskBrowserPreviewPath(input.taskID, input.directory), { signal: input.signal })) as BrowserPreviewTarget
}

export async function selectTaskBrowserPreviewTarget(input: {
  taskID: string
  directory: string
  targetID: string
  signal?: AbortSignal
}): Promise<BrowserPreviewTarget> {
  return (await apiJson(taskBrowserPreviewPath(input.taskID, input.directory, "/target"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetID: input.targetID }),
    signal: input.signal,
  })) as BrowserPreviewTarget
}

export async function captureTaskBrowserPreviewEvidence(input: {
  taskID: string
  directory: string
  targetID: string
  viewportIDs: BrowserPreviewViewportID[]
  signal?: AbortSignal
}): Promise<BrowserPreviewVerification> {
  return (await apiJson(taskBrowserPreviewPath(input.taskID, input.directory, "/capture"), {
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
  directory: string
  evidenceID: string
  signal?: AbortSignal
}): Promise<BrowserPreviewEvidence> {
  return (await apiJson(
    taskBrowserPreviewPath(input.taskID, input.directory, `/evidence/${encodeURIComponent(input.evidenceID)}`),
    { signal: input.signal },
  )) as BrowserPreviewEvidence
}

export async function loadTaskBrowserPreviewEvidenceCaptureObjectUrl(input: {
  taskID: string
  directory: string
  evidenceID: string
  signal?: AbortSignal
}): Promise<string> {
  const path = taskBrowserPreviewPath(
    input.taskID,
    input.directory,
    `/evidence/${encodeURIComponent(input.evidenceID)}/capture.png`,
  )
  const response = await apiRequest<Uint8Array>(path, {
    responseKind: "binary",
    signal: input.signal,
  })
  if (!response.ok) throw new ApiError(response.status, path, decodeBinaryBrowserPreviewErrorBody(response.body))
  const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "image/png"
  return URL.createObjectURL(new Blob([bytesToArrayBuffer(response.body)], { type: contentType }))
}

export async function loadTaskBrowserPreviewLiveSnapshotObjectUrl(input: {
  taskID: string
  directory: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  signal?: AbortSignal
}): Promise<string> {
  return browserPreviewLiveFrameObjectUrl(
    taskBrowserPreviewPath(input.taskID, input.directory, "/live/snapshot"),
    {
      targetID: input.targetID,
      viewportID: input.viewportID,
    },
    input.signal,
  )
}

export async function sendTaskBrowserPreviewLiveInputObjectUrl(input: {
  taskID: string
  directory: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  input: BrowserPreviewLiveInput
  signal?: AbortSignal
}): Promise<string> {
  return browserPreviewLiveFrameObjectUrl(
    taskBrowserPreviewPath(input.taskID, input.directory, "/live/input"),
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
  if (!response.ok) throw new ApiError(response.status, path, decodeBinaryBrowserPreviewErrorBody(response.body))
  const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "image/png"
  const blob = new Blob([bytesToArrayBuffer(response.body)], { type: contentType })
  await browserPreviewLiveFrameDecoder(blob)
  return URL.createObjectURL(blob)
}

async function decodeBrowserPreviewLiveFrame(blob: Blob): Promise<void> {
  if (typeof Image === "undefined") throw new Error("Browser preview live image decoder is unavailable.")
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    if (typeof image.decode !== "function") throw new Error("Browser preview live image decoder is unavailable.")
    await image.decode()
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("Browser preview live screenshot decoded without dimensions.")
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("decoder is unavailable")) throw new Error(message)
    throw new Error("Browser preview live screenshot failed to decode.")
  } finally {
    URL.revokeObjectURL(url)
  }
}

function decodeBinaryBrowserPreviewErrorBody(body: Uint8Array): unknown {
  const text = new TextDecoder().decode(body).trim()
  if (!text) return body
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}
