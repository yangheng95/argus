import { spawn, type ChildProcess } from "node:child_process"

import { ProcessSupervisor } from "@/shell/process-supervisor"
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

const CHILD_CLEANUP_TIMEOUT_MS = 5_000

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise<boolean>((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.off("exit", onExit)
      resolve(false)
    }, timeoutMs)
    if (typeof timer.unref === "function") timer.unref()
    const onExit = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
  })
}

async function terminateChildTree(child: ChildProcess, timeoutMs = CHILD_CLEANUP_TIMEOUT_MS): Promise<boolean> {
  const pid = child.pid
  if (!pid) return true
  if (process.platform === "win32") {
    await ProcessSupervisor.terminateProcessTree(pid, `browser node sidecar process tree ${pid}`).catch(() => false)
    return await waitForProcessExit(child, timeoutMs)
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    return false
  }
  return await waitForProcessExit(child, timeoutMs)
}

export async function runBrowserNodeSidecar<TResult>(input: {
  runtime?: BrowserNodeSidecarRuntime
  script: string
  payload: unknown
  payloadEnvName: string
  inactivityTimeoutMs: number
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
  let lastActivity = "start"
  let rejectRun: ((error: unknown) => void) | undefined
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
    resetInactivityTimer("stdout")
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
    resetInactivityTimer("stderr")
  })

  let aborted = false
  let abortError: BrowserNodeSidecarError | undefined
  const abortHandler = () => {
    aborted = true
    abortError = new BrowserNodeSidecarError(
      "aborted",
      input.signal?.reason instanceof Error ? input.signal.reason.message : `${input.label} aborted`,
      { stderr, stdout },
    )
    void terminateChildTree(child).then((terminated) => {
      if (terminated) return
      abortError = new BrowserNodeSidecarError(
        "aborted",
        `${abortError?.message ?? `${input.label} aborted`}; child process did not exit within ${CHILD_CLEANUP_TIMEOUT_MS}ms after cleanup signal.`,
        { stderr, stdout },
      )
      rejectRun?.(abortError)
    })
  }
  input.signal?.addEventListener("abort", abortHandler, { once: true })
  let timeoutError: BrowserNodeSidecarError | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const clearInactivityTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }
  const resetInactivityTimer = (source: string) => {
    lastActivity = source
    clearInactivityTimer()
    timer = setTimeout(() => {
      const baseTimeoutError = new BrowserNodeSidecarError(
        "timeout",
        `${input.label} inactive for ${input.inactivityTimeoutMs}ms after ${lastActivity}. stderr=${stderr.slice(-2000)}`,
        { stderr, stdout },
      )
      timeoutError = baseTimeoutError
      void terminateChildTree(child).then((terminated) => {
        if (!terminated) {
          timeoutError = new BrowserNodeSidecarError(
            "timeout",
            `${baseTimeoutError.message}; child process did not exit within ${CHILD_CLEANUP_TIMEOUT_MS}ms after cleanup signal.`,
            { stderr, stdout },
            { cause: baseTimeoutError },
          )
        }
        rejectRun?.(timeoutError)
      })
    }, input.inactivityTimeoutMs)
  }
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    rejectRun = reject
    resetInactivityTimer("start")
    child.once("error", (error) => {
      clearInactivityTimer()
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearInactivityTimer()
      resolve({ code, signal })
    })
  })
    .catch((error) => ({
      code: 1,
      signal: null,
      error,
    }))
    .finally(() => {
      rejectRun = undefined
      input.signal?.removeEventListener("abort", abortHandler)
      clearInactivityTimer()
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
    throw abortError ?? new BrowserNodeSidecarError("aborted", `${input.label} aborted`, { stderr, stdout })
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
