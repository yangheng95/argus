import path from "path"
import type { ModelMessage } from "ai"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Trace } from "@/trace"

const TRACE_DIR = path.join(Global.Path.data, "llm-trace")

const MAX_DEPTH = 8
const MAX_ARRAY = 120
const MAX_KEYS = 120
const MAX_TEXT = 8_000

type StepLike = {
  finishReason: string
  usage: unknown
  request: {
    body?: unknown
  }
  response: {
    id: string
    timestamp: Date
    modelId: string
    headers?: Record<string, string>
  }
  text: string
  reasoningText: string | undefined
  toolCalls: readonly unknown[]
  toolResults: readonly unknown[]
  warnings: unknown
}

type FinishLike = StepLike & {
  steps: readonly StepLike[]
  totalUsage: unknown
}

type AbortLike = {
  steps: readonly StepLike[]
}

export type CallRecord = {
  version: 1
  type: "llm_call"
  call_id: string
  session_id: string
  user_message_id: string
  started_at: number
  ended_at: number
  status: "finished" | "aborted" | "error"
  model: {
    provider_id: string
    model_id: string
  }
  agent: {
    name: string
    mode: string
  }
  small: boolean
  request: {
    system: string[]
    messages: unknown
    tools: string[]
    tool_choice: string | null
    max_retries: number
    max_output_tokens: number | null
    temperature: number | null
    top_p: number | null
    top_k: number | null
    headers: Record<string, string>
    provider_options: unknown
  }
  steps: Array<{
    index: number
    finish_reason: string
    usage: unknown
    request_body: unknown
    response: {
      id: string
      timestamp: string
      model_id: string
      headers?: Record<string, string>
    }
    text: string
    reasoning_text: string | undefined
    tool_calls: unknown
    tool_results: unknown
    warnings: unknown
  }>
  finish_reason: string | null
  total_usage: unknown
  error: unknown
}

export namespace LLMTrace {
  export type StartInput = {
    callID: string
    sessionID: string
    userMessageID: string
    model: {
      providerID: string
      modelID: string
    }
    agent: {
      name: string
      mode: string
    }
    small: boolean
    request: {
      system: string[]
      messages: ModelMessage[]
      tools: string[]
      toolChoice: string | null
      maxRetries: number
      maxOutputTokens: number | null
      temperature: number | null
      topP: number | null
      topK: number | null
      headers: Record<string, string>
      providerOptions: unknown
    }
  }

  type Recorder = {
    step(step: StepLike): void
    finish(step: FinishLike): void
    abort(step: AbortLike): void
    error(error: unknown): void
  }

  export function filepath(sessionID: string) {
    return path.join(TRACE_DIR, `${sessionID}.jsonl`)
  }

