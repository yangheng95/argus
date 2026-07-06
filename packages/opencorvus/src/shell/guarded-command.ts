import { createIsolatedProjectCheckWorkspace, type IsolatedProjectCheckWorkspace } from "@/project/isolated-check-workspace"
import { Log } from "@/util/log"
import { ProcessSupervisor } from "@/shell/process-supervisor"
import { Shell } from "@/shell/shell"

const log = Log.create({ service: "guarded-command" })

export type GuardedCommandInput = {
  command: string
  projectDir: string
  taskID?: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  background?: boolean
}

export async function runGuardedCommand(input: GuardedCommandInput): Promise<string> {
  const isolated = await createIsolatedProjectCheckWorkspace({
    projectDir: input.projectDir,
    sourceCwd: input.projectDir,
    taskID: input.taskID,
  })
  const scopedInput = { ...input, projectDir: isolated.workspace }
  try {
    const backgroundResult = input.background ? await runBackgroundCommand(scopedInput) : undefined
    const parts = backgroundResult ? backgroundResult.parts : await runForegroundCommand(scopedInput)
    parts.unshift(`source_cwd: ${input.projectDir}`, `execution_cwd: ${isolated.workspace}`)
    if (input.background) {
      scheduleWorkspaceCleanup(isolated, input.timeoutMs, input.signal, backgroundResult!.exited)
    } else {
      await isolated.dispose()
    }
    return parts.join("\n") || "exit_code: 0 (no output)"
  } catch (error) {
    await isolated.dispose().catch(() => undefined)
    throw error
  }
}

async function runForegroundCommand(input: GuardedCommandInput): Promise<string[]> {
  const result = await Shell.run(input.command, {
    cwd: input.projectDir,
    env: input.env,
    timeoutMs: input.timeoutMs,
    abort: input.signal,
  })
  const parts = [`exit_code: ${result.exitCode}`]
  if (typeof result.pid === "number") parts.push(`pid: ${result.pid}`)
  if (result.timedOut) parts.push(`timeout_ms: ${input.timeoutMs}`)
  if (result.idleTimedOut) parts.push("idle_timeout: true")
  if (result.aborted) parts.push("aborted: true")
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.slice(0, 8_000)}`)
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.slice(0, 5_000)}`)
  return parts
}

async function runBackgroundCommand(input: GuardedCommandInput): Promise<{ parts: string[]; exited: Promise<void> }> {
  const result = await Shell.launch(input.command, {
    cwd: input.projectDir,
    env: input.env,
    outputSniffMs: Math.min(input.timeoutMs, 10_000),
    leaseMs: input.timeoutMs,
    abort: input.signal,
  })
  return {
    exited: result.exited,
    parts: [
      "background: true",
      `pid: ${result.pid}`,
      result.address ? `url: ${result.address}` : "",
      `lease_timeout_ms: ${input.timeoutMs}`,
      result.initialOutput.trim() ? `startup_output:\n${result.initialOutput}` : "",
    ].filter((part) => part.length > 0),
  }
}

function scheduleWorkspaceCleanup(
  workspace: IsolatedProjectCheckWorkspace,
  leaseMs: number,
  signal: AbortSignal | undefined,
  processExited: Promise<void>,
): void {
  let cleaned = false
  const cleanupDelayMs = Math.max(leaseMs, 1) + 1_000
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    clearTimeout(timer)
    signal?.removeEventListener("abort", cleanup)
    void cleanupBackgroundWorkspace(workspace, processExited).catch((error) => {
      log.error("failed to clean isolated background command workspace", {
        workspace: workspace.root,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  const timer = setTimeout(cleanup, cleanupDelayMs)
  timer.unref?.()
  processExited.finally(cleanup).catch(cleanup)
  if (signal?.aborted) cleanup()
  else signal?.addEventListener("abort", cleanup, { once: true })
}

async function cleanupBackgroundWorkspace(
  workspace: IsolatedProjectCheckWorkspace,
  processExited: Promise<void>,
): Promise<void> {
  await waitForBackgroundExit(processExited, 5_000)
  await ProcessSupervisor.disposeLiveProcessesUnder(workspace.root)
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await workspace.dispose()
      return
    } catch (error) {
      lastError = error
      await Bun.sleep(100)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "unknown workspace cleanup failure"))
}

async function waitForBackgroundExit(processExited: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      processExited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
