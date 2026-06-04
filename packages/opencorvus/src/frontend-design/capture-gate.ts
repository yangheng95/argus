/**
 * Reference capture and diagnostics.
 *
 * This module is the single capture path for live URL visual references.
 * Browser/navigation/screenshot failures are real acquisition failures and
 * still throw. Pixel-density heuristics are diagnostics only: they are useful
 * evidence for later investigation, but they must not block the workflow.
 */
import z from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { BrowserRuntime } from "@/browser/runtime"
import { runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { resolveBrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import {
  decodePNGBuffer,
  nonWhiteDensity,
  uniqueColorBucketCount,
  topKPalette,
} from "@/util/pixel-stats"

/** Chart / sidebar / toolbar 等关键区域的 bbox（CSS 像素）。 */
export const CaptureBbox = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})
export type CaptureBboxType = z.infer<typeof CaptureBbox>

/**
 * Frontend-design 采集阶段产出的权威 manifest。
 * 作为下游 goal / acceptance / evaluator 的只读事实源（禁自造锚点，rule 11）。
 */
export const CaptureManifest = z.object({
  url: z.string().url(),
  viewport: z.object({
    width: z.number().int().min(100).max(4096),
    height: z.number().int().min(100).max(4096),
    device_scale_factor: z.number().min(0.5).max(4).default(1),
  }),
  captured_at: z.number().int(),
  duration_ms: z.number().int().min(0),

  screenshot_sha256: z.string().length(64),
  dom_sha256: z.string().length(64),

  screenshot_byte_size: z.number().int().min(0),
  har_byte_size: z.number().int().min(0),

  non_white_pixel_ratio: z.number().min(0).max(1),
  unique_color_count: z.number().int().min(0),
  text_length: z.number().int().min(0),

  reference_strings: z.array(z.string().min(1)),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  layout: z.record(z.string(), CaptureBbox),

  tool_version: z.object({
    browserRuntime: z.string().optional(),
    chrome: z.string().optional(),
  }),
})
export type CaptureManifestType = z.infer<typeof CaptureManifest>

/** Diagnostic thresholds. These produce warnings, never workflow failures. */
export const CAPTURE_DIAGNOSTIC_THRESHOLDS = {
  min_byte_size: 20_480,
  min_non_white_pixel_ratio: 0.05,
  min_unique_color_count: 16,
  min_sparse_text_length: 20,
} as const

export interface CaptureDiagnosticWarning {
  field: "screenshot_byte_size" | "non_white_pixel_ratio" | "unique_color_count"
  threshold: number
  observed: number
}

export class CaptureReferenceError extends Error {
  override readonly cause?: unknown
  constructor(
    message: string,
    readonly stage: "browser" | "navigate" | "content_paint" | "screenshot" | "stats",
    cause?: unknown,
  ) {
    super(message)
    this.name = "CaptureReferenceError"
    this.cause = cause
  }
}

export function assessCaptureDiagnostics(manifest: CaptureManifestType): CaptureDiagnosticWarning[] {
  const warnings: CaptureDiagnosticWarning[] = []
  const hasSparsePageEvidence =
    manifest.text_length >= CAPTURE_DIAGNOSTIC_THRESHOLDS.min_sparse_text_length ||
    manifest.reference_strings.length >= 3 ||
    Object.keys(manifest.layout).length > 0
  if (manifest.screenshot_byte_size < CAPTURE_DIAGNOSTIC_THRESHOLDS.min_byte_size) {
    warnings.push({
      field: "screenshot_byte_size",
      threshold: CAPTURE_DIAGNOSTIC_THRESHOLDS.min_byte_size,
      observed: manifest.screenshot_byte_size,
    })
  }
  if (
    manifest.non_white_pixel_ratio < CAPTURE_DIAGNOSTIC_THRESHOLDS.min_non_white_pixel_ratio &&
    !hasSparsePageEvidence
  ) {
    warnings.push({
      field: "non_white_pixel_ratio",
      threshold: CAPTURE_DIAGNOSTIC_THRESHOLDS.min_non_white_pixel_ratio,
      observed: manifest.non_white_pixel_ratio,
    })
  }
  if (manifest.unique_color_count < CAPTURE_DIAGNOSTIC_THRESHOLDS.min_unique_color_count) {
    warnings.push({
      field: "unique_color_count",
      threshold: CAPTURE_DIAGNOSTIC_THRESHOLDS.min_unique_color_count,
      observed: manifest.unique_color_count,
    })
  }
  return warnings
}

export function assessCaptureManifest(manifest: CaptureManifestType): {
  ok: true
  manifest: CaptureManifestType
  diagnostics: CaptureDiagnosticWarning[]
} {
  return { ok: true, manifest, diagnostics: assessCaptureDiagnostics(manifest) }
}

export function summarizeCaptureDiagnostics(warnings: readonly CaptureDiagnosticWarning[]): string {
  return warnings
    .map((v) => `${v.field}=${typeof v.observed === "number" ? v.observed : String(v.observed)} < ${v.threshold}`)
    .join("; ")
}

