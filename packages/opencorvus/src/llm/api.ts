import {
  APICallError,
  streamObject as streamObjectBase,
  streamText as streamTextBase,
  type StreamTextOnChunkCallback,
  type StreamTextOnErrorCallback,
  type StreamTextOnFinishCallback,
  type StreamTextOnStepFinishCallback,
  type StepResult,
  type ToolSet,
} from "ai"

import { Env } from "@/env"
import { abortableIterable } from "@/util/stream-activity"

type StreamTextOnAbortCallback<TOOLS extends ToolSet> = (event: {
  readonly steps: StepResult<TOOLS>[]
}) => PromiseLike<void> | void

export type TextHooks<TOOLS extends ToolSet = ToolSet> = {
  onAbort?: StreamTextOnAbortCallback<TOOLS>
  onChunk?: StreamTextOnChunkCallback<TOOLS>
  onError?: StreamTextOnErrorCallback
  onFinish?: StreamTextOnFinishCallback<TOOLS>
  onStepFinish?: StreamTextOnStepFinishCallback<TOOLS>
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 250

function timeoutMs(value?: number | false) {
  if (value === false) return undefined
  if (typeof value === "number" && value > 0) return value
  const env = Number.parseInt(Env.get("OPENCORVUS_LLM_TIMEOUT_MS") ?? "", 10)
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS
}

function retries(value?: number) {
  if (typeof value === "number" && value >= 0) return value
  const env = Number.parseInt(Env.get("OPENCORVUS_LLM_MAX_RETRIES") ?? "", 10)
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_RETRIES
}

function retryDelayMs(value?: number) {
  if (typeof value === "number" && value >= 0) return value
  const env = Number.parseInt(Env.get("OPENCORVUS_LLM_RETRY_DELAY_MS") ?? "", 10)
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_RETRY_DELAY_MS
}

function signal(signal?: AbortSignal, timeout?: number | false) {
  const ms = timeoutMs(timeout)
  if (!ms) return signal
  const next = AbortSignal.timeout(ms)
  if (!signal) return next
  return AbortSignal.any([signal, next])
}

function retryable(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true
  if (APICallError.isInstance(error)) return error.isRetryable
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return [
    "timeout",
    "timed out",
    "connectionrefused",
    "econnreset",
    "fetch failed",
    "overloaded",
    "rate limit",
    "too many requests",
  ].some((part) => message.includes(part))
}

async function wait(ms: number, abort?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      abort?.removeEventListener("abort", stop)
      resolve()
    }
    const stop = () => {
      clearTimeout(timer)
      abort?.removeEventListener("abort", stop)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(done, ms)
    abort?.addEventListener("abort", stop, { once: true })
  })
}

async function call<T>(run: (attemptSignal: AbortSignal | undefined) => Promise<T>, input: {
  retries?: number
  retryDelayMs?: number
  abortSignal?: AbortSignal
  timeoutMs?: number | false
}) {
  const max = retries(input.retries)
  const base = retryDelayMs(input.retryDelayMs)
  for (let attempt = 0; attempt <= max; attempt++) {
    // Create a fresh per-attempt timeout signal so earlier timeouts don't poison retries.
    const attemptSignal = signal(input.abortSignal, input.timeoutMs)
    try {
      return await run(attemptSignal)
    } catch (error) {
      if (attempt >= max || !retryable(error)) throw error
      // Use only the caller's abort signal for the delay (not the already-expired per-attempt signal).
      await wait(base * Math.pow(2, attempt), input.abortSignal)
    }
  }
  throw new Error("unreachable")
}

export function streamText<TOOLS extends ToolSet = ToolSet>(
  input: Parameters<typeof streamTextBase<TOOLS>>[0] & {
    timeoutMs?: number | false
    retries?: number
  },
) {
  const { timeoutMs: timeout, retries: count, abortSignal, ...rest } = input
  const composed = signal(abortSignal, timeout)
  const result = streamTextBase({
    ...(rest as Parameters<typeof streamTextBase<TOOLS>>[0]),
    abortSignal: composed,
    maxRetries: retries(count),
  })
  // The AI SDK's fullStream/textStream are AsyncIterableStreams whose
  // backing reader.read() can park indefinitely on a stalled upstream
  // socket; the abortSignal closes the connection but does not reject the
  // pending read. Wrap each iterable so consumers' for-await loops throw
  // an AbortError as soon as `composed` flips, no matter what the SDK /
  // Bun fetch reader does internally. Other properties (usage, response,
  // toAIStreamResponse, …) pass through unchanged via Proxy.
  if (!composed) return result
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (prop === "fullStream") return abortableIterable(target.fullStream, composed)
      if (prop === "textStream") return abortableIterable(target.textStream, composed)
      return Reflect.get(target, prop, receiver)
    },
  })
}

export function streamObject(
  input: Parameters<typeof streamObjectBase>[0] & {
    timeoutMs?: number | false
    retries?: number
  },
) {
  const { timeoutMs: timeout, retries: count, abortSignal, ...rest } = input
  const composed = signal(abortSignal, timeout)
  const result = streamObjectBase({
    ...(rest as Parameters<typeof streamObjectBase>[0]),
    abortSignal: composed,
    maxRetries: retries(count),
  })
  if (!composed) return result
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (prop === "partialObjectStream") return abortableIterable(target.partialObjectStream, composed)
      if (prop === "textStream") return abortableIterable(target.textStream, composed)
      if (prop === "elementStream") {
        const v = (target as any).elementStream
        return v ? abortableIterable(v, composed) : v
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
