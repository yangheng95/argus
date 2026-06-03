import { NamedError } from "@opencorvus-ai/util/error"
import { Snapshot } from "@/snapshot"
import z from "zod"

export const ExecutorName = z.enum(["opencorvus", "codex", "claude-code"])
export type ExecutorNameInfo = z.infer<typeof ExecutorName>

export const CodingExecutor = z.enum(["codex", "claude-code"])
export type CodingExecutorInfo = z.infer<typeof CodingExecutor>

export const CodingTool = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("builtin"),
    name: z.string(),
  }),
  z.object({
    type: z.literal("function"),
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
  }),
])
export type CodingToolInfo = z.infer<typeof CodingTool>
export type ExecutorStatusInfo = "queued" | "retrying" | "running" | "blocked" | "completed" | "failed"

export const ToolMode = z.enum(["default", "none"])
export type ToolModeInfo = z.infer<typeof ToolMode>

export const SandboxMode = z.enum(["read-only", "workspace-write", "danger-full-access"])
export type SandboxModeInfo = z.infer<typeof SandboxMode>

export const CodingRunInput = z.object({
  sessionID: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string(),
  taskID: z.string().optional(),
  logicalSessionID: z.string().optional(),
  runtimeDir: z.string().optional(),
  worktreeDir: z.string().optional(),
  cwd: z.string().optional(),
  system: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  tools: CodingTool.array().optional(),
  toolMode: ToolMode.optional(),
  sandbox: SandboxMode.optional(),
})

export const CodingResumeInput = CodingRunInput.extend({
  sessionID: z.string(),
})

export type CodingRunInfo = z.infer<typeof CodingRunInput> & { signal?: AbortSignal }
export type CodingResumeInfo = z.infer<typeof CodingResumeInput> & { signal?: AbortSignal }

export type CodingProviderOptions = {
  model?: string | (() => string | undefined)
  cwd?: string | (() => string | undefined)
  system?: string | (() => string | undefined)
  maxTurns?: number | (() => number | undefined)
  tools?: CodingToolInfo[] | (() => CodingToolInfo[] | undefined)
}

export function codingRuntimeEnv(input: {
  taskID?: string
  logicalSessionID?: string
  runtimeDir?: string
  worktreeDir?: string
}): Record<string, string> {
  return {
    ...(input.taskID ? { OPENCORVUS_TASK_ID: input.taskID } : {}),
    ...(input.logicalSessionID ? { OPENCORVUS_SESSION_ID: input.logicalSessionID } : {}),
    ...(input.runtimeDir ? { OPENCORVUS_RUNTIME_DIR: input.runtimeDir } : {}),
    ...(input.worktreeDir ? { OPENCORVUS_WORKTREE_DIR: input.worktreeDir } : {}),
  }
}

export const PlanningStage = z.enum(["spec", "plan"])
export type PlanningStageInfo = z.infer<typeof PlanningStage>

export const PlanningCapabilities = z.object({
  spec: z.boolean(),
  plan: z.boolean(),
})
export type PlanningCapabilitiesInfo = z.infer<typeof PlanningCapabilities>

export const PlanningInput = z.object({
  stage: PlanningStage,
  prompt: z.string(),
  cwd: z.string().optional(),
  system: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  toolMode: ToolMode.optional(),
  sandbox: SandboxMode.optional(),
})
export type PlanningInputInfo = z.infer<typeof PlanningInput> & { signal?: AbortSignal }

export const CodingCapabilities = z.object({
  builtinTools: z.boolean(),
  customTools: z.boolean(),
  stream: z.boolean(),
  resume: z.boolean(),
  interrupt: z.boolean(),
  cwd: z.boolean(),
  system: z.boolean(),
})
export type CodingCapabilitiesInfo = z.infer<typeof CodingCapabilities>

export const ExecutorNotConfiguredError = NamedError.create(
  "ExecutorNotConfiguredError",
  z.object({
    executor: ExecutorName,
    message: z.string(),
  }),
)