// ---------------------------------------------------------------------------
// captureReferenceManifest — 实采实现
// ---------------------------------------------------------------------------

export interface CaptureResult {
  manifest: CaptureManifestType
  /** 当次采集的 PNG 字节；调用方可直接作为 attachment 不必再读盘。 */
  screenshotPng: Buffer
  /** 落盘位置（outDir/screenshot.png，outDir/manifest.json，outDir/dom.html）。 */
  artifactPaths: {
    manifestJson: string
    screenshotPng: string
    domHtml: string
  }
}

type BrowserEvidence = {
  screenshotPng: Buffer
  domOuter: string
  innerText: string
  layoutRaw: Record<string, { x: number; y: number; width: number; height: number }>
  harByteSize: number
  chromeVersion?: string
}

export async function captureReferenceManifest(input: {
  url: string
  viewport?: { width: number; height: number; deviceScaleFactor?: number }
  outDir: string
  timeoutMs?: number
  browserExecutable?: string
}): Promise<CaptureResult> {
  if (!/^https?:\/\//i.test(input.url)) {
    throw new CaptureReferenceError(
      `capture url must start with http(s)://: ${input.url}`,
      "navigate",
    )
  }

  const viewport = input.viewport ?? { width: 1440, height: 900 }
  const deviceScaleFactor = input.viewport?.deviceScaleFactor ?? 1
  const timeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(input.timeoutMs)
  const startedAt = Date.now()

  const evidence = await captureBrowserEvidence({
    url: input.url,
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor,
    timeoutMs,
    browserExecutable: input.browserExecutable,
  })

  const pngBuf = evidence.screenshotPng
  const domOuter = evidence.domOuter
  const innerText = evidence.innerText
  const layoutRaw = evidence.layoutRaw

  // Pixel stats
  const decoded = await decodePNGBuffer(pngBuf).catch((e) => {
    throw new CaptureReferenceError("screenshot decode failed", "stats", e)
  })
  const nonWhiteRatio = nonWhiteDensity(decoded)
  const uniqueColors = uniqueColorBucketCount(decoded)
  const palette = topKPalette(decoded, 16)

  // reference_strings：dedupe + 过滤过短段
  const referenceStrings = Array.from(
    new Set(
      innerText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 200),
    ),
  ).slice(0, 500)

  const screenshotSha = sha256(pngBuf)
  const domSha = sha256(Buffer.from(domOuter, "utf8"))

  const browserRuntimePkg = await readBrowserRuntimeVersion()

  const manifest: CaptureManifestType = CaptureManifest.parse({
    url: input.url,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      device_scale_factor: deviceScaleFactor,
    },
    captured_at: startedAt,
    duration_ms: Date.now() - startedAt,
    screenshot_sha256: screenshotSha,
    dom_sha256: domSha,
    screenshot_byte_size: pngBuf.length,
    har_byte_size: evidence.harByteSize,
    non_white_pixel_ratio: Number(nonWhiteRatio.toFixed(6)),
    unique_color_count: uniqueColors,
    text_length: innerText.length,
    reference_strings: referenceStrings,
    palette,
    layout: layoutRaw,
    tool_version: {
      browserRuntime: browserRuntimePkg,
      chrome: evidence.chromeVersion,
    },
  })

  // 落盘
  await fs.mkdir(input.outDir, { recursive: true })
  const artifactPaths = {
    manifestJson: path.join(input.outDir, "manifest.json"),
    screenshotPng: path.join(input.outDir, "screenshot.png"),
    domHtml: path.join(input.outDir, "dom.html"),
  }
  await Promise.all([
    fs.writeFile(artifactPaths.manifestJson, JSON.stringify(manifest, null, 2)),
    fs.writeFile(artifactPaths.screenshotPng, pngBuf),
    fs.writeFile(artifactPaths.domHtml, domOuter, "utf8"),
  ])

  return { manifest, screenshotPng: pngBuf, artifactPaths }
}

async function captureBrowserEvidence(input: {
  url: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  timeoutMs: number
  browserExecutable?: string
}): Promise<BrowserEvidence> {
  return captureBrowserEvidenceViaNode(input)
}

