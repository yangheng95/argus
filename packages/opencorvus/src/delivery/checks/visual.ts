/**
 * Visual similarity evaluator — Browser Runtime screenshot + SSIM gate.
 *
 * The same logic that ships in `script/benchmark/visual-diff.ts` (which is
 * now a thin CLI wrapper) lives here as a library so the per-goal evaluator
 * can run it inside the orchestrator. Every fig2code-style task that lists a
 * visual reference automatically gets a structural-similarity check without
 * any external pipeline tooling.
 *
 * Behaviour matches the CLI (single source of truth for thresholds and the
 * SSIM map analysis):
 *   - Render a live http(s) target URL with Chromium at the reference's
 *     natural viewport (or a caller-supplied size).
 *   - Compare against the reference PNG using SSIM. Fail when either
 *     `mean SSIM < threshold` OR the worst-5% window SSIM (`p5`) drops below
 *     `worstThreshold` — protects against partial structural collapse that
 *     a generous mean would hide.
 *   - No fallback: missing browser, missing reference, or size-mismatched
 *     images all produce explicit failures.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import type { Page } from "playwright"
import { PNG } from "pngjs"
import ssim from "ssim.js"
import { isBrowserImplicitAssetRequest, isResourceLoadConsoleError } from "./browser-noise"
import { BrowserRuntime, findBrowserExecutable } from "@/browser/runtime"

export interface VisualDiffOptions {
  /** Live http(s) URL. File paths are intentionally rejected by renderPage. */
  rendered: string
  /** Absolute path to the reference PNG. */
  reference: string
  /** Force a specific browser viewport. Defaults to the reference image's
   *  native pixel size, which is the common case for fig2code. */
  viewport?: { width: number; height: number }
  /** Mean SSIM floor. Default 0.85. */
  threshold?: number
  /** Worst-5%-window SSIM floor. Default 0.55. */
  worstThreshold?: number
  /** Directory to write `rendered.png` and `diff.json`. Created if absent. */
  outDir: string
  /** Optional override for the chrome/edge executable. */
  browserExecutable?: string
  /** Override browser launch timeout. Default: 60_000ms. */
  browserLaunchTimeoutMs?: number
  /** Run Chromium headless. Default false to preserve overlay benchmark visual mode. */
  headless?: boolean
  /** Fall back to Chrome's CLI screenshot path when Playwright cannot launch. */
  chromeCliFallback?: boolean
}

export interface VisualDiffReport {
  passed: boolean
  /** "ok" if both gates passed, otherwise a categorical reason. */
  reason: "ok" | "size_mismatch" | "below_mean" | "below_worst" | "below_both"
  mssim: number
  threshold: number
  worstThreshold: number
  distribution: { min: number; p1: number; p5: number; p25: number; mean: number }
  gate: { meanPassed: boolean; worstPassed: boolean }
  viewport: { width: number; height: number }
  rendered: { path: string; width: number; height: number }
  reference: { path: string; width: number; height: number }
  ssimPerformanceMs: unknown
}

async function decodePNG(filePath: string): Promise<PNG> {
  const buf = await fs.readFile(filePath)
  return new Promise<PNG>((resolve, reject) => {
    const png = new PNG()
    png.parse(buf, (err, parsed) => (err ? reject(err) : resolve(parsed)))
  })
}

function pngLuminanceVariance(png: PNG): number {
  const data = png.data
  const stride = 64 * 4
  let sum = 0
  let sumSq = 0
  let samples = 0
  for (let i = 0; i + 2 < data.length; i += stride) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += lum
    sumSq += lum * lum
    samples += 1
  }
  if (samples === 0) return 0
  const mean = sum / samples
  return sumSq / samples - mean * mean
}

export interface RenderPageCapture {
  targetUrl: string
  layers: {
    http: { passed: boolean; status: number; content_type: string; body_length: number; reason: string }
    asset: { passed: boolean; total: number; failed: Array<{ url: string; status: number; reason: string }> }
    dom: { passed: boolean; body_descendants: number; required: number }
    js: { passed: boolean; console_errors: string[]; page_errors: string[] }
    pixel: { passed: boolean; variance: number; floor: number; screenshot_path: string }
    expected: { passed: boolean; missing_selectors: string[]; missing_texts: string[] }
  }
}

