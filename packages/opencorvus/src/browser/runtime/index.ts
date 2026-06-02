import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Browser } from "playwright"

export namespace BrowserRuntime {
  type PlaywrightModule = typeof import("playwright")

  export type ErrorCode = "browser_executable_not_found" | "browser_missing" | "browser_launch_failed"

  export type Diagnostic = {
    code: ErrorCode
    message: string
    checkedCandidates: string[]
    recoveryCommand: string
    override?: string
  }

  export class RuntimeError extends Error {
    readonly code: ErrorCode
    readonly diagnostic: Diagnostic

    constructor(diagnostic: Diagnostic, options?: ErrorOptions) {
      super(`${diagnostic.code}: ${diagnostic.message}`, options)
      this.name = "BrowserRuntimeError"
      this.code = diagnostic.code
      this.diagnostic = diagnostic
    }
  }

  export const DEFAULT_BROWSER_CANDIDATES = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ] as const

  export const RECOVERY_COMMAND =
    "Install Chrome/Edge or set OPENCORVUS_BROWSER_EXECUTABLE to the browser executable path."
  export const DEFAULT_BROWSER_LAUNCH_TIMEOUT_MS = 60_000

  export function resolveBrowserLaunchTimeoutMs(explicit?: number): number {
    if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit
    const env = Number(process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? "")
    if (Number.isFinite(env) && env > 0) return env
    return DEFAULT_BROWSER_LAUNCH_TIMEOUT_MS
  }

  export async function findBrowserExecutable(override?: string): Promise<string> {
    const explicit = override ?? process.env.OPENCORVUS_BROWSER_EXECUTABLE ?? process.env.BROWSER_EXECUTABLE
    if (explicit) {
      await fs.access(explicit).catch(() => {
        throw new RuntimeError({
          code: "browser_executable_not_found",
          message: `browserExecutable not found: ${explicit}`,
          checkedCandidates: [explicit],
          override: explicit,
          recoveryCommand: RECOVERY_COMMAND,
        })
      })
      return explicit
    }
    const checkedCandidates = [...DEFAULT_BROWSER_CANDIDATES]
    for (const bin of DEFAULT_BROWSER_CANDIDATES) {
      try {
        await fs.access(bin)
        return bin
      } catch {}
    }
    throw new RuntimeError({
      code: "browser_missing",
      message: "No Chrome/Edge executable found.",
      checkedCandidates,
      recoveryCommand: RECOVERY_COMMAND,
    })
  }

  export async function launchPlaywrightBrowser(input: {
    headless: boolean
    executablePath?: string
    args?: string[]
    timeoutMs?: number
  }): Promise<Browser> {
    const executablePath = await findBrowserExecutable(input.executablePath)
    try {
      const { chromium } = await loadPlaywright()
      return await chromium.launch({
        executablePath,
        headless: input.headless,
        args: input.args ?? defaultLaunchArgs(),
        timeout: resolveBrowserLaunchTimeoutMs(input.timeoutMs),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new RuntimeError(
        {
          code: "browser_launch_failed",
          message: `BrowserRuntime launch failed for ${executablePath}: ${detail}`,
          checkedCandidates: [executablePath],
          recoveryCommand: RECOVERY_COMMAND,
        },
        { cause: error },
      )
    }
  }

  export function defaultLaunchArgs() {
    return ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-remote-fonts"]
  }

  export async function resolvePlaywrightEntry(): Promise<string> {
    const packaged = path.join(path.dirname(process.execPath), "node_modules", "playwright", "index.mjs")
    if (await exists(packaged)) return packaged

    if (isPackagedRuntime()) {
      throw new Error(`Packaged Playwright runtime is missing. Expected ${packaged}`)
    }

    const packageRoot = await sourcePackageRoot()
    const source = path.join(packageRoot, "node_modules", "playwright", "index.mjs")
    if (await exists(source)) return source
    throw new Error(`Source Playwright runtime is missing. Expected ${source}`)
  }

  async function loadPlaywright(): Promise<PlaywrightModule> {
    const entry = await resolvePlaywrightEntry()
    return import(pathToFileURL(entry).href) as Promise<PlaywrightModule>
  }

  async function sourcePackageRoot(): Promise<string> {
    const explicit = process.env.OPENCORVUS_BROWSER_MCP_SOURCE_PACKAGE_DIR?.trim()
    if (explicit) return explicit

    let current = import.meta.dir
    while (true) {
      if (await exists(path.join(current, "package.json"))) return current
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }

    throw new Error("Cannot resolve source package root for Playwright runtime")
  }

  function isPackagedRuntime() {
    if (process.env.OPENCORVUS_BROWSER_MCP_PACKAGED === "1") return true
    const executable = path.basename(process.execPath).toLowerCase().replace(/\.exe$/, "")
    return executable !== "bun" && executable !== "node"
  }

  async function exists(file: string) {
    return fs
      .access(file)
      .then(() => true)
      .catch(() => false)
  }
}

export const findBrowserExecutable = BrowserRuntime.findBrowserExecutable
export const launchPlaywrightBrowser = BrowserRuntime.launchPlaywrightBrowser
