import fs from "node:fs/promises"
import path from "node:path"
import { BrowserRuntime } from "@/browser/runtime"
import { initialize as initializeSingleFile } from "single-file-cli/single-file-cli-api.js"

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
  const chromePath = await BrowserRuntime.findBrowserExecutable()
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true })
  await fs.rm(input.outputPath, { force: true })

  throwIfAborted(input.signal)

  const options = {
    url: input.url,
    output: input.outputPath,
    browserHeadless: true,
    browserExecutablePath: chromePath,
    browserWidth: input.viewport.width,
    browserHeight: input.viewport.height,
    browserWaitDelay: input.waitDelayMs ?? 10_000,
    browserWaitUntil: "networkAlmostIdle",
    blockScripts: false,
    removeUnusedStyles: false,
    compressHTML: false,
    compressCSS: false,
  }

  const singlefile = await initializeSingleFile(options)
  let finishPromise: Promise<void> | undefined
  const finish = () => (finishPromise ??= singlefile.finish())
  const abort = () => {
    void finish()
  }
  input.signal?.addEventListener("abort", abort, { once: true })
  try {
    throwIfAborted(input.signal)
    await singlefile.capture([input.url])
    throwIfAborted(input.signal)
  } finally {
    input.signal?.removeEventListener("abort", abort)
    await finish()
  }

  const stat = await fs.stat(input.outputPath)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`single-file did not write a non-empty HTML file at ${input.outputPath}`)
  }
  return { outputPath: input.outputPath, bytes: stat.size, command: ["single-file-cli/api", input.url, input.outputPath] }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new Error("single-file capture aborted")
}
