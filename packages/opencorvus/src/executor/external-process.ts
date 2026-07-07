import { createInterface } from "readline"
import { text } from "node:stream/consumers"
import { Process } from "@/util/process"
import { normalizeExecutableArgv } from "@/util/command"
import { ProcessSupervisor } from "@/shell/process-supervisor"

const PROCESS_EXIT_TIMEOUT_MS = 5_000

/**
 * Stream a subprocess's stdout as JSON lines.
 *
 * Resource-leak contract: when the consumer of this stream stops early
 * (`break` out of `for await`, throw inside the loop, or otherwise drops
 * the iterator), the iterator's `return()` MUST tear the subprocess tree
 * down. Otherwise the child (claude-code SDK / codex CLI / any JSON stream
 * helper) keeps running detached and orphans on the OS.
 *
 * Earlier the finally only closed the readline; the eventual
 * `await Promise.all([proc.exited, stderr])` AFTER the `for await` loop
 * never ran on early-exit (generator suspended past the yield), so
 * proc.exited was never awaited and proc was never told to stop.
 * Connecting `input.signal` is helpful but not sufficient — many callers
 * don't pass a signal, and even when they do, `for await` exit doesn't
 * trigger that signal automatically.
 *
 * Now: the returned iterator owns `return()` directly. Early return,
 * stream close, and stream error all flow through one cleanup promise that
 * terminates the subprocess tree, drains stderr/stdout, and only then
 * surfaces cleanup or non-zero exit errors.
 */
export function jsonLines(input: {
  command: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  signal?: AbortSignal
}): AsyncIterableIterator<Record<string, unknown>> {
  const command = normalizeExecutableArgv(input.command)
  const proc = Process.spawn(command, {
    cwd: input.cwd,
    env: input.env,
    stdin: input.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    abort: input.signal,
  })
  if (!proc.stdout || !proc.stderr) {
    throw new Error(`Command output not available: ${command.join(" ")}`)
  }
  const stdout = proc.stdout
  const stderr = proc.stderr

  const stderrPromise = text(stderr)
  if (input.stdin !== undefined && proc.stdin) {
    proc.stdin.write(input.stdin)
    proc.stdin.end()
  }

  const rl = createInterface({
    input: stdout,
    crlfDelay: Infinity,
  })
  const queuedLines: string[] = []
  let stdoutClosed = false
  let stdoutError: unknown
  let wakeLineReader: (() => void) | undefined

  const wakeLine = () => {
    const wake = wakeLineReader
    wakeLineReader = undefined
    wake?.()
  }
  const onLine = (line: string) => {
    queuedLines.push(line)
    wakeLine()
  }
  const onReaderClose = () => {
    stdoutClosed = true
    wakeLine()
  }
  const onReaderError = (error: unknown) => {
    stdoutError = error
    stdoutClosed = true
    wakeLine()
  }
  const readLine = async (): Promise<string | undefined> => {
    while (queuedLines.length === 0) {
      if (stdoutError) throw stdoutError
      if (stdoutClosed) return undefined
      await new Promise<void>((resolve) => {
        wakeLineReader = resolve
      })
    }
    return queuedLines.shift()
  }

  rl.on("line", onLine)
  rl.once("close", onReaderClose)
  rl.once("error", onReaderError)
  stdout.once("error", onReaderError)

  let exitCode: number | undefined
  let stderrBody = ""
  let exitError: unknown
  let cleanupPromise: Promise<void> | undefined
  let consumerCompleted = false

  const cleanup = async () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      rl.off("line", onLine)
      rl.off("close", onReaderClose)
      rl.off("error", onReaderError)
      stdout.off("error", onReaderError)
      rl.close()

      // Terminate the subprocess tree if it's still alive — covers consumer
      // early-break (iterator return()), upstream throw, or natural EOF where
      // the child is hung waiting on stdin / network.
      try {
        await proc.terminate()
      } catch (error) {
        exitError = error
      }

      // Drain proc.exited + stderr inside cleanup so we always settle them
      // before the iterator returns. Catch errors (kill races, abort) so a
      // teardown failure can't shadow the original consumer exception.
      try {
        exitCode = await ProcessSupervisor.awaitWithTimeout(
          proc.exited,
          PROCESS_EXIT_TIMEOUT_MS,
          `JSON-lines process did not exit after cleanup: ${command.join(" ")}`,
        )
      } catch (error) {
        exitError = error
      }
      if (!exitError) {
        try {
          stderrBody = await stderrPromise
        } catch {
          /* ignore */
        }
      }
    })()
    return cleanupPromise
  }

  const surfaceCleanupFailure = async () => {
    await cleanup()
    if (exitError) throw exitError
  }

  const finishCompletedStream = async () => {
    consumerCompleted = true
    await cleanup()
    if (exitError) throw exitError
    if (input.signal?.aborted) return
    if (exitCode === 0 || exitCode === undefined) return
    const detail = stderrBody.trim() || `Command failed with exit code ${exitCode}: ${command.join(" ")}`
    throw new Error(detail)
  }

  const iterator: AsyncIterableIterator<Record<string, unknown>> = {
    [Symbol.asyncIterator]() {
      return iterator
    },
    async next() {
      while (true) {
        if (cleanupPromise) return { done: true, value: undefined as unknown as Record<string, unknown> }
        const line = await readLine()
        if (line === undefined) {
          await finishCompletedStream()
          return { done: true, value: undefined as unknown as Record<string, unknown> }
        }
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          return { done: false, value: JSON.parse(trimmed) as Record<string, unknown> }
        } catch {
          // ignore non-json lines from progress or human-readable stderr bridges
        }
      }
    },
    async return() {
      if (!consumerCompleted) await surfaceCleanupFailure()
      return { done: true, value: undefined as unknown as Record<string, unknown> }
    },
    async throw(error?: unknown) {
      if (!consumerCompleted) await surfaceCleanupFailure()
      throw error
    },
  }

  return iterator
}
