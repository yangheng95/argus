import { z } from "zod"

export type ToolCommandRunInput = {
  executable: string
  args: string[]
  cwd: string
  env?: Record<string, string | undefined>
  inactiveTimeoutMs: number
  abort?: AbortSignal
}

export type ToolCommandRunResult = {
  startedAt: string
  finishedAt: string
  durationMs: number
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  error: string | null
  stdout: string
  stderr: string
}

export type ToolHost = {
  runCommand(input: ToolCommandRunInput): Promise<ToolCommandRunResult>
}

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  /**
   * Current project directory for this session.
   * Prefer this over process.cwd() when resolving relative paths.
   */
  directory: string
  /**
   * Project worktree root for this session.
   * Useful for generating stable relative paths (e.g. path.relative(worktree, absPath)).
   */
  worktree: string
  abort: AbortSignal
  host: ToolHost
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
