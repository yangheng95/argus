import { spawn, type ChildProcess } from "node:child_process"
import { ProcessSupervisor } from "@/shell/process-supervisor"

export type InactivityTimeoutProcessResult = {
  exitCode: number | undefined
  stdout: string
  stderr: string
}

const TERMINATE_FINAL_MS = 5_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function signalProcessTree(proc: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  const pid = proc.pid
  if (!pid) return
  if (process.platform === "win32") {
    await ProcessSupervisor.terminateProcessTree(pid, `inactivity timeout process tree ${pid}`)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== "ESRCH") proc.kill(signal)
  }
}

export async function runProcessWithInactivityTimeout(input: {
  executable: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
}): Promise<InactivityTimeoutProcessResult> {
  const proc = spawn(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  let finalTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let settled = false
  let cleanupError: unknown

  const exitCode = await new Promise<number | undefined>((resolve) => {
    const clearTimers = () => {
      if (timer) clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      if (finalTimer) clearTimeout(finalTimer)
    }
    const finish = (code: number | undefined) => {
      if (settled) return
      settled = true
      clearTimers()
      resolve(code)
    }
    const recordCleanupError = (error: unknown) => {
      cleanupError = error
      proc.stdout.destroy()
      proc.stderr.destroy()
      finish(undefined)
    }
    const terminateTimedOutProcessTree = async () => {
      if (process.platform === "win32") {
        await signalProcessTree(proc, "SIGKILL")
        return
      }
      await signalProcessTree(proc, "SIGTERM")
      forceTimer = setTimeout(() => {
        void signalProcessTree(proc, "SIGKILL").catch(recordCleanupError)
      }, ProcessSupervisor.TERMINATION_EXIT_TIMEOUT_MS)
    }
    const refreshTimer = () => {
      if (settled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        void terminateTimedOutProcessTree().catch(recordCleanupError)
        finalTimer = setTimeout(() => {
          proc.stdout.destroy()
          proc.stderr.destroy()
          finish(undefined)
        }, TERMINATE_FINAL_MS)
      }, input.timeoutMs)
    }

    proc.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk))
      refreshTimer()
    })
    proc.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk))
      refreshTimer()
    })
    proc.once("error", () => finish(undefined))
    proc.once("close", (code) => finish(timedOut ? undefined : (code ?? undefined)))
    refreshTimer()
  })

  const stdout = Buffer.concat(stdoutChunks).toString("utf8")
  const stderr = Buffer.concat(stderrChunks).toString("utf8")
  const timeoutMessage = `Command timed out after ${input.timeoutMs}ms without stdout/stderr activity.`
  const cleanupMessage = cleanupError ? `\nTimeout cleanup failed: ${errorMessage(cleanupError)}` : ""
  return {
    exitCode,
    stdout,
    stderr: timedOut ? `${stderr}\n${timeoutMessage}${cleanupMessage}` : stderr,
  }
}