/** Pure-render API — renders an HTML/URL target into `<outDir>/rendered.png`
 *  and returns the absolute path. No SSIM / no comparison. The delivery
 *  pipeline uses this to hand the LLM a screenshot of the actual built
 *  artifact; the LLM then compares it against the reference image via its
 *  vision capability (far more actionable than a single SSIM number).
 *
 *  `referenceForViewport` lets callers match the reference image's native
 *  size when known — otherwise callers must supply an explicit `viewport`.
 *  One of the two MUST be provided; this helper throws otherwise so we
 *  don't silently render at an arbitrary default. */
export async function renderPage(opts: {
  rendered: string
  outDir: string
  viewport?: { width: number; height: number }
  referenceForViewport?: string
  browserExecutable?: string
  /** Override browser launch timeout. Default: 60_000ms. */
  browserLaunchTimeoutMs?: number
  /** Run Chromium headless. Default false to preserve overlay benchmark visual mode. */
  headless?: boolean
  /** Fall back to Chrome's CLI screenshot path when Playwright cannot launch. */
  chromeCliFallback?: boolean
  /** Override browser page.goto navigation timeout. Default: 90_000ms. */
  navigationTimeoutMs?: number
  /** Extra settle delay after window load. Default: 2_500ms. */
  settleMs?: number
  /** Optional selector that must appear before assertions are evaluated. */
  waitForSelector?: string
  /** Minimum body descendant count for integrity checks. */
  minDomDescendants?: number
  /** CSS selectors expected to exist after render. */
  expectSelectors?: string[]
  /** Text fragments expected in document.body.textContent after render. */
  expectTexts?: string[]
  /** Run a generic user-interaction probe in the same browser page after first paint. */
  probeInteractions?: boolean
}): Promise<{
  renderedPath: string
  viewport: { width: number; height: number }
  size: { width: number; height: number }
  /** DOM 实证指标：与 screenshot 同一轮 render 采集，避免下游再开一次 browser（rule 22）。 */
  dom: {
    textLength: number
    nodeCount: number
    bodyDescendantCount: number
    hasBodyChildren: boolean
    /** React 根「<div id=\"root\"></div>」空壳（未 hydrate / hydrate 了空 App）。 */
    isEmptyRootShell: boolean
  }
  interaction?: RuntimeInteractionProbe
  capture: RenderPageCapture
}> {
  let viewport = opts.viewport
  if (!viewport) {
    if (!opts.referenceForViewport) {
      throw new Error("renderPage: one of `viewport` or `referenceForViewport` is required")
    }
    await fs.access(opts.referenceForViewport).catch(() => {
      throw new Error(`renderPage: reference image not found: ${opts.referenceForViewport}`)
    })
    const refImg = await decodePNG(opts.referenceForViewport)
    viewport = { width: refImg.width, height: refImg.height }
  }
  await fs.mkdir(opts.outDir, { recursive: true })

  if (!/^https?:\/\//i.test(opts.rendered)) {
    throw new Error(`renderPage: delivery rendering is URL-only; start the app yourself, then pass its http(s) URL. Received: ${opts.rendered}`)
  }
  const target = opts.rendered

  let browser
  try {
    browser = await BrowserRuntime.launchPlaywrightBrowser({
      executablePath: opts.browserExecutable,
      headless: opts.headless ?? false,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      timeoutMs: opts.browserLaunchTimeoutMs ?? Number(process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? 60_000),
    })
  } catch (error) {
    if (!opts.chromeCliFallback) throw error
    return renderPageWithChromeCli({
      target,
      viewport,
      outDir: opts.outDir,
      browserExecutable: opts.browserExecutable,
      navigationTimeoutMs: opts.navigationTimeoutMs,
    })
  }
  const renderedPath = path.join(opts.outDir, "rendered.png")
  let dom: {
    textLength: number
    nodeCount: number
    bodyDescendantCount: number
    hasBodyChildren: boolean
    isEmptyRootShell: boolean
  }
  let interaction: RuntimeInteractionProbe | undefined
  let capture: RenderPageCapture | undefined
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    const failedRequests: Array<{ url: string; status: number; reason: string }> = []
    let totalResponses = 0
    page.on("response", (res) => {
      totalResponses += 1
      const status = res.status()
      if (status >= 400 && status < 600 && !isBrowserImplicitAssetRequest(res.url())) {
        failedRequests.push({ url: res.url(), status, reason: res.statusText() || `HTTP ${status}` })
      }
    })
    page.on("requestfailed", (req) => {
      if (isBrowserImplicitAssetRequest(req.url())) return
      failedRequests.push({ url: req.url(), status: 0, reason: req.failure()?.errorText ?? "request failed" })
    })
    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() !== "error") return
      const text = msg.text().slice(0, 400)
      // Network-load failures are owned by the asset layer (single source);
      // Chromium's mirrored "Failed to load resource" console error is not an
      // app JS fault.
      if (isResourceLoadConsoleError(text)) return
      consoleErrors.push(text)
    })
    const pageErrors: string[] = []
    page.on("pageerror", (err) => {
      const e = err as Error
      pageErrors.push(e.message?.slice(0, 400) ?? String(err))
    })
    await page.exposeFunction("__opencorvusCaptureUnhandledRejection", (message: string) => {
      pageErrors.push(`unhandledrejection: ${message}`.slice(0, 400))
    })
    await page.addInitScript(() => {
      const globalWindow = window as unknown as {
        __opencorvusCaptureUnhandledRejection?: (message: string) => void
      }
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason
        const message = reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : JSON.stringify(reason)
        globalWindow.__opencorvusCaptureUnhandledRejection?.(message)
      })
    })
    // A live preview URL can still need a non-trivial first-paint window once
    // the server accepts connections. Configurable via opts.navigationTimeoutMs
    // so benchmarks with slower runners can override without editing source.
    const navigationTimeoutMs = opts.navigationTimeoutMs ?? 90_000
    // `load` (window.onload) instead of `networkidle0`: live frontend previews
    // commonly keep websockets open indefinitely, so network-idle is not a
    // faithful completion signal for a rendered interactive page.
    // `load` fires when DOM + initial CSS/JS/fonts are loaded, which is
    // sufficient for a faithful screenshot. The settle wait below covers
    // React hydration that runs after the load event.
    const response = await page.goto(target, { waitUntil: "load", timeout: navigationTimeoutMs })
    const status = response?.status() ?? 0
    const contentType = String(response?.headers()["content-type"] ?? "").toLowerCase()
    const bodyBuf = response ? await response.body().catch(() => Buffer.alloc(0)) : Buffer.alloc(0)
    let httpReason = ""
    if (status < 200 || status >= 300) {
      httpReason = `status=${status}`
    } else if (!contentType.includes("text/html")) {
      httpReason = `content-type=${contentType || "(missing)"} — app root must serve text/html`
    } else if (bodyBuf.length < 200) {
      httpReason = `body=${bodyBuf.length}B — too small to be an app shell`
    }
    let missingWaitSelector: string | undefined
    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: navigationTimeoutMs }).catch(() => {
        missingWaitSelector = opts.waitForSelector
      })
    }
    // React/Vue/SPA hydration often fires after `load`. Without this delay
    // the screenshot can capture the un-hydrated shell ("Loading…" / empty
    // root). 2.5s is a conservative cap — most apps hydrate in <500ms but
    // a cold first-paint with code-splitting can stretch to 1-2s.
    await new Promise((r) => setTimeout(r, opts.settleMs ?? 2_500))
    const collectDom = () => page.evaluate(() => {
      const body = document.body
      const text = body ? (body.innerText ?? "").trim() : ""
      const nodeCount = document.querySelectorAll("*").length
      const bodyDescendantCount = body ? body.getElementsByTagName("*").length : 0
      const hasBodyChildren = !!body && body.children.length > 0
      // 检测 Vite/CRA 空壳：`<div id="root">` 是 body 的唯一非脚本子元素且其内部
      // 元素 <= 1。React SPA 渲染失败 / 未 hydrate / hydrate 了空 App 都会命中。
      const isEmptyRootShell = (() => {
        if (!body) return true
        const elementChildren = Array.from(body.children).filter(
          (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE" && c.tagName !== "NOSCRIPT",
        )
        if (elementChildren.length !== 1) return false
        const sole = elementChildren[0] as HTMLElement
        if (sole.id !== "root" && sole.id !== "app" && sole.id !== "__next") return false
        return sole.querySelectorAll("*").length <= 1
      })()
      return {
        textLength: text.length,
        nodeCount,
        bodyDescendantCount,
        hasBodyChildren,
        isEmptyRootShell,
      }
    })
    dom = await collectDom()
    if (opts.probeInteractions) {
      interaction = await probeRuntimeInteractions(page)
      if (interaction.textChanged || interaction.htmlChanged) {
        dom = await collectDom()
      }
    }
    await page.screenshot({
      path: renderedPath,
      type: "png",
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    })
    const rendered = await decodePNG(renderedPath)
    const variance = pngLuminanceVariance(rendered)
    const missingSelectors: string[] = []
    for (const sel of opts.expectSelectors ?? []) {
      const found = await page.$(sel).then((e) => !!e).catch(() => false)
      if (!found) missingSelectors.push(sel)
    }
    if (missingWaitSelector && !missingSelectors.includes(missingWaitSelector)) {
      missingSelectors.push(missingWaitSelector)
    }
    const bodyText = await page.evaluate(() => document.body?.textContent ?? "")
    const missingTexts = (opts.expectTexts ?? []).filter((text) => !bodyText.includes(text))
    const requiredDomDescendants = opts.minDomDescendants ?? 1
    capture = {
      targetUrl: target,
      layers: {
        http: {
          passed: status >= 200 && status < 300 && contentType.includes("text/html") && bodyBuf.length >= 200,
          status,
          content_type: contentType,
          body_length: bodyBuf.length,
          reason: httpReason,
        },
        asset: {
          passed: failedRequests.length === 0,
          total: totalResponses,
          failed: failedRequests,
        },
        dom: {
          passed: dom.bodyDescendantCount >= requiredDomDescendants,
          body_descendants: dom.bodyDescendantCount,
          required: requiredDomDescendants,
        },
        js: {
          passed: consoleErrors.length === 0 && pageErrors.length === 0,
          console_errors: consoleErrors,
          page_errors: pageErrors,
        },
        pixel: {
          passed: variance >= 25,
          variance: Number(variance.toFixed(2)),
          floor: 25,
          screenshot_path: renderedPath,
        },
        expected: {
          passed: missingSelectors.length === 0 && missingTexts.length === 0,
          missing_selectors: missingSelectors,
          missing_texts: missingTexts,
        },
      },
    }
  } finally {
    await browser.close()
  }
  if (!capture) {
    throw new Error("renderPage: capture was not produced")
  }
  const rendered = await decodePNG(renderedPath)
  return {
    renderedPath,
    viewport,
    size: { width: rendered.width, height: rendered.height },
    dom,
    interaction,
    capture,
  }
}

