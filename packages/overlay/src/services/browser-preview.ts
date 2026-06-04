import { apiJson } from "./api"

export interface BrowserPreviewViewport {
  id: "desktop" | "tablet" | "mobile"
  labelKey: string
  width: number
  height: number
}

export interface BrowserPreviewTarget {
  id?: string
  taskID?: string
  latestEvidenceID?: string
  kind: "task-url" | "explicit-url" | "manifest-url" | "manifest-command" | "missing" | "failed"
  status: "ready" | "configured" | "missing" | "failed"
  projectRoot: string
  /**
   * URL means Uniform Resource Locator. The backend supplies it explicitly;
   * the overlay never infers ports or server paths.
   */
  url?: string
  command?: string
  packageManager?: string
  viewports: BrowserPreviewViewport[]
  diagnostics: string[]
  source: "task-artifact" | "explicit" | "package-json" | "none"
}

export interface BrowserPreviewVerification {
  status: "passed" | "failed"
  projectRoot: string
  target: BrowserPreviewTarget
  viewport: BrowserPreviewViewport
  capture?: {
    captured: boolean
    passed: boolean
    url: string
    summary: string
    path?: string
  }
  diagnostics: string[]
}

export type BrowserPreviewViewportID = BrowserPreviewViewport["id"]

export async function loadTaskBrowserPreviewTarget(taskID: string, signal?: AbortSignal): Promise<BrowserPreviewTarget> {
  return await apiJson(`task/${encodeURIComponent(taskID)}/browser-preview`, { signal }) as BrowserPreviewTarget
}

export async function saveTaskBrowserPreviewTarget(input: {
  taskID: string
  url: string
  signal?: AbortSignal
}): Promise<BrowserPreviewTarget> {
  return await apiJson(`task/${encodeURIComponent(input.taskID)}/browser-preview/target`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input.url }),
    signal: input.signal,
  }) as BrowserPreviewTarget
}

export async function captureTaskBrowserPreviewEvidence(input: {
  taskID: string
  targetID?: string
  viewportID: BrowserPreviewViewportID
  signal?: AbortSignal
}): Promise<BrowserPreviewVerification> {
  return await apiJson(`task/${encodeURIComponent(input.taskID)}/browser-preview/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.targetID ? { targetID: input.targetID } : {}),
      viewportID: input.viewportID,
    }),
    signal: input.signal,
  }) as BrowserPreviewVerification
}
