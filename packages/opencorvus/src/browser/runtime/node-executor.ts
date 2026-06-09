import { spawn, type ChildProcess } from "node:child_process"

import { type BrowserNodeSidecarRuntime, resolveBrowserNodeSidecarRuntime } from "./node-sidecar"

export interface BrowserNodeSidecarRunResult<TResult> {
  result: TResult
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export class BrowserNodeSidecarError extends Error {
  constructor(
    readonly kind: "aborted" | "invalid_json" | "spawn" | "timeout",
    message: string,
    readonly detail: {
      stderr?: string
      stdout?: string
    } = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "BrowserNodeSidecarError"
  }
}

async function waitForProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
  })
}

async function terminateChildTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid) return
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => {
        child.kill()
        resolve()
      })
    })
    await waitForProcessExit(child)
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    child.kill("SIGKILL")
  }
  await waitForProcessExit(child)
}

export async function runBrowserNodeSidecar<TResult>(input: {
  runtime?: BrowserNodeSidecarRuntime
  script: string
  payload: unknown
  payloadEnvName: string
  hardTimeoutMs: number
  signal?: AbortSignal
  label: string
}): Promise<BrowserNodeSidecarRunResult<TResult>> {
  if (input.signal?.aborted) {
    throw new BrowserNodeSidecarError(
      "aborted",
      input.signal.reason instanceof Error ? input.signal.reason.message : `${input.label} aborted`,
    )
  }
  const runtime = input.runtime ?? (await resolveBrowserNodeSidecarRuntime())
  const payload = Buffer.from(JSON.stringify(input.payload), "utf8").toString("base64")
  const child = spawn(runtime.nodeExecutable, ["-"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [input.payloadEnvName]: payload,
      OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH: runtime.playwrightRequirePath,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  })
  child.stdin.end(input.script)

  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  let aborted = false
  const abortHandler = () => {
    aborted = true
    void terminateChildTree(child)
  }
  input.signal?.addEventListener("abort", abortHandler, { once: true })
  let timeoutError: BrowserNodeSidecarError | undefined
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      timeoutError = new BrowserNodeSidecarError(
        "timeout",
        `${input.label} timed out after ${input.hardTimeoutMs}ms. stderr=${stderr.slice(-2000)}`,
        { stderr },
      )
      void terminateChildTree(child)
    }, input.hardTimeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
    .catch((error) => ({
      code: 1,
      signal: null,
      error,
    }))
    .finally(() => {
      input.signal?.removeEventListener("abort", abortHandler)
    })

  if ("error" in exit) {
    const error = exit.error
    if (error instanceof BrowserNodeSidecarError) throw error
    throw new BrowserNodeSidecarError(
      "spawn",
      error instanceof Error ? error.message : String(error),
      { stderr },
      { cause: error },
    )
  }
  if (aborted) {
    throw new BrowserNodeSidecarError(
      "aborted",
      input.signal?.reason instanceof Error ? input.signal.reason.message : `${input.label} aborted`,
      { stderr },
    )
  }
  if (timeoutError) throw timeoutError

  let result: TResult
  try {
    result = JSON.parse(stdout) as TResult
  } catch (error) {
    throw new BrowserNodeSidecarError(
      "invalid_json",
      `${input.label} returned invalid JSON. stderr=${stderr.trim()} stdout=${stdout.slice(0, 500)}`,
      { stderr, stdout },
      { cause: error },
    )
  }

  return {
    result,
    stderr,
    exitCode: exit.code,
    signal: exit.signal,
  }
}