async function renderPageWithChromeCli(opts: {
  target: string
  viewport: { width: number; height: number }
  outDir: string
  browserExecutable?: string
  navigationTimeoutMs?: number
}): Promise<{
  renderedPath: string
  viewport: { width: number; height: number }
  size: { width: number; height: number }
  dom: {
    textLength: number
    nodeCount: number
    bodyDescendantCount: number
    hasBodyChildren: boolean
    isEmptyRootShell: boolean
  }
  capture: RenderPageCapture
}> {
  const chromePath = await findBrowserExecutable(opts.browserExecutable)
  const renderedPath = path.join(opts.outDir, "rendered.png")
  await fs.rm(renderedPath, { force: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn(chromePath, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--virtual-time-budget=${opts.navigationTimeoutMs ?? 5_000}`,
      `--screenshot=${renderedPath}`,
      `--window-size=${opts.viewport.width},${opts.viewport.height}`,
      opts.target,
    ], { stdio: "ignore", windowsHide: true })
    child.on("error", reject)
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Chrome CLI screenshot exited with code ${code}`)))
  })
  const rendered = await decodePNG(renderedPath)
  const variance = pngLuminanceVariance(rendered)
  const dom = {
    textLength: 0,
    nodeCount: 0,
    bodyDescendantCount: 0,
    hasBodyChildren: false,
    isEmptyRootShell: false,
  }
  return {
    renderedPath,
    viewport: opts.viewport,
    size: { width: rendered.width, height: rendered.height },
    dom,
    capture: {
      targetUrl: opts.target,
      layers: {
        http: { passed: true, status: 200, content_type: "unknown", body_length: 0, reason: "chrome-cli-fallback" },
        asset: { passed: true, total: 0, failed: [] },
        dom: { passed: true, body_descendants: 0, required: 0 },
        js: { passed: true, console_errors: [], page_errors: [] },
        pixel: {
          passed: variance >= 25,
          variance: Number(variance.toFixed(2)),
          floor: 25,
          screenshot_path: renderedPath,
        },
        expected: { passed: true, missing_selectors: [], missing_texts: [] },
      },
    },
  }
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

