import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Shell } from "@/shell/shell"

export type GuardedCommandInput = {
  command: string
  projectDir: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  background?: boolean
  readOnlyGuard?: boolean
}

export async function runGuardedCommand(input: GuardedCommandInput): Promise<string> {
  const beforeStatus = input.readOnlyGuard ? await gitShortStatus(input) : undefined
  const parts = input.background
    ? await runBackgroundCommand(input)
    : await runForegroundCommand(input)
  const afterStatus = input.readOnlyGuard ? await gitShortStatus(input) : undefined
  const warning = beforeStatus !== undefined && afterStatus !== undefined
    ? formatReadOnlyGuardWarning(beforeStatus, afterStatus)
    : undefined
  if (warning) parts.push(warning)
  return parts.join("\n") || "exit_code: 0 (no output)"
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

async function runBackgroundCommand(input: GuardedCommandInput): Promise<string[]> {
  const result = await Shell.launch(input.command, {
    cwd: input.projectDir,
    env: input.env,
    outputSniffMs: Math.min(input.timeoutMs, 10_000),
    leaseMs: input.timeoutMs,
  })
  return [
    "background: true",
    `pid: ${result.pid}`,
    result.address ? `url: ${result.address}` : "",
    `lease_timeout_ms: ${input.timeoutMs}`,
    result.initialOutput.trim() ? `startup_output:\n${result.initialOutput}` : "",
  ].filter((part) => part.length > 0)
}

async function gitShortStatus(input: GuardedCommandInput): Promise<string> {
  const status = await Shell.run("git status --short --untracked-files=all", {
    cwd: input.projectDir,
    env: input.env,
    timeoutMs: 10_000,
    abort: input.signal,
  })
  return normalizeReadOnlyGitStatus(status.stdout)
}

export function formatReadOnlyGuardWarning(beforeStatus: string, afterStatus: string): string | undefined {
  const before = normalizeReadOnlyGitStatus(beforeStatus)
  const after = normalizeReadOnlyGitStatus(afterStatus)
  if (before === after) return undefined
  return [
    "readonly_guard: implementation worktree changed during reviewer command; treat this as unsafe verification, not an implementation fix.",
    "before_status:",
    before || "(clean)",
    "after_status:",
    after || "(clean)",
  ].join("\n")
}

export function normalizeReadOnlyGitStatus(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => !statusLineTouchesOnlyEvidenceInput(line))
    .join("\n")
}

function statusLineTouchesOnlyEvidenceInput(line: string): boolean {
  const payload = line.length > 3 ? line.slice(3).trim() : line.trim()
  const paths = payload.split(" -> ").map(unquoteGitPath).filter((item) => item.length > 0)
  return paths.length > 0 && paths.every((item) => ProjectRuntimePaths.isEvidenceInputRelativePath(item))
}

function unquoteGitPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
  return trimmed
}
