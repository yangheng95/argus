import { NamedError } from "@opencorvus-ai/util/error"
import { Snapshot } from "@/snapshot"
import z from "zod"

export const ExecutorName = z.enum(["opencode", "codex", "claude-code"])
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

export const CodingRunInput = z.object({
  model: z.string().optional(),
  prompt: z.string(),
  cwd: z.string().optional(),
  system: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  tools: CodingTool.array().optional(),
})

export const CodingResumeInput = CodingRunInput.extend({
  sessionID: z.string(),
})

export type CodingRunInfo = z.infer<typeof CodingRunInput> & { signal?: AbortSignal }
export type CodingResumeInfo = z.infer<typeof CodingResumeInput> & { signal?: AbortSignal }

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
    delivery: boolean
    resume: boolean
    events: boolean
  }
  submit(input: {
    sessionID: string
    prompt: string
    priority?: "high" | "normal" | "low"
    source?: "planner" | "scheduler" | "system"
  }): Promise<{
    sessionID: string
    queueTaskID: string
  }>
  status(queueTaskID: string): Promise<{
    queueTaskID: string
    status: "queued" | "retrying" | "running" | "completed" | "failed"
    error: string | null
  }>
  abort(input: { sessionID?: string; queueTaskID?: string }): Promise<boolean>
  delivery(input: { sessionID: string; since?: number }): Promise<{
    summary: string
    diffs: z.infer<typeof Snapshot.FileDiff>[]
  }>
  resume(input: {
    sessionID: string
    message: string
    priority?: "high" | "normal" | "low"
  }): Promise<{
    sessionID: string
    queueTaskID: string
  }>
  events(input: {
    sessionID: string
    signal?: AbortSignal
  }): AsyncIterable<{
    type: string
    summary?: string
    payload?: Record<string, unknown>
  }>
}

const Meta = z.record(z.string(), z.unknown())

export const CodingEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: z.string(),
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
    input: z.string(),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string(),
    output: z.string(),
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

export async function* decode<T>(raw: AsyncIterable<T>, push: (item: T) => CodingEventInfo[]) {
  for await (const item of raw) {
    for (const part of push(item)) {
      yield CodingEvent.parse(part)
    }
  }
}
