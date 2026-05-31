import fs from "node:fs/promises"
import path from "node:path"
import { BrowserRuntime } from "@/browser/runtime"

export interface CaptureSingleFileInput {
  url: string
  outputPath: string
  viewport: { width: number; height: number }
  waitDelayMs?: number
  signal?: AbortSignal
}

export interface CaptureSingleFileOutput {
  outputPath: string
  bytes: number
  command: string[]
}

export async function captureSingleFileHtml(input: CaptureSingleFileInput): Promise<CaptureSingleFileOutput> {
  const executable = await resolveSingleFileExecutable()
  const chromePath = await BrowserRuntime.findBrowserExecutable()
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true })
  await fs.rm(input.outputPath, { force: true })

  const args = [
    input.url,
    input.outputPath,
    "--browser-headless=true",
    `--browser-executable-path=${chromePath}`,
    `--browser-width=${input.viewport.width}`,
    `--browser-height=${input.viewport.height}`,
    `--browser-wait-delay=${input.waitDelayMs ?? 10_000}`,
    "--browser-wait-until=networkAlmostIdle",
    "--block-scripts=false",
    "--remove-unused-styles=false",
    "--compress-HTML=false",
    "--compress-CSS=false",
  ]

  const proc = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: process.env,
  })
  const abort = () => proc.kill()
  input.signal?.addEventListener("abort", abort, { once: true })
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    if (exitCode !== 0) {
      throw new Error(`single-file exited ${exitCode}: ${(stderr || stdout).slice(0, 2000)}`)
    }
  } finally {
    input.signal?.removeEventListener("abort", abort)
  }

  const stat = await fs.stat(input.outputPath)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`single-file did not write a non-empty HTML file at ${input.outputPath}`)
  }
  return { outputPath: input.outputPath, bytes: stat.size, command: [executable, ...args] }
}

async function resolveSingleFileExecutable(): Promise<string> {
  const exe = process.platform === "win32" ? "single-file.exe" : "single-file"
  const candidates = [
    path.resolve(process.cwd(), "node_modules", ".bin", exe),
    path.resolve(process.cwd(), "packages", "opencorvus", "node_modules", ".bin", exe),
  ]
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`single-file executable not found; expected ${candidates.join(" or ")}`)
}