  /**
   * Read pre-existing legacy session-scoped JSONL files. New runs no longer
   * write here — Trace is the single source of truth — but historic files
   * are still parsed so cli/cmd/export, orchestrator/publisher, server/
   * routes/{export,session-management-share}, tool/panel can render
   * archived sessions captured before the migration.
   */
  export async function read(sessionID: string): Promise<CallRecord[]> {
    const raw = await Filesystem.readText(filepath(sessionID)).catch(() => "")
    if (!raw.trim()) return []
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as CallRecord
          return value.type === "llm_call" ? [value] : []
        } catch {
          return []
        }
      })
  }

  function trimText(text: string) {
    if (text.length <= MAX_TEXT) return text
    return `${text.slice(0, MAX_TEXT)}\n...[truncated ${text.length - MAX_TEXT} chars]`
  }

  function normalize(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value
    if (typeof value === "number" || typeof value === "boolean") return value
    if (typeof value === "string") {
      if (value.startsWith("data:") && value.length > MAX_TEXT) {
        const comma = value.indexOf(",")
        if (comma > 0) {
          const head = value.slice(0, comma + 1)
          return `${head}...[base64 omitted ${value.length - comma - 1} chars]`
        }
      }
      return trimText(value)
    }
    if (value instanceof Date) return value.toISOString()
    if (typeof value === "bigint") return value.toString()
    if (depth >= MAX_DEPTH) return "[max-depth]"

    if (Array.isArray(value)) {
      const list = value.slice(0, MAX_ARRAY).map((item) => normalize(item, depth + 1, seen))
      if (value.length > MAX_ARRAY) list.push(`[+${value.length - MAX_ARRAY} items]`)
      return list
    }

    if (typeof value === "object") {
      const set = seen ?? new WeakSet<object>()
      if (set.has(value)) return "[circular]"
      set.add(value)
      const entries = Object.entries(value as Record<string, unknown>)
      const obj: Record<string, unknown> = {}
      for (const [index, [key, val]] of entries.entries()) {
        if (index >= MAX_KEYS) {
          obj["..."] = `[+${entries.length - MAX_KEYS} keys]`
          break
        }
        obj[key] = normalize(val, depth + 1, set)
      }
      return obj
    }

    return String(value)
  }

  function normalizeError(error: unknown) {
    if (error instanceof Error) {
      return normalize({
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause,
      })
    }
    return normalize(error)
  }

  export function begin(input: StartInput): Recorder {
    const start = Date.now()
    const steps: StepLike[] = []
    let done = false

    // Resolve which task owns this session — Trace routes events into that
    // task's JSONL. Unbound sessions fall back to sessionID as the trace key
    // so orphan calls still get captured (see Trace.taskIDForSession).
    const taskID = Trace.taskIDForSession(input.sessionID)
    const traceMeta = {
      taskID,
      sessionID: input.sessionID,
      agent: input.agent.name,
    }

    Trace.event({
      ...traceMeta,
      category: "agent.start",
      payload: {
        call_id: input.callID,
        model: { providerID: input.model.providerID, modelID: input.model.modelID },
        small: input.small,
        tool_count: input.request.tools.length,
        message_count: input.request.messages.length,
      },
    })

    const finalize = (result: {
      status: CallRecord["status"]
      finishReason: string | null
      totalUsage: unknown
      error: unknown
      stepData: readonly StepLike[]
    }) => {
      if (done) return
      done = true
      // Legacy session-scoped JSONL writes have been retired — Trace is now
      // the single source of truth. The 5 LLMTrace.read() consumers still
      // load any pre-existing <sessionID>.jsonl files for backward compat,
      // but new calls only stream into the per-task Trace JSONL.
      Trace.event({
        ...traceMeta,
        category: result.status === "error" ? "llm.error" : result.status === "aborted" ? "llm.error" : "llm.finish",
        payload: {
          call_id: input.callID,
          status: result.status,
          finish_reason: result.finishReason,
          total_usage: normalize(result.totalUsage),
          duration_ms: Date.now() - start,
          step_count: result.stepData.length,
          error: normalize(result.error),
        },
      })
      Trace.event({
        ...traceMeta,
        category: "agent.finish",
        payload: { call_id: input.callID, status: result.status },
      })
    }

    return {
      step(step) {
        if (done) return
        steps.push(step)
        Trace.event({
          ...traceMeta,
          category: "llm.step",
          round: steps.length,
          payload: {
            call_id: input.callID,
            finish_reason: step.finishReason,
            text_len: step.text?.length ?? 0,
            reasoning_len: step.reasoningText?.length ?? 0,
            tool_call_count: step.toolCalls?.length ?? 0,
            tool_result_count: step.toolResults?.length ?? 0,
            usage: normalize(step.usage),
          },
        })
        for (const call of step.toolCalls ?? []) {
          const c = call as { toolCallId?: string; toolName?: string; input?: unknown }
          Trace.event({
            ...traceMeta,
            category: "tool.call",
            round: steps.length,
            payload: {
              call_id: c.toolCallId,
              tool: c.toolName,
              input: normalize(c.input),
              llm_call_id: input.callID,
            },
          })
        }
        for (const result of step.toolResults ?? []) {
          const r = result as { toolCallId?: string; toolName?: string; output?: unknown; isError?: boolean }
          Trace.event({
            ...traceMeta,
            category: r.isError ? "tool.error" : "tool.result",
            round: steps.length,
            payload: {
              call_id: r.toolCallId,
              tool: r.toolName,
              output: normalize(r.output),
              llm_call_id: input.callID,
            },
          })
        }
      },
      finish(step) {
        finalize({
          status: "finished",
          finishReason: step.finishReason,
          totalUsage: step.totalUsage,
          error: null,
          stepData: step.steps.length > 0 ? step.steps : steps,
        })
      },
      abort(step) {
        finalize({
          status: "aborted",
          finishReason: null,
          totalUsage: null,
          error: null,
          stepData: step.steps.length > 0 ? step.steps : steps,
        })
      },
      error(error) {
        finalize({
          status: "error",
          finishReason: null,
          totalUsage: null,
          error: normalizeError(error),
          stepData: steps,
        })
      },
    }
  }
}
