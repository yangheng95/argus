/**
 * P0-A · Reference 真实性闸。
 *
 * 采集 + 校验 reference 图的唯一入口。伪造 PNG（67 字节 / 空白 / 单色）在这里
 * 被直接拒收，不允许走「静态文本 visual contract」那条退路（CLAUDE.md rule 1）。
 *
 * 消费者：
 *  - P0-A 自身：design-analyst 抓图后调用 captureReferenceManifest + enforceCaptureGate
 *  - P0-B (Stream C)：`chart_region_density` 硬门可消费 manifest.layout[] 的 bbox
 *  - P1-A (Stream E)：evaluator runtime-evidence 复用本模块的 puppeteer 抓图能力
 *  - P1-B (Stream F)：content-fingerprint 消费 reference_strings / palette / layout
 *
 * 契约要点：
 *  - 抓图失败 ⇒ 抛 `CaptureGateError`；调用方必须直接走 task=failed，禁 fallback
 *  - SPA 必须等 content-paint（canvas 有像素 或 main bbox 非零）+ networkidle
 *  - 像素统计与 visual-metric 共享 `util/pixel-stats`（rule 22：禁双源）
 */
import z from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import puppeteer from "puppeteer-core"
import { findBrowserExecutable } from "@/delivery/checks/visual"
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
 * Design-analyst 采集阶段产出的权威 manifest。
 * 作为下游 goal / delivery / evaluator 的只读事实源（禁自造锚点，rule 11）。
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
    puppeteer: z.string().optional(),
    chrome: z.string().optional(),
  }),
})
export type CaptureManifestType = z.infer<typeof CaptureManifest>

/** Gate 阈值。数值严守 spec P0-A；调节须保持字段名恒定以不破坏下游 consumers。 */
export const CAPTURE_GATE_THRESHOLDS = {
  min_byte_size: 20_480,
  min_non_white_pixel_ratio: 0.05,
  min_unique_color_count: 16,
} as const

export interface CaptureGateViolation {
  field: "screenshot_byte_size" | "non_white_pixel_ratio" | "unique_color_count"
  threshold: number
  observed: number
}

export class CaptureGateError extends Error {
  override readonly cause?: unknown
  constructor(
    message: string,
    readonly stage: "browser" | "navigate" | "content_paint" | "screenshot" | "stats" | "gate",
    cause?: unknown,
  ) {
    super(message)
    this.name = "CaptureGateError"
    this.cause = cause
  }
}

/**
 * 校验 CaptureManifest 是否满足真实性闸。
 * - 通过：返回 { ok: true, manifest }
 * - 失败：返回 { ok: false, violations }；调用方必须把任务判 failed，禁 fallback。
 */
export function enforceCaptureGate(manifest: CaptureManifestType):
  | { ok: true; manifest: CaptureManifestType }
  | { ok: false; violations: CaptureGateViolation[] } {
  const violations: CaptureGateViolation[] = []
  if (manifest.screenshot_byte_size < CAPTURE_GATE_THRESHOLDS.min_byte_size) {
    violations.push({
      field: "screenshot_byte_size",
      threshold: CAPTURE_GATE_THRESHOLDS.min_byte_size,
      observed: manifest.screenshot_byte_size,
    })
  }
  if (manifest.non_white_pixel_ratio < CAPTURE_GATE_THRESHOLDS.min_non_white_pixel_ratio) {
    violations.push({
      field: "non_white_pixel_ratio",
      threshold: CAPTURE_GATE_THRESHOLDS.min_non_white_pixel_ratio,
      observed: manifest.non_white_pixel_ratio,
    })
  }
  if (manifest.unique_color_count < CAPTURE_GATE_THRESHOLDS.min_unique_color_count) {
    violations.push({
      field: "unique_color_count",
      threshold: CAPTURE_GATE_THRESHOLDS.min_unique_color_count,
      observed: manifest.unique_color_count,
    })
  }
  if (violations.length > 0) return { ok: false, violations }
  return { ok: true, manifest }
}

