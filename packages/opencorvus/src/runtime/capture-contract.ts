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

export type RuntimeCaptureLayers = {
  http: { passed: boolean; status: number; content_type: string; body_length: number; reason: string }
  asset: { passed: boolean; total: number; failed: Array<{ url: string; status: number; reason: string }> }
  dom: { passed: boolean; body_descendants: number; required: number }
  js: { passed: boolean; console_errors: string[]; page_errors: string[] }
  pixel: { passed: boolean; variance: number; floor: number; screenshot_path: string }
  expected: { passed: boolean; missing_selectors: string[]; missing_texts: string[] }
}

export type RuntimeInteractionProbe = {
  visibleControlCount: number
  textInputCount: number
  fileInputCount: number
  attemptedInteractionCount: number
  textChanged: boolean
  htmlChanged: boolean
  errorCount: number
  errors: string[]
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
  layers: RuntimeCaptureLayers
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

export function runtimeCaptureFailedLayers(layers: RuntimeCaptureLayers): string[] {
  return Object.entries(layers)
    .filter(([, value]) => !value.passed)
    .map(([name]) => name)
}