async function probeRuntimeInteractions(page: Page): Promise<RuntimeInteractionProbe> {
  const before = await page.evaluate(() => ({
    text: document.body?.innerText ?? "",
    html: document.body?.innerHTML ?? "",
  }))
  const seen = new Set<string>()
  const errors: string[] = []
  let attempted = 0
  let visibleControlCount = 0
  let textInputCount = 0
  let fileInputCount = 0

  for (let round = 0; round < 3; round++) {
    const controls = await page.evaluate(() => {
      const state = window as unknown as { __opencorvusRuntimeProbeNext?: number }
      state.__opencorvusRuntimeProbeNext ??= 0
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      }
      const elements = Array.from(document.querySelectorAll(
        "button,a[href],input,textarea,select,[role='button'],[contenteditable='true']",
      )).filter((el) => visible(el))
      return elements.map((el) => {
        let id = el.getAttribute("data-opencorvus-runtime-probe-id")
        if (!id) {
          const next = state.__opencorvusRuntimeProbeNext ?? 0
          id = String(next)
          state.__opencorvusRuntimeProbeNext = next + 1
          el.setAttribute("data-opencorvus-runtime-probe-id", id)
        }
        const selector = `[data-opencorvus-runtime-probe-id="${id}"]`
        const isFileInput = el instanceof HTMLInputElement && (el.type || "").toLowerCase() === "file"
        const isTextInput = el instanceof HTMLTextAreaElement
          || (el instanceof HTMLInputElement
            && ["email", "password", "search", "text", "url"].includes((el.type || "text").toLowerCase()))
        return { id, selector, isTextInput, isFileInput }
      })
    })
    visibleControlCount = Math.max(visibleControlCount, controls.length)
    const roundTextInputCount = controls.filter((item) => item.isTextInput).length
    textInputCount = Math.max(textInputCount, roundTextInputCount)
    fileInputCount = Math.max(fileInputCount, controls.filter((item) => item.isFileInput).length)

    for (const item of controls.filter((control) => control.isTextInput).slice(0, 3)) {
      try {
        await page.click(item.selector, { delay: 10 })
        await page.keyboard.down("Control")
        await page.keyboard.press("KeyA")
        await page.keyboard.up("Control")
        await page.keyboard.type("opencorvus runtime probe", { delay: 5 })
        attempted++
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    const clickTargets = controls
      .filter((item) => !item.isFileInput && !seen.has(item.id))
      .slice(0, 5)
    if (clickTargets.length === 0 && roundTextInputCount === 0) break
    for (const item of clickTargets) {
      seen.add(item.id)
      try {
        await page.click(item.selector, { delay: 20 })
        attempted++
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200))
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000))

  const after = await page.evaluate(() => ({
    text: document.body?.innerText ?? "",
    html: document.body?.innerHTML ?? "",
  }))
  return {
    visibleControlCount,
    textInputCount,
    fileInputCount,
    attemptedInteractionCount: attempted,
    textChanged: before.text !== after.text,
    htmlChanged: before.html !== after.html,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
  }
}