async function captureBrowserEvidenceViaNode(input: {
  url: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  timeoutMs: number
  browserExecutable?: string
}): Promise<BrowserEvidence> {
  const executablePath = await BrowserRuntime.findBrowserExecutable(input.browserExecutable)
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(input.timeoutMs)
  const hardTimeoutMs = launchTimeoutMs + input.timeoutMs + 30_000
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const run = await runBrowserNodeSidecar<
    | { ok: true; screenshotBase64: string; domOuter: string; innerText: string; layoutRaw: BrowserEvidence["layoutRaw"]; harByteSize: number; chromeVersion?: string }
    | { ok: false; message: string; stack?: string }
  >({
    runtime,
    script: NODE_CAPTURE_SCRIPT,
    payload: { ...input, executablePath, launchTimeoutMs },
    payloadEnvName: "OPENCORVUS_CAPTURE_INPUT",
    hardTimeoutMs,
    label: "Node browser capture",
  }).catch((e) => {
    throw new CaptureReferenceError(`browser runtime launch failed via Node sidecar: ${formatBrowserRuntimeError(e)}`, "browser", e)
  })

  const result = run.result
  if (!result.ok) {
    throw new CaptureReferenceError(
      `browser runtime launch failed via Node sidecar: ${result.message}${result.stack ? `\n${result.stack}` : ""}`,
      "browser",
    )
  }

  if (run.exitCode !== 0) {
    throw new CaptureReferenceError(
      `browser runtime launch failed via Node sidecar: node exited with ${run.signal ?? run.exitCode}. ${run.stderr.trim()}`,
      "browser",
    )
  }
  return {
    screenshotPng: Buffer.from(result.screenshotBase64, "base64"),
    domOuter: result.domOuter,
    innerText: result.innerText,
    layoutRaw: result.layoutRaw ?? {},
    harByteSize: result.harByteSize ?? 0,
    chromeVersion: result.chromeVersion,
  }
}

function formatBrowserRuntimeError(error: unknown): string {
  if (error instanceof BrowserRuntime.RuntimeError) return error.diagnostic.message
  return error instanceof Error ? error.message : String(error)
}

const NODE_CAPTURE_SCRIPT = String.raw`
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

async function main() {
  const input = JSON.parse(Buffer.from(process.env.OPENCORVUS_CAPTURE_INPUT || "", "base64").toString("utf8"));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: input.executablePath,
      headless: true,
      timeout: input.launchTimeoutMs,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: input.viewport.width, height: input.viewport.height },
      deviceScaleFactor: input.deviceScaleFactor,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    let harByteSize = 0;
    page.on("response", (res) => {
      const len = Number(res.headers()["content-length"]);
      if (Number.isFinite(len) && len > 0) harByteSize += len;
    });
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: input.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(input.timeoutMs, 5000) }).catch(() => undefined);
    await Promise.race([
      page.evaluateHandle(() => document.fonts && document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, Math.min(input.timeoutMs, 5000))),
    ]).catch(() => undefined);
    await page.waitForFunction(() => document.readyState === "complete", { timeout: Math.min(input.timeoutMs, 5000) }).catch(() => undefined);
    await page.waitForFunction(
      () => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        for (const c of canvases) {
          if (c.width > 0 && c.height > 0) return true;
        }
        const mainCandidates = [
          document.querySelector("main"),
          document.querySelector("[role='main']"),
          document.querySelector("article"),
          document.body.firstElementChild,
        ];
        for (const el of mainCandidates) {
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 200 && r.height > 200) return true;
        }
        return false;
      },
      { timeout: Math.min(input.timeoutMs, 5000), polling: 250 },
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const screenshot = Buffer.from(await page.screenshot({ type: "png", fullPage: true }));
    const domOuter = await page.evaluate(() => document.documentElement.outerHTML);
    const innerText = await page.evaluate(() => (document.body && document.body.innerText ? document.body.innerText : "").normalize());
    const layoutRaw = await page.evaluate(() => {
      const pick = (selector) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        let best = null;
        let bestArea = 0;
        for (const n of nodes) {
          const r = n.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea) {
            bestArea = area;
            best = n;
          }
        }
        if (!best) return null;
        const r = best.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return {
          x: Math.max(0, Math.round(r.left + window.scrollX)),
          y: Math.max(0, Math.round(r.top + window.scrollY)),
          width: Math.max(1, Math.round(r.width)),
          height: Math.max(1, Math.round(r.height)),
        };
      };
      const out = {};
      const candidates = [
        ["chart", "canvas, svg, [role='img'], .chart, .recharts-wrapper, .echarts"],
        ["sidebar", "aside, nav, [role='navigation'], .sidebar"],
        ["toolbar", "[role='toolbar'], header, .toolbar"],
        ["header", "header, [role='banner']"],
        ["footer", "footer, [role='contentinfo']"],
        ["main", "main, [role='main'], article"],
      ];
      for (const [name, selector] of candidates) {
        const r = pick(selector);
        if (r) out[name] = r;
      }
      return out;
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      screenshotBase64: screenshot.toString("base64"),
      domOuter,
      innerText,
      layoutRaw,
      harByteSize,
      chromeVersion: browser.version(),
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : undefined,
    }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();
`

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function readBrowserRuntimeVersion(): Promise<string | undefined> {
  try {
    const pkgUrl = await import.meta.resolve?.("playwright/package.json")
    if (!pkgUrl) return undefined
    const pkgPath = pkgUrl.startsWith("file:") ? new URL(pkgUrl).pathname : pkgUrl
    const raw = await fs.readFile(pkgPath.replace(/^\//, ""), "utf8").catch(() =>
      fs.readFile(pkgPath, "utf8"),
    )
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version
  } catch {
    return undefined
  }
}
