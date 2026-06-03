#!/usr/bin/env bun

// Visual-diff CLI — thin wrapper around `src/acceptance/checks/visual.ts`.
//
// Usage:
//   --rendered <url>              live page URL to evaluate
//   --rendered-dir <projectDir>   serve dist/, build/, out/, or project root
//   --reference <pngPath>         reference screenshot
//   --viewport <WxH>              puppeteer viewport (default: reference image size)
//   --threshold <0..1>            mean SSIM floor (default 0.85)
//   --worst-threshold <0..1>      worst-5% window SSIM floor (default 0.55)
//   --browser-launch-timeout-ms <n> browser launch timeout (default 60000)
//   --out <dir>                   write rendered.png + diff.json here (default repo .scratch/benchmark-runs/visual-diff-out)
//   --headless                    run Chromium headless
//   --chrome-cli-fallback         use Chrome CLI screenshot if Playwright launch fails
//
// Exit code: 0 = passed, 1 = failed, 2 = input/config error.
//
// Implementation lives in `@/evaluator/visual` so the orchestrator's per-goal
// evaluator can run the same gate without shelling out.

import path from "node:path"
import fs from "node:fs/promises"
import http from "node:http"
import { runVisualDiff, summarizeVisualReport } from "../../src/acceptance/checks/visual"

function flag(name: string): string | undefined {
  const prefix = `${name}=`
  const argvMatch = process.argv.find((item) => item.startsWith(prefix))
  if (argvMatch) return argvMatch.slice(prefix.length)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}

function required(name: string): string {
  const value = flag(name)
  if (!value) {
    console.error(`[visual-diff] missing required flag: ${name}`)
    process.exit(2)
  }
  return value
}

function parseViewport(value: string): { width: number; height: number } | undefined {
  const match = value.match(/^(\d+)x(\d+)$/)
  if (!match) {
    console.error(`[visual-diff] invalid --viewport (expected WxH): ${value}`)
    process.exit(2)
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

async function main() {
  const renderedFlag = flag("--rendered")
  const renderedDirFlag = flag("--rendered-dir")
  if (!renderedFlag && !renderedDirFlag) {
    console.error("[visual-diff] must provide --rendered with a live http(s) URL or --rendered-dir with an app directory")
    process.exit(2)
  }
  if (renderedFlag && renderedDirFlag) {
    console.error("[visual-diff] pass only one of --rendered or --rendered-dir")
    process.exit(2)
  }
  if (renderedFlag && !/^https?:\/\//i.test(renderedFlag)) {
    console.error(`[visual-diff] --rendered must be a live http(s) URL: ${renderedFlag}`)
    process.exit(2)
  }
  const reference = required("--reference")
  const threshold = Number(flag("--threshold") ?? "0.85")
  const worstThreshold = Number(flag("--worst-threshold") ?? "0.55")
  const browserLaunchTimeoutMs = Number(flag("--browser-launch-timeout-ms") ?? process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? 60_000)
  const headless = process.argv.includes("--headless") || process.env.OPENCORVUS_VISUAL_DIFF_HEADLESS === "1"
  const chromeCliFallback = process.argv.includes("--chrome-cli-fallback") || process.env.OPENCORVUS_VISUAL_DIFF_CHROME_CLI_FALLBACK === "1"
  const defaultOutDir = path.resolve(import.meta.dir, "../../../..", ".scratch", "benchmark-runs", "visual-diff-out")
  const outDir = path.resolve(flag("--out") ?? defaultOutDir)
  const viewportFlag = flag("--viewport")
  const viewport = viewportFlag ? parseViewport(viewportFlag) : undefined

  const server = renderedDirFlag
    ? await serveRenderedDir(path.resolve(renderedDirFlag))
    : undefined
  let exitCode = 2
  try {
    const renderedResolved = renderedFlag ?? server?.url
    if (!renderedResolved) throw new Error("visual-diff: failed to resolve rendered target")
    console.log(`[visual-diff] rendered=${renderedResolved} reference=${reference}`)

    const report = await runVisualDiff({
      rendered: renderedResolved,
      reference,
      viewport,
      threshold,
      worstThreshold,
      outDir,
      browserLaunchTimeoutMs,
      headless,
      chromeCliFallback,
    })
    const verdict = report.passed ? "PASS" : "FAIL"
    console.log(`[visual-diff] ${verdict} ${summarizeVisualReport(report)} out=${outDir}`)
    exitCode = report.passed ? 0 : 1
  } finally {
    if (server) await new Promise((resolve) => server.server.close(resolve))
  }
  process.exit(exitCode)
}

async function serveRenderedDir(projectDir: string): Promise<{ url: string; server: http.Server }> {
  const root = await resolveStaticRoot(projectDir)
  const port = await getFreePort()
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
      const requested = path.resolve(root, relative)
      if (!requested.startsWith(root)) {
        res.writeHead(403)
        res.end("Forbidden")
        return
      }
      const stat = await fs.stat(requested).catch(() => undefined)
      const filePath = stat?.isDirectory() ? path.join(requested, "index.html") : requested
      const body = await fs.readFile(filePath)
      res.writeHead(200, { "content-type": contentType(filePath) })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end("Not found")
    }
  })
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve))
  return { url: `http://127.0.0.1:${port}/index.html`, server }
}

async function resolveStaticRoot(projectDir: string): Promise<string> {
  const candidates = [
    path.join(projectDir, "dist"),
    path.join(projectDir, "build"),
    path.join(projectDir, "out"),
    projectDir,
  ]
  for (const candidate of candidates) {
    const indexPath = path.join(candidate, "index.html")
    const stat = await fs.stat(indexPath).catch(() => undefined)
    if (stat?.isFile()) return candidate
  }
  throw new Error(`[visual-diff] --rendered-dir does not contain dist/index.html, build/index.html, out/index.html, or index.html: ${projectDir}`)
}

async function getFreePort(): Promise<number> {
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".html") return "text/html; charset=utf-8"
  if (ext === ".js") return "text/javascript; charset=utf-8"
  if (ext === ".css") return "text/css; charset=utf-8"
  if (ext === ".json") return "application/json"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".woff") return "font/woff"
  if (ext === ".woff2") return "font/woff2"
  return "application/octet-stream"
}

main().catch((err) => {
  console.error(`[visual-diff] error: ${err instanceof Error ? err.stack || err.message : String(err)}`)
  process.exit(2)
})
