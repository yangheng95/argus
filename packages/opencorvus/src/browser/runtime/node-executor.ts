import { spawn } from "node:child_process"

import {
  type BrowserNodeSidecarRuntime,
  resolveBrowserNodeSidecarRuntime,
} from "./node-sidecar"

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
    throw new BrowserNodeSidecarError("aborted", input.signal.reason instanceof Error ? input.signal.reason.message : `${input.label} aborted`)
  }
  const runtime = input.runtime ?? await resolveBrowserNodeSidecarRuntime()
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
    child.kill()
  }
  input.signal?.addEventListener("abort", abortHandler, { once: true })
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new BrowserNodeSidecarError(
        "timeout",
        `${input.label} timed out after ${input.hardTimeoutMs}ms. stderr=${stderr.slice(-2000)}`,
        { stderr },
      ))
    }, input.hardTimeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  }).catch((error) => ({
    code: 1,
    signal: null,
    error,
  })).finally(() => {
    input.signal?.removeEventListener("abort", abortHandler)
  })

  if ("error" in exit) {
    const error = exit.error
    if (error instanceof BrowserNodeSidecarError) throw error
    throw new BrowserNodeSidecarError("spawn", error instanceof Error ? error.message : String(error), { stderr }, { cause: error })
  }
  if (aborted) {
    throw new BrowserNodeSidecarError(
      "aborted",
      input.signal?.reason instanceof Error ? input.signal.reason.message : `${input.label} aborted`,
      { stderr },
    )
  }

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
