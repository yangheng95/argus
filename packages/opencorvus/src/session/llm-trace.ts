import type { ModelMessage } from "ai"
import { Trace } from "@/trace"
import { Log } from "@/util/log"

const log = Log.create({ service: "llm-trace" })

// Normalisation limits — keep payloads within Trace's 1MB per-event cap.
const MAX_DEPTH = 8
const MAX_ARRAY = 120
const MAX_KEYS = 120
const MAX_TEXT = 8_000

// Verbose limits — used only for `llm.request` / `llm.outbound` where the goal
// is cache-hit byte-diffing, so we preserve far more of system prompts and
// tool results.  Still bounded to stay under the 1MB per-event line cap even
// with a ~5-turn tool loop and a ~150k-token system stack.
const MAX_DEPTH_VERBOSE = 12
const MAX_ARRAY_VERBOSE = 600
const MAX_KEYS_VERBOSE = 400
const MAX_TEXT_VERBOSE = 64_000

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

  function trimText(text: string, maxText: number) {
    if (text.length <= maxText) return text
    return `${text.slice(0, maxText)}\n...[truncated ${text.length - maxText} chars]`
  }

  interface NormalizeLimits {
    depth: number
    array: number
    keys: number
    text: number
  }

  const NORMAL_LIMITS: NormalizeLimits = { depth: MAX_DEPTH, array: MAX_ARRAY, keys: MAX_KEYS, text: MAX_TEXT }
  const VERBOSE_LIMITS: NormalizeLimits = {
    depth: MAX_DEPTH_VERBOSE, array: MAX_ARRAY_VERBOSE, keys: MAX_KEYS_VERBOSE, text: MAX_TEXT_VERBOSE,
  }

  function normalizeWith(value: unknown, limits: NormalizeLimits, depth = 0, seen?: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value
    if (typeof value === "number" || typeof value === "boolean") return value
    if (typeof value === "string") {
      if (value.startsWith("data:") && value.length > limits.text) {
        const comma = value.indexOf(",")
        if (comma > 0) {
          // For cache-diff purposes we keep a stable hash-substitute so that
          // byte-identical base64 blobs yield byte-identical trace entries.
          const head = value.slice(0, comma + 1)
          const bodyLen = value.length - comma - 1
          const sample = value.slice(comma + 1, comma + 17) // first 16 base64 chars is enough to detect drift
          return `${head}${sample}...[base64 omitted ${bodyLen} chars]`
        }
      }
      return trimText(value, limits.text)
    }
    if (value instanceof Date) return value.toISOString()
    if (typeof value === "bigint") return value.toString()
    if (depth >= limits.depth) return "[max-depth]"

    if (Array.isArray(value)) {
      const list = value.slice(0, limits.array).map((item) => normalizeWith(item, limits, depth + 1, seen))
      if (value.length > limits.array) list.push(`[+${value.length - limits.array} items]`)
      return list
    }

    if (typeof value === "object") {
      const set = seen ?? new WeakSet<object>()
      if (set.has(value)) return "[circular]"
      set.add(value)
      const entries = Object.entries(value as Record<string, unknown>)
      const obj: Record<string, unknown> = {}
      for (const [index, [key, val]] of entries.entries()) {
        if (index >= limits.keys) {
          obj["..."] = `[+${entries.length - limits.keys} keys]`
          break
        }
        obj[key] = normalizeWith(val, limits, depth + 1, set)
      }
      return obj
    }

    return String(value)
  }

  function normalize(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
    return normalizeWith(value, NORMAL_LIMITS, depth, seen)
  }

  function normalizeVerbose(value: unknown): unknown {
    return normalizeWith(value, VERBOSE_LIMITS, 0)
  }

  /**
   * Test-only: expose the two normalise profiles for unit tests without
   * forcing them through the full `begin()` path (which depends on DB-backed
   * session resolution).  Production code MUST NOT import this.
   */
  export const _internalsForTest = {
    normalize: (v: unknown) => normalize(v),
    normalizeVerbose: (v: unknown) => normalizeVerbose(v),
    limits: { normal: NORMAL_LIMITS, verbose: VERBOSE_LIMITS },
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

    // Full pre-transform request — the authoritative input for cache-diffing.
    // This is what LLMTrace.begin sees BEFORE wrapModel / applyCaching runs,
    // so consumers can reason about divergence separately from provider-specific
    // normalization. The post-transform body is captured per-step via
    // step.request.body (see below).
    Trace.event({
      ...traceMeta,
      category: "llm.request",
      payload: {
        call_id: input.callID,
        model: { providerID: input.model.providerID, modelID: input.model.modelID },
        small: input.small,
        request: {
          system: normalizeVerbose(input.request.system),
          messages: normalizeVerbose(input.request.messages),
          tools: input.request.tools,
          toolChoice: input.request.toolChoice,
          maxRetries: input.request.maxRetries,
          maxOutputTokens: input.request.maxOutputTokens,
          temperature: input.request.temperature,
          topP: input.request.topP,
          topK: input.request.topK,
          headers: normalizeVerbose(input.request.headers),
          providerOptions: normalizeVerbose(input.request.providerOptions),
        },
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
        // Raw outbound body — what the AI SDK actually serialised and sent
        // over the wire for this round (post transform / post cache_control).
        // Captured here and not at begin() because the middleware mutates
        // messages on each step, so a single request-at-start snapshot is
        // stale by the time the model replies.  step.request.body is the
        // vendor-neutral representation (JSON, already normalised by the AI
        // SDK).  Fall back gracefully when a provider doesn't populate it.
        if (step.request?.body !== undefined) {
          Trace.event({
            ...traceMeta,
            category: "llm.outbound",
            round: stepCount,
            payload: {
              call_id: input.callID,
              response_id: step.response?.id,
              response_model: step.response?.modelId,
              body: normalizeVerbose(step.request.body),
              response_headers: normalizeVerbose(step.response?.headers),
            },
          })
        }
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
