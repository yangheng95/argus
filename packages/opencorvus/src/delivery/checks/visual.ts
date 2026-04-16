/**
 * Visual similarity evaluator — puppeteer screenshot + SSIM gate.
 *
 * The same logic that ships in `script/benchmark/visual-diff.ts` (which is
 * now a thin CLI wrapper) lives here as a library so the per-goal evaluator
 * can run it inside the orchestrator. Every fig2code-style task that lists a
 * visual reference automatically gets a structural-similarity check without
 * any external pipeline tooling.
 *
 * Behaviour matches the CLI (single source of truth for thresholds and the
 * SSIM map analysis):
 *   - Render the target HTML/URL with puppeteer at the reference's natural
 *     viewport (or a caller-supplied size).
 *   - Compare against the reference PNG using SSIM. Fail when either
 *     `mean SSIM < threshold` OR the worst-5% window SSIM (`p5`) drops below
 *     `worstThreshold` — protects against partial structural collapse that
 *     a generous mean would hide.
 *   - No fallback: missing browser, missing reference, or size-mismatched
 *     images all produce explicit failures.
 */
import fs from "node:fs/promises"
import path from "node:path"
import puppeteer from "puppeteer-core"
import { PNG } from "pngjs"
import ssim from "ssim.js"

export interface VisualDiffOptions {
  /** Either an absolute file path to an html file, or http(s)/file URL. */
  rendered: string
  /** Absolute path to the reference PNG. */
  reference: string
  /** Force a specific puppeteer viewport. Defaults to the reference image's
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

const DEFAULT_BROWSER_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

export async function findBrowserExecutable(override?: string): Promise<string> {
  if (override) {
    await fs.access(override).catch(() => {
      throw new Error(`browserExecutable not found: ${override}`)
    })
    return override
  }
  for (const bin of DEFAULT_BROWSER_CANDIDATES) {
    try {
      await fs.access(bin)
      return bin
    } catch {}
  }
  throw new Error(
    "No Chrome/Edge executable found. Install one or pass `browserExecutable` explicitly.",
  )
}

function toFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/")
  return `file:///${abs.replace(/^\/+/, "")}`
}

function resolveTarget(rendered: string): string {
  if (/^https?:\/\//i.test(rendered) || /^file:\/\//i.test(rendered)) return rendered
  return toFileUrl(rendered)
}

async function decodePNG(filePath: string): Promise<PNG> {
  const buf = await fs.readFile(filePath)
  return new Promise<PNG>((resolve, reject) => {
    const png = new PNG()
    png.parse(buf, (err, parsed) => (err ? reject(err) : resolve(parsed)))
  })
}

const DISCOVERY_SKIP_DIRS = new Set([
  ".git",
  ".opencorvus",
  "node_modules",
  "references",
  "visual-diff-out",
  ".opencorvus-worktrees",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
])

/**
 * Walk a directory and find the most-recent `index.html`. Used by per-goal
 * evaluator when the goal owns a workspace and we just want to check
 * "whatever index.html the executor produced".
 */
export async function findRenderedIndex(rootDir: string): Promise<string | undefined> {
  const candidates: Array<{ path: string; depth: number; mtime: number }> = []
  async function walk(current: string, depth: number) {
    let entries: import("node:fs").Dirent[] = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DISCOVERY_SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
        await walk(path.join(current, entry.name), depth + 1)
        continue
      }
      if (entry.name.toLowerCase() === "index.html") {
        const abs = path.join(current, entry.name)
        const stat = await fs.stat(abs).catch(() => null)
        candidates.push({ path: abs, depth, mtime: stat?.mtimeMs ?? 0 })
      }
    }
  }
  await walk(rootDir, 0)
  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.mtime - a.mtime || a.depth - b.depth || a.path.localeCompare(b.path))
  return candidates[0].path
}

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
  await fs.mkdir(opts.outDir, { recursive: true })

  const refImgProbe = await decodePNG(opts.reference)
  const viewport = opts.viewport ?? { width: refImgProbe.width, height: refImgProbe.height }

  const executablePath = await findBrowserExecutable(opts.browserExecutable)
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  })
  const renderedPath = path.join(opts.outDir, "rendered.png")
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 })
    const target = resolveTarget(opts.rendered)
    await page.goto(target, { waitUntil: "networkidle0", timeout: 60_000 })
    await page.screenshot({
      path: renderedPath,
      type: "png",
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    })
  } finally {
    await browser.close()
  }

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
