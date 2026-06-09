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
  const diagnostics = singleFileDiagnosticPaths(input.outputPath)
  await Promise.all([
    fs.rm(diagnostics.errorsFile, { force: true }),
    fs.rm(diagnostics.debugMessagesFile, { force: true }),
  ])

  throwIfAborted(input.signal)

  const options = {
    url: input.url,
    output: input.outputPath,
    browserHeadless: true,
    browserExecutablePath: chromePath,
    browserWidth: input.viewport.width,
    browserHeight: input.viewport.height,
    browserWaitDelay: input.waitDelayMs ?? 10_000,
    browserWaitUntil: "DOMContentLoaded",
    browserWaitUntilDelay: 1_000,
    browserLoadMaxTime: 120_000,
    browserCaptureMaxTime: 120_000,
    blockScripts: false,
    removeUnusedStyles: false,
    compressHTML: false,
    compressCSS: false,
    errorsFile: diagnostics.errorsFile,
    debugMessagesFile: diagnostics.debugMessagesFile,
    errorsTracesDisabled: false,
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

  const stat = await fs.stat(input.outputPath).catch(async (error) => {
    throw new Error(await renderSingleFileOutputFailure(input.outputPath, diagnostics, error))
  })
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(await renderSingleFileOutputFailure(input.outputPath, diagnostics))
  }
  return {
    outputPath: input.outputPath,
    bytes: stat.size,
    command: ["single-file-cli/api", input.url, input.outputPath],
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new Error("single-file capture aborted")
}

function singleFileDiagnosticPaths(outputPath: string) {
  const outputDir = path.dirname(outputPath)
  return {
    errorsFile: path.join(outputDir, "singlefile-errors.log"),
    debugMessagesFile: path.join(outputDir, "singlefile-debug.log"),
  }
}

async function renderSingleFileOutputFailure(
  outputPath: string,
  diagnostics: ReturnType<typeof singleFileDiagnosticPaths>,
  cause?: unknown,
): Promise<string> {
  const details = await readSingleFileDiagnostics(diagnostics)
  const causeMessage = cause instanceof Error && cause.message ? ` Cause: ${cause.message}` : ""
  return [`single-file capture did not write a non-empty HTML file at ${outputPath}.${causeMessage}`, details]
    .filter(Boolean)
    .join("\n\n")
}

async function readSingleFileDiagnostics(diagnostics: ReturnType<typeof singleFileDiagnosticPaths>): Promise<string> {
  const sections = await Promise.all([
    readDiagnosticSection("errors", diagnostics.errorsFile),
    readDiagnosticSection("debug", diagnostics.debugMessagesFile),
  ])
  const body = sections.filter(Boolean).join("\n\n")
  return body ? `SingleFile diagnostics:\n${body}` : ""
}

async function readDiagnosticSection(label: string, file: string): Promise<string> {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const trimmed = text.trim()
  if (!trimmed) return ""
  const maxChars = 4_000
  const clipped =
    trimmed.length > maxChars
      ? `${trimmed.slice(0, maxChars).trimEnd()}\n[clipped ${trimmed.length - maxChars} chars from ${file}]`
      : trimmed
  return `## ${label}: ${file}\n${clipped}`
}

export const SingleFileCaptureTestHooks = {
  readSingleFileDiagnostics,
}
