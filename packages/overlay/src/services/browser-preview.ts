import { apiJson } from "./api"

export interface BrowserPreviewViewport {
  id: "desktop" | "tablet" | "mobile"
  labelKey: string
  width: number
  height: number
}

export interface BrowserPreviewTarget {
  kind: "explicit-url" | "manifest-url" | "manifest-command" | "missing" | "failed"
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
  source: "query" | "package-json" | "none"
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

export async function loadBrowserPreviewTarget(url?: string): Promise<BrowserPreviewTarget> {
  const trimmed = url?.trim()
  const query = trimmed ? `?url=${encodeURIComponent(trimmed)}` : ""
  return await apiJson(`browser-preview/target${query}`) as BrowserPreviewTarget
}

export async function verifyBrowserPreviewTarget(input: {
  url?: string
  viewportID: BrowserPreviewViewportID
}): Promise<BrowserPreviewVerification> {
  return await apiJson("browser-preview/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.url ? { url: input.url } : {}),
      viewportID: input.viewportID,
    }),
  }) as BrowserPreviewVerification
}
