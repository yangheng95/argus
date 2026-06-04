import fs from "fs/promises"
import path from "path"
import crypto from "node:crypto"
import { renderPage, type RenderPageCapture, type RuntimeInteractionProbe } from "@/runtime/visual-page"

export const RUNTIME_CAPTURE_VIEWPORT_MAX = { width: 1440, height: 1080 } as const
export const RUNTIME_CAPTURE_DEFAULTS = {
  viewport_width: 1440,
  viewport_height: 1080,
  min_dom_descendants: 20,
  wait_timeout_ms: 30_000,
  settle_ms: 2_500,
} as const

export type RuntimeCaptureRequest = {
  url: string
  viewport_width?: number
  viewport_height?: number
  min_dom_descendants?: number
  expect_selectors?: string[]
  expect_texts?: string[]
  wait_for_selector?: string
  wait_timeout_ms?: number
  settle_ms?: number
}

export type NormalizedRuntimeCaptureRequest = Required<Omit<RuntimeCaptureRequest, "wait_for_selector">> & {
  wait_for_selector?: string
}

export type RuntimeCaptureInput = RuntimeCaptureRequest & {
  outDir: string
  referenceForViewport?: string
  browserExecutable?: string
  headless?: boolean
  probeInteractions?: boolean
  fileLabel?: string
  signal?: AbortSignal
}

export type RuntimeCaptureFailure = {
  captured: false
  passed: false
  url: string
  requested_viewport: { width: number; height: number }
  viewport: { width: number; height: number; capped: boolean }
  capture_error: { kind: "capture_failed"; message: string }
  summary: string
}

export type RuntimeCaptureSuccess = {
  captured: true
  passed: boolean
  url: string
  target_url: string
  path: string
  sha: string
  bytes: number
  size: { width: number; height: number }
  requested_viewport: { width: number; height: number }
  viewport: { width: number; height: number; capped: boolean }
  layers: RenderPageCapture["layers"]
  dom: {
    textLength: number
    nodeCount: number
    bodyDescendantCount: number
    hasBodyChildren: boolean
    isEmptyRootShell: boolean
  }
  interaction?: RuntimeInteractionProbe
  summary: string
}

export type RuntimeCaptureResult = RuntimeCaptureSuccess | RuntimeCaptureFailure

export function normalizeRuntimeCaptureViewport(input: { width: number; height: number }): {
  width: number
  height: number
  capped: boolean
} {
  const width = Math.min(input.width, RUNTIME_CAPTURE_VIEWPORT_MAX.width)
  const height = Math.min(input.height, RUNTIME_CAPTURE_VIEWPORT_MAX.height)
  return {
    width,
    height,
    capped: width !== input.width || height !== input.height,
  }
}

export function normalizeRuntimeCaptureRequest(args: RuntimeCaptureRequest): NormalizedRuntimeCaptureRequest {
  return {
    url: args.url,
    viewport_width: args.viewport_width ?? RUNTIME_CAPTURE_DEFAULTS.viewport_width,
    viewport_height: args.viewport_height ?? RUNTIME_CAPTURE_DEFAULTS.viewport_height,
    min_dom_descendants: args.min_dom_descendants ?? RUNTIME_CAPTURE_DEFAULTS.min_dom_descendants,
    expect_selectors: args.expect_selectors ?? [],
    expect_texts: args.expect_texts ?? [],
    wait_timeout_ms: args.wait_timeout_ms ?? RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms,
    settle_ms: args.settle_ms ?? RUNTIME_CAPTURE_DEFAULTS.settle_ms,
    ...(args.wait_for_selector ? { wait_for_selector: args.wait_for_selector } : {}),
  }
}

export async function captureRuntimePage(input: RuntimeCaptureInput): Promise<RuntimeCaptureResult> {
  const args = normalizeRuntimeCaptureRequest(input)
  const viewport = normalizeRuntimeCaptureViewport({
    width: args.viewport_width,
    height: args.viewport_height,
  })
  await fs.mkdir(input.outDir, { recursive: true })
  try {
    const useReferenceViewport =
      !!input.referenceForViewport && input.viewport_width === undefined && input.viewport_height === undefined
    const rendered = await renderPage({
      rendered: args.url,
      outDir: input.outDir,
      viewport: useReferenceViewport ? undefined : viewport,
      referenceForViewport: input.referenceForViewport,
      browserExecutable: input.browserExecutable,
      headless: input.headless,
      navigationTimeoutMs: args.wait_timeout_ms,
      settleMs: args.settle_ms,
      waitForSelector: args.wait_for_selector,
      minDomDescendants: args.min_dom_descendants,
      expectSelectors: args.expect_selectors,
      expectTexts: args.expect_texts,
      probeInteractions: input.probeInteractions,
      signal: input.signal,
    })
    const buf = await fs.readFile(rendered.renderedPath)
    const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)
    const finalPath = input.fileLabel
      ? path.join(input.outDir, `${sanitizeCaptureLabel(input.fileLabel)}-${sha}.png`)
      : rendered.renderedPath
    if (finalPath !== rendered.renderedPath) {
      await fs.rename(rendered.renderedPath, finalPath).catch(async () => {
        await fs.copyFile(rendered.renderedPath, finalPath)
      })
      rendered.capture.layers.pixel.screenshot_path = finalPath
    }
    const failedLayers = runtimeCaptureFailedLayers(rendered.capture.layers)
    const actualViewport = useReferenceViewport
      ? { width: rendered.viewport.width, height: rendered.viewport.height, capped: false }
      : viewport
    return {
      captured: true,
      passed: failedLayers.length === 0,
      url: args.url,
      target_url: rendered.capture.targetUrl,
      path: finalPath,
      sha,
      bytes: buf.length,
      size: rendered.size,
      requested_viewport: { width: args.viewport_width, height: args.viewport_height },
      viewport: actualViewport,
      layers: rendered.capture.layers,
      dom: rendered.dom,
      interaction: rendered.interaction,
      summary:
        failedLayers.length === 0
          ? `all runtime capture layers passed on ${args.url}`
          : `failed layers: ${failedLayers.join(", ")}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      captured: false,
      passed: false,
      url: args.url,
      requested_viewport: { width: args.viewport_width, height: args.viewport_height },
      viewport,
      capture_error: { kind: "capture_failed", message },
      summary: `runtime capture failed: ${message}`,
    }
  }
}

export function runtimeCaptureFailedLayers(layers: RenderPageCapture["layers"]): string[] {
  return Object.entries(layers)
    .filter(([, value]) => !value.passed)
    .map(([name]) => name)
}

function sanitizeCaptureLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40) || "capture"
}
