import { spawn as launch, type ChildProcess } from "child_process"
import { buffer } from "node:stream/consumers"
import { normalizeExecutableArgv } from "./command"
import { ProcessSupervisor } from "@/shell/process-supervisor"

const PROCESS_CLOSE_TIMEOUT_MS = 5_000

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore"

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv | null
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    abort?: AbortSignal
  }

  export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
    nothrow?: boolean
  }

  export interface Result {
    code: number
    stdout: Buffer
    stderr: Buffer
  }

  export class RunFailedError extends Error {
    readonly cmd: string[]
    readonly code: number
    readonly stdout: Buffer
    readonly stderr: Buffer

    constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
      const text = stderr.toString().trim()
      super(
        text
          ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
          : `Command failed with code ${code}: ${cmd.join(" ")}`,
      )
      this.name = "ProcessRunFailedError"
      this.cmd = [...cmd]
      this.code = code
      this.stdout = stdout
      this.stderr = stderr
    }
  }

  export type Child = ChildProcess & {
    exited: Promise<number>
    terminate(): Promise<void>
  }

  export function spawn(cmd: string[], opts: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    opts.abort?.throwIfAborted()
    const command = normalizeExecutableArgv(cmd)

    const proc = launch(command[0], command.slice(1), {
      cwd: opts.cwd,
      env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
      stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
      detached: process.platform !== "win32",
    })

    let termination: Promise<void> | undefined
    let rejectExited: ((error: Error) => void) | undefined
    let closed = false
    let exited: Promise<number>

    const terminate = () => {
      if (termination) return termination
      if (!proc.pid) throw new Error(`Process tree termination requires a process id: ${command.join(" ")}`)
      const cleanup =
        process.platform === "win32"
          ? ProcessSupervisor.terminateProcessTree(proc.pid, `process tree ${command.join(" ")}`)
          : ProcessSupervisor.terminateProcessGroup(proc.pid, `process group ${command.join(" ")}`)
      termination = cleanup
        .then(() =>
          ProcessSupervisor.awaitWithTimeout(
            exited,
            PROCESS_CLOSE_TIMEOUT_MS,
            `Process did not close after tree cleanup: ${command.join(" ")}`,
          ),
        )
        .then(() => undefined)
        .catch((error) => {
          const failure = error instanceof Error ? error : new Error(String(error))
          if (!closed) rejectExited?.(failure)
          throw failure
        })
      return termination
    }

    const abort = () => {
      try {
        void terminate().catch(() => undefined)
      } catch {
        // The owning caller observes termination failures through explicit terminate() calls.
      }
    }

    exited = new Promise<number>((resolve, reject) => {
      rejectExited = (error) => {
        done()
        reject(error)
      }
      const done = () => {
        opts.abort?.removeEventListener("abort", abort)
      }

      proc.once("close", (code, signal) => {
        closed = true
        done()
        resolve(code ?? (signal ? 1 : 0))
      })

      proc.once("error", (error) => {
        done()
        reject(error)
      })
    })

    if (opts.abort) {
      opts.abort.addEventListener("abort", abort, { once: true })
      if (opts.abort.aborted) abort()
    }

    const child = proc as Child
    child.exited = exited
    child.terminate = terminate
    return child
  }

  export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
    const command = normalizeExecutableArgv(cmd)
    const proc = spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env,
      stdin: opts.stdin,
      abort: opts.abort,
      stdout: "pipe",
      stderr: "pipe",
    })

    if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

    let code: number
    let stdout: Buffer
    let stderr: Buffer
    try {
      ;[code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    } finally {
      await proc.terminate()
    }
    const out = {
      code,
      stdout,
      stderr,
    }
    if (out.code === 0 || opts.nothrow) return out
    throw new RunFailedError(command, out.code, out.stdout, out.stderr)
  }
}