/** SSIM visual diff — retained for the external benchmark CLI and operator
 *  verification workflows only. The delivery pipeline no longer gates on
 *  SSIM: the LLM compares rendered vs reference via vision (see `renderPage`
 *  + integrity acceptance multimodal attachments), which produces actionable
 *  "header is missing N button, sidebar 20px too wide" feedback instead of
 *  a single opaque similarity number. */
export async function runVisualDiff(opts: VisualDiffOptions): Promise<VisualDiffReport> {
  const threshold = opts.threshold ?? 0.85
  const worstThreshold = opts.worstThreshold ?? 0.55
  for (const [name, value] of [["threshold", threshold], ["worstThreshold", worstThreshold]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`runVisualDiff: invalid ${name} (expected 0..1): ${value}`)
    }
  }
  await fs.access(opts.reference).catch(() => {
    throw new Error(`runVisualDiff: reference image not found: ${opts.reference}`)
  })

  const refImgProbe = await decodePNG(opts.reference)
  const { renderedPath, viewport } = await renderPage({
    rendered: opts.rendered,
    outDir: opts.outDir,
    viewport: opts.viewport ?? { width: refImgProbe.width, height: refImgProbe.height },
    browserExecutable: opts.browserExecutable,
    browserLaunchTimeoutMs: opts.browserLaunchTimeoutMs,
    headless: opts.headless,
    chromeCliFallback: opts.chromeCliFallback,
  })

  const rendImg = await decodePNG(renderedPath)
  const refImg = refImgProbe
  if (rendImg.width !== refImg.width || rendImg.height !== refImg.height) {
    const report: VisualDiffReport = {
      passed: false,
      reason: "size_mismatch",
      mssim: Number.NaN,
      threshold,
      worstThreshold,
      distribution: { min: Number.NaN, p1: Number.NaN, p5: Number.NaN, p25: Number.NaN, mean: Number.NaN },
      gate: { meanPassed: false, worstPassed: false },
      viewport,
      rendered: { path: renderedPath, width: rendImg.width, height: rendImg.height },
      reference: { path: path.resolve(opts.reference), width: refImg.width, height: refImg.height },
      ssimPerformanceMs: undefined,
    }
    await fs.writeFile(path.join(opts.outDir, "diff.json"), JSON.stringify(report, null, 2))
    return report
  }

  // pngjs returns `Buffer` for `data`; ssim.js types it as `Uint8ClampedArray`.
  // The bytes are bit-identical RGBA, so a structural cast is safe — no copy.
  const { mssim, ssim_map, performance } = ssim(
    { data: rendImg.data as unknown as Uint8ClampedArray, width: rendImg.width, height: rendImg.height },
    { data: refImg.data as unknown as Uint8ClampedArray, width: refImg.width, height: refImg.height },
  )
  const mapData = ssim_map?.data ? Array.from(ssim_map.data as Float32Array | number[]) : []
  mapData.sort((a, b) => a - b)
  const percentile = (p: number) =>
    mapData.length === 0 ? Number.NaN : mapData[Math.min(mapData.length - 1, Math.floor(p * mapData.length))]
  const minSSIM = mapData[0] ?? Number.NaN
  const p1 = percentile(0.01)
  const p5 = percentile(0.05)
  const p25 = percentile(0.25)

  const meanPassed = mssim >= threshold
  const worstPassed = Number.isFinite(p5) ? p5 >= worstThreshold : false
  const passed = meanPassed && worstPassed
  const reason: VisualDiffReport["reason"] = passed
    ? "ok"
    : !meanPassed && !worstPassed
      ? "below_both"
      : !meanPassed
        ? "below_mean"
        : "below_worst"

  const report: VisualDiffReport = {
    passed,
    reason,
    mssim,
    threshold,
    worstThreshold,
    distribution: { min: minSSIM, p1, p5, p25, mean: mssim },
    gate: { meanPassed, worstPassed },
    viewport,
    rendered: { path: renderedPath, width: rendImg.width, height: rendImg.height },
    reference: { path: path.resolve(opts.reference), width: refImg.width, height: refImg.height },
    ssimPerformanceMs: performance,
  }
  await fs.writeFile(path.join(opts.outDir, "diff.json"), JSON.stringify(report, null, 2))
  return report
}

/** Format a `VisualDiffReport` as a one-line evidence string suitable for
 *  CheckResult.output / EvaluationCheck.evidence. */
export function summarizeVisualReport(report: VisualDiffReport): string {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "n/a")
  if (report.reason === "size_mismatch") {
    return `size mismatch — rendered=${report.rendered.width}x${report.rendered.height} reference=${report.reference.width}x${report.reference.height}`
  }
  return `mean=${fmt(report.mssim)} (≥${report.threshold}) p5=${fmt(report.distribution.p5)} (≥${report.worstThreshold}) min=${fmt(report.distribution.min)}`
}