export type ExecutorAdapter = {
  capabilities(): {
    submit: boolean
    status: boolean
    abort: boolean
    acceptance: boolean
    resume: boolean
    events: boolean
  }
  submit(input: {
    sessionID: string
    prompt: string
    priority?: "critical" | "high" | "normal" | "low"
    source?: "evaluator" | "system"
    taskID?: string
    logicalSessionID?: string
    runtimeDir?: string
    worktreeDir?: string
    cwd?: string
    /** Per-submission system prompt override — takes precedence over options.system. */
    system?: string
  }): Promise<{
    sessionID: string
    queueTaskID: string
  }>
  status(queueTaskID: string): Promise<{
    queueTaskID: string
    status: ExecutorStatusInfo
    error: string | null
  }>
  abort(input: { sessionID?: string; queueTaskID?: string }): Promise<boolean>
  acceptance(input: { sessionID: string; since?: number }): Promise<{
    summary: string
    diffs: z.infer<typeof Snapshot.FileDiff>[]
  }>
  resume(input: {
    sessionID: string
    message: string
    taskID?: string
    logicalSessionID?: string
    runtimeDir?: string
    worktreeDir?: string
    priority?: "critical" | "high" | "normal" | "low"
  }): Promise<{
    sessionID: string
    queueTaskID: string
  }>
  events(input: {
    goalID?: string
    sessionID?: string
    queueTaskID?: string
    signal?: AbortSignal
  }): AsyncIterable<{
    type: string
    summary?: string
    payload?: Record<string, unknown>
  }>
  planningCapabilities?(): PlanningCapabilitiesInfo
  generatePlanning?(input: PlanningInputInfo): Promise<{
    output: string
  }>
  resolve?(input: {
    sessionID?: string
    queueTaskID?: string
    requestID: string
    kind: "approval" | "input"
    response?: Record<string, unknown>
    error?: Record<string, unknown>
  }): Promise<boolean>
}

const Meta = z.record(z.string(), z.unknown())

export const CodingEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    phase: z.string(),
    summary: z.string().optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("text_delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string(),
    name: z.string(),
    input: z.union([z.string(), z.record(z.string(), z.unknown())]),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("tool_delta"),
    id: z.string(),
    name: z.string().optional(),
    delta: z.string(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string(),
    name: z.string().optional(),
    input: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    output: z.string(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("reasoning_delta"),
    text: z.string(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("plan_delta"),
    summary: z.string().optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("diff_delta"),
    summary: z.string().optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("approval_request"),
    id: z.string(),
    approval: z.string(),
    message: z.string().optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("input_request"),
    id: z.string(),
    questions: z.array(z.record(z.string(), z.unknown())).optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    costUSD: z.number().nonnegative().optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("done"),
    sessionID: z.string().optional(),
    output: z.string().optional(),
    costUSD: z.number().optional(),
    turns: z.number().int().optional(),
    meta: Meta.optional(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    meta: Meta.optional(),
  }),
])
export type CodingEventInfo = z.infer<typeof CodingEvent>

export interface CodingProvider {
  name: CodingExecutorInfo
  capabilities(): CodingCapabilitiesInfo
  run(input: CodingRunInfo): AsyncIterable<CodingEventInfo>
  resume(input: CodingResumeInfo): AsyncIterable<CodingEventInfo>
  interrupt(sessionID: string): Promise<boolean>
  respond?(input: {
    sessionID: string
    requestID: string
    kind: "approval" | "input"
    response?: Record<string, unknown>
    error?: Record<string, unknown>
  }): Promise<boolean>
}

export function text(input: unknown) {
  if (typeof input === "string") return input
  if (input === undefined || input === null) return ""
  if (typeof input === "number" || typeof input === "boolean") return String(input)
  const value = JSON.stringify(input)
  return typeof value === "string" ? value : ""
}

export function record(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

export function structuredInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    } catch {}
    return { value: raw }
  }
  return {}
}

export async function* decode<T>(raw: AsyncIterable<T>, push: (item: T) => CodingEventInfo[]) {
  for await (const item of raw) {
    for (const part of push(item)) {
      yield CodingEvent.parse(part)
    }
  }
}
