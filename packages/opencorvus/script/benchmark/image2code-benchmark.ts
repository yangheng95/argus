#!/usr/bin/env bun
//
// image2code-benchmark.ts — dedicated entry point for the image-to-code
// pipeline (mirror/image: webpage_image_extract → webpage_image_compile →
// implement → webpage_render → webpage_vision_judge).
//
// Why a separate script (vs. just calling overlay-web-benchmark):
//   • Defaults differ from url2code: there is no upstream URL — the agent's
//     only ground truth is a reference screenshot, and visual-diff is the
//     ONLY meaningful verify gate.
//   • Request prompt must steer the agent into image-extract instead of
//     url-extract, otherwise the planner picks the wrong mirror tool.
//   • Reference image is REQUIRED, not optional — refuse to start without
//     one rather than silently producing a malformed task.
//
// Why a thin wrapper (vs. duplicating the 2000-line benchmark engine):
//   The server bootstrap, SSE streaming, stall watchdogs, overlay browser
//   driver, completion gates, report writer, and quality-gate evaluator are
//   identical to overlay-web-benchmark. Per CLAUDE.md rule 22 (no dual
//   source) we delegate via argv splice and only override the defaults
//   that genuinely differ for image2code.
//
// Usage:
//   bun run image2code-benchmark.ts                              # default reference (ainvest.png)
//   bun run image2code-benchmark.ts --reference-images=path.png  # custom reference
//   bun run image2code-benchmark.ts --request-file=brief.txt     # custom prompt
//   bun run image2code-benchmark.ts --report=.scratch/benchmark-runs/out.json --no-keep  # all overlay-web-benchmark flags pass through

import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { spawn } from "node:child_process"

const SCRIPT_DIR = import.meta.dir
const TARGET = path.join(SCRIPT_DIR, "overlay-web-benchmark.ts")
const DEFAULT_REFERENCE = path.join(SCRIPT_DIR, "assets", "ainvest.png")

// Image2code prompt — embedded so the script is self-contained even when
// the loose .image-bench-request.txt fixture is gone. Steers the agent
// through the image-generate pipeline (webpage_image_extract → compile →
// implement → render + vision_judge) since there is no URL to scrape.
const IMAGE2CODE_PROMPT = [
  "请按附图所示的网页设计，复刻一份高保真克隆：",
  "- 视觉还原：颜色、字体、间距、布局必须与截图一致",
  "- 文案与图标按截图所示原样保留",
  "- 交互：截图中可见的按钮、卡片、列表等基本交互行为要可点击/可悬停",
  "- 实现技术不限，最终需可在本地通过 webpage_render 渲染并通过 webpage_vision_judge 视觉判定",
  "",
  "由于只提供了截图（没有线上 URL），请走 image-generate 流程：webpage_image_extract → webpage_image_compile → 实现 → webpage_render + webpage_vision_judge 迭代。",
].join("\n") + "\n"

const userArgs = process.argv.slice(2)
function hasFlag(name: string): boolean {
  return userArgs.some((a) => a === name || a.startsWith(`${name}=`))
}

// Resolve reference image: explicit flag wins; otherwise fall back to the
// bundled fixture. Refuse to start if neither resolves to a file on disk —
// running image2code with no reference produces a meaningless task whose
// visual-diff gate has nothing to score against (rule 12: visual benchmark
// must remain visual).
function resolveReferenceImage(): string {
  const idx = userArgs.findIndex((a) => a === "--reference-images" || a.startsWith("--reference-images="))
  if (idx !== -1) {
    const raw = userArgs[idx].includes("=")
      ? userArgs[idx].slice(userArgs[idx].indexOf("=") + 1)
      : userArgs[idx + 1]
    // overlay-web-benchmark accepts comma-separated lists; for the
    // existence check use the first entry only.
    const first = String(raw || "").split(",").map((s) => s.trim()).filter(Boolean)[0]
    if (first && fs.existsSync(path.resolve(first))) return path.resolve(first)
    process.stderr.write(`[image2code-benchmark] --reference-images path not found: ${raw}\n`)
    process.exit(2)
  }
  if (fs.existsSync(DEFAULT_REFERENCE)) return DEFAULT_REFERENCE
  process.stderr.write(
    `[image2code-benchmark] no reference image found.\n` +
    `  Pass --reference-images=path/to/screenshot.png\n` +
    `  Or drop a default at ${DEFAULT_REFERENCE}\n`,
  )
  process.exit(2)
}

const referenceImage = resolveReferenceImage()

// Materialize the embedded prompt into a temp file unless the caller
// provided one. overlay-web-benchmark reads --request-file, so we mirror
// that contract instead of inventing a parallel path.
let requestFile = userArgs.find((a) => a.startsWith("--request-file="))?.slice("--request-file=".length)
if (!requestFile) {
  const idx = userArgs.indexOf("--request-file")
  if (idx !== -1 && idx + 1 < userArgs.length) requestFile = userArgs[idx + 1]
}
if (!requestFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "image2code-bench-"))
  requestFile = path.join(tmpDir, "request.txt")
  fs.writeFileSync(requestFile, IMAGE2CODE_PROMPT, "utf8")
}

const injected: string[] = []
if (!hasFlag("--title")) injected.push("--title", "Image-to-Code Benchmark")
if (!hasFlag("--request-file") && !hasFlag("--request-attachment")) {
  injected.push("--request-file", requestFile)
}
if (!hasFlag("--reference-images")) {
  injected.push("--reference-images", referenceImage)
}

console.log(
  `[image2code-benchmark] reference=${path.basename(referenceImage)} ` +
  `prompt=${path.basename(requestFile)} delegating to overlay-web-benchmark.ts`,
)

const child = spawn("bun", ["run", TARGET, ...injected, ...userArgs], {
  stdio: "inherit",
  env: process.env,
})

child.on("error", (err) => {
  process.stderr.write(`[image2code-benchmark] failed to spawn child: ${err.message}\n`)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`[image2code-benchmark] child terminated by signal ${signal}\n`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})

// Forward common termination signals to the child so Ctrl+C cleans up the
// whole tree (Server.listen, puppeteer browser, temp dirs).
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    child.kill(sig)
  })
}
