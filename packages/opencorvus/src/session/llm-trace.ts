import fs from "fs/promises"
import path from "path"
import type { ModelMessage } from "ai"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"

const log = Log.create({ service: "session.llm-trace" })
const TRACE_DIR = path.join(Global.Path.data, "llm-trace")
const FLAG = "OPENCORVUS_LLM_TRACE"

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

  const writes = new Map<string, Promise<void>>()

  function on(value: string | undefined) {
    if (!value) return false
    const lower = value.trim().toLowerCase()
    return lower === "1" || lower === "true" || lower === "yes" || lower === "on"
  }

  export function enabled() {
    return on(process.env[FLAG])
  }

  export function filepath(sessionID: string) {
    return path.join(TRACE_DIR, `${sessionID}.jsonl`)
  }

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

  function enqueue(sessionID: string, record: CallRecord) {
    const file = filepath(sessionID)
    const row = `${JSON.stringify(record)}\n`
    const prev = writes.get(file) ?? Promise.resolve()
    const next = prev
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.appendFile(file, row, "utf8")
      })
      .catch((error) => {
        log.error("trace write failed", {
          sessionID,
          file,
          error: normalizeError(error),
        })
      })
    writes.set(file, next)
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

  function normalizeStep(step: StepLike, index: number) {
    return {
      index,
      finish_reason: step.finishReason,
      usage: normalize(step.usage),
      request_body: normalize(step.request?.body),
      response: {
        id: step.response.id,
        timestamp: step.response.timestamp.toISOString(),
        model_id: step.response.modelId,
        headers: step.response.headers,
      },
      text: trimText(step.text),
      reasoning_text: step.reasoningText ? trimText(step.reasoningText) : undefined,
      tool_calls: normalize(step.toolCalls),
      tool_results: normalize(step.toolResults),
      warnings: normalize(step.warnings),
    }
  }

  export function begin(input: StartInput): Recorder {
    if (!enabled()) {
      return {
        step() {},
        finish() {},
        abort() {},
        error() {},
      }
    }

    const start = Date.now()
    const steps: StepLike[] = []
    let done = false

    const base = {
      version: 1 as const,
      type: "llm_call" as const,
      call_id: input.callID,
      session_id: input.sessionID,
      user_message_id: input.userMessageID,
      started_at: start,
      model: {
        provider_id: input.model.providerID,
        model_id: input.model.modelID,
      },
      agent: input.agent,
      small: input.small,
      request: {
        system: input.request.system.map((item) => trimText(item)),
        messages: normalize(input.request.messages),
        tools: input.request.tools,
        tool_choice: input.request.toolChoice,
        max_retries: input.request.maxRetries,
        max_output_tokens: input.request.maxOutputTokens,
        temperature: input.request.temperature,
        top_p: input.request.topP,
        top_k: input.request.topK,
        headers: input.request.headers,
        provider_options: normalize(input.request.providerOptions),
      },
    }

    const finalize = (result: {
      status: CallRecord["status"]
      finishReason: string | null
      totalUsage: unknown
      error: unknown
      stepData: readonly StepLike[]
    }) => {
      if (done) return
      done = true
      enqueue(input.sessionID, {
        ...base,
        ended_at: Date.now(),
        status: result.status,
        steps: result.stepData.map((item, index) => normalizeStep(item, index + 1)),
        finish_reason: result.finishReason,
        total_usage: normalize(result.totalUsage),
        error: normalize(result.error),
      })
    }

    return {
      step(step) {
        if (done) return
        steps.push(step)
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
