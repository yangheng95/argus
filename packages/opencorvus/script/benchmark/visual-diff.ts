#!/usr/bin/env bun

// Visual-diff CLI — thin wrapper around `src/delivery/checks/visual.ts`.
//
// Usage:
//   --rendered <htmlPath | url>   page to evaluate (or use --rendered-dir)
//   --rendered-dir <dir>          auto-discover index.html under dir
//   --reference <pngPath>         reference screenshot
//   --viewport <WxH>              puppeteer viewport (default: reference image size)
//   --threshold <0..1>            mean SSIM floor (default 0.85)
//   --worst-threshold <0..1>      worst-5% window SSIM floor (default 0.55)
//   --out <dir>                   write rendered.png + diff.json here (default ./visual-diff-out)
//
// Exit code: 0 = passed, 1 = failed, 2 = input/config error.
//
// Implementation lives in `@/evaluator/visual` so the orchestrator's per-goal
// evaluator can run the same gate without shelling out.

import path from "node:path"
import { findRenderedIndex, runVisualDiff, summarizeVisualReport } from "../../src/delivery/checks/visual"

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
    console.error("[visual-diff] must provide --rendered or --rendered-dir")
    process.exit(2)
  }
  const reference = required("--reference")
  const threshold = Number(flag("--threshold") ?? "0.85")
  const worstThreshold = Number(flag("--worst-threshold") ?? "0.55")
  const outDir = path.resolve(flag("--out") ?? "visual-diff-out")
  const viewportFlag = flag("--viewport")
  const viewport = viewportFlag ? parseViewport(viewportFlag) : undefined

  const rendered = renderedFlag ?? (async () => {
    const found = await findRenderedIndex(path.resolve(renderedDirFlag!))
    if (!found) {
      console.error(`[visual-diff] no index.html found under --rendered-dir=${renderedDirFlag}`)
      process.exit(1)
    }
    return found
  })()
  const renderedResolved = typeof rendered === "string" ? rendered : await rendered

  console.log(`[visual-diff] rendered=${renderedResolved} reference=${reference}`)

  const report = await runVisualDiff({
    rendered: renderedResolved,
    reference,
    viewport,
    threshold,
    worstThreshold,
    outDir,
  })
  const verdict = report.passed ? "PASS" : "FAIL"
  console.log(`[visual-diff] ${verdict} ${summarizeVisualReport(report)} out=${outDir}`)
  process.exit(report.passed ? 0 : 1)
}

main().catch((err) => {
  console.error(`[visual-diff] error: ${err instanceof Error ? err.stack || err.message : String(err)}`)
  process.exit(2)
})
