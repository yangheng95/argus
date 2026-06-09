import { createInterface } from "readline"
import { text } from "node:stream/consumers"
import { Process } from "@/util/process"
import { normalizeExecutableArgv } from "@/util/command"

/**
 * Stream a subprocess's stdout as JSON lines.
 *
 * Resource-leak contract: when the consumer of this generator stops early
 * (`break` out of `for await`, throw inside the loop, or otherwise drops
 * the iterator), the runtime invokes the generator's `return()` which
 * fires the `finally` block. The finally MUST tear the subprocess down —
 * otherwise the child (claude-code SDK / codex CLI / any json-stream
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
 * Now: finally always kills the subprocess (SIGTERM, then SIGKILL after
 * 5s via the Process util's built-in escalation), drains stderr/stdout,
 * and only THEN re-throws non-zero exit errors. The drain happens inside
 * finally so it always runs regardless of whether the consumer broke
 * early or completed normally.
 */
export async function* jsonLines(input: {
  command: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  signal?: AbortSignal
}) {
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

  const stderrPromise = text(proc.stderr)
  if (input.stdin !== undefined && proc.stdin) {
    proc.stdin.write(input.stdin)
    proc.stdin.end()
  }

  const rl = createInterface({
    input: proc.stdout,
    crlfDelay: Infinity,
  })

  let consumerAborted = true
  let exitCode: number | undefined
  let stderrBody = ""

  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        // ignore non-json lines from progress or human-readable stderr bridges
      }
    }
    consumerAborted = false
  } finally {
    rl.close()

    // Force-kill the subprocess if it's still alive — covers consumer
    // early-break (generator return()), upstream throw, or natural EOF
    // where the child is hung waiting on stdin / network. SIGTERM here;
    // Process.spawn's own watchdog escalates to SIGKILL after 5s.
    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill("SIGTERM")
      } catch {
        /* race: child already exited */
      }
    }

    // Drain proc.exited + stderr inside finally so we always settle them
    // before the generator returns. Catch errors (kill races, abort) so a
    // teardown failure can't shadow the original consumer exception.
    try {
      exitCode = await proc.exited
    } catch {
      /* ignore */
    }
    try {
      stderrBody = await stderrPromise
    } catch {
      /* ignore */
    }
  }

  // Only surface a non-zero exit when the consumer actually finished
  // reading AND the signal didn't request termination. Consumer
  // early-break and AbortSignal-driven SIGTERM both produce a non-zero
  // exit that the caller already expects; re-throwing would mask the
  // real reason the loop ended.
  if (consumerAborted) return
  if (input.signal?.aborted) return
  if (exitCode === 0 || exitCode === undefined) return
  const detail = stderrBody.trim() || `Command failed with exit code ${exitCode}: ${command.join(" ")}`
  throw new Error(detail)
}
