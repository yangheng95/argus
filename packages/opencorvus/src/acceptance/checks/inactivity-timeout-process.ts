import { spawn } from "node:child_process"

export type InactivityTimeoutProcessResult = {
  exitCode: number | undefined
  stdout: string
  stderr: string
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
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let settled = false

  const exitCode = await new Promise<number | undefined>((resolve) => {
    const finish = (code: number | undefined) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(code)
    }
    const refreshTimer = () => {
      if (settled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        proc.kill()
        finish(undefined)
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
    proc.once("exit", (code) => finish(code ?? undefined))
    refreshTimer()
  })

  const stdout = Buffer.concat(stdoutChunks).toString("utf8")
  const stderr = Buffer.concat(stderrChunks).toString("utf8")
  return {
    exitCode,
    stdout,
    stderr: timedOut
      ? `${stderr}\nCommand timed out after ${input.timeoutMs}ms without stdout/stderr activity.`
      : stderr,
  }
}
