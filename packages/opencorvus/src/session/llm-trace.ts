import type { ModelMessage } from "ai"
import { Trace } from "@/trace"
import { Log } from "@/util/log"

const log = Log.create({ service: "llm-trace" })

// Normalisation limits — keep payloads within Trace's 1MB per-event cap.
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
    // Count only — we emit per-step Trace events as they arrive, so nothing
    // downstream reads back the raw StepLike[]. Retaining the objects held
    // full request.body / response / toolResults in memory for the entire
    // LLM call (reasoning models can do 20+ rounds with large tool outputs).
    let stepCount = 0
    let done = false

    // Trace is per-task. Not every session is task-owned: MCP servers,
    // Debug-tool runs, direct Coding API, Panel control sessions, and
    // generic Session.create HTTP callers all produce sessions that
    // legitimately sit outside the orchestrator task tree. For those we
    // emit nothing to the per-task JSONL — it's not a bug, just not part
    // of the task trace surface.
    //
    // Task-owned sessions always reach a taskID via parent_id → root →
    // engine_task.session_id (this lookup is pure DB now, no
    // in-memory registry). If a session that *should* be task-owned
    // can't be resolved, that is a real bug — but LLMTrace can't tell
    // the two cases apart from here. `log.debug` keeps the evidence
    // without crashing the LLM call or flooding ERROR logs.
    const taskID = Trace.taskIDForSession(input.sessionID)
    if (!taskID) {
      log.debug("standalone session (no owning task) — skipping per-task trace", {
        sessionID: input.sessionID,
        agent: input.agent.name,
      })
      return {
        step() {},
        finish() {},
        abort() {},
        error() {},
      }
    }
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
      status: "finished" | "aborted" | "error"
      finishReason: string | null
      totalUsage: unknown
      error: unknown
      stepCount: number
    }) => {
      if (done) return
      done = true
      Trace.event({
        ...traceMeta,
        category: result.status === "error" ? "llm.error" : result.status === "aborted" ? "llm.error" : "llm.finish",
        payload: {
          call_id: input.callID,
          status: result.status,
          finish_reason: result.finishReason,
          total_usage: normalize(result.totalUsage),
          duration_ms: Date.now() - start,
          step_count: result.stepCount,
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
        stepCount += 1
        Trace.event({
          ...traceMeta,
          category: "llm.step",
          round: stepCount,
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
            round: stepCount,
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
            round: stepCount,
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
          stepCount: step.steps.length > 0 ? step.steps.length : stepCount,
        })
      },
      abort(step) {
        finalize({
          status: "aborted",
          finishReason: null,
          totalUsage: null,
          error: null,
          stepCount: step.steps.length > 0 ? step.steps.length : stepCount,
        })
      },
      error(error) {
        finalize({
          status: "error",
          finishReason: null,
          totalUsage: null,
          error: normalizeError(error),
          stepCount: stepCount,
        })
      },
    }
  }
}