export function summarizeCaptureViolations(violations: readonly CaptureGateViolation[]): string {
  return violations
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

export async function captureReferenceManifest(input: {
  url: string
  viewport?: { width: number; height: number; deviceScaleFactor?: number }
  outDir: string
  timeoutMs?: number
  browserExecutable?: string
}): Promise<CaptureResult> {
  if (!/^https?:\/\//i.test(input.url)) {
    throw new CaptureGateError(
      `capture url must start with http(s)://: ${input.url}`,
      "navigate",
    )
  }

  const viewport = input.viewport ?? { width: 1440, height: 900 }
  const deviceScaleFactor = input.viewport?.deviceScaleFactor ?? 1
  const timeoutMs = input.timeoutMs ?? 90_000
  const startedAt = Date.now()

  let executablePath: string
  try {
    executablePath = await findBrowserExecutable(input.browserExecutable)
  } catch (e) {
    throw new CaptureGateError(
      "no Chrome/Edge executable available for reference capture",
      "browser",
      e,
    )
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  }).catch((e) => {
    throw new CaptureGateError("puppeteer launch failed", "browser", e)
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor,
    })
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    )

    // HAR 大小近似：累加 content-length（抓图不追求完整 HAR 字节对齐，仅作真实性信号）。
    let harByteSize = 0
    page.on("response", (res) => {
      const len = Number(res.headers()["content-length"])
      if (Number.isFinite(len) && len > 0) harByteSize += len
    })

    try {
      await page.goto(input.url, { waitUntil: "networkidle2", timeout: timeoutMs })
    } catch (e) {
      throw new CaptureGateError(`navigation failed for ${input.url}`, "navigate", e)
    }

    // Render settle
    try {
      await Promise.race([
        page.evaluateHandle("document.fonts.ready"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("document.fonts.ready timeout")), timeoutMs),
        ),
      ])
      await page.waitForFunction(() => document.readyState === "complete", { timeout: timeoutMs })
    } catch (e) {
      throw new CaptureGateError("render settle failed", "content_paint", e)
    }

    // Content-paint gate：SPA 必须出像素或主内容区有 bbox，否则判为空页
    // （spec P0-A：`waitForFunction(() => canvas_has_pixels || main_content_bounds_nonzero)`）。
    try {
      await page.waitForFunction(
        () => {
          const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[]
          for (const c of canvases) {
            if (c.width > 0 && c.height > 0) return true
          }
          const mainCandidates = [
            document.querySelector("main"),
            document.querySelector('[role="main"]'),
            document.querySelector("article"),
            document.body.firstElementChild as Element | null,
          ]
          for (const el of mainCandidates) {
            if (!el) continue
            const r = (el as HTMLElement).getBoundingClientRect()
            if (r.width > 200 && r.height > 200) return true
          }
          return false
        },
        { timeout: timeoutMs, polling: 250 },
      )
    } catch (e) {
      throw new CaptureGateError(
        "content-paint gate: no canvas pixels and no main-content bbox > 200×200 within timeout — page is empty or still loading",
        "content_paint",
        e,
      )
    }

    // 额外的 tail buffer 给 hydration / 懒加载 / 动画首帧落位
    await new Promise((r) => setTimeout(r, 2_000))

    // 抓 fullpage screenshot
    let pngBuf: Buffer
    try {
      const raw = await page.screenshot({ type: "png", fullPage: true })
      pngBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    } catch (e) {
      throw new CaptureGateError("screenshot failed", "screenshot", e)
    }

    // DOM + innerText
    const domOuter = await page.evaluate(() => document.documentElement.outerHTML)
    const innerText = await page.evaluate(() => (document.body?.innerText ?? "").normalize())

    // Layout bbox（heuristic 命名区域）
    const layoutRaw = await page.evaluate(() => {
      const pick = (selector: string): { x: number; y: number; width: number; height: number } | null => {
        const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
        let best: HTMLElement | null = null
        let bestArea = 0
        for (const n of nodes) {
          const r = n.getBoundingClientRect()
          const area = r.width * r.height
          if (area > bestArea) {
            bestArea = area
            best = n
          }
        }
        if (!best) return null
        const r = best.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return null
        return {
          x: Math.max(0, Math.round(r.left + window.scrollX)),
          y: Math.max(0, Math.round(r.top + window.scrollY)),
          width: Math.max(1, Math.round(r.width)),
          height: Math.max(1, Math.round(r.height)),
        }
      }
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {}
      const candidates: Array<[string, string]> = [
        ["chart", "canvas, svg, [role='img'], .chart, .recharts-wrapper, .echarts"],
        ["sidebar", "aside, nav, [role='navigation'], .sidebar"],
        ["toolbar", "[role='toolbar'], header, .toolbar"],
        ["header", "header, [role='banner']"],
        ["footer", "footer, [role='contentinfo']"],
        ["main", "main, [role='main'], article"],
      ]
      for (const [name, selector] of candidates) {
        const r = pick(selector)
        if (r) out[name] = r
      }
      return out
    })

    // Pixel stats
    const decoded = await decodePNGBuffer(pngBuf).catch((e) => {
      throw new CaptureGateError("screenshot decode failed", "stats", e)
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

    const chromeVersion = await browser.version().catch(() => undefined)
    const puppeteerPkg = await readPuppeteerVersion()

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
      har_byte_size: harByteSize,
      non_white_pixel_ratio: Number(nonWhiteRatio.toFixed(6)),
      unique_color_count: uniqueColors,
      text_length: innerText.length,
      reference_strings: referenceStrings,
      palette,
      layout: layoutRaw,
      tool_version: {
        puppeteer: puppeteerPkg,
        chrome: chromeVersion,
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
  } finally {
    await browser.close().catch(() => undefined)
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function readPuppeteerVersion(): Promise<string | undefined> {
  try {
    const pkgUrl = await import.meta.resolve?.("puppeteer-core/package.json")
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
