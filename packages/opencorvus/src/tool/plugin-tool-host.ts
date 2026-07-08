import type { ToolCommandRunInput, ToolCommandRunResult, ToolHost } from "@opencorvus-ai/plugin"
import { ProcessSupervisor } from "@/shell/process-supervisor"

const OUTPUT_CLOSE_TIMEOUT_MS = 1_000

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function collectOutput(
  stream: NodeJS.ReadableStream | null,
  append: (chunk: string) => void,
  onActivity: () => void,
): Promise<void> {
  if (!stream) return Promise.resolve()
  stream.setEncoding("utf8")
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    stream.on("data", (chunk) => {
      append(String(chunk))
      onActivity()
    })
    stream.once("end", finish)
    stream.once("close", finish)
    stream.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

async function waitForOutputClose(handle: ProcessSupervisor.Handle, stdoutClosed: Promise<void>, stderrClosed: Promise<void>) {
  await ProcessSupervisor.awaitWithTimeout(
    Promise.all([stdoutClosed, stderrClosed]),
    OUTPUT_CLOSE_TIMEOUT_MS,
    `plugin tool command ${handle.pid} output streams did not close within ${OUTPUT_CLOSE_TIMEOUT_MS}ms`,
  )
}

async function runCommand(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
  if (!input.executable.trim()) throw new Error("Tool host command executable must be nonempty.")
  if (!Array.isArray(input.args)) throw new Error("Tool host command args must be an array.")
  if (!input.cwd.trim()) throw new Error("Tool host command cwd must be nonempty.")
  if (!Number.isInteger(input.inactiveTimeoutMs) || input.inactiveTimeoutMs <= 0) {
    throw new Error("Tool host command inactiveTimeoutMs must be a positive integer.")
  }

  const startedAt = new Date()
  const startedMs = Date.now()
  const abort = input.abort ?? new AbortController().signal
  let stdout = ""
  let stderr = ""
  let timedOut = false
  let aborted = abort.aborted
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined
  let handle: ProcessSupervisor.Handle | undefined
  let termination: Promise<void> | undefined
  let terminationError: unknown
  let rejectTerminationFailure: (error: unknown) => void = () => {}
  const terminationFailure = new Promise<never>((_resolve, reject) => {
    rejectTerminationFailure = reject
  })

  const finish = (result: Pick<ToolCommandRunResult, "exitCode" | "signal" | "error">): ToolCommandRunResult => ({
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut,
    aborted,
    error: result.error,
    stdout,
    stderr,
  })

  if (aborted) {
    return finish({
      exitCode: null,
      signal: null,
      error: "Tool host command was aborted before spawn.",
    })
  }

  const clearInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = undefined
  }

  const requestTermination = () => {
    if (!handle || termination) return
    termination = ProcessSupervisor.terminateAndWaitForExit(handle, `plugin tool command ${handle.pid}`)
      .then(() => undefined)
      .catch((error) => {
        terminationError = error
        rejectTerminationFailure(error)
      })
  }

  const resetInactivityTimer = () => {
    clearInactivityTimer()
    inactivityTimer = setTimeout(() => {
      timedOut = true
      requestTermination()
    }, input.inactiveTimeoutMs)
  }

  const onAbort = () => {
    aborted = true
    requestTermination()
  }

  try {
    handle = await ProcessSupervisor.spawnCommand({
      executable: input.executable,
      args: input.args,
      cwd: input.cwd,
      env: input.env as NodeJS.ProcessEnv | undefined,
      stdin: "ignore",
    })
  } catch (error) {
    return finish({
      exitCode: null,
      signal: null,
      error: errorMessage(error),
    })
  }

  const stdoutClosed = collectOutput(
    handle.stdout,
    (chunk) => {
      stdout += chunk
    },
    resetInactivityTimer,
  )
  const stderrClosed = collectOutput(
    handle.stderr,
    (chunk) => {
      stderr += chunk
    },
    resetInactivityTimer,
  )

  let completion: Pick<ToolCommandRunResult, "exitCode" | "signal" | "error">
  try {
    abort.addEventListener("abort", onAbort, { once: true })
    if (abort.aborted) onAbort()
    resetInactivityTimer()
    completion = await Promise.race([
      handle.exited.then(
        (exitCode) => ({ exitCode, signal: null, error: null }),
        (error) => ({ exitCode: null, signal: null, error: errorMessage(error) }),
      ),
      terminationFailure,
    ])
  } finally {
    clearInactivityTimer()
    abort.removeEventListener("abort", onAbort)
  }

  if (termination) await termination
  if (terminationError) throw terminationError
  await ProcessSupervisor.disposeAndWaitForExit(handle, `plugin tool command ${handle.pid}`)
  await waitForOutputClose(handle, stdoutClosed, stderrClosed)

  return finish(completion)
}

export function createPluginToolHost(): ToolHost {
  return { runCommand }
}
